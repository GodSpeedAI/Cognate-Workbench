# Architecture — Native desktop, terminal, and collaborative browser

Mission: transform Cognate Workbench into a Tauri-packaged desktop workbench with an
integrated PTY terminal, a genuinely interactive shared browser, and an
inspect/annotate workflow — integrated through the existing capability, event,
authority, and evidence model.

Status: living document. Update when a decision changes. Evidence lives in
`verification.md` (same directory).

## Baseline facts this design builds on (verified 2026-11-03)

- Backend: one Bun process (`src/server.ts`) serving Connect RPC (`/cognate.v1.RuntimeService/*`),
  the bundled UI, `/health`, `/remote/*` on `127.0.0.1:3180` (default), loopback-only with
  Host/Origin refusal (`src/server.ts:132`).
- Headless mode already exists: `COGNATE_NO_WINDOW=1 cognate-workbench launch` behaves like `start`
  (`src/cli.ts:168-199`). `server.lock` `{pid, port}` in the data home; `launch` reuses a live
  instance via lock + `/health`; SIGTERM shuts down cleanly (server → bundled pg0 → lock release).
- Existing "desktop" is an external Chromium `--app` window (`src/desktopWindow.ts`) — kept as the
  fallback path; Tauri becomes the primary shell.
- Packaged resource resolution: `resourcePath()` honors `COGNATE_RESOURCE_DIR`, else
  `<exeDir>/../share/cognate-workbench` (`src/resources.ts`). Bundled pg0 lives at
  `resourcePath("bin", "pg0")`, verified against `MANIFEST.json`.
- Capability model: components provide `CapabilityContract`s; `bindCapabilities` in `domain/index.ts`
  anchors them on `.sea` concepts with hard count assertions; client-invocable ids must be in
  `GRANTED_CAPABILITIES` (`src/server.ts:205`) and mounted in `createRuntime`.
- Events: closed `WORKBENCH_EVENTS` list (28 types, `src/workbench/types.ts:175`), pure reducer
  (`src/workbench/reducer.ts`), projections registered in `src/server.ts:588`, streamed to the UI via
  the Connect `StreamEvents` RPC (no SSE/WS on the main surface today).
- UI: `src/ui/App.tsx` (6075 lines) hand-rolls center views (`currentView`, `App.tsx:5296`) over four
  booleans; the right inspector already has a registry (`shell/Inspector.tsx`: register by id/order,
  portal, persisted width/open/tab). No terminal/browser/xterm/iframe code exists in the UI.
- CSP on `/` (`src/server.ts:933`): `default-src 'self'; connect-src 'self'; frame-ancestors 'none'` —
  any WebSocket must be same-origin; external-site iframes are blocked today.
- Bun 1.4.0 pinned. `Bun.Terminal` (PTY) exists since 1.3.5, Windows ConPTY since 1.3.14. node-pty is
  broken under Bun (oven-sh/bun#25822) — do not use it.
- Toolchains on this host: Rust 1.98 + cargo, webkit2gtk-4.1 + gtk3 (Tauri Linux buildable/runnable
  under WSLg), DomainForge CLI at `.tmp/domainforge`, pg0 at `.tmp/pg0`.

## External technology decisions

| Concern | Decision | Rationale |
|---|---|---|
| Desktop shell | **Tauri 2** (2.x stable) | Mission-mandated; sidecar + `frontendDist`-as-URL + capability system verified in docs; donor precedent exists (`PandaCode src-tauri`). |
| Backend in production | Existing Bun-compiled `cognate-workbench` binary as Tauri **sidecar** | Already headless-capable, already lock/health/SIGTERM-disciplined; no rewrite. |
| Terminal renderer | **`@xterm/xterm` 6.x** + `@xterm/addon-fit` (+ `addon-search`) | Proven, maintained (6.0.0, Dec 2025), ESM; canvas addon removed — use webgl with DOM fallback. |
| Local PTY | **`Bun.Terminal`** | Built into pinned Bun 1.4; node-pty does not work under Bun (#25822); Windows ConPTY supported. |
| Browser automation backend | **agent-browser (vercel-labs) first**, behind a provider contract; CDP/Playwright fallback | Mission preference; research confirms sessions, ref snapshots, streaming WS with input injection ("pair browsing"). Gap: no published library API (CLI/MCP/WS only) — the adapter drives the CLI and proxies its stream WS through our server. A Phase E spike decides agent-browser vs Playwright-CDP on evidence; the contract keeps either swappable. |
| Browser viewport transport | Backend-proxied stream over same-origin WS `/browser/stream` | CSP `connect-src 'self'`; agent-browser's own WS is on its daemon port and unauthenticated — never exposed directly. |
| Model-driven browser ops | Governed `browser.*` capabilities | Consequence classification (read vs act) per mission §10. |

Rejected alternatives (brief): node-pty (broken under Bun), Electron (heavy, duplicative of Tauri),
embedding the page in an iframe (CSP + privilege mixing; untrusted content must not share the
Workbench origin), Lightpanda/Servo (mission: not prerequisites).

## Component boundaries

```
src-tauri/                     Tauri 2 shell (Rust)
  - spawns sidecar: cognate-workbench (Bun binary), env COGNATE_NO_WINDOW=1,
    COGNATE_RESOURCE_DIR=<tauri resource dir>, PORT=<free port picked by shell>
  - waits for GET /health, then opens the webview at http://127.0.0.1:<port>
  - reuses a live instance: reads <home>/server.lock, probes /health, attaches a
    second window instead of spawning a second backend
  - native menus + shortcuts (Rust-side, no webview IPC required)
  - minimal capability grants: the localhost webview is a *remote* Tauri context and
    gets NO Tauri APIs by default (CSP + capability system keep it web-only)
  - on close: SIGTERM sidecar, wait for exit (server stops pg0 + releases lock)

src/terminal/                  Terminal session service (Workbench)
  - TerminalPort interface; LocalBunTerminal adapter (Bun.Terminal),
    SshTerminal adapter (ssh2 shell+PTY, probeHostKey re-verification,
    secrets via openSecretStore), WslTerminal adapter (wsl.exe under a local PTY)
  - bounded scrollback ring, backpressure, idle reaper, process-group kill
  - capability family terminal.* (operator-only creation); events + projection
    record durable metadata only — stream bytes are never persisted
  - transport: same-origin WebSocket /terminal/stream (Bun.serve ws handler)

src/browser/                   Browser session service (Workbench)
  - BrowserProvider contract: sessions, navigation, snapshot(refs), evaluate,
    screenshot, input, stream attach, dispose
  - AgentBrowserProvider (CLI daemon) and CdpPlaywrightProvider behind it
  - capability family browser.* with read/act consequence split
  - transport: /browser/stream WS proxy (frames out, input in), same-origin

src/ui/terminal/               xterm.js panel (center view + dock)
src/ui/browser/                browser panel (center view + dock), inspect/annotate UX
```

Durable vs ephemeral: PTY/browser processes, streams, buffers are ephemeral in-process; durable
records (session identity/ownership, metadata, transitions, annotations, evidence links) go through
the event log + projections; dead runtime sessions render as dead after restart.

## Key design decisions

1. **The boot-token seam is already solved.** The server injects the operator session token into
   `/app.js` at boot; a Tauri webview that loads `http://127.0.0.1:<port>/` is authenticated exactly
   like the current `--app` browser window. No token file, no URL query token, no new auth surface.
2. **The shell picks the port, not the server.** Rust binds `127.0.0.1:0` to reserve a free port,
   passes it as `PORT`, and polls `/health`. No collision, no discovery problem for the fresh-start
   case; the lock-file reuse path handles the already-running case.
3. **Terminal = human surface.** `terminal.*` creation requires `ctx.actor.kind === "user"`
   (operator). Agents keep `tool.bash`; a PTY must not become an agent authorization bypass.
   Local-world terminals are permitted for the operator under the `contained` posture: the posture
   constrains *agent* effects (`UncontainedEffectRefusedError` is aimed at agent runs); refusing the
   operator a terminal on the machine the app already runs on would be incoherent. Documented as a
   deliberate authority distinction; terminal streams never enter agent context or the event log.
4. **SSH/WSL terminals reuse durable world records.** The SSH terminal adapter re-verifies the host
   key with the SDK's exported `probeHostKey` against the same known-hosts store, and reads
   credentials from the existing `execution-world:<id>:*` secret keys. The one-shot `ProcessPort`
   contract is not stretched into interactivity (mission §5); a `TerminalPort` abstraction is
   Workbench-local for now, with an SDK proposal recorded in the final report.
5. **Browser ops are two consequence classes.** Observation (`browser.snapshot`, `browser.screenshot`,
   `browser.navigate` to http(s)) is lower-risk; actuation (`browser.click`, `browser.type`,
   `browser.evaluate`, form submission, uploads) goes through the approval/authority plane like
   other consequential capability calls. Page content is untrusted input: captured element text is
   data, never system instructions.
6. **Inspect happens in the page, not in the canvas.** The backend injects a small inspector script
   (via the provider's evaluate) that draws hover outlines and, on click, returns structured element
   context (tag, role, name, text, rect, selector candidates, ancestry, styles). Screenshot evidence
   is captured through the provider. Source mapping is best-effort (React dev instrumentation where
   present) and explicitly labeled as such.
7. **Preview registration is explicit.** A governed `preview.register` capability (agent-invocable)
   records URL + workspace + owning run/task; readiness is probed over HTTP; stdout regex detection
   is only a convenience. SSH/WSL reachability uses forwarding (SSH local forward via the terminal
   adapter's ssh2 connection; WSL uses localhost forwarding), never public binds.
8. **UI integration is additive.** Terminal and browser become center views through a small
   registry extracted from the `currentView` switch (no redesign); the inspector gains
   inspect/annotate tabs using the existing `InspectorTab` registry idiom. Layout preferences reuse
   the sidebar/inspector localStorage conventions. Existing journeys must not regress (E2E suite).

## Acceptance matrix (condensed; full detail in acceptance-matrix.md)

Desktop: packaged launch without dev server; second-window reuse; close cleans up (pg0 stopped, lock
released); startup failures visible; privileged APIs unreachable from webview content.
Terminal: create/type/resize/ANSI in xterm; multiple sessions; SSH/WSL where testable; detach keeps
process; explicit kill terminates process group; unauthorized attach refused; `tool.bash` regression
green; no stream bytes in the event log.
Browser: launch/navigate real pages incl. localhost apps; streamed viewport interaction; shared
session with agent ops (attribution distinct); screenshots; a11y snapshot with refs; element select
→ structured context; annotation persisted + visible to agent; stale refs after navigation handled;
crash recovery renders dead sessions dead.
E2E: the 11-step mission journey (§11) automated against a fixture web app on a local world.

## Platform coverage honesty

Validated locally: Linux x64 (WSL2/WSLg). CI-validated: whatever the GitHub matrix adds (the
existing 5-platform matrix does not include Tauri signing; artifacts stay unsigned).
Windows/macOS behavior is implemented per docs but *not* claimed verified until run on those
platforms; the report distinguishes verified from untested per mission §14.
