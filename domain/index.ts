// Loads Cognate Workbench's authoritative Interaction Domain Model (IDM).
// The inherited semantic namespace is preserved for compatibility with persisted evidence.
//
// Per idm-to-cognate.md "Gaps": there is no canonical `.sea/interaction/` -> `domain/*.sea` wiring
// step in the CLI or the domainforge package. This app's decision: `domain/` does NOT copy or
// symlink the `.sea` source — it re-exports it in place, reading directly from
// `APP/.sea/interaction/interaction-model.sea` at startup via `loadSemanticProjection`. That file
// remains the single source of truth for the IDM; this module is the one place that knows its path.
import { readFile } from "node:fs/promises";
import { bindCapabilities, loadSemanticProjection, type CapabilityBinding, type SemanticProjection } from "@godspeedai/cognate-domainforge";
import type { CapabilityContract, SemanticRef } from "@godspeedai/cognate-kernel-api";
import { resourcePath } from "../src/resources.ts";

export interface Domain {
  readonly projection: SemanticProjection;
  /** `${namespace}::${EntityName}` semantic ids used by bindings below. */
  readonly semanticId: (name: string) => string;
}

/** Parse the IDM and fail fast on any error (spec: "fail fast on errors"). */
export async function loadDomain(): Promise<Domain> {
  const path = resourcePath(".sea", "interaction", "interaction-model.sea");
  const source = await readFile(path, "utf8");
  const result = loadSemanticProjection(source, { uri: `domain/${path}` });
  if (!result.ok) {
    throw new Error(`domain: failed to parse interaction-model.sea: ${JSON.stringify(result.error)}`);
  }
  const { projection } = result;
  const namespace = "deepseek-harness.interaction";
  // eslint-disable-next-line no-console
  console.log(`[domain] loaded ${projection.objects.length} semantic objects (digest ${projection.source.digest}) from ${path}`);
  return { projection, semanticId: (name) => `${namespace}::${name}` };
}

/** The executable cognitive capabilities are anchored explicitly to the IDM concepts they realize. */
export const COGNITIVE_CAPABILITY_ANCHORS: Readonly<Record<string, string>> = {
  "case.open": "Case",
  "criterion.freeze": "SuccessCriterion",
  "world.freeze": "WorldSnapshot",
  "world.fork": "WorldSnapshot",
  "world.attach": "WorldSnapshot",
  "world.discard": "WorldSnapshot",
  "verification.run": "Verification",
  "case.derive": "Case",
  "world.settle": "WorldSnapshot",
  "risk.assess": "RiskAssessment",
  "case.observe": "Case",
  "ui.focus.publish": "AttentionFocus",
  "ui.context": "AttentionFocus",
  "ui.request": "AttentionFocus",
  "ui.pending": "AttentionFocus",
  "experiment.round": "Experiment",
  "experiment.status": "Experiment",
  "method.review": "MethodRecommendation",
  "method.accept": "MethodRecommendation",
  "method.active": "MethodRecommendation",
};

export function cognitiveCapabilityBindings(domain: Domain): readonly CapabilityBinding[] {
  return Object.entries(COGNITIVE_CAPABILITY_ANCHORS).map(([id, entity]) => ({
    semanticId: domain.semanticId(entity),
    capability: { id, version: "1.0.0" },
  }));
}

export function bindCognitiveCapabilities(domain: Domain): Readonly<Record<string, SemanticRef>> {
  const bindings = cognitiveCapabilityBindings(domain);
  const contracts = bindCapabilities(domain.projection, bindings);
  if (contracts.length !== 20) throw new Error(`domain: expected 20 cognitive contracts, got ${contracts.length}`);
  const unbound = contracts.find((contract) => !contract.semanticRef);
  if (unbound) throw new Error(`domain: cognitive capability ${unbound.id} has no SemanticRef`);
  return Object.fromEntries(contracts.map((contract) => [contract.id, contract.semanticRef!])) as Readonly<Record<string, SemanticRef>>;
}

/**
 * Explicit capability bindings for this tranche (T5). Only capabilities this app actually publishes
 * are bound — no speculative bindings (idm-to-cognate.md traceability rule #1, handoff.md "What
 * downstream agents should NOT do").
 */
export function tranche5Bindings(domain: Domain): readonly CapabilityBinding[] {
  return [
    { semanticId: domain.semanticId("ModelProvider"), capability: { id: "model.generate", version: "1.0.0" } },
    { semanticId: domain.semanticId("ModelProvider"), capability: { id: "secret.put", version: "1.0.0" } },
    { semanticId: domain.semanticId("ModelProvider"), capability: { id: "model.configure", version: "1.0.0" } },
    { semanticId: domain.semanticId("WorkspaceRecord"), capability: { id: "workspace.select", version: "1.0.0" } },
    { semanticId: domain.semanticId("Session"), capability: { id: "session.history", version: "1.0.0" } },
  ];
}

export function bindTranche5(domain: Domain) {
  const contracts = bindCapabilities(domain.projection, tranche5Bindings(domain));
  if (contracts.length !== 5) throw new Error(`domain: expected 5 bound contracts, got ${contracts.length}`);
  const [modelGenerate, secretPut, modelConfigure, workspaceSelect, sessionHistory] = contracts as [
    CapabilityContract,
    CapabilityContract,
    CapabilityContract,
    CapabilityContract,
    CapabilityContract,
  ];
  return { modelGenerate, secretPut, modelConfigure, workspaceSelect, sessionHistory };
}

/**
 * T7 additions: `Tool` (`tool.read`/`tool.edit`/`tool.bash`/`tool.run_code`) and `WorkspaceRecord`
 * (`workspace.path`, the tool loop's root-resolution lookup). `ApprovalGate` is deliberately left
 * unbound here — it is realized as a pure decision function (`src/domain/approvalGate.ts`) plus a
 * `ctx.waitFor` continuation inside `agent.coding`, not as a `CapabilityContract`; see BINDINGS.md.
 */
export function tranche7Bindings(domain: Domain): readonly CapabilityBinding[] {
  return [
    { semanticId: domain.semanticId("Tool"), capability: { id: "tool.read", version: "1.0.0" } },
    { semanticId: domain.semanticId("Tool"), capability: { id: "tool.edit", version: "1.0.0" } },
    { semanticId: domain.semanticId("Tool"), capability: { id: "tool.bash", version: "1.0.0" } },
    { semanticId: domain.semanticId("Tool"), capability: { id: "tool.run_code", version: "1.0.0" } },
    { semanticId: domain.semanticId("WorkspaceRecord"), capability: { id: "workspace.path", version: "1.0.0" } },
  ];
}

export function bindTranche7(domain: Domain) {
  const contracts = bindCapabilities(domain.projection, tranche7Bindings(domain));
  if (contracts.length !== 5) throw new Error(`domain: expected 5 bound contracts, got ${contracts.length}`);
  const [toolRead, toolEdit, toolBash, toolRunCode, workspacePath] = contracts as [
    CapabilityContract,
    CapabilityContract,
    CapabilityContract,
    CapabilityContract,
    CapabilityContract,
  ];
  return { toolRead, toolEdit, toolBash, toolRunCode, workspacePath };
}

/**
 * T9 addition: `PlanMode` (`plan.state`, `agent.coding`'s per-turn read of the session's plan
 * mode/todos/review state — see `src/capabilities/planState.ts`). Plan mode itself is not a
 * `CapabilityContract` a UI action invokes directly; it is app events (`plan.mode.changed`,
 * `plan.todos.updated`, `plan.review.requested`, `plan.review.decided`) emitted by `agent.coding`
 * and folded by the `plans` projection — same shape as `ApprovalGate` (T7-T8: a pure decision
 * function plus a `ctx.waitFor` continuation, not a bound capability). See BINDINGS.md.
 */
export function tranche9Bindings(domain: Domain): readonly CapabilityBinding[] {
  return [{ semanticId: domain.semanticId("PlanMode"), capability: { id: "plan.state", version: "1.0.0" } }];
}

export function bindTranche9(domain: Domain) {
  const contracts = bindCapabilities(domain.projection, tranche9Bindings(domain));
  if (contracts.length !== 1) throw new Error(`domain: expected 1 bound contract, got ${contracts.length}`);
  const [planState] = contracts as [CapabilityContract];
  return { planState };
}

/**
 * T10 addition: `Subagent` (`subagent.start`, this app's own capability the `subagent` tool's
 * fire-and-forget delegation invokes directly — see `src/capabilities/subagentStart.ts` for why the
 * packaged `@godspeedai/cognate-profile-harness` one is not reused).
 */
export function tranche10Bindings(domain: Domain): readonly CapabilityBinding[] {
  return [{ semanticId: domain.semanticId("Subagent"), capability: { id: "subagent.start", version: "1.0.0" } }];
}

export function bindTranche10(domain: Domain) {
  const contracts = bindCapabilities(domain.projection, tranche10Bindings(domain));
  if (contracts.length !== 1) throw new Error(`domain: expected 1 bound contract, got ${contracts.length}`);
  const [subagentStart] = contracts as [CapabilityContract];
  return { subagentStart };
}

/**
 * Usage pass U2: `UserPreferences` — the durable Settings -> General inventory
 * (reference-behavior-matrix.md §11). One `settings.change*` capability per setting group, all
 * realized by the single `settingsChangeComponent` (`src/capabilities/settingsChange.ts`): each
 * validates its field and starts a deterministic `agent.config` run whose `settings.changed`
 * event the `settings` projection folds into its one "current" row. `settings.changeWorkDetails`
 * predates the entity (it was unbound, like `onboarding.dismiss`); creating `UserPreferences`
 * this tranche retroactively gives the whole family its semantic anchor. Order matches
 * SETTING_FIELDS in `src/capabilities/settingsChange.ts`.
 */
export function usage2Bindings(domain: Domain): readonly CapabilityBinding[] {
  return [
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changeWorkDetails", version: "1.0.0" } },
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changePermission", version: "1.0.0" } },
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changeLanguage", version: "1.0.0" } },
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changeAppearance", version: "1.0.0" } },
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changeFontSize", version: "1.0.0" } },
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changePerformanceDetail", version: "1.0.0" } },
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changeCodingTools", version: "1.0.0" } },
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changeSendBehavior", version: "1.0.0" } },
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changePreset", version: "1.0.0" } },
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changePlugin", version: "1.0.0" } },
    { semanticId: domain.semanticId("UserPreferences"), capability: { id: "settings.changeSpending", version: "1.0.0" } },
  ];
}

export function bindUsage2(domain: Domain) {
  const contracts = bindCapabilities(domain.projection, usage2Bindings(domain));
  if (contracts.length !== 11) throw new Error(`domain: expected 11 bound contracts, got ${contracts.length}`);
  return { settingsChange: contracts.map((c) => c.semanticRef) };
}

/**
 * Usage pass U3: the sidebar's per-workspace actions (reference-behavior-matrix.md §12 — Rename /
 * Delete workspace), anchored on the existing `WorkspaceRecord` entity. Realized by
 * `workspaceManageComponent` (`src/capabilities/workspaceManage.ts`); each validates against the
 * live `workspaces` projection and starts a deterministic `agent.config` run whose
 * `workspace.renamed` / `workspace.deleted` event the projection folds (a deleted current
 * workspace clears the pointer — the UI falls back to the no-workspace state).
 */
export function usage3Bindings(domain: Domain): readonly CapabilityBinding[] {
  return [
    { semanticId: domain.semanticId("WorkspaceRecord"), capability: { id: "workspace.rename", version: "1.0.0" } },
    { semanticId: domain.semanticId("WorkspaceRecord"), capability: { id: "workspace.delete", version: "1.0.0" } },
  ];
}

export function bindUsage3(domain: Domain) {
  const contracts = bindCapabilities(domain.projection, usage3Bindings(domain));
  if (contracts.length !== 2) throw new Error(`domain: expected 2 bound contracts, got ${contracts.length}`);
  return { rename: contracts[0]!.semanticRef, remove: contracts[1]!.semanticRef };
}


/**
 * Remote Workspaces (T4): the execution-world family, anchored on the `ExecutionWorld` and
 * `WorldConnection` entities the T1 model already declares. `process.exec` stands for the framework
 * `filesystem.*` / `process.exec` family (one semantic anchor, published by `@godspeedai/cognate-execution`);
 * the `execution.world.*` capabilities are this app's runtime management of worlds. Pure reads of
 * state (a world list) are not capabilities and are not bound.
 */
export function executionWorldBindings(domain: Domain): readonly CapabilityBinding[] {
  return [
    { semanticId: domain.semanticId("ExecutionWorld"), capability: { id: "process.exec", version: "1.0.0" } },
    { semanticId: domain.semanticId("ExecutionWorld"), capability: { id: "execution.world.connect", version: "1.0.0" } },
    { semanticId: domain.semanticId("ExecutionWorld"), capability: { id: "workspace.contained.select", version: "1.0.0" } },
    { semanticId: domain.semanticId("ExecutionWorld"), capability: { id: "execution.world.disconnect", version: "1.0.0" } },
    { semanticId: domain.semanticId("WorldConnection"), capability: { id: "execution.world.probe", version: "1.0.0" } },
    { semanticId: domain.semanticId("WorldConnection"), capability: { id: "execution.world.check", version: "1.0.0" } },
    { semanticId: domain.semanticId("WorldConnection"), capability: { id: "execution.containment.inspect", version: "1.0.0" } },
  ];
}

export function bindExecutionWorlds(domain: Domain) {
  const contracts = bindCapabilities(domain.projection, executionWorldBindings(domain));
  if (contracts.length !== 7) throw new Error(`domain: expected 7 bound contracts, got ${contracts.length}`);
  const [family, connect, contained, disconnect, probe, check, containmentInspect] = contracts as [(typeof contracts)[number], (typeof contracts)[number], (typeof contracts)[number], (typeof contracts)[number], (typeof contracts)[number], (typeof contracts)[number], (typeof contracts)[number]];
  return { family: family.semanticRef, connect: connect.semanticRef, contained: contained.semanticRef, disconnect: disconnect.semanticRef, probe: probe.semanticRef, check: check.semanticRef, containmentInspect: containmentInspect.semanticRef };
}

/**
 * Workbench layer (Unified Harness Experience Model v2): every `WORKBENCH_CAPABILITY_IDS` entry is
 * anchored on one of the workbench Entities the IDM extension declares. `authority.check` is the
 * only capability the tool loop invokes; `workbench.seed` is infrastructure (loads the catalog) and
 * is anchored on `SkillCapability`. Explicit, like every binding here — nothing is inferred.
 */
export const WORKBENCH_ANCHORS: Readonly<Record<string, string>> = {
  "task.create": "Task",
  "task.status.change": "Task",
  "task.contract.update": "TaskContract",
  "task.review.request": "ReviewGate",
  "task.review.decide": "ReviewGate",
  "worker.return": "ReviewGate",
  "evidence.record": "EvidenceLedger",
  "authority.check": "ProtectedEvidence",
  "authority.elevate": "ProtectedEvidence",
  "workflow.define": "Workflow",
  "workflow.instantiate": "Workflow",
  "workflow.node.advance": "Workflow",
  "skill.register": "SkillCapability",
  "workbench.seed": "SkillCapability",
  "skill.bind": "CapabilityImplementation",
  "skill.lifecycle.advance": "CapabilityImplementation",
  "automation.create": "Automation",
  "automation.advance": "Automation",
  "usage.record": "UsageLedger",
  "parallelism.plan": "ParallelPlan",
  "steer.enqueue": "SteeringInbox",
  "steer.pending": "SteeringInbox",
  "feedback.record": "GroundedFeedback",
  // RED journeys (J-TASK-scope / J-TASK-move): the Task family's visibility read and the
  // governed move mutation, anchored on the same `Task` entity as `task.create`.
  "task.list": "Task",
  "task.move": "Task",
};

export function workbenchBindings(domain: Domain): readonly CapabilityBinding[] {
  return Object.entries(WORKBENCH_ANCHORS).map(([id, entity]) => ({ semanticId: domain.semanticId(entity), capability: { id, version: "1.0.0" } }));
}

export function bindWorkbench(domain: Domain): Readonly<Record<string, CapabilityContract["semanticRef"]>> {
  const bindings = workbenchBindings(domain);
  const contracts = bindCapabilities(domain.projection, bindings);
  if (contracts.length !== bindings.length) throw new Error(`domain: expected ${bindings.length} workbench contracts, got ${contracts.length}`);
  return Object.fromEntries(contracts.map((c) => [c.id, c.semanticRef]));
}

/**
 * T11: the completion of the workbench's disabled controls. Six capabilities, each anchored on an
 * IDM entity that already described the concept (the `Plugin` entity was added to the model this
 * tranche; the rest predate it):
 *
 * - `session.setArchived` on `Session` — J-SESSION-archive
 * - `settings.changeShortcuts` and `config.path` on `UserPreferences` — J-PREFS-shortcuts,
 *   J-CFG-config-path (both are operator preference/config surfaces)
 * - `provider.delete` and `model.catalog` on `ModelProvider` — J-CFG-provider-delete,
 *   J-CFG-model-catalog
 * - `plugin.install` and `plugin.uninstall` on `Plugin` — J-PLG-install
 *
 * Order matches `TRANCHE11_CAPABILITIES` in `src/server.ts`.
 */
export const TRANCHE11_ANCHORS: readonly (readonly [string, string])[] = [
  ["session.setArchived", "Session"],
  ["settings.changeShortcuts", "UserPreferences"],
  ["provider.delete", "ModelProvider"],
  ["model.catalog", "ModelProvider"],
  ["config.path", "UserPreferences"],
  ["plugin.install", "Plugin"],
  ["plugin.uninstall", "Plugin"],
];

export function tranche11Bindings(domain: Domain): readonly CapabilityBinding[] {
  return TRANCHE11_ANCHORS.map(([id, entity]) => ({ semanticId: domain.semanticId(entity), capability: { id, version: "1.0.0" } }));
}

export function bindTranche11(domain: Domain) {
  const bindings = tranche11Bindings(domain);
  const contracts = bindCapabilities(domain.projection, bindings);
  if (contracts.length !== bindings.length) throw new Error(`domain: expected ${bindings.length} tranche-11 contracts, got ${contracts.length}`);
  return Object.fromEntries(contracts.map((c) => [c.id, c.semanticRef])) as Readonly<Record<string, CapabilityContract["semanticRef"]>>;
}

/**
 * Native Experts & Teams capability bindings. Each contract is explicitly published by the
 * Experts, model-routing or commitment component. Semantic policies do not grant authority;
 * the mutation boundary validates permissions and commits native shared thread state with CAS.
 */
export const EXPERT_CAPABILITY_ANCHORS: Readonly<Record<string, string>> = {
  "expert.save": "Expert",
  "expert.copy": "ExpertDefinition",
  "expert.archive": "Expert",
  "team.save": "Team",
  "team.copy": "Team",
  "team.member": "TeamMembership",
  "team.activate": "Team",
  "team.replaceOrchestrator": "TeamMembership",
  "expert.converse": "Conversation",
  "team.converse": "Conversation",
  "team.delegate": "Assignment",
  "team.handoff": "Handoff",
  "team.message": "ExpertMessage",
  "team.inbox.send": "ExpertMessage",
  "team.inbox.consume": "ExpertMessage",
  "team.inbox.cancel": "ExpertMessage",
  "team.cancel": "Assignment",
  "team.retry": "Assignment",
  "team.review": "Team",
  "team.settle": "Team",
  "expert.memory.write": "ExpertMemory",
  "expert.memory.read": "ExpertMemory",
  "expert.context": "Conversation",
  "expert.model.generate": "ExpertRun",
  "expert.tool.invoke": "ExpertEffectCommitment",
  "expert.effect.resolve": "ExpertEffectCommitment",
  "experts.seed": "ExpertDefinition",
};

export function expertCapabilityBindings(domain: Domain): readonly CapabilityBinding[] {
  return Object.entries(EXPERT_CAPABILITY_ANCHORS).map(([id, entity]) => ({
    semanticId: domain.semanticId(entity),
    capability: { id, version: "1.0.0" },
  }));
}

export function bindExpertCapabilities(domain: Domain): Readonly<Record<string, CapabilityContract["semanticRef"]>> {
  const bindings = expertCapabilityBindings(domain);
  const contracts = bindCapabilities(domain.projection, bindings);
  if (contracts.length !== bindings.length) {
    throw new Error(`domain: expected ${bindings.length} expert contracts, got ${contracts.length}`);
  }
  return Object.fromEntries(contracts.map((contract) => [contract.id, contract.semanticRef]));
}

/** Schedule definitions and occurrence delivery specialize the existing Automation concept. */
export const SCHEDULE_CAPABILITY_ANCHORS: Readonly<Record<string,string>> = {
  "schedule.save":"Automation", "schedule.manage":"Automation",
  "schedule.list":"Automation", "schedule.dispatch":"Automation",
};
export function bindScheduleCapabilities(domain:Domain):Readonly<Record<string,CapabilityContract["semanticRef"]>> {
  const bindings=Object.entries(SCHEDULE_CAPABILITY_ANCHORS).map(([id,concept])=>({semanticId:domain.semanticId(concept),capability:{id,version:"1.0.0"}}));
  const contracts=bindCapabilities(domain.projection,bindings);
  if(contracts.length!==4)throw new Error("domain: expected four native schedule bindings");
  return Object.fromEntries(contracts.map(contract=>[contract.id,contract.semanticRef]));
}

/** SEA-Forge as the external authority (P02): status, pending approvals, operator resolution. */
export const GOVERNANCE_CAPABILITY_ANCHORS: Readonly<Record<string, string>> = {
  "governance.status": "ApprovalAuthority",
  "governance.approvals.list": "ApprovalAuthority",
  "governance.approval.resolve": "ApprovalAuthority",
};
export function bindGovernanceCapabilities(domain: Domain): Readonly<Record<string, CapabilityContract["semanticRef"]>> {
  const bindings = Object.entries(GOVERNANCE_CAPABILITY_ANCHORS).map(([id, concept]) => ({ semanticId: domain.semanticId(concept), capability: { id, version: "1.0.0" } }));
  const contracts = bindCapabilities(domain.projection, bindings);
  if (contracts.length !== bindings.length) throw new Error(`domain: expected ${bindings.length} governance bindings`);
  return Object.fromEntries(contracts.map((contract) => [contract.id, contract.semanticRef]));
}

/** Governed settlement (readiness P03): the declared proof and the settlement status. */
export const SETTLEMENT_CAPABILITY_ANCHORS: Readonly<Record<string, string>> = {
  "workspace.proof.declare": "Verification",
  "workspace.proof.declare_contract": "Verification",
  "workspace.proof.current": "Verification",
  "settlement.status": "Verification",
};
export function bindSettlementCapabilities(domain: Domain): Readonly<Record<string, CapabilityContract["semanticRef"]>> {
  const bindings = Object.entries(SETTLEMENT_CAPABILITY_ANCHORS).map(([id, concept]) => ({ semanticId: domain.semanticId(concept), capability: { id, version: "1.0.0" } }));
  const contracts = bindCapabilities(domain.projection, bindings);
  if (contracts.length !== bindings.length) throw new Error(`domain: expected ${bindings.length} settlement bindings`);
  return Object.fromEntries(contracts.map((contract) => [contract.id, contract.semanticRef]));
}

/** Operator reconciliation of an interrupted agent capability call (`ambiguous-invocation`). */
export const AMBIGUOUS_CAPABILITY_ANCHORS: Readonly<Record<string, string>> = {
  "run.invocation.reconcile": "AgentRun",
};
export function bindAmbiguousCapabilities(domain: Domain): Readonly<Record<string, CapabilityContract["semanticRef"]>> {
  const bindings = Object.entries(AMBIGUOUS_CAPABILITY_ANCHORS).map(([id, concept]) => ({ semanticId: domain.semanticId(concept), capability: { id, version: "1.0.0" } }));
  const contracts = bindCapabilities(domain.projection, bindings);
  if (contracts.length !== bindings.length) throw new Error(`domain: expected ${bindings.length} ambiguous-invocation bindings`);
  return Object.fromEntries(contracts.map((contract) => [contract.id, contract.semanticRef]));
}

/**
 * RED journeys (J-SESSION-draft, J-WS-directory-discovery, J-TASK-scope, J-TASK-move,
 * J-RUN-task-attribution, J-TASK-expert-provenance — see
 * `docs/specs/session-workspace-task-red-journeys.md` and the journey catalog). `task.create`
 * gains scope fields and `team.converse` gains a validated `taskId` without new bindings — those
 * capabilities were already anchored on `Task`/`Conversation`; `task.list`/`task.move` join the
 * workbench Task family in `WORKBENCH_ANCHORS`. These are the remaining *new* capabilities, each
 * anchored on the entity the model already declares for it:
 *
 * - `session.create` on `Session` — the durable pre-inference draft identity (J-SESSION-draft).
 * - `session.task.bind` on `Session` — the governed Task↔Session binding mutation (J-TASK-scope).
 * - `workspace.directory.suggest` on `ExecutionWorld` — read-only directory completion in the
 *   selected execution world (J-WS-directory-discovery).
 */
export const RED_JOURNEY_ANCHORS: Readonly<Record<string, string>> = {
  "session.create": "Session",
  "session.task.bind": "Session",
  "workspace.directory.suggest": "ExecutionWorld",
};

export function redJourneyBindings(domain: Domain): readonly CapabilityBinding[] {
  return Object.entries(RED_JOURNEY_ANCHORS).map(([id, entity]) => ({
    semanticId: domain.semanticId(entity),
    capability: { id, version: "1.0.0" },
  }));
}

export function bindRedJourneys(domain: Domain): Readonly<Record<string, CapabilityContract["semanticRef"]>> {
  const bindings = redJourneyBindings(domain);
  const contracts = bindCapabilities(domain.projection, bindings);
  if (contracts.length !== bindings.length) {
    throw new Error(`domain: expected ${bindings.length} RED journey contracts, got ${contracts.length}`);
  }
  const unbound = contracts.find((contract) => !contract.semanticRef);
  if (unbound) throw new Error(`domain: RED journey capability ${unbound.id} has no SemanticRef`);
  return Object.fromEntries(contracts.map((contract) => [contract.id, contract.semanticRef!])) as Readonly<
    Record<string, CapabilityContract["semanticRef"]>
  >;
}

/**
 * J-CHECKOUT (PandaCode worktree affordance): the governed Task-to-checkout family, anchored on
 * the `Task` entity exactly as `task.move` is — each capability reads or mutates a Task-scoped
 * association. The `TaskCheckoutRecord` resource plays the same role `TaskBindingRecord` plays
 * for session bindings: the durable record type in the model, never a binding anchor.
 * - `git.branch.list` — read-only local branch inventory of the workspace's repository.
 * - `git.checkout.attach` — create/adopt a worktree and bind it to a Task (J-CHECKOUT-BIND).
 * - `git.checkout.status` / `git.checkout.merge` / `git.checkout.remove` / `git.checkout.recreate`
 *   — the guarded lifecycle (J-CHECKOUT-LIFECYCLE).
 * - `task.checkout.resolve` — read the live binding; the agent loop's recorded step
 *   (J-CHECKOUT-EXECUTION).
 */
export const CHECKOUT_CAPABILITY_ANCHORS: Readonly<Record<string, string>> = {
  "git.branch.list": "Task",
  "git.checkout.attach": "Task",
  "git.checkout.status": "Task",
  "git.checkout.merge": "Task",
  "git.checkout.remove": "Task",
  "git.checkout.recreate": "Task",
  "task.checkout.resolve": "Task",
};

export function bindCheckoutCapabilities(domain: Domain): Readonly<Record<string, CapabilityContract["semanticRef"]>> {
  const bindings = Object.entries(CHECKOUT_CAPABILITY_ANCHORS).map(([id, resource]) => ({
    semanticId: domain.semanticId(resource),
    capability: { id, version: "1.0.0" },
  }));
  const contracts = bindCapabilities(domain.projection, bindings);
  if (contracts.length !== bindings.length) {
    throw new Error(`domain: expected ${bindings.length} checkout contracts, got ${contracts.length}`);
  }
  const unbound = contracts.find((contract) => !contract.semanticRef);
  if (unbound) throw new Error(`domain: checkout capability ${unbound.id} has no SemanticRef`);
  return Object.fromEntries(contracts.map((contract) => [contract.id, contract.semanticRef!])) as Readonly<
    Record<string, CapabilityContract["semanticRef"]>
  >;
}

/** Effective native capacity is inspection data, distinct from advisory parallelism plans. */
export function bindRuntimeExecution(domain: Domain): CapabilityContract["semanticRef"] {
  const contracts = bindCapabilities(domain.projection, [{
    semanticId: domain.semanticId("NativeExecutionSlots"),
    capability: { id: "execution.runtime.inspect", version: "1.0.0" },
  }]);
  if (contracts.length !== 1) throw new Error("domain: expected one native runtime execution binding");
  return contracts[0]!.semanticRef;
}

/**
 * T8 production trust: durable identities/revocable sessions (J-AUTH-SESSION,
 * J-AUTH-TENANT-ISOLATION) and aggregate containment quotas (J-RW-AGGREGATE-CONTAINMENT). Session
 * administration capabilities anchor on `DurableSession` (the durable session record is the truth;
 * a browser or agent never supplies its own identity); the aggregate quota setting anchors on
 * `ContainmentQuota` (an operator preference that the containment ledger enforces fail-closed
 * across processes — it is deliberately NOT a per-user preference, so it gets its own anchor).
 */
export function bindT8Identity(domain: Domain) {
  const bindings: readonly CapabilityBinding[] = [
    { semanticId: domain.semanticId("DurableSession"), capability: { id: "identity.session.issue", version: "1.0.0" } },
    { semanticId: domain.semanticId("DurableSession"), capability: { id: "identity.session.revoke", version: "1.0.0" } },
    { semanticId: domain.semanticId("DurableSession"), capability: { id: "identity.inspect", version: "1.0.0" } },
    { semanticId: domain.semanticId("ContainmentQuota"), capability: { id: "settings.changeContainment", version: "1.0.0" } },
  ];
  const contracts = bindCapabilities(domain.projection, bindings);
  if (contracts.length !== bindings.length) throw new Error(`domain: expected ${bindings.length} T8 identity contracts, got ${contracts.length}`);
  const byId = Object.fromEntries(contracts.map(contract => [contract.id, contract.semanticRef])) as Record<string, CapabilityContract["semanticRef"]>;
  return {
    identity: { issue: byId["identity.session.issue"]!, revoke: byId["identity.session.revoke"]!, inspect: byId["identity.inspect"]! },
    containment: byId["settings.changeContainment"]!,
  };
}
