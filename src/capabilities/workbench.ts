// Workbench capabilities (Unified Harness Experience Model v2). Same shape as `workspace.rename`:
// each handler validates against the live `workbench` projection with the pure modules in
// `src/workbench/`, then starts a deterministic `agent.config` run whose `workbench.*` events the
// projection folds. The durable event log, never component memory, owns the state.
//
// Human-only decisions (`task.review.decide`, `authority.elevate`) require a `user` actor: an agent
// run invokes capabilities as a non-user principal, so it cannot accept its own work.
import { randomUUID } from "node:crypto";
import type { Json } from "@godspeedai/cognate-events";
import type { CapabilityContract, Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { decideShell, decideWrite, type Decision } from "../workbench/authority.ts";
import { advance as advanceAutomation, deliveryReceipt, newAutomation, nextFire, type AutomationRun, type Schedule } from "../workbench/automation.ts";
import { contractMissing, defaultAuthority } from "../workbench/contract.ts";
import { validateGroundedFeedback, type GroundedFeedback } from "../workbench/grounded.ts";
import { acceptanceReady, reviewReadiness } from "../workbench/ledger.ts";
import { planParallelism, type WorkUnit } from "../workbench/parallelism.ts";
import type { BindingRecord, CapabilityRecord, ElevationRecord, TaskRecord, WorkflowInstanceRecord } from "../workbench/state.ts";
import { enqueue, emptyInbox, type Inbox } from "../workbench/steering.ts";
import { advanceLifecycle, checkSubstitution, detectConflicts, seedBindings, seedCatalog } from "../workbench/skillOs.ts";
import {
  CONTRACT_FIELDS,
  type AuthorityScopes,
  type CapabilityContractDef,
  type CapabilityState,
  type EvidenceEntry,
  type EvidenceKind,
  type ImplementationBinding,
  type NodeStatus,
  type SteerMode,
  type TaskContract,
  type TaskStatus,
  type WorkerReturn,
  type WorkflowDefinition,
} from "../workbench/types.ts";
import { documentWorkflow, frontendProductActualization, nodeDone, readyNodes, validateWorkflow } from "../workbench/workflow.ts";

export const WORKBENCH_CAPABILITY_IDS = [
  "task.create",
  "task.contract.update",
  "task.status.change",
  "task.review.request",
  "task.review.decide",
  "worker.return",
  "evidence.record",
  "authority.check",
  "authority.elevate",
  "workflow.define",
  "workflow.instantiate",
  "workflow.node.advance",
  "skill.register",
  "skill.bind",
  "skill.lifecycle.advance",
  "automation.create",
  "automation.advance",
  "usage.record",
  "parallelism.plan",
  "steer.enqueue",
  "steer.pending",
  "feedback.record",
  "workbench.seed",
] as const;
export type WorkbenchCapabilityId = (typeof WORKBENCH_CAPABILITY_IDS)[number];

const TERMINAL_TASK: ReadonlySet<TaskStatus> = new Set(["ACCEPTED", "OPERATIONALIZED"]);
const ALL_ALLOWED: AuthorityScopes = {
  filesystem: { read: "yes", write: "yes", outsideWorkspace: "yes" },
  shell: { run: "yes", destructive: "yes" },
  network: { outbound: "yes" },
  packages: { install: "yes" },
  extensions: { install: "yes", enable: "yes" },
  protectedPaths: [],
};

interface RecordedEvent {
  readonly type: string;
  readonly payload: Json;
}

export function workbenchComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  /** One semantic ref per capability id (explicit bindings; see `domain/index.ts`). */
  readonly semanticRefs: Readonly<Record<string, SemanticRef | undefined>>;
}): Component {
  const contracts: CapabilityContract[] = WORKBENCH_CAPABILITY_IDS.map((id) => ({ id, version: "1.0.0", semanticRef: options.semanticRefs[id] }));
  const contractOf = (id: WorkbenchCapabilityId): CapabilityContract => contracts.find((c) => c.id === id) as CapabilityContract;

  const readRows = async (prefix: string): Promise<{ key: string; value: unknown }[]> => {
    const rows = (await options.getService().readProjection(options.systemCaller, { name: "workbench" })).rows;
    return rows.filter((r) => r.key.startsWith(prefix)).map((r) => ({ key: r.key.slice(prefix.length), value: r.value }));
  };
  const readOne = async <T>(key: string, projection = "workbench"): Promise<T | undefined> => {
    const rows = (await options.getService().readProjection(options.systemCaller, { name: projection })).rows;
    return rows.find((r) => r.key === key)?.value as T | undefined;
  };
  const record = async (events: readonly RecordedEvent[]): Promise<void> => {
    await options.getService().startRun(options.systemCaller, {
      agent: AGENT_CONFIG,
      // Pure-module results may carry `undefined` fields; the event envelope requires strict JSON.
      input: { kind: "workbench.recorded", events: JSON.parse(JSON.stringify(events)) as Json },
      idempotencyKey: randomUUID(),
    });
  };
  const requireUser = (ctx: HandlerContext, what: string): void => {
    if (ctx.actor.kind !== "user") throw new Error(`${what} is a human decision: only a user may do this, not ${ctx.actor.kind} "${ctx.actor.id}"`);
  };
  const getTask = async (taskId: string): Promise<TaskRecord> => {
    const task = await readOne<TaskRecord>(`task/${taskId}`);
    if (!task) throw new Error(`unknown task ${taskId}`);
    return task;
  };
  const evidenceOf = async (taskId: string): Promise<EvidenceEntry[]> => (await readRows(`evidence/${taskId}/`)).map((r) => r.value as EvidenceEntry);

  return {
    id: "workbench:manage",
    provides: contracts,
    activate(fiber) {
      const provide = <I, O>(id: WorkbenchCapabilityId, handler: (input: I, ctx: HandlerContext) => Promise<O>) =>
        fiber.provide(contractOf(id), async (raw, ctx) => handler(raw as I, ctx));

      // ---- Task Contract (J-WB-task-contract) ---------------------------------------------------
      provide("task.create", async (input: { title: string; workspaceId: string; contract?: Partial<TaskContract> }) => {
        const title = (input.title ?? "").trim();
        if (!title) throw new Error("task.create: a title is required");
        const workspaces = (await options.getService().readProjection(options.systemCaller, { name: "workspaces" })).rows;
        if (!workspaces.some((r) => r.key === `record/${input.workspaceId}`)) throw new Error(`task.create: unknown workspace ${input.workspaceId} — a task must bind to an explicit workspace`);
        const id = `task-${randomUUID().slice(0, 8)}`;
        const contract: Partial<TaskContract> = {
          ...(input.contract ?? {}),
          context: { ...(input.contract?.context ?? { files: [] }), workspaceId: input.workspaceId, files: input.contract?.context?.files ?? [] },
          authority: input.contract?.authority ?? defaultAuthority(),
        };
        const task: TaskRecord = { id, title, workspaceId: input.workspaceId, status: "BRIEFING", contract, finished: false, produced: false, humanApproved: false, operationalized: false, createdAt: "" };
        await record([{ type: "workbench.task.created", payload: { task } as unknown as Json }]);
        return { taskId: id, missing: contractMissing(contract) };
      });

      provide("task.contract.update", async (input: { taskId: string; contract: Partial<TaskContract> }) => {
        const task = await getTask(input.taskId);
        if (task.status === "RUNNING") throw new Error("task.contract.update: the contract cannot change while the task is RUNNING — stop it first");
        if (TERMINAL_TASK.has(task.status)) throw new Error(`task.contract.update: task is ${task.status}`);
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input.contract ?? {})) {
          if (!(CONTRACT_FIELDS as readonly string[]).includes(k) && k !== "context") continue;
          patch[k] = v;
        }
        // The workspace binding is fixed at creation (workspace existence is not task scope).
        const ctxPatch = patch.context as TaskContract["context"] | undefined;
        if (ctxPatch) patch.context = { ...ctxPatch, workspaceId: task.workspaceId };
        await record([{ type: "workbench.task.contract.updated", payload: { taskId: task.id, contract: patch } as unknown as Json }]);
        const merged = { ...task.contract, ...patch } as Partial<TaskContract>;
        return { taskId: task.id, missing: contractMissing(merged) };
      });

      provide("task.status.change", async (input: { taskId: string; to: TaskStatus; note?: string }) => {
        const task = await getTask(input.taskId);
        const allowed: Partial<Record<TaskStatus, readonly TaskStatus[]>> = {
          BACKLOG: ["BRIEFING"],
          BRIEFING: ["READY", "BACKLOG"],
          READY: ["RUNNING", "BRIEFING"],
          RUNNING: ["BLOCKED", "READY", "READY_FOR_REVIEW"],
          BLOCKED: ["RUNNING", "READY"],
          REWORK: ["RUNNING", "READY", "BRIEFING"],
          ACCEPTED: ["OPERATIONALIZED"],
        };
        if (input.to === "READY_FOR_REVIEW") throw new Error("task.status.change: use task.review.request — readiness is evaluated, not declared");
        if (input.to === "ACCEPTED" || input.to === "REWORK") throw new Error("task.status.change: use task.review.decide — acceptance is a human decision");
        if (!(allowed[task.status] ?? []).includes(input.to)) throw new Error(`task.status.change: ${task.status} -> ${input.to} is not a valid transition`);
        if (input.to === "READY") {
          const missing = contractMissing(task.contract);
          if (missing.length > 0) throw new Error(`task.status.change: the task contract is incomplete — missing ${missing.join(", ")}`);
        }
        if (input.to === "OPERATIONALIZED" && !task.humanApproved) throw new Error("task.status.change: only an accepted task can be operationalized");
        await record([{ type: "workbench.task.status.changed", payload: { taskId: task.id, status: input.to, ...(input.note ? { note: input.note } : {}) } as unknown as Json }]);
        return { taskId: task.id, status: input.to };
      });

      // ---- Evidence, worker return, review gate (J-WB-review-gate) -------------------------------
      provide("evidence.record", async (input: { taskId: string; kind: EvidenceKind; status: EvidenceEntry["status"]; summary: string; criterionId?: string; source?: string }) => {
        const task = await getTask(input.taskId);
        if (!input.summary?.trim()) throw new Error("evidence.record: a summary is required");
        if (input.kind === "human") throw new Error("evidence.record: human evidence is recorded by task.review.decide");
        if (input.criterionId && !(task.contract.acceptance ?? []).some((c) => c.id === input.criterionId)) throw new Error(`evidence.record: task ${task.id} has no acceptance criterion ${input.criterionId}`);
        const entry: EvidenceEntry = {
          id: `ev-${randomUUID().slice(0, 8)}`,
          taskId: task.id,
          kind: input.kind,
          status: input.status,
          summary: input.summary.trim(),
          ...(input.criterionId ? { criterionId: input.criterionId } : {}),
          ...(input.source ? { source: input.source } : {}),
        };
        await record([{ type: "workbench.evidence.recorded", payload: { entry } as unknown as Json }]);
        return { evidenceId: entry.id };
      });

      provide("worker.return", async (input: { taskId: string; workerReturn: WorkerReturn }) => {
        const task = await getTask(input.taskId);
        const r = input.workerReturn;
        if (!r || !Array.isArray(r.changed) || !Array.isArray(r.tested) || !Array.isArray(r.evidence) || !Array.isArray(r.remaining) || !Array.isArray(r.risks)) throw new Error("worker.return: changed, tested, evidence, remaining and risks must all be declared (arrays, possibly empty)");
        await record([{ type: "workbench.worker.returned", payload: { taskId: task.id, workerReturn: { ...r, readyForReview: r.readyForReview === true } } as unknown as Json }]);
        return { taskId: task.id };
      });

      provide("task.review.request", async (input: { taskId: string }) => {
        const task = await getTask(input.taskId);
        if (TERMINAL_TASK.has(task.status)) throw new Error(`task.review.request: task is already ${task.status}`);
        const missing = contractMissing(task.contract);
        if (missing.length > 0) throw new Error(`task.review.request: the task contract is incomplete — missing ${missing.join(", ")}`);
        const readiness = reviewReadiness({ acceptance: task.contract.acceptance ?? [], entries: await evidenceOf(task.id), ...(task.workerReturn ? { workerReturn: task.workerReturn } : {}) });
        if (!readiness.ready) throw new Error(`task.review.request: not ready for review — ${readiness.blockers.join("; ")}`);
        await record([{ type: "workbench.review.requested", payload: { taskId: task.id } as unknown as Json }]);
        return { taskId: task.id, status: "READY_FOR_REVIEW" };
      });

      provide("task.review.decide", async (input: { taskId: string; decision: "accept" | "rework"; note?: string }, ctx) => {
        requireUser(ctx, "task.review.decide");
        const task = await getTask(input.taskId);
        if (task.status !== "READY_FOR_REVIEW") throw new Error(`task.review.decide: task is ${task.status}, not READY_FOR_REVIEW`);
        if (input.decision !== "accept" && input.decision !== "rework") throw new Error("task.review.decide: decision must be accept or rework");
        const entries = await evidenceOf(task.id);
        const events: RecordedEvent[] = [];
        if (input.decision === "accept") {
          const ready = acceptanceReady({ acceptance: task.contract.acceptance ?? [], entries, humanApproved: true });
          if (!ready.ready) throw new Error(`task.review.decide: cannot accept — ${ready.blockers.join("; ")}`);
          const humanCriterion = (task.contract.acceptance ?? []).find((c) => c.kind === "human");
          events.push({
            type: "workbench.evidence.recorded",
            payload: { entry: { id: `ev-${randomUUID().slice(0, 8)}`, taskId: task.id, kind: "human", status: "pass", summary: input.note?.trim() || "accepted by reviewer", ...(humanCriterion ? { criterionId: humanCriterion.id } : {}), source: `user:${ctx.actor.id}` } } as unknown as Json,
          });
        } else {
          events.push({ type: "workbench.evidence.recorded", payload: { entry: { id: `ev-${randomUUID().slice(0, 8)}`, taskId: task.id, kind: "human", status: "fail", summary: input.note?.trim() || "rework requested", source: `user:${ctx.actor.id}` } } as unknown as Json });
        }
        events.push({ type: "workbench.review.decided", payload: { taskId: task.id, decision: input.decision, ...(input.note ? { note: input.note } : {}) } as unknown as Json });
        await record(events);
        return { taskId: task.id, status: input.decision === "accept" ? "ACCEPTED" : "REWORK" };
      });

      // ---- Authority plane + protected evidence (J-WB-protected-evidence) ------------------------
      provide("authority.check", async (input: { workspaceId: string; taskId?: string; tool: string; args: Record<string, unknown> }): Promise<Decision & { taskId?: string }> => {
        const tasks = (await readRows("task/")).map((r) => r.value as TaskRecord).filter((t) => t.workspaceId === input.workspaceId && !TERMINAL_TASK.has(t.status));
        const own = input.taskId ? tasks.find((t) => t.id === input.taskId) : undefined;
        const protectedPaths = [...new Set(tasks.flatMap((t) => t.contract.authority?.protectedPaths ?? []))];
        const base = own?.contract.authority ?? ALL_ALLOWED;
        const scopes: AuthorityScopes = { ...base, protectedPaths };
        const elevated = (await readOne<ElevationRecord>(`elevation/${input.workspaceId}`))?.paths ?? [];
        const owner = own?.id ?? tasks.find((t) => (t.contract.authority?.protectedPaths ?? []).length > 0)?.id;
        const withTask = <T extends object>(d: T): T & { taskId?: string } => (owner ? { ...d, taskId: owner } : d);
        if (input.tool === "edit") {
          // An absolute path inside the workspace root is the same file as its relative form:
          // relativise it so protection cannot be sidestepped by spelling the path differently.
          const root = (await readOne<{ root: string }>(`record/${input.workspaceId}`, "workspaces"))?.root;
          let path = String(input.args.file_path ?? "");
          if (root && path.startsWith(`${root.replace(/\/+$/, "")}/`)) path = path.slice(root.replace(/\/+$/, "").length + 1);
          return withTask({ ...decideWrite(scopes, path, { elevatedPaths: elevated }) });
        }
        if (input.tool === "bash") {
          return withTask({ ...decideShell(scopes, String(input.args.command ?? ""), { elevatedPaths: elevated }) });
        }
        return { outcome: "allow", rule: "not-applicable", reason: `${input.tool} is not path-mutating` };
      });

      provide("authority.elevate", async (input: { workspaceId: string; path: string }, ctx) => {
        requireUser(ctx, "authority.elevate");
        if (!input.path?.trim()) throw new Error("authority.elevate: an exact path is required (elevation is per path, never blanket)");
        if (/[*?[{]/.test(input.path)) throw new Error("authority.elevate: globs cannot be elevated; name the exact path");
        await record([{ type: "workbench.authority.elevated", payload: { workspaceId: input.workspaceId, path: input.path.trim() } as unknown as Json }]);
        return { ok: true };
      });

      // ---- Workflow graph (J-WB-workflow) ---------------------------------------------------------
      provide("workflow.define", async (input: { definition: WorkflowDefinition }) => {
        const errors = validateWorkflow(input.definition);
        if (errors.length > 0) throw new Error(`workflow.define: invalid workflow — ${errors.join("; ")}`);
        const prev = await readOne<WorkflowDefinition>(`workflow/${input.definition.id}`);
        const definition = { ...input.definition, version: prev ? Math.max(prev.version + 1, input.definition.version) : input.definition.version };
        await record([{ type: "workbench.workflow.defined", payload: { definition } as unknown as Json }]);
        return { workflowId: definition.id, version: definition.version };
      });

      provide("workflow.instantiate", async (input: { workflowId: string; workspaceId: string }) => {
        if (!(await readOne<WorkflowDefinition>(`workflow/${input.workflowId}`))) throw new Error(`workflow.instantiate: unknown workflow ${input.workflowId}`);
        const workspaces = (await options.getService().readProjection(options.systemCaller, { name: "workspaces" })).rows;
        if (!workspaces.some((r) => r.key === `record/${input.workspaceId}`)) throw new Error(`workflow.instantiate: unknown workspace ${input.workspaceId}`);
        const instanceId = `wi-${randomUUID().slice(0, 8)}`;
        await record([{ type: "workbench.workflow.instantiated", payload: { instanceId, workflowId: input.workflowId, workspaceId: input.workspaceId } as unknown as Json }]);
        return { instanceId };
      });

      provide("workflow.node.advance", async (input: { instanceId: string; nodeId: string; to: NodeStatus; closedEvidence?: EvidenceKind[] }) => {
        const inst = await readOne<WorkflowInstanceRecord>(`instance/${input.instanceId}`);
        if (!inst) throw new Error(`workflow.node.advance: unknown instance ${input.instanceId}`);
        const def = await readOne<WorkflowDefinition>(`workflow/${inst.workflowId}`);
        if (!def) throw new Error(`workflow.node.advance: unknown workflow ${inst.workflowId}`);
        const node = def.nodes.find((n) => n.id === input.nodeId);
        if (!node) throw new Error(`workflow.node.advance: unknown node ${input.nodeId}`);
        if (input.to === "running" || input.to === "review" || input.to === "done") {
          const ready = readyNodes(def, inst.status, inst.closed);
          const alreadyActive = inst.status[node.id] === "running" || inst.status[node.id] === "review";
          if (!ready.includes(node.id) && !alreadyActive) throw new Error(`workflow.node.advance: ${node.id} is not unlocked — its dependencies are not satisfied with closed evidence`);
        }
        if (input.to === "done" && node.review && inst.status[node.id] !== "review") throw new Error(`workflow.node.advance: ${node.id} is a review gate — it must go through review before done`);
        if (input.to === "done") {
          const closed = new Set([...(inst.closed[node.id] ?? []), ...(input.closedEvidence ?? [])]);
          const missing = node.acceptance.filter((k) => !closed.has(k));
          if (missing.length > 0) throw new Error(`workflow.node.advance: ${node.id} cannot be done — evidence not closed: ${missing.join(", ")}`);
        }
        await record([{ type: "workbench.workflow.node.changed", payload: { instanceId: inst.id, nodeId: node.id, status: input.to, ...(input.closedEvidence ? { closedEvidence: input.closedEvidence } : {}) } as unknown as Json }]);
        return { nodeId: node.id, status: input.to, done: input.to === "done" && nodeDone(def, node.id, { ...inst.status, [node.id]: "done" }, { ...inst.closed, [node.id]: [...(inst.closed[node.id] ?? []), ...(input.closedEvidence ?? [])] }) };
      });

      // ---- Skill OS (J-WB-capability-lifecycle) ---------------------------------------------------
      provide("skill.register", async (input: { def: CapabilityContractDef }) => {
        if (!input.def?.id?.startsWith("capability.")) throw new Error('skill.register: capability ids start with "capability."');
        await record([{ type: "workbench.capability.registered", payload: { def: input.def } as unknown as Json }]);
        return { capabilityId: input.def.id };
      });

      provide("skill.bind", async (input: { binding: ImplementationBinding; replaces?: string }) => {
        const cap = await readOne<CapabilityRecord>(`capability/${input.binding.capabilityId}`);
        if (!cap) throw new Error(`skill.bind: unknown capability ${input.binding.capabilityId}`);
        let substitution: unknown;
        if (input.replaces) {
          const old = await readOne<BindingRecord>(`binding/${cap.def.id}/${input.replaces}`);
          if (!old) throw new Error(`skill.bind: ${input.replaces} is not bound to ${cap.def.id}`);
          const check = checkSubstitution(cap.def, old.binding, input.binding);
          if (!check.compatible) throw new Error(`skill.bind: incompatible substitution — ${check.problems.join("; ")}`);
          substitution = check;
        }
        await record([{ type: "workbench.capability.bound", payload: { binding: input.binding, ...(substitution ? { substitution } : {}) } as unknown as Json }]);
        return { capabilityId: cap.def.id, implementationId: input.binding.implementationId, ...(substitution ? { substitution } : {}) };
      });

      provide("skill.lifecycle.advance", async (input: { capabilityId: string; implementationId: string; to: CapabilityState }, ctx) => {
        const row = await readOne<BindingRecord>(`binding/${input.capabilityId}/${input.implementationId}`);
        if (!row) throw new Error(`skill.lifecycle.advance: ${input.implementationId} is not bound to ${input.capabilityId}`);
        if (input.to === "AUTHORITY_GRANTED" || input.to === "REVIEWED" || input.to === "INSTALLED") requireUser(ctx, `granting ${input.to}`);
        const result = advanceLifecycle(row.state, input.to);
        if (!result.ok) throw new Error(`skill.lifecycle.advance: ${result.error}`);
        if (input.to === "ENABLED") {
          const catalog = (await readRows("capability/")).map((r) => (r.value as CapabilityRecord).def);
          const active = (await readRows("binding/")).filter((r) => (r.value as BindingRecord).state === "ENABLED" || (r.value as BindingRecord).state === "EXERCISED" || (r.value as BindingRecord).state === "VERIFIED" || (r.value as BindingRecord).state === "AVAILABLE").map((r) => (r.value as BindingRecord).binding.capabilityId);
          const conflicts = detectConflicts(catalog, [...new Set([...active, input.capabilityId])]);
          const mine = conflicts.filter((c) => c.capabilities.includes(input.capabilityId));
          if (mine.length > 0) throw new Error(`skill.lifecycle.advance: enabling ${input.capabilityId} conflicts on ${mine.map((c) => `${c.surface} (${c.capabilities.join(", ")})`).join("; ")}`);
        }
        await record([{ type: "workbench.capability.lifecycle.advanced", payload: { capabilityId: input.capabilityId, implementationId: input.implementationId, state: result.state } as unknown as Json }]);
        return { state: result.state };
      });

      // ---- Automation (J-WB-automation) ------------------------------------------------------------
      provide("automation.create", async (input: { name: string; schedule: Schedule; substrate: AutomationRun["substrate"]; inputs?: Record<string, string>; capabilities?: string[]; acceptance: string[]; workflowId?: string; sourceTaskId?: string; now?: string }) => {
        if (!input.name?.trim()) throw new Error("automation.create: a name is required");
        if (!input.acceptance || input.acceptance.length === 0) throw new Error("automation.create: an outcome gate (acceptance) is required — dispatch is not completion");
        if (input.sourceTaskId) {
          const src = await getTask(input.sourceTaskId);
          if (!src.humanApproved) throw new Error("automation.create: only an accepted workflow can be operationalized");
        }
        const id = `auto-${randomUUID().slice(0, 8)}`;
        const run = newAutomation({ id, name: input.name.trim(), substrate: input.substrate, inputs: input.inputs ?? {}, capabilities: input.capabilities ?? [], acceptance: input.acceptance });
        const fire = nextFire(input.schedule, new Date(input.now ?? Date.now()));
        const events: RecordedEvent[] = [{ type: "workbench.automation.created", payload: { id, run, schedule: input.schedule, nextFire: fire.toISOString(), ...(input.workflowId ? { workflowId: input.workflowId } : {}) } as unknown as Json }];
        if (input.sourceTaskId) events.push({ type: "workbench.task.status.changed", payload: { taskId: input.sourceTaskId, status: "OPERATIONALIZED" } as unknown as Json });
        await record(events);
        return { automationId: id, nextFire: fire.toISOString() };
      });

      provide("automation.advance", async (input: { id: string; to: AutomationRun["state"] | "receipt"; outputs?: string[]; closedAcceptance?: string[]; failure?: string }) => {
        const row = await readOne<{ run: AutomationRun }>(`automation/${input.id}`);
        if (!row) throw new Error(`automation.advance: unknown automation ${input.id}`);
        const result =
          input.to === "receipt"
            ? deliveryReceipt(row.run)
            : advanceAutomation(row.run, input.to, { ...(input.outputs ? { outputs: input.outputs } : {}), ...(input.closedAcceptance ? { closedAcceptance: input.closedAcceptance } : {}), ...(input.failure ? { failure: input.failure } : {}) });
        if (!result.ok) throw new Error(`automation.advance: ${result.error}`);
        await record([{ type: "workbench.automation.advanced", payload: { id: input.id, run: result.run } as unknown as Json }]);
        return { state: result.run.state };
      });

      // ---- Economics, parallelism, steering, grounded feedback --------------------------------------
      provide("usage.record", async (input: { sessionId?: string; record: Json }) => {
        await record([{ type: "workbench.usage.recorded", payload: { ...(input.sessionId ? { sessionId: input.sessionId } : {}), record: input.record } as unknown as Json }]);
        return { ok: true };
      });

      provide("parallelism.plan", async (input: { units: WorkUnit[]; maxConcurrency?: number }) => planParallelism(input.units, input.maxConcurrency ? { maxConcurrency: input.maxConcurrency } : {}) as unknown as Json);

      provide("steer.enqueue", async (input: { sessionId: string; mode: SteerMode; text: string; id?: string }) => {
        if (input.mode !== "steer-now" && input.mode !== "queue-next") throw new Error("steer.enqueue: mode must be steer-now or queue-next");
        if (!input.text?.trim()) throw new Error("steer.enqueue: text is required");
        const message = { id: input.id ?? `st-${randomUUID().slice(0, 8)}`, mode: input.mode, text: input.text.trim() };
        enqueue(emptyInbox(), message); // validates
        await record([{ type: "workbench.steer.enqueued", payload: { sessionId: input.sessionId, message } as unknown as Json }]);
        return { messageId: message.id };
      });

      provide("steer.pending", async (input: { sessionId: string }) => {
        const inbox = (await readOne<Inbox>(`inbox/${input.sessionId}`)) ?? emptyInbox();
        return { steer: inbox.nextStep, queued: inbox.nextTurn } as unknown as Json;
      });

      provide("feedback.record", async (input: { feedback: GroundedFeedback; taskId?: string }) => {
        const errors = validateGroundedFeedback(input.feedback);
        if (errors.length > 0) throw new Error(`feedback.record: ${errors.join("; ")}`);
        const id = `fb-${randomUUID().slice(0, 8)}`;
        await record([{ type: "workbench.feedback.recorded", payload: { id, feedback: input.feedback, ...(input.taskId ? { taskId: input.taskId } : {}) } as unknown as Json }]);
        return { feedbackId: id };
      });

      // ---- Seed (idempotent): the catalog, example bindings and the two reference workflows -------------
      provide("workbench.seed", async () => {
        const existing = await readRows("capability/");
        if (existing.length > 0) return { seeded: false, capabilities: existing.length };
        const events: RecordedEvent[] = [];
        for (const def of seedCatalog()) events.push({ type: "workbench.capability.registered", payload: { def } as unknown as Json });
        for (const binding of seedBindings()) events.push({ type: "workbench.capability.bound", payload: { binding } as unknown as Json });
        for (const definition of [frontendProductActualization(), documentWorkflow()]) {
          const errors = validateWorkflow(definition);
          if (errors.length > 0) throw new Error(`workbench.seed: built-in workflow ${definition.id} invalid — ${errors.join("; ")}`);
          events.push({ type: "workbench.workflow.defined", payload: { definition } as unknown as Json });
        }
        await record(events);
        return { seeded: true, capabilities: seedCatalog().length };
      });
    },
  };
}
