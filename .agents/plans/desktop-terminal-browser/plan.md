# Tranche plan — desktop-terminal-browser

Order chosen by dependency and risk; each tranche is independently verifiable and committed.

| # | Tranche | Proves | Key risk retired |
|---|---|---|---|
| T1 | **Baseline + architecture** (this) | Repo maps, baseline gates green, decisions recorded | Wrong assumptions about existing code |
| T2 | **Tauri shell skeleton** | `cargo tauri build`/dev on Linux; sidecar spawn + /health wait + webview loads working app; close cleans up | Tauri+Bun sidecar incompatibility; resource dir resolution |
| T3 | **Model: terminal/browser/preview journeys** | `.sea` journeys validated (domainforge), bindings + count assertions, capability catalog docs | Model-code drift |
| T4 | **Terminal local PTY** | J-TERM journey test: create→interact→resize→detach→reattach→kill; unauthorized refused; tool.bash regression green | Bun.Terminal behavior, WS auth, backpressure |
| T5 | **Terminal SSH/WSL adapters** | SSH shell channel with host-key verification + secret reuse; WSL via wsl.exe (Linux-untestable paths honestly marked) | Duplicating host-key logic wrongly |
| T6 | **UI dock refactor** | Center-view registry extraction, no behavior regression (existing E2E green) | App.tsx regression |
| T7 | **Terminal UI** | xterm panel opens/sessions/tabs/labels/world chips; E2E journey in real Chromium | xterm+WS framing, CSP |
| T8 | **Browser provider spike + adapter** | agent-browser driven from Bun for every required op (or documented deviation + CDP fallback) | agent-browser gaps (eval/inspect) |
| T9 | **Shared browser service + UI** | Streamed interactive viewport, same-session agent ops, ownership handoff, screenshots | Stream proxy latency, CSP |
| T10 | **Inspect + annotate + evidence** | Injected inspector, structured capture, annotation records, agent receives context | Injection via CLI adapter |
| T11 | **Preview registration + forwarding** | preview.register journey; agent starts fixture dev server; browser opens it; cleanup | Long-run process governance |
| T12 | **End-to-end mission journey + hardening + packaging + docs** | 11-step E2E; threat review; package scripts; docs; final report | Integration coherence |

Model-first rule: T3 lands before any capability code (T4+). If a tranche reveals a domain gap,
fix the model first, re-validate, then code.

## Test naming

Journey tests: `test/J-TERMINAL-session.test.ts`, `test/J-BROWSER-shared.test.ts`,
`test/J-BROWSER-inspect.test.ts`, `test/J-PREVIEW-register.test.ts`,
`test/J-DESKTOP-shell.test.ts` (packaged smoke where environment permits).
Component tests: `test/ui-terminal.test.tsx`, `test/ui-browser.test.tsx`.
E2E: `test/E2E-terminal.test.ts`, `test/E2E-browser-inspect.test.ts`.

## Verification commands per tranche

- Always: `bun run typecheck`, targeted `bun test <files>`, `just smoke` before milestones.
- Model tranches: `.tmp/domainforge/bin/domainforge validate --format human .sea/interaction/interaction-model.sea`
  and `fmt --check` (mind the quantifier-policy formatter caveat from the skill).
- Milestones: `bun run verify` (typecheck + full suite).
- Packaging tranches: `cargo fmt --check`, `cargo clippy`, `cargo test` in `src-tauri/`;
  Tauri debug build launches on this host (WSLg) with a real interaction pass.
