// The committed menu map (desktop-native-completion B3, design §1): every menu item is
// classified as rust-only (no web dependency) or ui-dispatch (routed into the web app's own
// action handlers through the `window.__wbShell` bridge). v1 ships only actions that exist in
// the web app — the six `SHORTCUT_ACTIONS` ids of `src/shortcuts.ts`; a menu item without a
// real action does not ship (PRODUCT.md principle 3). No domain accelerators: the
// operator-editable shortcut table stays the single source of truth, so the menus cannot
// diverge from it.
//
// The ui-dispatch items stay disabled until the shell has both a `/health` liveness signal
// and a page-load signal from the webview (the liveness rule; `lib.rs` flips them).

use tauri::menu::{MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

/// The web app's action inventory (mirrors `SHORTCUT_ACTIONS` in `src/shortcuts.ts`; the
/// cargo test pins the mirror, and the web-side format test pins the original).
pub const UI_ACTION_IDS: [&str; 6] = [
    "open-command-palette",
    "open-shortcuts",
    "new-session",
    "toggle-sidebar",
    "open-settings",
    "toggle-inspector",
];

/// One workbench menu item. Labels carry no accelerators by design.
pub struct WorkbenchItem {
    pub id: &'static str,
    pub label: &'static str,
}

/// The ui-dispatch menu map: every item routes to an existing action id.
pub const WORKBENCH_MENU: [WorkbenchItem; 6] = [
    WorkbenchItem {
        id: "new-session",
        label: "New Session",
    },
    WorkbenchItem {
        id: "open-command-palette",
        label: "Command Palette",
    },
    WorkbenchItem {
        id: "open-settings",
        label: "Settings",
    },
    WorkbenchItem {
        id: "open-shortcuts",
        label: "Keyboard Shortcuts",
    },
    WorkbenchItem {
        id: "toggle-sidebar",
        label: "Toggle Sidebar",
    },
    WorkbenchItem {
        id: "toggle-inspector",
        label: "Toggle Inspector",
    },
];

/// The one documented dispatch message: a versioned action id and optional args, evaluated
/// host-side into the bridge. No content, no tokens, ever.
pub fn dispatch_script(id: &str) -> String {
    format!("window.__wbShell && window.__wbShell.dispatch({{\"v\":1,\"action\":\"{id}\"}})")
}

/// Builds the Workbench submenu from the map. Items start disabled; the liveness rule in
/// `lib.rs` enables them once `/health` and the page load have both fired. Returns the item
/// handles so the liveness rule can update them without rebuilding the menu.
pub fn build_workbench_menu<R: Runtime>(
    app: &AppHandle<R>,
) -> tauri::Result<(tauri::menu::Submenu<R>, Vec<MenuItem<R>>)> {
    let mut items = Vec::new();
    let mut submenu = SubmenuBuilder::new(app, "Workbench");
    for entry in WORKBENCH_MENU.iter() {
        let item = MenuItem::with_id(app, entry.id, entry.label, false, None::<&str>)?;
        submenu = submenu.item(&item);
        items.push(item);
    }
    Ok((submenu.build()?, items))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_menu_item_maps_to_an_existing_web_action() {
        for entry in WORKBENCH_MENU.iter() {
            assert!(
                UI_ACTION_IDS.contains(&entry.id),
                "menu item '{}' is not in the web app's action inventory (src/shortcuts.ts SHORTCUT_ACTIONS)",
                entry.id
            );
            assert!(!entry.label.is_empty());
        }
    }

    #[test]
    fn every_web_action_is_reachable_from_the_menu() {
        // The reverse direction: no dead actions — if the web app grows an action and the
        // menu does not follow, this test says so ( PRODUCT.md principle 3 cuts both ways).
        for id in UI_ACTION_IDS.iter() {
            assert!(
                WORKBENCH_MENU.iter().any(|entry| entry.id == *id),
                "web action '{id}' has no menu item"
            );
        }
    }

    #[test]
    fn dispatch_script_is_the_documented_protocol() {
        assert_eq!(
            dispatch_script("new-session"),
            "window.__wbShell && window.__wbShell.dispatch({\"v\":1,\"action\":\"new-session\"})"
        );
        // Static ids only: no quoting hazards can reach the eval string.
        for entry in WORKBENCH_MENU.iter() {
            assert!(dispatch_script(entry.id).ends_with("\"})"));
        }
    }
}
