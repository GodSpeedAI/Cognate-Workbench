// Cognate Workbench desktop shell.
//
// Owns the native window and the lifecycle of the local Cognate backend process.
// The webview loads the backend's own URL (http://127.0.0.1:<port>), which is a
// remote context for Tauri: with no capability files shipped, the web content gets
// no Tauri IPC at all. That is deliberate — see README.md in this directory.

mod backend;
mod menu;
mod title;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    Manager,
};

/// The menu-liveness rule (design §1): ui-dispatch menu items are enabled only once the
/// managed backend answers `/health` AND the main webview has finished loading a page —
/// the shell's two observable signals that the web app (and its bridge) is there. The
/// handles are updated in place; the menu is never rebuilt for a liveness flip.
struct WorkbenchItems {
    enabled: AtomicBool,
    items: Vec<MenuItem<tauri::Wry>>,
}

pub fn run() {
    let single = tauri_plugin_single_instance::init(|app, _args, _cwd| {
        // A second launch focuses the existing window; the backend is reused via its lock file.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    });

    let window_state = tauri_plugin_window_state::Builder::default().build();

    tauri::Builder::default()
        .plugin(single)
        .plugin(window_state)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(Mutex::new(1.0f64));
            app.manage(backend::PageReady::default());
            let workbench = build_menu(app)?;
            app.manage(WorkbenchItems {
                enabled: AtomicBool::new(false),
                items: workbench,
            });
            backend::launch(app.handle().clone());
            spawn_liveness_rule(app.handle().clone());
            install_signal_handlers(app.handle().clone());
            Ok(())
        })
        .on_menu_event(|app, event| {
            handle_menu_event(app, event.id().as_ref());
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::WindowEvent { label, event, .. } => {
                if label == "main" {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        close_requested(app, api);
                    }
                }
            }
            tauri::RunEvent::ExitRequested { .. } => {
                if let Some(handle) = app.try_state::<backend::BackendHandle>() {
                    backend::shutdown(&handle);
                }
            }
            tauri::RunEvent::Exit => {
                if let Some(handle) = app.try_state::<backend::BackendHandle>() {
                    backend::shutdown(&handle);
                }
            }
            _ => {}
        });
}

/// The fail-closed close guard (design §2), scoped by backend ownership:
/// - reused backend: the shell exits; the backend keeps its own owner — nothing to confirm.
/// - shell-owned backend: confirm before close whenever work is in flight (the server's own
///   `/health` run counts — the machine authority) OR the state cannot be read (probe
///   failure, missing counts). A dead or wedged webview can never suppress the confirm,
///   because the signal comes from the server side, not the page.
fn close_requested(app: &tauri::AppHandle, api: tauri::CloseRequestApi) {
    if !backend::shell_owned_backend(app) {
        return; // reused backend: closing the shell leaves it with its owner
    }
    let port = backend::backend_port(app);
    let state = backend::health_state(port);
    let known_idle = state.healthy
        && state.runs_in_flight.is_some()
        && state.pending_approvals.is_some()
        && state.runs_in_flight == Some(0)
        && state.pending_approvals == Some(0);
    if known_idle {
        return; // idle and healthy: close proceeds
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let app = app.clone();
    api.prevent_close();
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .message("A run is in flight or its state is unknown. Quit and stop the agent run?")
        .title("Quit Cognate Workbench")
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
            "Quit and stop".to_string(),
            "Keep working".to_string(),
        ))
        .show(move |confirmed| {
            if confirmed {
                // destroy() bypasses the close-request guard; ExitRequested then runs the
                // normal shutdown (SIGTERM, pg0 stop, lock release).
                let _ = window.destroy();
            }
        });
}

/// Tauri installs no Unix signal handlers: an external SIGTERM would orphan the
/// managed backend. Route SIGTERM/SIGINT through app.exit so the normal shutdown
/// path (SIGTERM to the child, pg0 stop, lock release) runs.
#[cfg(unix)]
fn install_signal_handlers(app: tauri::AppHandle) {
    use signal_hook::consts::{SIGINT, SIGTERM};
    use signal_hook::iterator::Signals;
    let mut signals = Signals::new([SIGTERM, SIGINT]).expect("signal registration");
    std::thread::spawn(move || {
        if let Some(signal) = signals.forever().next() {
            backend::log_shell(&format!("signal {signal}: shutting down"));
            app.exit(0);
            // If the event loop is wedged, do not leave the backend behind — but outlast the
            // sidecar's 60 s shutdown grace so the database stop is never cut short.
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(90));
                std::process::exit(0);
            });
        }
    });
}

#[cfg(not(unix))]
fn install_signal_handlers(_app: tauri::AppHandle) {}

fn build_menu(app: &tauri::App) -> tauri::Result<Vec<MenuItem<tauri::Wry>>> {
    let reload = MenuItem::with_id(app, "wb-reload", "Reload", true, None::<&str>)?;
    let mut view = SubmenuBuilder::new(app, "View").item(&reload);
    if cfg!(debug_assertions) {
        let devtools = MenuItem::with_id(
            app,
            "wb-devtools",
            "Toggle Developer Tools",
            true,
            None::<&str>,
        )?;
        view = view.separator().item(&devtools);
    }
    let view = view.build()?;

    let zoom_in = MenuItem::with_id(app, "wb-zoom-in", "Zoom In", true, None::<&str>)?;
    let zoom_out = MenuItem::with_id(app, "wb-zoom-out", "Zoom Out", true, None::<&str>)?;
    let zoom_reset = MenuItem::with_id(app, "wb-zoom-reset", "Reset Zoom", true, None::<&str>)?;
    let zoom_menu = SubmenuBuilder::new(app, "Zoom")
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .build()?;

    let close = PredefinedMenuItem::close_window(app, None::<&str>)?;
    let file = SubmenuBuilder::new(app, "File").item(&close).build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // The Workbench menu is the committed menu map (menu.rs): ui-dispatch items start
    // disabled until the liveness rule enables them.
    let (workbench, workbench_items) = menu::build_workbench_menu(app.handle())?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&zoom_menu)
        .build()?;

    let mut menu = MenuBuilder::new(app)
        .item(&file)
        .item(&edit)
        .item(&workbench)
        .item(&view)
        .item(&window);
    if cfg!(target_os = "macos") {
        let about = PredefinedMenuItem::about(app, None::<&str>, None)?;
        let quit = PredefinedMenuItem::quit(app, None::<&str>)?;
        menu = menu.item(&about).separator().item(&quit);
    }
    app.set_menu(menu.build()?)?;
    Ok(workbench_items)
}

/// The shell watch: every 2 s, (1) the menu-liveness rule — `/health` on the managed
/// backend port + the page-load signal decide whether the ui-dispatch menu items are
/// enabled (both signals shell-observed; a dead or wedged webview can only disable the
/// menus, never fake them) — and (2) the attention cue — a title that parses to a
/// waiting-on-you state while the window is unfocused raises one user-attention request,
/// on the transition only, so an unfocused cockpit still summons its operator.
fn spawn_liveness_rule(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last = false;
        let mut attention_out = false;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let Some(state) = app.try_state::<WorkbenchItems>() else {
                return;
            };
            let port = backend::backend_port(&app);
            let healthy = port != 0 && backend::probe_health(port);
            let page_ready = app
                .try_state::<backend::PageReady>()
                .map(|p| p.0.load(Ordering::Relaxed))
                .unwrap_or(false);
            let enabled = healthy && page_ready;
            if enabled != last {
                for item in &state.items {
                    let _ = item.set_enabled(enabled);
                }
                state.enabled.store(enabled, Ordering::Relaxed);
                last = enabled;
            }

            // Attention cue (design §2): title is the human cue; fail-open by contract —
            // a missed cue is harmless, a wrong one would not be, so only a strict parse
            // of a waiting-on-you state fires, and only on the unfocused transition.
            if let Some(window) = app.get_webview_window("main") {
                let focused = window.is_focused().unwrap_or(true);
                let wants_attention = match window.title().ok().as_deref().map(title::parse_title) {
                    Some(Some(state)) => !matches!(state, title::TitleState::Idle),
                    _ => false,
                };
                let should = wants_attention && !focused;
                if should && !attention_out {
                    use tauri::UserAttentionType;
                    let _ = window.request_user_attention(Some(UserAttentionType::Informational));
                }
                attention_out = should;
            } else {
                attention_out = false;
            }
        }
    });
}

fn handle_menu_event(app: &tauri::AppHandle, id: &str) {
    // ui-dispatch items (the menu map): route into the web app's bridge, only while the
    // liveness rule says the bridge is there. Disabled items cannot be clicked; the guard
    // is defense against a stale event racing a liveness flip.
    if menu::UI_ACTION_IDS.contains(&id) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let ready = app
            .try_state::<WorkbenchItems>()
            .map(|s| s.enabled.load(Ordering::Relaxed))
            .unwrap_or(false);
        if ready {
            let _ = window.eval(menu::dispatch_script(id));
        }
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let zoom = app.state::<Mutex<f64>>();
    match id {
        "wb-reload" => {
            let _ = window.eval("location.reload()");
        }
        "wb-devtools" => {
            // Devtools exist implicitly in debug builds; a release build has no such surface.
            #[cfg(debug_assertions)]
            {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        "wb-zoom-in" => {
            let mut level = zoom.lock().expect("zoom state poisoned");
            *level = (*level + 0.1).min(3.0);
            let _ = window.set_zoom(*level);
        }
        "wb-zoom-out" => {
            let mut level = zoom.lock().expect("zoom state poisoned");
            *level = (*level - 0.1).max(0.5);
            let _ = window.set_zoom(*level);
        }
        "wb-zoom-reset" => {
            let mut level = zoom.lock().expect("zoom state poisoned");
            *level = 1.0;
            let _ = window.set_zoom(1.0);
        }
        _ => {}
    }
}
