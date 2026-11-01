// Shared happy-dom lifecycle for the ui-* component tests, which run in ONE `bun test` process.
//
// react-dom loads once per process and must load while a DOM exists (it probes `window` at import), and
// React's scheduler captures the window's timers at that moment. `GlobalRegistrator.unregister()` closes
// the window, which silences those timers, so a later file's React updates would never flush. Releasing
// restores every global (so later non-DOM tests see the real fetch/Response) but leaves the window
// open; its timers stay alive for the cached React.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

export function registerDom(): void {
  GlobalRegistrator.register();
}

export async function releaseDom(): Promise<void> {
  Object.defineProperty(globalThis, "happyDOM", { value: undefined, configurable: true, writable: true });
  await GlobalRegistrator.unregister();
}
