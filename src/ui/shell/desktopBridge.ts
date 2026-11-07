// The one seam between the Tauri shell and the web app (desktop-native-completion B3).
// The shell dispatches action ids through host-side script evaluation into this single
// documented entry point; the bridge routes them to the app's own action handlers — the
// same handlers the command palette and the keyboard contract use. No Tauri capability is
// granted to web content (the zero-grant posture, design §1): this is host-initiated only.
//
// Browser and CLI contexts never register the bridge (no shell exists); dispatching into
// an unknown or malformed message is refused with a console warning, never thrown into
// the app.

export interface ShellDispatchMessage {
  readonly v: 1;
  readonly action: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

export type ShellActionHandler = (args: Readonly<Record<string, unknown>>) => void;

export const SHELL_BRIDGE_NAME = "__wbShell";

function isDispatchMessage(value: unknown): value is ShellDispatchMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.v === 1 && typeof candidate.action === "string" && (candidate.args === undefined || typeof candidate.args === "object");
}

/** Reads the handlers through a getter on every dispatch so the bridge always routes to
 *  the app's current handlers (App.tsx rebuilds its handler map every render). */
export function registerShellBridge(handlers: () => Readonly<Record<string, ShellActionHandler | undefined>>): void {
  if (typeof window === "undefined") return;
  if (Object.prototype.hasOwnProperty.call(window, SHELL_BRIDGE_NAME)) return;
  const bridge = {
    dispatch(message: unknown): void {
      if (!isDispatchMessage(message)) {
        console.warn("wbShell: refusing malformed dispatch");
        return;
      }
      const handler = handlers()[message.action];
      if (!handler) {
        console.warn(`wbShell: no handler for action "${message.action}"`);
        return;
      }
      handler(message.args ?? {});
    },
  };
  Object.defineProperty(window, SHELL_BRIDGE_NAME, { value: Object.freeze(bridge), configurable: false, writable: false });
}
