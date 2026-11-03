// Cognate Workbench desktop shell.
//
// Owns the native window and the lifecycle of the local Cognate backend process.
// The webview loads the backend's own URL (http://127.0.0.1:<port>), which is a
// remote context for Tauri: with no capability files shipped, the web content gets
// no Tauri IPC at all. That is deliberate — see README.md in this directory.

mod backend;

use std::sync::Mutex;

use tauri::{
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    Manager,
};

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
            build_menu(app)?;
            backend::launch(app.handle().clone());
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
            // If the event loop is wedged, do not leave the backend behind.
            std::thread::spawn(|| {
                std::thread::sleep(std::time::Duration::from_secs(12));
                std::process::exit(0);
            });
        }
    });
}

#[cfg(not(unix))]
fn install_signal_handlers(_app: tauri::AppHandle) {}

fn build_menu(app: &tauri::App) -> tauri::Result<()> {
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

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&zoom_menu)
        .build()?;

    let mut menu = MenuBuilder::new(app)
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&window);
    if cfg!(target_os = "macos") {
        let about = PredefinedMenuItem::about(app, None::<&str>, None)?;
        let quit = PredefinedMenuItem::quit(app, None::<&str>)?;
        menu = menu.item(&about).separator().item(&quit);
    }
    app.set_menu(menu.build()?)?;
    Ok(())
}

fn handle_menu_event(app: &tauri::AppHandle, id: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let zoom = app.state::<Mutex<f64>>();
    match id {
        "wb-reload" => {
            let _ = window.eval("location.reload()");
        }
        "wb-devtools" => {
            if window.is_devtools_open() {
                window.close_devtools();
            } else {
                window.open_devtools();
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
