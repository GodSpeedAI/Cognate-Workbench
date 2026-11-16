# browser — shared managed browser sessions

## Overview

One shared, managed browser per session: an isolated Chromium driven by the
agent-browser provider, streamed into the Workbench UI as a JPEG viewport over the
same-origin `/browser/stream` websocket, with named control handoff between the
person and the agent. The same session carries inspect/annotate: a page-injected
script captures structured element context (tag, role, name, text, rect, selector
candidates, ancestry, styles) without activating the element, and annotations reach
the agent as labeled data. Screenshot evidence is captured through the provider.

## Interface

- [provider.ts:BrowserProvider] — the backend contract: sessions, navigation,
  snapshots with refs, evaluate, screenshots, input, stream attach, dispose
  ([provider.ts:BrowserProviderError]). Any conforming backend slots in; the
  agent-browser spike decision and the fallback note live in the
  desktop-terminal-browser verification log.
- [agentBrowser.ts:agentBrowserProvider] — the chosen adapter: drives the
  agent-browser CLI daemon (`open`, `eval`, `snapshot -i`, `get box`, `screenshot`,
  stream enable), unwraps its `{success, data, error}` results, and proxies its
  raw daemon websocket frames (base64 JPEG `frame` messages, `url`/`console`
  events). The daemon port stays internal — never exposed.
- [service.ts:BrowserService] — owner-checked attach, base64→bytes frame decode,
  url/console relay, and the named control handoff ([service.ts:Controller] is
  `"human" | "agent"`): human input is refused while the agent holds control and
  vice versa; reads stay available to both. Errors:
  [service.ts:BrowserAccessError], [service.ts:BrowserUnknownError].
- [inspectScript.ts:INSPECT_SCRIPT_SOURCE] — the page-injected inspector (hover
  outlines; click selects without activating — the capture-phase click kill is
  load-bearing) and its enable/disable expressions.
- [annotationMessage.ts] — the structured annotation payload, fenced as untrusted
  data for the model conversation.
- [wsController.ts:browserWsController] — the `/browser/stream` websocket surface
  (boot-token first-message auth, shared surface tag with the terminal controller).
- Capability surface: `browserComponent` in `src/capabilities/` (observation vs
  actuation split per the desktop-terminal-browser architecture).

## Invariants

- **Page content is untrusted input**: captured element text is data, never system
  instructions; the annotation payload carries the untrusted-input fence.
- **Panel content never runs in the Workbench origin**: the stream is pixels + input
  mapping over a same-origin websocket; the visited page's JS never executes in the
  app's context.
- **No silent simultaneous control**: writes are single-controller at a time with
  explicit handoff; conflicting writes are refused, not raced.
- **Metadata-only durability**: `workbench.browser.*` events record session
  identity/ownership, metadata, transitions, annotations, and evidence links — page
  content and scrollback bytes are never persisted.
- Stale element references after navigation are detected and surfaced; dead sessions
  render dead after restart.

## Side Effects

- Spawns and owns the agent-browser daemon and its isolated Chromium; disposes them
  on session close/owner end.
- Writes screenshot evidence under the browser-evidence directory.
- Emits `workbench.browser.*` events (metadata only).

## Verification

- `bun test test/J-BROWSER-session.test.ts` — open, navigate, stream, human click,
  control handoff, close folds one durable record; foreign-identity attach and dead
  sessions answer honestly.
- `bun test test/J-BROWSER-inspect.test.ts` — select-without-activate, full
  structured capture fields, evidence screenshot on disk, staleness token
  (stale-after-navigation, resolve-after-SPA-update), the submitted message reaching
  the model's journal with the fence present, inspect refused under agent control.
- `bun test test/E2E-browser.test.ts` — real Chromium dock flow; address-bar
  navigation; letterbox-corrected clicks ([viewportMath.ts] carries the mapping
  regression matrix, `test/ui-viewport-math.test.ts`).
