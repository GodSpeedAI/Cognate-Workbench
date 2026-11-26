# Current status

**Status revision:** 44

**Stage:** WP-23 operator hand-off of approved case assignments (PR #40)

**Summary:** The operator hands an approved case assignment to a conversation (J-CASE-ASSIGNMENT-handoff). The host's hand-off source supplies the approved Brief, Budget and case context and a request carrying its own is refused; one run per assignment id is bound to the session; session-assignment-bindings folds that run's own start; only the local operator, outside any run, can hand off, interrupt, resume or report spend. Hosted verify passed on 1a105bf.

**Verified:**

- Hosted verify 45833643135 on 1a105bf: success (typecheck+smoke, shards 1-4, tauri-linux, aggregate); earlier hosted verify 45828061942 on 6a812e2 success
- just typecheck clean; domainforge validate 0 violations; fmt --check clean; bun scripts/verify-sea-format.ts ok
- test/J-CASE-ASSIGNMENT-handoff.test.ts 3 pass (real server, production session posture; reconciles a mid-stream interrupt)
- test/assignment-operator-controls.test.ts 4 pass (red 4 fail before the fix): system spend refused, in-run operator refused for interrupt/resume/spend, foreign tenant refused identically before any lookup, candidates read refused
- test/E2E-case-assignment-handoff.test.ts passes on hosted CI; locally it passes most runs (see limits)
- Merged origin/main (capability runtime T3); Cognate pins kept at 0.10.0, 35 packages resolve to 0.10.0, frozen install clean
- DomainForge 0.22.2 platform-package binding resolver (scripts/package.ts, tauri-sidecar.ts) and validated SSH host key helper (ssh2 ed25519 under Bun unparseable 7/2000) cherry-picked from the CognitiveOS integration

**Limits:**

- Operator controls can be refused with too much contention while the bound run streams: structural Cognate defect (control events appended to the run stream the executor owns); the browser journey failed about 5 of 16 local runs under load. Cognate #91 backoff merged; structural fix in progress on Cognate fix/assignment-controls-off-run-stream; reaching this repo needs a Cognate release and dependency bump
- No production hand-off source until Horizon wiring exists; absent source fails closed
- The in-process trusted path is used; the SEA Connect admission provider needs a Cognate release that includes it
- Reconciliation card says restart for an operator interrupt; Interrupt records a fixed reason
- Local WSL host network churn can fail strict console assertions; hosted runner is the qualifying environment
- Full local just verify not run on this tree; hosted CI is the gate

**Next:**

- Merge PR #40
- Release Cognate with the structural control fix (owner authorization for publication), bump, drop the contention retries
- Horizon production hand-off source

**Evidence:**

- https://github.com/GodSpeedAI/Cognate-Workbench/actions/runs/45833643135
- test/J-CASE-ASSIGNMENT-handoff.test.ts
- test/E2E-case-assignment-handoff.test.ts
- test/assignment-operator-controls.test.ts
- screenshots/workbench/e2e-wp23-assignment-01..07-*.png
- .agents/DEBT.md

**Spec:** .sea/interaction/interaction-model.sea (j_case_assignment_handoff)

**Plan:** /home/sprime01/projects/sea-rs/.agents/plans/2026-11-20-fde-open-work-handoff.md (section 2)
