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

/// Entry point called from setup: resolves the backend, then opens a window.
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
    thread::spawn(move || match start_backend(resource_root) {
        Ok(Started::Spawned { port, child, log }) => {
            app.manage(BackendHandle {
                child: Mutex::new(Some(child)),
            });
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
            app.manage(BackendHandle {
                child: Mutex::new(None),
            });
            if let Err(error) = open_main_window(&app, port) {
                open_error_window(
                    &app,
                    &format!("failed to open the main window: {error}"),
                    &log,
                );
            }
        }
        Err(BackendError { reason, log }) => {
            app.manage(BackendHandle {
                child: Mutex::new(None),
            });
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

    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        if probe_health(port) {
            append_log(&log, &format!("backend ready on port {port}"));
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
            let _ = child.kill();
            return Err(BackendError {
                reason: "the backend did not become ready within 60 seconds".into(),
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
            name.starts_with("cognate-workbench-") && TRIPLES.iter().any(|triple| name.contains(triple))
        })
        .collect();
    candidates.sort();
    candidates.into_iter().next()
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

fn probe_health(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1000)));
    let request =
        format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut body = String::new();
    if stream.read_to_string(&mut body).is_err() {
        return false;
    }
    body.contains("\"ok\":true") || body.contains("\"ok\": true")
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
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log) {
        let _ = file.write_all(text.as_bytes());
    }
}

fn open_main_window(app: &AppHandle, port: u16) -> tauri::Result<()> {
    let url = tauri::Url::parse(&format!("http://127.0.0.1:{port}/"))
        .expect("localhost URL always parses");
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Cognate Workbench")
        .inner_size(1440.0, 920.0)
        .min_inner_size(960.0, 600.0)
        .zoom_hotkeys_enabled(true)
        .build()?;
    Ok(())
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

/// Watches the spawned backend: if it dies while the app is running, surface an
/// error window instead of leaving a dead webview.
fn spawn_watchdog(app: AppHandle, log: PathBuf) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let Some(state) = app.try_state::<BackendHandle>() else {
            return; // shell is shutting down
        };
        let mut guard = match state.child.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => {
                    *guard = None; // already exited; shutdown becomes a no-op
                    drop(guard);
                    open_error_window(
                        &app,
                        &format!("the backend process exited unexpectedly (exit status: {status})"),
                        &log,
                    );
                    return;
                }
                Ok(None) => {}
                Err(_) => return, // status unavailable; treat as running
            },
            None => return, // reused backend: its owner manages it
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
    let deadline = Instant::now() + Duration::from_secs(10);
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
