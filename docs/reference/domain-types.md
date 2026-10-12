# Reference: domain types

The vocabulary types from `src/workbench/types.ts` and `src/cognitive/`, with the invariants that
matter. Narrative explanation is in [Evidence and done](../concepts/evidence-and-done.md) and
[Cognitive navigation](../concepts/cognitive-navigation.md); this page is for looking things up.

## The task contract

```ts
interface TaskContract {
  context:    { workspaceId?: string; files: readonly string[]; branch?: string };
  goal:       { outcome: string; deliverable?: string; nonGoals: readonly string[] };
  skills:     readonly string[];                 // capability ids
  authority?: AuthorityScopes;
  executors:  readonly ExecutorBinding[];
  budget?:    Budget;
  invariants: readonly Invariant[];
  acceptance: readonly AcceptanceCriterion[];
}
```

**Invariant: `context.workspaceId` alone does not define task scope.** Scope is the explicit file
list plus the branch.

`CONTRACT_FIELDS` is the canonical eight, in the order the cockpit renders them:
`context, goal, skills, authority, executors, budget, invariants, acceptance`.

Satisfaction rules, enforced by `contractMissing()`:

| Field | Satisfied when |
|---|---|
| `context` | `context.workspaceId` is a non-blank string |
| `goal` | `goal.outcome` is non-blank |
| `skills` | at least one |
| `authority` | defined (not `undefined`) |
| `executors` | at least one |
| `budget` | defined |
| `invariants` | at least one |
| `acceptance` | at least one |

## Authority

```ts
type Grant = "yes" | "approval" | "no";

interface AuthorityScopes {
  filesystem: { read: Grant; write: Grant; outsideWorkspace: Grant };
  shell:     { run: Grant; destructive: Grant };
  network:   Grant;
}
```

`approval` means the operation needs a human decision before it runs.

**Invariant: outcomes are ordered `allow < approval < deny` and the strictest wins.** Adding a rule
can only tighten an outcome, never loosen it.

A `Decision`:

```ts
interface Decision {
  outcome: "allow" | "approval" | "deny";
  rule: string;          // which rule fired
  reason: string;        // human-readable
  pattern?: string;      // the protected pattern, when rule is "protected-evidence"
  path?: string;         // the normalised path that matched
}
```

`normalizeRelative(relPath)` returns `{ path, escapes }`, where `escapes` is true when the path
leaves the workspace. Escaping is distinguishable from simply matching nothing.

## Completion

```ts
type DoneLevel =
  | "not-started" | "finished" | "produced" | "tested"
  | "ready-for-review" | "accepted" | "operationalized";

type TaskStatus =
  | "BACKLOG" | "BRIEFING" | "READY" | "RUNNING" | "BLOCKED"
  | "READY_FOR_REVIEW" | "REWORK" | "ACCEPTED" | "OPERATIONALIZED";
```

**Invariant: the UI must not collapse `DoneLevel`.** They are deliberately separate.

`BACKLOG` and `BLOCKED` are defined but no UI action currently sets them — a recorded gap.

## Evidence

```ts
type AcceptanceKind = "test" | "independent-check" | "journey" | "audit" | "integrity" | "human";
type EvidenceKind   = AcceptanceKind | "domain" | "implementation" | "quality" | "runtime";

interface AcceptanceCriterion {
  id: string;
  kind: AcceptanceKind;
  description: string;
  required: boolean;
}

interface EvidenceEntry {
  id: string;
  kind: EvidenceKind;
  status: "pass" | "fail" | "pending";
  // …criterion binding and detail
}
```

Ledger rows group criteria into `closed | failed | open`.

`openRequired` reports the required criteria still open; `acceptanceReady` and `reviewReadiness`
compute whether review may proceed.

## Invariants on work

```ts
type InvariantKind = "domain" | "product" | "design" | "governance" | "workflow";
interface Invariant { id: string; kind: InvariantKind; statement: string; }
```

## Executors and budget

```ts
type ExecutorRole = "primary" | "architect" | "worker" | "verifier";

interface ExecutorBinding {
  role: ExecutorRole;
  executor: string;               // e.g. "model:deepseek-chat", "tool:bun-test"
  kind: "llm" | "deterministic";
  billingRoute?: string;
}

interface Budget {
  maxMs?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  maxConcurrency?: number;
}
```

**Invariant: `executor != evaluator authority`.** A binding may not also grant the authority to judge
its own output.

A budget is informational. Nothing enforces it at runtime — a recorded gap.

## Skills

```ts
// CAPABILITY_LIFECYCLE is an ordered list of CapabilityState values
function nextLifecycle(state): CapabilityState | undefined;
function advanceLifecycle(from, to): { ok: true; state } | { ok: false; error: string };
```

**Invariant: only the immediate next lifecycle state may be entered.** `advanceLifecycle` refuses a
skip, and refuses an unknown `from`.

## Workflows

```ts
// Edge mode determines whether the target must pass or must settle the source.
"needs"   // must pass
"after"   // must settle
```

A `Transition` carries `{ to, mode, auto, evidenceRequired, guard? }`. **Invariant: at most one
`auto` transition per edge** — a green neighbour does not silently advance a node; advancement is
explicit.

## Cognitive types

```ts
interface WorldManifest {
  schemaVersion: typeof MANIFEST_VERSION;   // 1
  repoSha?: string;
  files: Readonly<Record<string, string>>; // path -> content hash
  semanticModelHash: string;
  policyHash: string;
  environmentHash: string;
  criterionHash?: string;
  methodHash?: string;
}
```

**Invariants on the manifest:**

- It contains only state that changes *what the world is*.
- `repoSha` is a field of the manifest, **not** the identity. `repoSha != worldHash`.
- Lineage metadata — origin case, origin run, parent, status, timestamps — rides on events and is
  **excluded** from the hash. A candidate promoted to settled keeps the same `worldHash`.

```ts
type RefKind = "case" | "world" | "candidate" | "evidence" | "affordance"
             | "experiment" | "tool-call" | "surface" | "artifact";
type SemanticRef = `${RefKind}:${string}`;
```

`parseRef` validates against `^<kind>:<id>$`. An unparseable ref is rejected rather than guessed at.

```ts
interface PossibleOperation {
  id: string; label: string; purpose: string; advances: string;
  capability?: string;
  requires?: readonly string[];
  produces?: readonly string[];
  authority?: "human" | "none";
  payment?: { unit: string; estimate: number; basis: string };  // omit when unknown — never 0
  recovery?: "required" | "none";
  needsObserver?: boolean;
  priority?: number;
}
```

**Invariants on affordances:**

- Possibility is not affordance. An operation is current only if its preconditions hold, a capability
  and provider exist, the lease permits it, and its observer/recovery is reachable.
- A blocked affordance names `blockedBy` and the move that would unblock it.
- At most one `successor` per affordance.
- Payment is omitted when unknown. `unknown != 0`.

```ts
type Intent   = "inspect" | "compare" | "decide" | "verify" | "monitor";
type Lifetime = "while-condition" | "until-settled" | "session" | "persistent-if-human-pinned";
```

Surface block types: `callout`, `entity`, `table`, `compare`, `timeline`, `preflight`, `ask`.
**Invariant: `validateSurface` rejects unknown block types, unknown keys, and non-string leaves.**
`timeline` (ordered consequential history) and `compare` (A/B difference) are distinct on purpose.

Mediation tiers, in order: `governance > system > product > user > core`.
**Invariant: a lower-trust mediator cannot lower a trusted approval requirement.** Sentinel compares
against `next.trusted`.

## Settings

```ts
type WorkDetailsMode  = "compact" | "standard" | "detailed" | "verbose";
type AgentPreset      = "standard" | "ptc" | "minimal";
type PermissionMode   = "read-only" | "workspace-write" | "full-access";
```

**Invariant: `read-only < workspace-write < full-access`, and an unrecognised value ranks above every
known one.** Fail-closed.

`PRESET_TOOLS`:
- `standard` — read, edit, bash, todo_write, exit_plan_mode, subagent
- `ptc` — standard + run_code
- `minimal` — bash

`showsLiveProcessDetail(mode)` is true for `standard` and `detailed`.

## Focus

```ts
type FocusKind = "task" | "workflow-node" | "evidence" | "capability"
              | "automation" | "file" | "session";
```

**Invariant: focus never confers authority.** It is ephemeral and is not truth.

## Source trail

- `src/workbench/types.ts` — the shared vocabulary; every workbench module imports from it
- `src/workbench/authority.ts` — the ordering invariant
- `src/workbench/contract.ts` — the satisfaction rules
- `src/workbench/ledger.ts` — grouping and readiness
- `src/workbench/skillOs.ts` — the lifecycle invariant
- `src/workbench/workflow.ts` — edge modes and transitions
- `src/cognitive/world.ts` — the manifest invariants
- `src/cognitive/affordance.ts` — the affordance invariants
- `src/cognitive/surface.ts` — the closed grammar
- `src/cognitive/mediation.ts` — tiers and the trusted-subchain rule
- `src/cognitive/focus.ts` — `REF_KINDS`, `ATTENTION_PRECEDENCE`
- `src/domain/approvalGate.ts` — `PERMISSION_RANK`