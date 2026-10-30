# Delta ledger — PandaCode → Cognate Workbench

Evidence classes: OBSERVED (donor code/tests read at `ceed919`), RECON (`.tmp/Panda_Code/`
dossier, captures v0.3.4), EXISTING (Workbench code/tests read on this branch),
INFERRED (marked; not verified). Classification key: EXISTING / ENHANCE / ADD /
ADAPT / DEFER / EXCLUDE.

Workbench baseline: branch `test/red-session-workspace-task-contracts-20261020`,
T01–T04 conversation affordances already committed (`b9a6d79`).

## 1. Conversation, approvals, steering (Priority C)

| Donor affordance | Workbench reality | Decision |
| --- | --- | --- |
| Collapsed chronological tool groups, expandable disclosures (OBSERVED `tool-activity.ts`, `tool-trace.ts`) | Was a flat running-tool list; no grouping | **ENHANCE — DONE (T01)**, `src/toolGroups.ts`, 35 tests |
| Compact approval bar, first-line summary, ticks stripped (OBSERVED `approval-bar.ts:10-13`) | Full-text approval prompt could push actions off-screen | **ENHANCE — DONE (T03)**, `src/approvalSummary.ts` + render tests |
| Multi-message composer queue with per-row Cancel/Steer (OBSERVED `message-queue.ts`) | Single parked string | **ENHANCE — DONE (T04)**, `src/steerQueue.ts`; reorder/hold-reason cut with reasons in the prior report |
| Truthful steering status | UI asserted "applies at the next step" with no confirmation | **ENHANCE — DONE (T04)**: `pending → applied` on matching `workbench.steer.consumed` id |
| Durable queue across reload (donor: SQLite-backed) | In-memory; durable `queue-next` channel is write-only (`.agents/DEBT.md`) | **DEFER → T07**; the DEBT entry prescribes the exact closure path |
| Queue edit / move up / move down | n/a | **EXCLUDE** (presentation-only; Cancel + Steer carry the delivery consequences) |
| Approval permission modes (Standard/Full access) | Authority scopes + approval gate + SEA-Forge, far deeper | **EXISTING**; modes are authorization, not a UX affordance |
| Agent question cards | `ambiguousStep` capability + continuations | **EXISTING** |

## 2. Screenshot paste / visual attachments (Priority C)

| Donor affordance | Workbench reality | Decision |
| --- | --- | --- |
| Clipboard paste → thumbnails, remove, count caps (OBSERVED `attachments.ts:31-62`) | Nothing | **ADD — DONE (T02, preview-only)**, `src/attachments.ts`; 4-image cap, 8 MiB ceiling, honest "not sent" copy |
| Deliver image bytes to an image-capable model | Framework blocks: `ModelMessage.content` is `readonly string`, providers hardcode `multimodal_input: false` | **EXCLUDE (this revision)** — a framework change, recorded as the prerequisite; faking delivery is worse than none |
| Drop/file-picker selection | Paste only today | **DEFER (S)** — small, follow-up of T02 |

## 3. Git branches, worktrees, task-scoped checkouts (Priority A)

| Donor affordance (OBSERVED `workspace.rs`, `worktrees.ts`, `lib.rs`) | Workbench reality | Decision |
| --- | --- | --- |
| Task-bound isolated checkout: `create_worktree_with` — branch validation, `check-ref-format`, base-branch start point, existing-branch adoption, sibling `<repo>-worktrees/<branch>` layout | `contract.context.branch` is a free-text field; nothing Git-backed; agent turns always run in the workspace root | **ADD — T05 (core of this mission)** |
| Execution routed to the task's checkout | All tools resolve `workspace.path` root | **ADD — T05**: `task.checkout.resolve` in `agent.coding`, checkout frozen into `session.turn.started` |
| Branch list / current / default (`for-each-ref`, `symbolic-ref`) | none | **ADD — T05** (`git.branch.list`) |
| Worktree status: exists, uncommitted count, upstream, ahead, merged into main (`status --porcelain=v1 -z`, `rev-list --count`, `merge-base --is-ancestor`) | none | **ADD — T05** |
| Safe removal: no `--force`, prune, `branch -d` only, keep unmerged branch, refuse dirty | none | **ADD — T05** |
| Recreate missing worktree at same path (`worktree add -- <path> <branch>`) | none | **ADD — T05** |
| Local merge into default branch with conflict report + `merge --abort`, never half-merged | none | **ADD — T05** (operator-gated consequential action) |
| Draft-preserving task adoption; started-task transitions | Task contracts are durable; runs freeze task id per turn | **ADAPT — T05**: rebind refused while task RUNNING; per-turn checkout keeps history truthful |
| Branch-name suggestion from task intent (`suggestBranch`) | none | **ADD — T06** (slug from task title, `workbench/` namespace) |
| Copy path / open checkout | n/a | **ADD — T06** |
| `git push --set-upstream` + `gh pr create` | none | **DEFER → T08** (needs `gh` adapter; authorization gates required) |
| Per-turn attributed file changes (`pandacode_track_files` begin/complete handshake, frozen patches in SQLite) | `worker.return` changed-lists + review patches; no byte-level attribution | **DEFER**: honest attribution needs a write-handshake tool plus immutable patch storage; a Git status diff is *not* attribution (donor agrees, `turn-changes.md`). Prerequisite written in `deferred.md` |
| Stage/unstage/commit UI on current changes | none | **DEFER → after T06** (depends on T05 ops; second-order to isolation which is the operator's ask) |

## 4. GitHub integration (Priority B)

| Donor affordance | Workbench reality | Decision |
| --- | --- | --- |
| `gh`-CLI-only integration, no token storage, prompts disabled, 2 MiB cap (OBSERVED `github.rs`) | none | **ADAPT — T08**: same discipline via bounded subprocess through execution worlds |
| Repo list / issues / PRs browser tabs | none | **DEFER → T08** (thin adapter; issues/PR content treated as untrusted input) |
| Issue → task with linked context; PR linked to task (`task_links` table) | tasks durable; no external links | **ADAPT — T08** (durable link events, not a second store) |
| 1-click PR workflows (review, fix checks, merge when ready) | Workbench review gate is deeper (evidence, settlement) | **ADAPT — T08**: PR actions feed the existing review gate; never auto-accept |

## 5. Development, inspection and navigation (Priority D)

| Donor affordance | Workbench reality | Decision |
| --- | --- | --- |
| Multi-provider harnesses with badges and live status | Providers/model catalog/experts/teams, verified journeys | **EXISTING** |
| ⌘J integrated terminal; `pandacode-run.sh` one-click Run | Shell only through governed agent tools (`risk.assess`, shell safety) | **DEFER**: an interactive terminal is a new governed surface (pty streaming, scrollback, containment); operator's shell exists outside the app. Prerequisite noted in `deferred.md` |
| In-app browser, local-server detection, element-select, screenshot grounding, iOS simulator | No browser engine; no simulator | **DEFER/EXCLUDE**: no host mechanism exists to reuse; a browser engine is explicitly out (mission §7). Simulator: EXCLUDE (off Workbench's product axis) |
| Board with GitHub import; task context menus | Task sidebar with status/contract/review; `task.move` | **EXISTING (core)**; GitHub import rides T08 |
| ⌘K palette / quick-launch overlay / active-agent monitor | `shortcuts.ts` covers app shortcuts | **DEFER (S)**: a navigation palette is self-contained and cheap once T06 lands; recorded, not silently dropped |
| Session titles / summaries | Sessions have durable drafts/titles (J-SESSION-draft) | **EXISTING** |
| Session import | n/a | **DEFER** (schema mapping risk; low operator value today) |
| Bots (Telegram/Slack), schedules/channels | Native schedules verified (J-SCHEDULE); no external channels | **DEFER**: outbound channel connectors conflict with the single-operator security posture until external auth exists |
| Clean-VM / cloud sandboxes | Execution worlds: local, SSH, WSL, bubblewrap (verified) | **ADAPT later**: new world provider kinds are framework-level additions; recorded |
| Usage/cost and quota tracking | `economics.ts`, context-budget billing, model routes | **EXISTING** |
| Resume where you left off | Durable sessions, drafts, archive, history | **EXISTING** |
| Wallpaper / background customization | n/a | **EXCLUDE** — mission §8, explicit |

## Provenance and licensing

PandaCode license (read at `ceed919`): MIT **with a fork-attribution condition** — any
publicly released fork must state "This is a fork of PandaCode" with a link. Cognate
Workbench is **not a fork** of PandaCode: no PandaCode code is copied; only general
mechanisms (grouping caps, summary limits, worktree safety semantics) are re-implemented
in Workbench's architecture, exactly like the pre-existing codex/opencode ports recorded
in `primitive-provenance.md`. The prior T01–T04 modules follow the same rule
(mechanisms ported, no donor code). No donor file is tracked in this repository; the
donor stays under `.tmp/` (untracked).

## Before/after (implemented deltas)

- **T01–T04 (committed `b9a6d79`)** — see `.agents/reports/pandacode-delta/implementation-report.md`.
- **T05/T06 (this plan)** — before: a task's `context.branch` is decoration; every turn
  executes in the workspace root; two tasks editing one repo share one checkout and
  collide. After: an operator binds a task to an isolated worktree from the composer;
  the agent's reads, edits and shell commands land in that checkout (frozen per turn);
  two tasks work the same file in parallel without collision; the main checkout stays
  clean; branch/merge/remove/recreate are governed lifecycle operations with refusals
  that explain themselves; restart restores the association.
