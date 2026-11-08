# Current status

Revision 39, 2026-11-04. Branch `feat/desktop-terminal-browser` (stacked draft PR #28 on PR #27 `feat/ui-production-readiness`). Latest work: desktop-terminal-browser T10–T12-core (commits `4d12704`, `d2119a2`).

Plan: `.agents/plans/desktop-terminal-browser/plan.md`. Verification log (incl. the flake matrix): `.agents/plans/desktop-terminal-browser/verification.md`.

## Implemented and verified

- Terminal (T4/T5/T7): PTY service (local/WSL/SSH ports, host-key re-verification, process-group termination, governed capabilities, authenticated websocket stream); docked xterm panel (tabs, detach keeps the process, reattach replays bounded scrollback, maximize, persisted height). `J-TERMINAL` 3/3, `E2E-terminal` pass.
- Shared browser (T8/T9): managed isolated-Chromium sessions on the agent-browser provider; streamed viewport over an authenticated proxy; named control handoff (`browser.control`); canvas panel with letterbox-corrected input mapping (extracted, regression-matrixed). `J-BROWSER` 2/2, `E2E-browser` 2/2.
- Inspect + annotate (T10): injected page-side inspector; click selects without activating (the derived click is killed, not just mousedown — the journey caught the gap); structured capture (tag/role/name/text/rect/viewport/selector-candidates/ancestry/styles/timestamp) + evidence screenshot; durable annotations with a navigation staleness token (stale after navigation, valid across SPA updates — proven both ways); submission reaches the model's own journal as structured, data-labeled feedback. `J-BROWSER-inspect` 3/3; viewport math 9/9.
- Previews (T11): `preview.register`/`preview.stop` — explicit, ownership-carrying, readiness-probed; SSH worlds reached by a real direct-tcpip local forward over the world's own connection (fingerprint re-verified at handshake); owned server processes killed with the terminal's group discipline; archiving the owning session durably stops the preview. `J-PREVIEW` 4/4.
- Mission journey (T12 core): the original success criterion passes end to end — agent builds and serves through governed bash, operator inspects and annotates in the shared browser, the model receives the payload (its journal proves it), the agent's fix lands, the same browser workspace shows the change after an explicit refresh. `E2E-mission` 1/1.
- Product bugs fixed while proving: the execution-world connection resolver's key matcher could never match (silent SSH terminal/preview breakage); owner-ended cleanup was memory-only; inspect-mode activation leaked through mousedown-only prevention; agent-browser snapshot is interactive-only (preview markers are buttons); dock panels now load lazily (they were slowing every page load — measurable in UI E2Es).

## Flake characterization (4 full verify runs)

- Baseline `448a095`: 1 failure (`J-RW-ssh-workspaces`) — pre-existing suite-wide load rotation; it passed on every branch run.
- `ed81cde` and `4d12704`: `J-EXPERT-WORKSPACE-ADMISSION` failed twice — aggravated by dock page-load weight, not pre-existing; fixed by lazy docks in `d2119a2`. Provider-suite failures rotated (`switch` on one run, `test` on another; pass in isolation).
- `d2119a2` (HEAD #3): 1575 pass / 13 skip / 1 fail (`E2E-remote-workspaces`, 39s under load, 9.8s in isolation — rotation class). `J-EXPERT-WORKSPACE-ADMISSION` passed: the aggravation is addressed, not normalized.

## Open acceptance debt (tracked, not silently dropped)

- T6 as planned (center-view registry extraction) was NOT performed — the dock lives in `App.tsx`; folded into T12 hardening.
- Tauri rows still open at recording time: release packaged build finishing; real-window WSLg pass; sidecar-failure surface probe. `cargo check` is clean and `J-DESKTOP-launch` (window opens/quit cleanup/second-launch reuse) passes.
- Platform validation on real Windows/macOS hosts remains blocked (no hosts; installers unsigned).
- WSL preview forwarding documented, untested here (Windows-host feature).
- SSH terminal journey unexercised against a live sshd (the latent resolver bug it would have caught is fixed; the preview journey proves the SSH path end to end with the real fixture server).

## Next

1. Finish the Tauri release build + WSLg real-window pass + failure-surface probe; close the T12 rows or record them blocked.
2. PR #27 review/merge (rev-37 UI work) unblocks stacked PR #28.
3. Fold the T6 registry extraction into the T12 hardening pass or re-scope it explicitly.
