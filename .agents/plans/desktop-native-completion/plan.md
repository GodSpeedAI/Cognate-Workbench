# Tranche plan — desktop-native-completion

Spec: `design.md` in this directory (EGM-reviewed and resolved). Each tranche is independently
verifiable and committed; its done-state is its "Proves" line (mirrored from the design's Detailed
Implementation). Model-first rule: any capability-touching tranche lands its `.sea` journey first,
validated, before code.

| # | Tranche | Proves | Key risk retired |
|---|---|---|---|
| A1 | **Doc recovery** (this) | Status reconciled (rev 40); READMEs/architecture/DESIGN agree with code; three contract READMEs exist | Docs drift propagating into the mission |
| A3 | **Dispositions ledger** | Every A2 row, all 42 selects (file:line), downloads, DnD, Pin, remote diagnostics — dispositioned with evidence classes | Converting before deciding; "~35" count ambiguity |
| B1 | **CI scaffold** | `tauri-linux` CI job green (fmt/clippy/test + debug build; smoke lands in B2) | Shell never compiled in CI; DomainForge binding duplication; pin drift |
| B2 | **Packaged smoke harness + guards** | Harness green on Linux (debug binary + deb); `COGNATE_TEST_SIDECAR` T2 mode green; zero-IPC guard; coexistence/uninstall pass | Qualification claimed but not scripted; T2 with no mechanism |
| B3 | **Seam protocol** | `__wbShell` bridge + menu map v1 (existing actions only) + title owner/sentinel + liveness rule, all tested; zero-IPC guard green | Inventing web→shell IPC; menu items without real actions |
| B4 | **Desktop contract** | Fail-closed `/health` close-confirm verified (webview killed mid-run → confirm; reused close → backend survives; idle → close); attention; external links; downloads dispositioned; `--app` close decided | The fail-open close guard; dead links; dead downloads |
| B5 | **Lifecycle hardening** | Startup budgets measured/recorded; watchdog (5 s probe, reused-backend coverage, recovery surface); log rotation; package identity distinct; AppImage removed | 60 s SIGKILL orphaning pg0; blind watchdog; deb collision |
| D1..Dn | **Parallel defect track** (after A3) | Per-panel select batches + A2-row fixes land with their E2E delta, suite green; Pin + remote diagnostics journeys green (or DEFER recorded); guard test green | selectOption breakage; a11y regression; App.tsx collisions with B3 (sequenced after) |
| C | **Native UX convergence** (after B) | Per-platform menu conventions verified; notification gate (OQ1) decided; adopted acceptance rows recorded per platform | Chrome list without the contract |
| E1 | **Five-platform matrix** | 5/5 jobs green (T1+T2) on the RC tag; T3 where feasible | Platform claims without packaged evidence |
| E2 | **Jetson qualification** | Runbook executed with environment fingerprint + evidence (or explicit blocked state = Jetson-target release blocker) | WebKitGTK-on-JetPack surprises; DMABUF renderer; generic-ARM conflation |
| E3 | **Report + closure** | Platform-honesty report; screenshots re-captured with contrast audit; `just verify` + `domainforge validate` + cargo gates; revision 41 | Claimed-but-unverified rows; status drift |

Critical path: A1 → A3 → B1 → B2 → B3 → B4/B5 → E1; C and D parallelize against B's outcomes; E2
hangs off E1's arm64 artifact with an explicit blocked state, never silently. E3 may close when the
desktop qualification is complete, with unfinished D rows carried as recorded debt (owner decision,
2026-11-06).

## Verification commands per tranche

- Always: `bun run typecheck`, targeted `bun test <files>`, `just smoke` before milestones.
- Milestones: `just verify` (typecheck + full suite).
- Model tranches (A3-adjacent journeys in D): `domainforge validate --format human` + `fmt --check`
  on `.sea/interaction/interaction-model.sea` via `.tmp/domainforge/bin/domainforge`.
- Rust tranches: `cargo fmt --check`, `cargo clippy`, `cargo test` in `src-tauri/`;
  `bun run tauri:build` for bundles.
- Packaged tranches: `scripts/qualify-tauri.sh` (B2 onward).
- UI tranches: `UI_SHOTS_CONTRAST=1 bun scripts/ui-shots.ts` re-capture with the contrast audit.
