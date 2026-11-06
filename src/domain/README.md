# domain (Pure Decision Functions)

## Overview

Pure, side-effect-free decision functions that anchor the app's semantic model.
Both files are deliberately plain functions, NOT IDM CapabilityContracts: the
authoritative interaction model stays in `.sea/interaction/interaction-model.sea`
(loaded in place by `src/domain`'s consumers); these helpers are the pure code
counterparts of its `ApprovalGate` and `PlanMode` entities.
[approvalGate.ts:approvalGate] decides whether a tool call needs human approval
before it runs; [planGate.ts] holds the pure helpers for the plan-mode journey
(J-E-plan). These functions are consumed by `src/agents/agentCoding.ts`
(`agentCodingAgent`), which performs all I/O around them.

## Interface

- [approvalGate.ts:ApprovalDecisionRequest] — input: `{ tool, args, mode? }`; `mode` is the session's access mode (any case/spacing, normalized; defaults to `"read-only"`).
- [approvalGate.ts:ApprovalGateDecision] — output: `{ required, permission?, justification? }`; `permission`/`justification` present iff `required`.
- [approvalGate.ts:approvalGate] — the approval decision: approval is required exactly when `tool` is `"run_code"` and it carries a non-empty `sandbox_permissions` string ranked above the session's current access mode.
- [approvalGate.ts:approvalDeniedToolResult] — the exact denial text fed back to the model on Reject.
- [planGate.ts:isPlanOffCommand] — true for a message that is exactly the `/plan off` slash command (case/space-insensitive).
- [planGate.ts:splitPlanPrefix] — splits a leading `/plan ` prefix from the task text; returns `undefined` when the prefix is absent or the message is `/plan off`.
- [planGate.ts:extractPlanHeading] — the plan heading is its markdown's first `#`-level heading line, falling back to a truncated (80-char) first line.
- [planGate.ts:EXIT_PLAN_MODE_NOT_IN_PLAN_MODE] — constant denial text for `exit_plan_mode` called outside plan mode.
- [planGate.ts:PLAN_APPROVED_TOOL_RESULT] — constant reflection text on Approve.
- [planGate.ts:planRequestChangesToolResult] — "request changes" denial text (this app's own wording, flagged as not reference-observed in the source comment).
- Private: [approvalGate.ts:PERMISSION_RANK] (`"read-only"` 0, `"workspace-write"` 1, `"full-access"` 2), `normalize`, `rank`, and [planGate.ts:PLAN_PREFIX] (`/^\/plan\b\s*/i`).

## Invariants

- Pure functions: no I/O, no state, no randomness — decision only (file headers of [approvalGate.ts:approvalGate] and [planGate.ts]).
- Fail-closed ranking: an unrecognized permission or mode ranks above every known one (`Number.POSITIVE_INFINITY` in [approvalGate.ts:rank]), per journey `j_d_approval` "fail-closed by default".
- Approval is required exactly when the tool is `run_code` AND it carries a `sandbox_permissions` string ranked strictly above the current mode; `read`/`edit`/`bash` never reach this gate ([approvalGate.ts:approvalGate]).
- An absent `mode` defaults to `"read-only"`, the conservative default ([approvalGate.ts:approvalGate]).
- Denial and approval strings are exact reference-observed texts ([approvalGate.ts:approvalDeniedToolResult], [planGate.ts:EXIT_PLAN_MODE_NOT_IN_PLAN_MODE], [planGate.ts:PLAN_APPROVED_TOOL_RESULT]); [planGate.ts:planRequestChangesToolResult]'s wording is explicitly documented as this app's own invention (source comment, docs/known-gaps.md).
- [planGate.ts:splitPlanPrefix] returns `undefined` for `/plan off` so the off-command is never treated as a plan-mode-enabling prefix.
- [planGate.ts:extractPlanHeading] truncates the fallback heading to 80 characters.
- These are deliberately NOT CapabilityContracts — they are pure decision helpers named after the IDM entities; the `.sea/interaction/interaction-model.sea` model is the authoritative semantic anchor (file headers).

## Side Effects

- None. Both files are pure: no I/O, no network, no disk, no locks, no module state beyond constant tables ([approvalGate.ts:PERMISSION_RANK], [planGate.ts:PLAN_PREFIX]).

## Verification

- Run (from repo root): `bun test test`
- Covered by, among others: `test/J-D-approval.test.ts` (approval waterfall) and `test/J-E-plan.test.ts` (plan mode) — both verified present under `test/`.
