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
            // sidecar's 30 s shutdown grace so the database stop is never cut short.
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(45));
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

/// The liveness rule: every 2 s, `/health` on the managed backend port + the page-load
/// signal decide whether the ui-dispatch menu items are enabled. Both signals are
/// shell-observed; a dead or wedged webview can only disable the menus, never fake them.
fn spawn_liveness_rule(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last = false;
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
