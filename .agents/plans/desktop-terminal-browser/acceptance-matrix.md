# Acceptance matrix — desktop-terminal-browser

Each row: acceptance criterion, how it is verified, tranche. "Verified" entries are recorded in
`verification.md` with exact commands and evidence. Nothing counts as done until its row is verified
or explicitly deferred with a reason.

## Desktop shell (T2, T12)

| Criterion | Verification |
|---|---|
| Packaged/debug Tauri app launches the Workbench UI without a manually started dev server | Launch `src-tauri` debug build on this host; UI renders and is interactive |
| Sidecar readiness: backend starts, `/health` polled, webview opens on ready | Shell logs + observation; failure path shows an error surface instead of a blank window |
| Second window attaches to the live instance instead of spawning a duplicate backend | Two launches → one server process (lock + /health), two windows |
| Closing the app cleans up: sidecar SIGTERMed, bundled pg0 stopped (if owned), lock released | After close: no server process, lock file stale/absent, pg0 `info` stopped |
| Startup failures are visible (backend crash → error state, not silent blank) | Kill sidecar mid-boot; window shows failure and a retry affordance |
| Privileged APIs: webview content (localhost remote context) has no Tauri IPC access unless explicitly granted | Capability file review + runtime probe from the webview console |
| Native window behavior: resize/maximize/minimize/focus; state restored across restarts | Manual pass on WSLg + window-state plugin persistence |
| `just verify` remains green after shell work (web path unaffected) | CI + local |

## Model (T3)

| Criterion | Verification |
|---|---|
| New journeys (terminal, shared browser, inspect/annotate, preview) exist in `.sea` with catalog fields | `domainforge validate` 0 violations; `fmt --check` clean |
| Bindings anchored with count assertions updated | Boot naming a tranche count fails loudly if bindings drift (existing convention) |

## Terminal (T4, T5, T7)

| Criterion | Verification |
|---|---|
| Local PTY: create, type, interactive apps (e.g. `vim`/`top` smoke), ANSI rendered in xterm | `test/J-TERMINAL-session.test.ts` (runtime) + E2E in Chromium |
| Resize: xterm fit → PTY resize → TIOCGWINSZ honored by shell programs | Journey test asserts `stty size` reflects resize |
| Multiple sessions; per-session world + workspace labels | Journey test opens 2+; UI test asserts labels |
| Detach keeps process running; reattach restores bounded scrollback | Journey test: detach, append output, reattach, assert tail present |
| Explicit terminate kills the process group (children included) | Journey test: spawn `sh -c 'sleep 300'` child, kill, assert gone |
| Unauthorized attach: another authenticated identity / bad token refused | Journey test asserts 401/403 + no stream bytes |
| Output limits, backpressure, bounded buffer; idle cleanup | Unit tests on ring buffer + reaper |
| No raw scrollback in the event log; only metadata events | Event-log assertion in journey test |
| `tool.bash` regression: existing suites green; one-shot semantics unchanged | Full suite |
| SSH terminal (host-key verified, secrets from store) | Journey test against a local sshd fixture where available; otherwise documented limitation |
| WSL terminal | Windows-only; implemented, unverified on this host — recorded honestly |

## Shared browser (T8, T9)

| Criterion | Verification |
|---|---|
| Real interactive pages incl. dynamic JS apps render in the panel and accept input | E2E against a fixture Vite/static app |
| Shared session: agent op (navigate/snapshot) and human input address one session; attribution distinguishable | Journey test with two principals |
| Ownership handoff: pause/handoff/reject conflicting writes; no silent simultaneous control | Journey test |
| Screenshots as evidence; a11y snapshot with refs; DOM inspection | Journey test |
| Multiple isolated sessions; crash/disconnect → dead session rendered dead; recovery | Journey test |
| CSP/origin: panel content never runs in Workbench origin; untrusted page text is data not instructions | Threat review + test |
| agent-browser vs fallback decision documented with evidence | verification.md |

## Inspect + annotate (T10)

| Criterion | Verification |
|---|---|
| Inspect mode: hover outlines element; click selects (no navigation) and captures structured context | E2E on fixture app |
| Captured context: URL, tag, role, name, text, rect, viewport, selector candidates, ancestry, styles, timestamp | Journey test asserts fields |
| Annotate: attach note to selection; edit/dismiss; visible which element; persisted across reload | E2E + journey test |
| Feedback reaches the active agent conversation with element context; agent receives structured payload | Journey test asserting the message/event payload |
| Stale element references after navigation are detected and surfaced | Journey test |
| Evidence linkage durable (session/task/evidence records) | Projection assertions |

## Preview (T11)

| Criterion | Verification |
|---|---|
| Agent registers a dev-server preview through a governed capability; readiness probed | Journey test |
| Browser opens the preview; refresh after change; server/browser errors visible | E2E |
| Cleanup when owning task/session ends | Journey test |
| SSH/WSL forwarding (or documented per-world limitation) | Fixture where feasible |

## End-to-end mission journey (T12)

11 steps from mission §11 automated in `test/E2E-browser-inspect.test.ts` (or a dedicated
`E2E-desktop-journey`), against a fixture web app on a local world, with durable evidence linkage
asserted at the end.

## Gates

- `bun run typecheck` — clean at every commit.
- Targeted `bun test` per tranche; full `bun run verify` at T4/T7/T9/T10/T12 milestones.
- `cargo fmt/clippy/test` in `src-tauri/`; Tauri debug-build interaction pass on WSLg.
- DomainForge validate/fmt --check for every model change.
