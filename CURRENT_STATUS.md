# Current status — revision 42

The **desktop-native-completion** mission's D and F tracks are closed, and Milestone C is
recorded — this revision covers the recovered session's continuation.

**Recovery.** The previous session stalled in model-stream timeouts at 2026-11-06 23:42 with
its whole B5 change set uncommitted. The tree was verified against the mission's recorded
evidence, the gates re-run, and B5 landed (`3ed0337` + evidence refresh `37d2c5d`; rev 41).

**D track — the dispositions ledger, executed.** The global gate landed first: MenuSelect's
trigger accessible name now carries the current value with a full engine-independent keyboard
contract, pinned by `test/ui-menu-select.test.tsx` (12 tests, `d5ec3fd`). Then all **42 native
selects** converted across the nine ledger batches S1–S9, one commit each with its E2E delta,
closed by the standing `native-select-guard` test. All **17 open A2 D-rows** dispositioned:
14 fixed across five commits, three recorded as already landed (D-16, D-34, D-13's stray
theme icon); `DEBT.md` reconciled.

**F track — both BUILD rows, model-first.** F1 **session Pin** (`3596abc`): `J-SESSION-pin`
validated in the SEA model → `session.setPinned` anchored on `Session` → `session.pinned`
folded by the `sessions` projection (carried across turn rebuilds) → pinned-first
sort-independent ordering → row-menu Pin/Unpin with a pinned glyph → journey test proving
restart durability, reversibility and refusal. F2 **durable remote diagnostics** (`b9c7d9b`):
`J-REMOTE-diagnostics` validated with a new `RemoteControl` entity → bounded
`workbench.remote.state`/`.error` family folded into the workbench projection's
`remote/control` row → the recorder injected into `MobileRemote` at transitions and pairing
refusals only (never the polls, never secrets) → durable history rendered in the Remote
dialog → journey test proving polls record nothing and history survives restart.

**Milestone C recorded** (`d105c65`): per-platform menu conventions verified — no divergences
found (the macOS Edit/Window roles ship by construction; the no-accelerator deviation is
documented); the WSLg real-window rows recorded; the menu-click/dialog rows explicitly
BLOCKED on xdotool (passworded sudo) until a device pass. **OQ1 resolved by the owner**
(`ed8f583`): the B4 title cue stays the canonical approval-waiting surface; the notification
plugin is not shipped.

**E1 dispatched with owner authorization.** The push was initially rejected — 895 MB of
accidentally committed `dist-package/` packaging artifacts (regenerable output of
`scripts/package.ts`, now gitignored) sat in the unpushed history; a history rewrite of the
unpushed range removed them. The branch is pushed, PR #28 is ready for review, and the
five-platform `tauri` matrix is running on tag `v0.1.0-rc1`.

**Verified.** Boundary gates at every tranche with per-failure isolated classification:
1586/1 → 1600/1 → 1599/2 → 1603/2 (all failures the documented host-concurrency class;
`J-CHECKOUT-lifecycle` and `J-WS-delete` pass isolated, the admission E2E flake classified
twice). `domainforge validate` + `fmt --check` after every model change: 0 violations. Rust
gates: fmt clean, clippy 0 warnings, `cargo test` 7/7.

**Next.** E1: record the matrix results per OS/arch/SHA/checksum. E2: the Jetson runbook is
the operator's. E3: platform-honesty report, drift re-run, final reconciliation (rev 43).

---

# Current status — revision 41

Milestone B of the **desktop-native-completion** mission is complete — the whole Tauri desktop
foundation, B1 through B5, landed on `feat/desktop-terminal-browser`.

**The B-tranche.** B1 CI scaffold (five-platform `tauri.yml` RC matrix — windows-2022 x64,
macos-15 ARM, macos-15-intel x64, ubuntu-22.04 x64, ubuntu-22.04-arm aarch64 — with the Rust
1.95 Jetson MSRV gate, plus a per-commit tauri-linux fmt/clippy/test job in `verify.yml`);
B2 packaged smoke harness (`scripts/qualify-tauri.sh`, `just tauri-guards`/`tauri-smoke`, the
T2 `COGNATE_TEST_SIDECAR` mode); B3 shell↔web seam protocol (the frozen `__wbShell` bridge,
the two-side-pinned title grammar, the committed six-action menu map with the
`/health`+page-load liveness rule); B4 desktop contract (fail-closed close guard scoped by
backend ownership, title-transition attention cue, external-link routing via the opener,
`--app` beforeunload confirm, downloads DEFER); B5 lifecycle hardening: startup budgets
(180 s first boot / 60 s steady — measured 4 s on this host) with a graceful SIGTERM stop on
readiness timeout instead of the SIGKILL that orphaned pg0; a 5 s `/health` watchdog
(two-failure threshold) covering spawned-exit **and** hung-or-reused backends with a recovery
surface that names the owner and the relaunch move; handle-before-wait so an early quit always
has a kill path; 5 MB `desktop-shell.log` rotation; `/health` machine inputs (`shell`,
`runsInFlight`, `pendingApprovals`) folded server-side from the sessions projection with
absent counts fail-closed; the close guard switched to that machine authority (the B3 title
signal retired to the attention cue); package identity `cognate-workbench-shell` distinct
from the CLI's deb — proven non-overlapping by the coexistence smoke pass; `appimage` removed
from bundle targets on the recorded linuxdeploy/FUSE failure; `--app` surface identity
`chromium-app@<version>`; and the operator-executed Jetson AGX Orin qualification runbook
(`docs/jetson-qualification.md`) for E2.

**Also this revision:** the `postgresUrl()` environment-coupling test class is fixed —
`test/helpers.ts` gains `storeUrlForTest()` (the same resolution `storeConfigFor` uses: env
URL, else the shared development pg0 instance) and three suites that opened stores or scanned
schemas directly no longer dial whatever PostgreSQL happens to listen on 5432. The previous
B5 boundary run was 1582 pass / 5 fail; the fixes closed its three environment-coupled
failures.

**Verified.** Commits `6b7ac38` (B1), `78c4bb2` (B2), `daeb97a` (B3), `06c366a` (B4), this
commit (B5). Debug-shell and packaged-deb qualifications PASS; the B5 coexistence run proves
`packages distinct … no overlapping file paths`. Rust gates: fmt clean, clippy 0 warnings,
`cargo test` 7/7. Full `just verify` at the boundary: **1586 pass / 1 fail** — the one
failure (`J-EXPERT-WORKSPACE-ADMISSION`) hits the 22 s E2E deadline under full-gate load and
passes isolated in 9.76 s: the documented host-concurrency flake class, not a product bug.

**Next.** The D parallel track (per-panel native-select batches, the Pin affordance, remote
diagnostics — the ledger's BUILD rows), then Milestone C (native UX convergence), then
Milestone E (five-platform CI green, installer verification, the platform-honesty matrix, the
Jetson E2 run, a drift re-run, and the final report as revision 42).

---

# Current status — revision 40

Milestone A of the **desktop-native-completion** mission is complete: the EGM sequence ran end to
end over the Tauri desktop completion effort, and the doc reconciliation the drift report demanded
has landed (this revision).

**Reconciliation.** The markdown had sat at revision 36 while the JSONL ledger carried three
unreconciled revisions: **37** — the UI production-readiness pass (PandaCode-style UI with Cognate
identity, 1564-test gate green at `04f648d`, report at `.agents/reports/ui-production-readiness/`);
**38** — desktop-terminal-browser T4–T9 (PTY terminal service, docked xterm panel, shared managed
browser sessions); **39** — T10–T11 + T12 core (inspect+annotate, governed previews across worlds,
the end-to-end mission journey), including three product bugs found and fixed while proving it
(execution-world connection-resolver key matcher, owner-ended preview cleanup durability, the
inspect click-kill). All three remain recorded in full in `.agents/CURRENT_STATUS.jsonl`. The
Tauri 2 desktop shell has been the primary desktop surface since `4ac47c1` on
`feat/desktop-terminal-browser`; the Chromium `--app` window remains the CLI fallback.

**The EGM Milestone A artifacts** (`.agents/plans/desktop-native-completion/`): scoped drift
report (`2026-11-06_DRIFT_REPORT.md`); six-lens Goldfish brainstorm brief (`concepts_brief.md`);
the reviewed design (`design.md`); the five-stage review reports and their consolidation
(`zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`,
`intermediate_zoom_out_report.md`, `consolidated_review_report.md`); the owner-adjudicated
resolution (`goldfish_review_report.md` — 17 PROPOSE FIX applied, C17 decided in-mission); and
the post-resolution verification pass (`verification-pass.md`). The load-bearing corrections the
review forced: a fail-closed `/health` close guard scoped by backend ownership (the title channel
demoted to a human cue), a canonical zero-grant channel list, the Ctrl+Alt+N shortcut default
kept on every surface, downloads/DnD/Pin/remote-diagnostics routed through the dispositions
ledger, and tiered T1/T2/T3 packaged qualification. The design is the implementation contract
pending the owner's Milestone A sign-off; the architectural tranches (B3+) wait for it.

**Verified.** Commits `36cecea` (EGM artifacts), `e72723b` (resolution), `f133139` (verification
pass + corrections). Five review stages completed with every requested reviewer reporting; the
verification pass confirmed C1–C18 incorporated and found one new ground-truth error (the
contract panel's selects are driven by `E2E-workbench`), fixed in the same pass.

**This revision's doc reconciliation.** `src-tauri/README.md` shutdown text corrected (30 s grace
+ 45 s wedge failsafe — the 10 s figure documented the bug `96f7fb0` fixed); `src/README.md`
counts corrected (38 mounted capability components, 18 public projections) with subsystem entries
for `src/terminal/`, `src/browser/`, `src/preview/`; the sibling
desktop-terminal-browser `architecture.md` baseline corrections (event count, App.tsx size,
single-instance focus wording, T1-baseline markers); `DESIGN.md`'s nonexistent `tokens.css`
reference corrected to `app.css`; and EGM contract READMEs created for the three new subsystem
directories per the revision-34 bootstrap convention.

**Next.** Owner sign-off on `design.md`, then the dispositions ledger (A3) and the CI scaffold
(B1). The Jetson prerequisite (`libwebkit2gtk-4.1-0`, available in Ubuntu repos as 2.50.4) remains
an operator-authorized device change.

---

# Current status — revision 36

Standalone packages for Linux (x64, arm64), macOS (arm64, x64) and Windows (x64) are built and
qualified in CI from one commit (`bdb079d`). Each package bundles the Workbench executable, its browser
assets and the pinned, checksum-verified pg0 manager. The data home is per user; the bundled database is
recorded per data home and stopped only by the process that started it. External PostgreSQL is set with
`COGNATE_POSTGRES_URL`. Installers are unsigned.

**Verified.** GitHub run 41168736030 (`package`, head `bdb079d`): linux-x64, linux-arm64, darwin-arm64,
darwin-x64 and windows-x64 all succeeded. Each POSIX job ran the six journeys (durable restart,
interrupted ownership, stale recovery, fail-closed refusals, external PostgreSQL, upgrade), the browser
UI journey and the deterministic workflow, and each native package was installed, smoke-tested and removed.
Windows ran install, doctor, start, health and uninstall. Also green on `bdb079d`: clean-install (runs
41168740818, 41168735911) and verify (41168740630). Earlier, the full qualification passed on a
Jetson (AGX Orin, Ubuntu 22.04.5, aarch64) against an archive of the same runtime source
(sha256 `62cc73eb292c64c833bb0f213847d4a232a728862f1410535b7f78d6e0f46431`); the `.deb`
(sha256 `1ddd9953d4f91e11d7ac2a2d39c7340762f1e6135adb11676c0786e049c60ff5`) was checked by extraction and
run via `/usr/bin`, not installed system-wide.

**Fixed in CI this revision.** The browser install now uses the repository's pinned Playwright and one
shared browser cache; the qualification helpers read the data home where each platform keeps it (macOS
Application Support); `head -n -1` replaced with a portable form; the Windows smoke test sets its port before
launch; `hdiutil` retries on a busy resource; failing journeys name their line.

**Not verified.** Installing the `.deb` system-wide on the Jetson (needs sudo, not available there). Real
macOS and Windows machines: CI runners only. Signed or notarised installers (none). Upgrade across two
different builds (the upgrade journey reinstalls the same build). Windows stopping the bundled database
cleanly (the smoke test ends the process forcibly).

**Known limits.** The pg0 password is passed as a command-line argument to `pg0 start` (pg0 has no
secret-provisioning interface); pg0 writes it to its instance metadata, which is tightened to 0600. The SDK
`postgresPg0` driver is bypassed in bundled mode because `pg0 start --name` cannot reuse a data directory or
password, a framework gap to report separately. Bubblewrap is absent on the Jetson, so contained agent
execution is refused there by design; the doctor reports it without failing.

**Next.** Merge PR #22 into `main` with a merge commit; dispatch the `package` workflow on `main` with
`publish_release=true` to create `v0.1.0`; verify the release assets and `SHA256SUMS`.

---

# Current status — revision 35

Native-distribution foundation: GodSpeed pins moved to latest (Cognate SDK 0.8.0, domainforge-core 0.21.2;
realitytrace 0.3.0 already current). The bundled pg0 pin now includes the verified linux-aarch64-gnu digest.
A Jetson-class `clean-install-arm64` job on `ubuntu-22.04-arm` passes: it builds the DomainForge v0.21.2
napi binding natively because the npm package ships no linux-arm64 binding. Evidence: GitHub run 41140331701.

Verified: typecheck; smoke suite 73/73; both clean-install jobs green. Not yet: Jetson SSH (host key
not accepted), pg0 ownership/recovery, native packaging, Windows/macOS.

---

# Current status — revision 34

The egm-bootstrap documentation pass is complete: 18 EGM-compliant contract
files (README.md blueprints) now cover the root, `domain/`, `scripts/`, `src/`
and all 14 `src/**` code directories, generated with the `egm-bootstrap` skill
(`elephant-goldfish-model`) and left semantically faithful by a drift review.
Docs-only change; no runtime code was touched.

**What was written.** Every contract carries Overview / Interface / Invariants /
Side Effects / Verification grounded in exact `[file:symbol]` citations from a
fresh read of the code (scouts ran inline, one worker at a time — RAM
constraint). The root README kept its human-authored product documentation and
gained a Repository Blueprint section (subdirectory boundaries, global
invariants/side effects, `just verify` verification) before `## License`.
Pruned out per the skill: `test/`, `docs/`, `fixtures/`, `screenshots/`,
`.agents/`, `.sea/`, `.github/`, `.jolli/`, `.serena/`.

**Verification.** A dedicated correctness pass explicitly read all 18 files:
18/18 PASS (sections, markdown, every relative link resolves, ~60 named test
files exist, 150+ citation spot-checks). The egm-drift-report pass verified
~350 documented claims plus a ~160-symbol reverse export inventory per
directory: verdict consistent, no doc-to-code hallucinations. Its four findings
were fixed and re-verified against source (`WORKBENCH_EVENTS` 27→28,
`seedCatalog` 16→17 in `src/workbench/README.md`; "30 mounted capability
components plus observation/settlement wiring" in `src/README.md`; secrets-path
env precedence in the root blueprint). One stale cross-reference in
`src/ui/experts/README.md` was corrected to link `src/ui/README.md`. No test
suite was run for this change (docs-only); the last full gate remains the
revision-33 settlement run.

**Deliberately not done.** No code changes; `cognate.config.ts` remains an
unconsumed metadata file (documented as such); `src/secrets.ts`'s module header
still says `$COGNATE_HARNESS_HOME` without the `COGNATE_WORKBENCH_HOME`
precedence (source comment, out of the skill's docs-only scope — noted for the
next code touch). Worker evidence and the drift report live outside the repo in
`/tmp/egm-cognate-status/` (worker logs, subtree-index checkpoints,
`final-verification.md`, `drift-report.md`).

**Remaining open:** unchanged from revision 33 — T07 durable steering queue,
T08 GitHub adapter, turn-attributed diffs, the projection re-read amplification
upstream proposal, and the other pre-existing debts. Still a single-operator
Workbench, not production-hardened multi-user.

---

# Current status — revision 33

The PandaCode affordance-delta mission is settled: task-scoped Git checkouts (Priority A, T05+T06)
plus the earlier conversation-affordance slices (T01–T04) are implemented, tested and evidenced on
`main`; T07 (durable steering queue) and T08 (GitHub adapter) remain designed-and-deferred, not
built. Reports: `.agents/plans/pandacode-affordance-delta/` (delta ledger, architecture, plan,
implementation, verification, deferred, final).

**Model first.** The IDM gained `TaskCheckoutRecord` (resource + Task→WorkspaceRecord flow) and
three canonical journeys (J-CHECKOUT-BIND/-EXECUTION/-LIFECYCLE) with catalog entries, validated
before any runtime code (`domainforge validate` 0 violations, `fmt --check` clean; the domain loader
now reports 257 objects). All seven checkout capability ids are anchored on the Task entity in
`domain/index.ts` (`CHECKOUT_CAPABILITY_ANCHORS` + `bindCheckoutCapabilities`).

**Implemented.** `src/workbench/gitOps.ts` (bounded Git operations: worktree
create/status/merge/remove/recreate, argument arrays, no shell, world-provider execution);
`src/capabilities/taskCheckout.ts` (six operator-only capabilities + the agent-invocable
`task.checkout.resolve` read); the public `task-checkout-bindings` projection; `agent.coding`
resolves the binding before each turn and freezes `checkoutRoot`/`checkoutBranch` into
`session.turn.started`; the composer's checkout chip (suggested branch from the task title, default
start point, merge gated on commits that actually exist, two-step remove, recreate when the folder
vanished). One live checkout per task is enforced before anything is created.

**Safety properties are tested, not asserted:** work is never discarded (dirty/untracked removal
refused), an unmerged branch outlives its checkout, conflicts report files and abort cleanly, a
RUNNING task is never re-pointed, a refused bind creates nothing, two tasks never share a
checkout, restart restores the binding from the event log.

**Gates.** Focused suites: 17 pass / 124 expects (git-ops, J-CHECKOUT-parallel, J-CHECKOUT-lifecycle
with 7 tests, ui-checkout) + E2E-checkout 1 pass in real Chromium; `just typecheck` clean;
`domainforge validate` clean. Live operator walkthrough on a real server captured 7 states
(`screenshots/workbench/checkout-live-01..07.png`). Three full `just verify` runs are recorded
verbatim in the verification report; the one checkout failure across them was a real race in the
checkout E2E itself (asserted the async branch list before it loaded), fixed in `6a717f3`; every
other failure is the documented pre-existing host-load flake class, each passing in isolation.
Settlement run on the final tree: **1365 pass / 12 skip / 1 fail** — the one failure is the documented
pre-existing `E2E Experts and Teams` load-sensitive test (passes standalone, 2 pass / 79 s); every
checkout suite green in the run.

**New debt (`.agents/DEBT.md`):** checkout capabilities inherit the agent-effects refusal under the
default contained posture on `local` worlds (message aimed at agent runs); the chip's facts go stale
after commits made outside the app until a reload (capability layer re-checks, so no unsafe
action is possible).

**Remaining open:** T07 durable steering queue (close the write-only `queue-next` channel exactly as
the DEBT entry prescribes, replay/idempotency analysis first); T08 thin `gh` adapter (argument
arrays, no credential storage, untrusted PR content, operator-gated PRs); turn-attributed diffs
(attribution-correctness prerequisite); plus the pre-existing open debts from revision 32
(per-event projection re-read amplification, symlinked directory suggestions, live aggregate
memory accounting, multi-tenant seeding, distributed schedule-evaluator ownership, generalized SDK
inbox, co-tenancy E2E flakiness under parallel verify). Still a single-operator Workbench, not
production-hardened multi-user.

Next: propose the projection-sync batching/delta change upstream; then T07 when its
replay/idempotency analysis is done.

---

# Current status — revision 32

The RED-journeys mission is settled: the five intentionally red Session/Workspace/Task/Run suites
and the E2E UX suite on `test/red-session-workspace-task-contracts-20261020` (PR #2) are green
against real Cognate execution.

**Model first.** The IDM gained the `AgentRun` entity, the SessionDraft / DirectorySuggestion /
TaskBindingRecord / TaskMoveRecord / RunTaskAttribution / AssignmentTaskRecord resources and flows,
and six canonical journeys (J-SESSION-draft, J-WS-directory-discovery, J-TASK-scope, J-TASK-move,
J-RUN-task-attribution, J-TASK-expert-provenance) with catalog entries — validated before any
implementation (`domainforge validate` 0 violations, `fmt --check` clean, 252 objects). New
capabilities are bound explicitly in `domain/index.ts` (`RED_JOURNEY_ANCHORS`; `task.list`/`task.move`
joined the workbench Task family).

**Implemented.** Durable idempotent session drafts (deterministic identity, one `session.created`
event, draft rows survive reload/restart, explicit-workspace binding, first-turn reuse). Read-only
execution-world directory suggestions with one shared accessible picker across the Add-workspace
dialog, SSH/WSL folder step and first-run chooser. One Task entity with workspace/session scope,
`task.list` visibility semantics, governed `task.move` (identity/evidence/provenance preserved,
stale bindings invalidated, in-flight refused), and the durable per-session `session.task.bind`
binding surfaced as the composer's Task control. `agent.coding` freezes the validated taskId into
`session.turn.started`; `team.converse` validates and stamps the Task on orchestrator and specialist
assignments. The + action creates a selected draft from every screen, focuses the composer, and
shows retryable errors; New-task presents the This workspace / This session choice; TaskDetail
gains Move-or-promote with consequence previews.

**Races found by existing expert E2E suites, fixed in the product:** the session-task-bindings store
no longer mounts with no session open (per-event projection re-read amplification exhausted
Chromium's request pool on long logs); `startNewSession` closes panels at click time instead of
after its async invoke. The amplification itself is a known limitation needing an upstream framework
change (docs/known-gaps.md).

**Gates.** All five red suites green (18 tests, real runtime + real Chromium); `just verify` green
(1,197 pass / 9 pre-existing skips / 0 fail, 1,206 tests); expert regression suites green in
isolation; DomainForge validation and the Cognate adapter check clean. UX evidence captured in
`screenshots/red-journeys/` by `test/E2E-red-journeys-evidence.test.ts`. Two red-test selectors were
refined with assertions preserved/strengthened (documented in-file and in the handoff).

**Remaining open:** the client's per-event projection re-read amplification (framework change to
propose upstream); strict-prefix directory suggestions with symlinked directories never offered;
no retroactive draft rows for pre-existing sessions; the move preview is descriptive, not a
destination-config diff; plus the pre-existing open debts from revision 31 (co-tenancy E2E flakiness
under parallel verify, live aggregate memory accounting, multi-tenant seeding, distributed
schedule-evaluator ownership, generalized SDK inbox). Still a single-operator Workbench, not
production-hardened multi-user.

Next: mark PR #2 ready for review with the final report; propose the projection-sync batching/delta
change upstream.
