// J-BROWSER-session: the browser provider contract. One interface over the operations the
// Workbench actually needs, so the automation backend stays replaceable — the first adapter
// drives vercel-labs/agent-browser (verified 0.41.1 on this host: navigation, persistent JS
// evaluation, accessibility snapshots with element refs, screenshots, element boxes, viewport
// control, live viewport streaming with mouse/keyboard/touch injection). Arbitrary provider
// commands are never exposed as Cognate capabilities; the capability layer (see
// `src/capabilities/browser.ts`) decides which of these operations are invocable by whom.

export interface ViewportSpec {
  readonly width: number;
  readonly height: number;
  /** deviceScaleFactor; 2 doubles the rendered pixels for crisp frames on hidpi panels. */
  readonly scale?: number;
}

export interface ElementBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PageState {
  readonly url: string;
  readonly title: string;
}

/** One browser automation backend. Sessions are named; a name maps to one managed browser. */
export interface BrowserProvider {
  /** Identifier of the concrete backend ("agent-browser" today). */
  readonly id: string;
  /** Launch (or adopt) the named session's browser, optionally navigating and sizing it. */
  open(sessionName: string, options?: { readonly url?: string; readonly viewport?: ViewportSpec }): Promise<PageState>;
  navigate(sessionName: string, url: string): Promise<PageState>;
  /** Current URL and title of the session's active tab. */
  state(sessionName: string): Promise<PageState>;
  /** Accessibility snapshot with element refs (the agent-facing page model). */
  snapshot(sessionName: string): Promise<string>;
  screenshot(sessionName: string, outputPath: string): Promise<void>;
  /** Run JavaScript in the page and return its JSON result. Untrusted page data flows back — callers treat it as data. */
  evaluate(sessionName: string, expression: string): Promise<unknown>;
  setViewport(sessionName: string, viewport: ViewportSpec): Promise<void>;
  /** Enable live viewport streaming; returns the daemon's localhost stream port. */
  streamPort(sessionName: string): Promise<number>;
  /** Console and page errors for the panel's error surfaces. */
  errors(sessionName: string): Promise<readonly string[]>;
  /** Tear the named session down (browser + daemon state). */
  close(sessionName: string): Promise<void>;
  /** Tear every session this process created. */
  closeAll(): Promise<void>;
}

export class BrowserProviderError extends Error {
  override readonly name = "BrowserProviderError";
  constructor(message: string, readonly stderr?: string) {
    super(message);
  }
}
