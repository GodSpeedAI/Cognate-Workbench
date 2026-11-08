// Managed backend lifecycle: pick a port, spawn (or reuse) the Cognate server,
// wait for readiness, then open the webview on it. Closing the shell stops the
// server it started; a reused server keeps its owner.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Deserialize)]
struct LockFile {
    pid: u32,
    port: u16,
}

/// Managed-state handle for the spawned backend (empty when a live instance was reused
/// or startup failed).
pub struct BackendHandle {
    child: Mutex<Option<Child>>,
}

/// The managed backend's loopback port (0 when startup failed). The liveness rule in
/// `lib.rs` probes `/health` on it; the close guard (B4) will too.
#[derive(Default)]
pub struct BackendPort(std::sync::atomic::AtomicU16);

/// The main webview finished loading a page. One half of the menu-liveness rule
/// (with `/health`); the web app's bridge is expected to be registered by then.
#[derive(Default)]
pub struct PageReady(pub std::sync::atomic::AtomicBool);

pub fn backend_port(app: &AppHandle) -> u16 {
    app.try_state::<BackendPort>()
        .map(|p| p.0.load(std::sync::atomic::Ordering::Relaxed))
        .unwrap_or(0)
}

/// True when the shell spawned the backend it is serving from (false on the reuse path,
/// where the backend belongs to its own owner). The close contract (design §2) is scoped by
/// this: closing the shell stops what it started and never touches another owner's server.
pub fn shell_owned_backend(app: &AppHandle) -> bool {
    app.try_state::<BackendHandle>()
        .map(|handle| {
            handle
                .child
                .lock()
                .map(|guard| guard.is_some())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// Entry point called from setup: resolves the backend, then opens a window. The managed
/// handles exist from the first moment (empty), so an early quit always has a kill path —
/// the health wait can no longer race the exit (design §3).
pub fn launch(app: AppHandle) {
    let resource_root = if cfg!(debug_assertions) {
        None
    } else {
        // Must mirror the layout tauri.conf.json declares under bundle.resources:
        // src-tauri/resources/cognate-workbench lands at <resource dir>/resources/cognate-workbench.
        app.path()
            .resource_dir()
            .ok()
            .map(|dir| dir.join("resources").join("cognate-workbench"))
    };
    app.manage(BackendHandle {
        child: Mutex::new(None),
    });
    app.manage(BackendPort::default());
    thread::spawn(move || match start_backend(resource_root) {
        Ok(Started::Spawned { port, child, log }) => {
            if let Some(state) = app.try_state::<BackendHandle>() {
                if let Ok(mut guard) = state.child.lock() {
                    *guard = Some(child);
                }
            }
            if let Some(state) = app.try_state::<BackendPort>() {
                state.0.store(port, std::sync::atomic::Ordering::Relaxed);
            }
            spawn_watchdog(app.clone(), log.clone());
            if let Err(error) = open_main_window(&app, port) {
                open_error_window(
                    &app,
                    &format!("failed to open the main window: {error}"),
                    &log,
                );
            }
        }
        Ok(Started::Reused { port, log }) => {
            if let Some(state) = app.try_state::<BackendPort>() {
                state.0.store(port, std::sync::atomic::Ordering::Relaxed);
            }
            spawn_watchdog(app.clone(), log.clone());
            if let Err(error) = open_main_window(&app, port) {
                open_error_window(
                    &app,
                    &format!("failed to open the main window: {error}"),
                    &log,
                );
            }
        }
        Err(BackendError { reason, log }) => {
            open_error_window(&app, &reason, &log);
        }
    });
}

enum Started {
    Spawned {
        port: u16,
        child: Child,
        log: PathBuf,
    },
    Reused {
        port: u16,
        log: PathBuf,
    },
}

struct BackendError {
    reason: String,
    log: PathBuf,
}

fn start_backend(resource_root: Option<PathBuf>) -> Result<Started, BackendError> {
    let home = data_home();
    if let Err(error) = fs::create_dir_all(&home) {
        return Err(BackendError {
            reason: format!("cannot create the data home {}: {error}", home.display()),
            log: home.join("desktop-shell.log"),
        });
    }
    let log = home.join("desktop-shell.log");

    if let Some(port) = reuse_live_instance(&home) {
        append_log(&log, &format!("reusing running instance on port {port}"));
        return Ok(Started::Reused { port, log });
    }

    let port = pick_free_port().ok_or_else(|| BackendError {
        reason: "no free local port available".into(),
        log: log.clone(),
    })?;

    let mut command = backend_command();
    command
        .env("PORT", port.to_string())
        .env("COGNATE_NO_WINDOW", "1")
        // The shell identity on /health (B5): the sidecar reports which surface spawned this
        // boot. The --app surface sets its own in cli.ts; the Tauri shell does it here, from
        // the crate version (kept in step with package.json's 0.1.0).
        .env(
            "COGNATE_SHELL",
            concat!("tauri@", env!("CARGO_PKG_VERSION")),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = resource_root {
        // Packaged resources (browser assets, .sea model, bundled pg0) resolve through
        // COGNATE_RESOURCE_DIR; src/resources.ts honors this override.
        command.env("COGNATE_RESOURCE_DIR", dir);
    }

    append_log(&log, &format!("starting backend on port {port}"));
    let mut child = command.spawn().map_err(|error| BackendError {
        reason: format!("failed to start the backend process: {error}"),
        log: log.clone(),
    })?;

    pump_output(&mut child, &log);

    // Startup budgets (design §3): a first boot initializes the bundled database, which is
    // measurable and one-time — 180 s; a steady boot re-attaches — 60 s. The measured times
    // are logged at readiness and recorded in the mission's verification log.
    let first_boot = !home.join("database").exists();
    let budget_secs = if first_boot { 180 } else { 60 };
    let started_at = Instant::now();
    let deadline = started_at + Duration::from_secs(budget_secs);
    loop {
        if probe_health(port) {
            let elapsed = started_at.elapsed().as_secs();
            append_log(
                &log,
                &format!(
                    "backend ready on port {port} after {elapsed}s ({budget_secs}s budget, {} boot)",
                    if first_boot { "first" } else { "steady" }
                ),
            );
            return Ok(Started::Spawned { port, child, log });
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(BackendError {
                reason: format!(
                    "the backend process exited during startup (exit status: {status})"
                ),
                log,
            });
        }
        if Instant::now() > deadline {
            // A timed-out backend gets the same graceful stop the shutdown path uses —
            // SIGTERM with the 30 s database-stop grace — because SIGKILLing it here would
            // orphan the bundled pg0 exactly the way the 10 s shutdown window once did.
            append_log(
                &log,
                &format!("backend not ready within {budget_secs}s; requesting a clean stop"),
            );
            terminate(&mut child);
            let tail = log_tail(&log, 2000);
            return Err(BackendError {
                reason: format!(
                    "the backend did not become ready within {budget_secs}s; it was asked to stop cleanly. Its own last output:\n{}",
                    tail
                ),
                log,
            });
        }
        thread::sleep(Duration::from_millis(250));
    }
}

/// Dev builds run the server straight from the checkout; release builds run the
/// Bun-compiled sidecar placed next to the shell executable.
fn backend_command() -> Command {
    if cfg!(debug_assertions) {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri always has a parent")
            .to_path_buf();
        let mut command = Command::new("bun");
        command
            .args(["src/cli.ts", "start"])
            .current_dir(&repo_root);
        command
    } else {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .expect("the shell executable always has a parent");
        let sidecar = find_sidecar(&exe_dir).unwrap_or_else(|| exe_dir.join("cognate-workbench"));
        Command::new(sidecar)
    }
}

fn find_sidecar(dir: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                return false;
            };
            // The shell binary itself ("cognate-workbench-shell") shares the prefix; spawning
            // it would trip the single-instance plugin and exit 0. Match the shipped target
            // triples explicitly instead of any shared-prefix name.
            const TRIPLES: [&str; 3] = ["-unknown-linux-gnu", "-apple-darwin", "-pc-windows-msvc"];
            name.starts_with("cognate-workbench-")
                && TRIPLES.iter().any(|triple| name.contains(triple))
        })
        .collect();
    candidates.sort();
    candidates.into_iter().next()
}

#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    // signal 0: existence check only
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(not(unix))]
fn pid_alive(_pid: u32) -> bool {
    // Without a process check on Windows, rely on the /health probe below.
    true
}

fn reuse_live_instance(home: &Path) -> Option<u16> {
    let lock_path = home.join("server.lock");
    let raw = fs::read_to_string(lock_path).ok()?;
    let lock: LockFile = serde_json::from_str(&raw).ok()?;
    if !pid_alive(lock.pid) {
        return None;
    }
    if probe_health(lock.port) {
        Some(lock.port)
    } else {
        None
    }
}

fn pick_free_port() -> Option<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    drop(listener);
    Some(port)
}

pub fn probe_health(port: u16) -> bool {
    let Some(body) = health_body(port) else {
        return false;
    };
    let ok = body.contains("\"ok\":true") || body.contains("\"ok\": true");
    if !ok {
        // A parseable-but-unexpected /health body means the contract changed under us —
        // record the raw body once it happens, instead of failing silently (design §3).
        append_log(
            &data_home().join("desktop-shell.log"),
            &format!(
                "[shell] /health answered, but not ok: {}",
                body.chars().take(400).collect::<String>()
            ),
        );
    }
    ok
}

/// The `/health` body, or None when the backend does not answer. Raw text; callers parse
/// what they need.
fn health_body(port: u16) -> Option<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
    stream
        .set_read_timeout(Some(Duration::from_millis(1000)))
        .ok()?;
    let request =
        format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut body = String::new();
    stream.read_to_string(&mut body).ok()?;
    Some(body)
}

/// The close guard's machine inputs (design §2): whether the backend is healthy and, when
/// the server reports them, the runs-in-flight and pending-approval counts. `None` counts
/// are unknown state — the caller decides fail-closed.
pub struct HealthState {
    pub healthy: bool,
    pub runs_in_flight: Option<u32>,
    pub pending_approvals: Option<u32>,
}

pub fn health_state(port: u16) -> HealthState {
    let Some(body) = health_body(port) else {
        return HealthState {
            healthy: false,
            runs_in_flight: None,
            pending_approvals: None,
        };
    };
    // The body is JSON after the blank line that ends the HTTP headers.
    let json = body.split("\r\n\r\n").nth(1).unwrap_or("");
    let parsed: Option<serde_json::Value> = serde_json::from_str(json.trim()).ok();
    let value = parsed.unwrap_or(serde_json::Value::Null);
    let healthy = value.get("ok").and_then(|ok| ok.as_bool()).unwrap_or(false);
    let count = |name: &str| value.get(name).and_then(|n| n.as_u64()).map(|n| n as u32);
    HealthState {
        healthy,
        runs_in_flight: count("runsInFlight"),
        pending_approvals: count("pendingApprovals"),
    }
}

fn pump_output(child: &mut Child, log: &Path) {
    if let Some(stdout) = child.stdout.take() {
        let log = log.to_path_buf();
        thread::spawn(move || stream_to_log(stdout, &log));
    }
    if let Some(stderr) = child.stderr.take() {
        let log = log.to_path_buf();
        thread::spawn(move || stream_to_log(stderr, &log));
    }
}

fn stream_to_log<R: Read + Send + 'static>(mut stream: R, log: &Path) {
    let mut buffer = [0u8; 4096];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(read) => {
                let text = String::from_utf8_lossy(&buffer[..read]);
                append_log_raw(log, &text);
            }
        }
    }
}

fn append_log(log: &Path, line: &str) {
    append_log_raw(log, &format!("{line}\n"));
}

/// Shell-side log lines (signal shutdowns, reuse decisions) share the backend's log file.
pub fn log_shell(line: &str) {
    let log = data_home().join("desktop-shell.log");
    append_log(&log, &format!("[shell] {line}\n"));
}

fn append_log_raw(log: &Path, text: &str) {
    // Size-capped rotation (design §3): two pump threads write everything the sidecar says,
    // unbounded until now. At 5 MB the log moves to `.1` (one rotated file retained) and the
    // current file starts fresh.
    if let Ok(metadata) = fs::metadata(log) {
        if metadata.len() > 5 * 1024 * 1024 {
            let rotated = log.with_extension("log.1");
            let _ = fs::rename(log, &rotated);
        }
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log) {
        let _ = file.write_all(text.as_bytes());
    }
}

/// The last `max_bytes` of a log file, for surfacing the sidecar's own words in an error.
fn log_tail(log: &Path, max_bytes: usize) -> String {
    match fs::read(log) {
        Ok(bytes) => {
            let start = bytes.len().saturating_sub(max_bytes);
            String::from_utf8_lossy(&bytes[start..]).to_string()
        }
        Err(_) => String::new(),
    }
}

fn open_main_window(app: &AppHandle, port: u16) -> tauri::Result<()> {
    let url = tauri::Url::parse(&format!("http://127.0.0.1:{port}/"))
        .expect("localhost URL always parses");
    let nav_app = app.clone();
    let new_window_app = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Cognate Workbench")
        .inner_size(1440.0, 920.0)
        .min_inner_size(960.0, 600.0)
        .zoom_hotkeys_enabled(true)
        .on_page_load(|window, payload| {
            // One half of the menu-liveness rule: the web app's document is live (the
            // bridge registers on mount). A later reload re-fires this.
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                window
                    .app_handle()
                    .state::<PageReady>()
                    .0
                    .store(true, std::sync::atomic::Ordering::Relaxed);
            }
        })
        .on_navigation(move |url| {
            // The external-link contract (design §2): loopback stays in-app; every other
            // host opens in the system browser via the opener plugin (Rust-invoked only —
            // no capability grant to web content), http(s) only.
            let host = url.host_str().unwrap_or("");
            if host == "127.0.0.1" || host == "localhost" {
                return true;
            }
            open_externally(&nav_app, url.clone());
            false
        })
        .on_new_window(move |url, _| {
            // No in-app popups: target="_blank" links to other hosts open in the system
            // browser; anything else (blob previews, foreign schemes) is denied — the web
            // app's own honest fallback text covers the blocked cases.
            let host = url.host_str().unwrap_or("");
            let external = matches!(url.scheme(), "http" | "https")
                && host != "127.0.0.1"
                && host != "localhost";
            if external {
                open_externally(&new_window_app, url.clone());
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

fn open_externally(app: &AppHandle, url: tauri::Url) {
    use tauri_plugin_opener::OpenerExt;
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        append_log(
            &data_home().join("desktop-shell.log"),
            &format!("[shell] could not open {url} externally: {error}\n"),
        );
    }
}

fn open_error_window(app: &AppHandle, reason: &str, log: &Path) {
    append_log(log, &format!("error: {reason}"));
    let query = format!(
        "index.html?reason={}&log={}",
        uri_encode(reason),
        uri_encode(&log.display().to_string())
    );
    let builder = WebviewWindowBuilder::new(app, "error", WebviewUrl::App(query.into()))
        .title("Cognate Workbench")
        .inner_size(720.0, 420.0)
        .resizable(true);
    if let Err(error) = builder.build() {
        append_log(
            log,
            &format!("error: could not open the error window: {error}"),
        );
    }
}

fn uri_encode(raw: &str) -> String {
    let mut encoded = String::new();
    for byte in raw.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

/// Watches the backend for the two failures that strand the operator (design §3): the
/// spawned process dying (exit watchdog, as before) and — new — the backend hanging while
/// alive or a REUSED owner dying, caught by a `/health` probe every 5 s with a
/// two-consecutive-failure threshold. The recovery surface names what happened, who owns
/// the lock, and the move that fixes it; the backend itself is left to its owner unless
/// the shell spawned it (the exit arm stops it through the normal shutdown path).
fn spawn_watchdog(app: AppHandle, log: PathBuf) {
    thread::spawn(move || {
        let mut health_failures = 0u32;
        loop {
            thread::sleep(Duration::from_secs(5));
            let Some(state) = app.try_state::<BackendHandle>() else {
                return; // shell is shutting down
            };
            let mut shell_owned = false;
            {
                let mut guard = match state.child.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                match guard.as_mut() {
                    Some(child) => {
                        shell_owned = true;
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                *guard = None; // already exited; shutdown becomes a no-op
                                drop(guard);
                                open_error_window(
                                    &app,
                                    &format!(
                                        "the backend process exited unexpectedly (exit status: {status}).\
                                         \n\nRelaunch the app to start a new one; your sessions and settings\
                                         \nare durable in the data home."
                                    ),
                                    &log,
                                );
                                return;
                            }
                            Ok(None) => {}
                            Err(_) => {}
                        }
                    }
                    None => {
                        // Reused backend: its owner manages its lifetime; the shell only
                        // watches so the window is never a silent zombie.
                    }
                }
            }
            let port = backend_port(&app);
            if port == 0 {
                continue;
            }
            if probe_health(port) {
                health_failures = 0;
                continue;
            }
            health_failures += 1;
            if health_failures >= 2 {
                let ownership = if shell_owned {
                    "The app owns this backend and will stop it on exit if it returns."
                } else {
                    "The backend was started outside this window (its owner is recorded in server.lock); this window will not stop it."
                };
                open_error_window(
                    &app,
                    &format!(
                        "the backend stopped answering /health (2 consecutive failures).\
                         \n\n{ownership}\
                         \n\nRelaunch the app to attach to a running server or start a new one;\
                         \nyour sessions and settings are durable in the data home."
                    ),
                    &log,
                );
                return;
            }
        }
    });
}

/// Stop the spawned backend gracefully. Reused backends are left to their owner.
pub fn shutdown(handle: &tauri::State<'_, BackendHandle>) {
    if let Ok(mut guard) = handle.child.lock() {
        if let Some(mut child) = guard.take() {
            terminate(&mut child);
        }
    }
}

fn terminate(child: &mut Child) {
    #[cfg(unix)]
    {
        if let Ok(pid) = i32::try_from(child.id()) {
            unsafe {
                libc::kill(pid, libc::SIGTERM);
            }
        }
    }
    #[cfg(not(unix))]
    {
        // Windows: no portable SIGTERM for a detached child. The clean-stop gap matches
        // the standalone package's documented Windows limitation (see README.md).
        let _ = child.kill();
    }
    // The sidecar's clean stop covers app teardown (terminal/browser/preview disposal) AND the
    // bundled database's own stop. Ten seconds SIGKILLed it mid-cleanup, leaving an orphaned
    // pg0 behind — observed on this host. Thirty seconds covers a checkpointing database.
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => thread::sleep(Duration::from_millis(100)),
        }
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn data_home() -> PathBuf {
    if let Some(home) = std::env::var_os("COGNATE_WORKBENCH_HOME") {
        return PathBuf::from(home);
    }
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri always has a parent")
            .join(".data");
    }
    if cfg!(target_os = "windows") {
        return std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(default_home_fallback)
            .join("CognateWorkbench");
    }
    if cfg!(target_os = "macos") {
        return dirs_home()
            .join("Library")
            .join("Application Support")
            .join("CognateWorkbench");
    }
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(xdg).join("cognate-workbench");
    }
    dirs_home()
        .join(".local")
        .join("share")
        .join("cognate-workbench")
}

fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(default_home_fallback)
}

fn default_home_fallback() -> PathBuf {
    PathBuf::from(".")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_selection_skips_the_shell_binary() {
        let dir = std::env::temp_dir().join(format!("wb-sidecar-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("cognate-workbench-shell"), b"").unwrap();
        fs::write(dir.join("cognate-workbench-x86_64-unknown-linux-gnu"), b"").unwrap();
        let found = find_sidecar(&dir).unwrap();
        assert!(found.to_string_lossy().contains("x86_64-unknown-linux-gnu"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn sidecar_selection_is_none_without_a_candidate() {
        let dir = std::env::temp_dir().join(format!("wb-sidecar-empty-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert!(find_sidecar(&dir).is_none());
        fs::remove_dir_all(&dir).ok();
    }
}
