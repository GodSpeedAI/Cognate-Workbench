// Pure fold of `workbench.*` events into projection rows. The events are the truth; every row is
// derived and rebuildable. Keys are workspace-agnostic (`task/<id>`, `evidence/<taskId>/<id>`, ...);
// the projection wrapper adds the tenant prefix.
import type { Json } from "@godspeedai/cognate-events";
import { enqueue, emptyInbox, type Inbox } from "./steering.ts";
import type { UsageRecord } from "./economics.ts";
import type {
  AutomationRecord,
  BindingRecord,
  BlockedRecord,
  CapabilityRecord,
  ElevationRecord,
  FeedbackRecord,
  ScopedTaskRecord,
  TaskRecord,
  UsageRow,
  WorkflowInstanceRecord,
} from "./state.ts";
import type { EvidenceEntry, EvidenceKind, InboxMessage, NodeStatus, TaskStatus, WorkerReturn, WorkflowDefinition } from "./types.ts";

export interface Write {
  readonly key: string;
  readonly value: Json | null;
}
type Get = (key: string) => unknown;
const j = (v: unknown): Json => v as Json;
const USAGE_CAP = 200;

export function usageScope(taskId: string | undefined, sessionId: string | undefined): string {
  return taskId ?? `session:${sessionId ?? "unknown"}`;
}

/** Fold one event. Returns nothing for event types this projection does not own. */
export function reduceWorkbench(eventType: string, payload: unknown, recordedAt: string, eventId: string, get: Get): Write[] {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (eventType) {
    case "workbench.task.created": {
      const task = p.task as TaskRecord;
      return [{ key: `task/${task.id}`, value: j({ ...task, createdAt: recordedAt }) }];
    }
    case "workbench.task.contract.updated": {
      const prev = get(`task/${String(p.taskId)}`) as TaskRecord | undefined;
      if (!prev) return [];
      return [{ key: `task/${prev.id}`, value: j({ ...prev, contract: { ...prev.contract, ...(p.contract as object) } }) }];
    }
    case "workbench.task.status.changed": {
      const prev = get(`task/${String(p.taskId)}`) as TaskRecord | undefined;
      if (!prev) return [];
      const next: TaskRecord = {
        ...prev,
        status: (p.status as TaskStatus | undefined) ?? prev.status,
        finished: typeof p.finished === "boolean" ? p.finished : prev.finished,
        produced: typeof p.produced === "boolean" ? p.produced : prev.produced,
        operationalized: p.status === "OPERATIONALIZED" ? true : prev.operationalized,
        ...(typeof p.note === "string" ? { reviewNote: p.note } : {}),
      };
      return [{ key: `task/${prev.id}`, value: j(next) }];
    }
    case "workbench.task.activity": {
      const prev = get(`task/${String(p.taskId)}`) as TaskRecord | undefined;
      if (!prev) return [];
      const act = prev.activity ?? { changed: [], commands: [] };
      const changed = typeof p.changed === "string" && !act.changed.includes(p.changed) ? [...act.changed, p.changed] : act.changed;
      const commands = typeof p.command === "string" ? [...act.commands, p.command].slice(-30) : act.commands;
      return [{ key: `task/${prev.id}`, value: j({ ...prev, activity: { changed, commands } }) }];
    }
    // J-TASK-move: one governed mutation rewrites where the task is available, never its identity,
    // its evidence rows or its historical run lineage. `originWorkspaceId` preserves where the
    // task was born (set once, then carried forward); a cross-workspace move of a session-scoped
    // task promotes it to workspace scope because its owning session cannot follow.
    case "workbench.task.moved": {
      const prev = get(`task/${String(p.taskId)}`) as ScopedTaskRecord | undefined;
      if (!prev) return [];
      const workspaceId = String(p.workspaceId);
      const scope = (p.scope === "session" ? "session" : "workspace") as ScopedTaskRecord["scope"];
      // Drop the old owning-session field (a workspace-scope result has none) rather than writing
      // `undefined` into JSON state; a session-scope result carries its new owner explicitly.
      const { sessionId: _oldSessionId, ...rest } = prev;
      const next: ScopedTaskRecord = {
        ...rest,
        workspaceId,
        scope,
        ...(scope === "session" && typeof p.sessionId === "string" ? { sessionId: p.sessionId } : {}),
        ...(prev.originWorkspaceId ? { originWorkspaceId: prev.originWorkspaceId } : { originWorkspaceId: prev.workspaceId }),
        contract: { ...prev.contract, context: { ...(prev.contract.context ?? { files: [] }), workspaceId } },
      };
      return [{ key: `task/${prev.id}`, value: j(next) }];
    }
    case "workbench.authority.elevated": {
      const key = `elevation/${String(p.workspaceId)}`;
      const prev = (get(key) as ElevationRecord | undefined) ?? { paths: [] };
      const path = String(p.path);
      return [{ key, value: j({ paths: prev.paths.includes(path) ? prev.paths : [...prev.paths, path] }) }];
    }
    case "workbench.workflow.defined": {
      const def = p.definition as WorkflowDefinition;
      return [{ key: `workflow/${def.id}`, value: j(def) }];
    }
    case "workbench.workflow.instantiated": {
      const def = get(`workflow/${String(p.workflowId)}`) as WorkflowDefinition | undefined;
      if (!def) return [];
      const status: Record<string, NodeStatus> = {};
      for (const n of def.nodes) status[n.id] = "pending";
      const inst: WorkflowInstanceRecord = { id: String(p.instanceId), workflowId: def.id, workspaceId: String(p.workspaceId), status, closed: {} };
      return [{ key: `instance/${inst.id}`, value: j(inst) }];
    }
    case "workbench.workflow.node.changed": {
      const prev = get(`instance/${String(p.instanceId)}`) as WorkflowInstanceRecord | undefined;
      if (!prev) return [];
      const closedKinds = (p.closedEvidence as readonly EvidenceKind[] | undefined) ?? [];
      const merged = [...new Set([...(prev.closed[String(p.nodeId)] ?? []), ...closedKinds])];
      const next: WorkflowInstanceRecord = {
        ...prev,
        status: { ...prev.status, [String(p.nodeId)]: p.status as NodeStatus },
        closed: { ...prev.closed, [String(p.nodeId)]: merged },
      };
      return [{ key: `instance/${prev.id}`, value: j(next) }];
    }
    case "workbench.capability.registered": {
      const def = p.def as CapabilityRecord["def"];
      const prev = get(`capability/${def.id}`) as CapabilityRecord | undefined;
      return [{ key: `capability/${def.id}`, value: j({ ...(prev ?? {}), def }) }];
    }
    case "workbench.capability.bound": {
      const binding = p.binding as BindingRecord["binding"];
      const cap = get(`capability/${binding.capabilityId}`) as CapabilityRecord | undefined;
      const writes: Write[] = [
        { key: `binding/${binding.capabilityId}/${binding.implementationId}`, value: j({ binding, state: "IMPLEMENTATION_AVAILABLE", ...(p.substitution ? { substitution: p.substitution as BindingRecord["substitution"] } : {}) } satisfies BindingRecord) },
      ];
      if (cap) writes.push({ key: `capability/${binding.capabilityId}`, value: j({ ...cap, activeImplementation: binding.implementationId }) });
      return writes;
    }
    case "workbench.capability.lifecycle.advanced": {
      const key = `binding/${String(p.capabilityId)}/${String(p.implementationId)}`;
      const prev = get(key) as BindingRecord | undefined;
      if (!prev) return [];
      return [{ key, value: j({ ...prev, state: p.state }) }];
    }
    case "workbench.evidence.recorded": {
      const entry = p.entry as EvidenceEntry;
      return [{ key: `evidence/${entry.taskId}/${entry.id}`, value: j(entry) }];
    }
    case "workbench.worker.returned": {
      const prev = get(`task/${String(p.taskId)}`) as TaskRecord | undefined;
      if (!prev) return [];
      return [{ key: `task/${prev.id}`, value: j({ ...prev, workerReturn: p.workerReturn as WorkerReturn, finished: true, produced: (p.workerReturn as WorkerReturn).changed.length > 0 }) }];
    }
    case "workbench.review.requested": {
      const prev = get(`task/${String(p.taskId)}`) as TaskRecord | undefined;
      if (!prev) return [];
      return [{ key: `task/${prev.id}`, value: j({ ...prev, status: "READY_FOR_REVIEW", reviewRequestedAt: recordedAt }) }];
    }
    case "workbench.review.decided": {
      const prev = get(`task/${String(p.taskId)}`) as TaskRecord | undefined;
      if (!prev) return [];
      const accepted = p.decision === "accept";
      const next: TaskRecord = { ...prev, status: accepted ? "ACCEPTED" : "REWORK", humanApproved: accepted, ...(typeof p.note === "string" ? { reviewNote: p.note } : {}) };
      return [{ key: `task/${prev.id}`, value: j(next) }];
    }
    case "workbench.automation.created":
    case "workbench.automation.advanced": {
      const id = String(p.id);
      const prev = get(`automation/${id}`) as AutomationRecord | undefined;
      const next: AutomationRecord = {
        run: p.run as AutomationRecord["run"],
        schedule: (p.schedule as AutomationRecord["schedule"] | undefined) ?? (prev as AutomationRecord).schedule,
        ...(typeof p.nextFire === "string" ? { nextFire: p.nextFire } : prev?.nextFire ? { nextFire: prev.nextFire } : {}),
        ...(typeof p.workflowId === "string" ? { workflowId: p.workflowId } : prev?.workflowId ? { workflowId: prev.workflowId } : {}),
      };
      return [{ key: `automation/${id}`, value: j(next) }];
    }
    case "workbench.usage.recorded": {
      const record = p.record as UsageRecord;
      const key = `usage/${usageScope(record.taskId === "" ? undefined : record.taskId, typeof p.sessionId === "string" ? p.sessionId : undefined)}`;
      const prev = (get(key) as UsageRow | undefined) ?? { records: [] };
      return [{ key, value: j({ records: [...prev.records, record].slice(-USAGE_CAP) }) }];
    }
    case "workbench.steer.enqueued": {
      const key = `inbox/${String(p.sessionId)}`;
      const prev = (get(key) as Inbox | undefined) ?? emptyInbox();
      return [{ key, value: j(enqueue(prev, p.message as InboxMessage)) }];
    }
    case "workbench.steer.consumed": {
      const key = `inbox/${String(p.sessionId)}`;
      const prev = get(key) as Inbox | undefined;
      if (!prev) return [];
      const ids = new Set((p.ids as readonly string[]) ?? []);
      return [{ key, value: j({ nextTurn: prev.nextTurn.filter((m) => !ids.has(m.id)), nextStep: prev.nextStep.filter((m) => !ids.has(m.id)) }) }];
    }
    case "workbench.feedback.recorded": {
      const rec: FeedbackRecord = { id: String(p.id), feedback: p.feedback as FeedbackRecord["feedback"], ...(typeof p.taskId === "string" ? { taskId: p.taskId } : {}) };
      return [{ key: `feedback/${rec.id}`, value: j(rec) }];
    }
    case "workbench.protection.blocked": {
      const rec: BlockedRecord = {
        id: eventId,
        workspaceId: String(p.workspaceId),
        tool: String(p.tool),
        path: String(p.path),
        pattern: String(p.pattern),
        reason: String(p.reason),
        ...(typeof p.taskId === "string" ? { taskId: p.taskId } : {}),
      };
      const writes: Write[] = [{ key: `blocked/${eventId}`, value: j(rec) }];
      // The block is itself observable integrity evidence for the task that owns the protection.
      if (rec.taskId) {
        const entry: EvidenceEntry = { id: `blk-${eventId}`, taskId: rec.taskId, kind: "integrity", status: "pass", summary: `blocked ${rec.tool} on protected ${rec.path} (${rec.pattern})`, source: eventId };
        writes.push({ key: `evidence/${rec.taskId}/${entry.id}`, value: j(entry) });
      }
      return writes;
    }
    case "workbench.terminal.opened": {
      const row = {
        sessionId: String(p.sessionId),
        worldId: String(p.worldId),
        worldKind: String(p.worldKind),
        ...(typeof p.workspaceId === "string" ? { workspaceId: p.workspaceId } : {}),
        ...(typeof p.workspaceLabel === "string" ? { workspaceLabel: p.workspaceLabel } : {}),
        cwd: String(p.cwd),
        shell: String(p.shell),
        status: "running",
        openedAt: recordedAt,
        ...(typeof p.ownerActorId === "string" ? { ownerActorId: p.ownerActorId } : {}),
      };
      return [{ key: `terminal/${row.sessionId}`, value: j(row) }];
    }
    case "workbench.terminal.closed": {
      const sessionId = String(p.sessionId);
      const key = `terminal/${sessionId}`;
      const prev = get(key) as { [k: string]: unknown } | undefined;
      if (!prev) return [];
      return [{
        key,
        value: j({
          ...prev,
          status: "exited",
          closedAt: recordedAt,
          reason: String(p.reason ?? "exit"),
          ...(p.exitCode === null || typeof p.exitCode === "number" ? { exitCode: p.exitCode } : {}),
          ...(typeof p.message === "string" ? { message: p.message } : {}),
        }),
      }];
    }
    case "workbench.browser.opened": {
      const row = {
        sessionId: String(p.sessionId),
        providerId: String(p.providerId),
        ...(typeof p.url === "string" ? { url: p.url } : {}),
        ...(typeof p.title === "string" ? { title: p.title } : {}),
        controller: "human",
        status: "running",
        ...(typeof p.workspaceId === "string" ? { workspaceId: p.workspaceId } : {}),
        openedAt: recordedAt,
        screenshots: [] as unknown[],
        annotations: [] as unknown[],
        navigations: 0,
      };
      return [{ key: `browser/${row.sessionId}`, value: j(row) }];
    }
    case "workbench.browser.navigated": {
      const key = `browser/${String(p.sessionId)}`;
      const prev = get(key) as { [k: string]: unknown; navigations?: unknown } | undefined;
      if (!prev) return [];
      return [{ key, value: j({ ...prev, url: String(p.url), ...(typeof p.title === "string" ? { title: p.title } : {}), navigatedAt: recordedAt, navigations: (typeof prev.navigations === "number" ? prev.navigations : 0) + 1 }) }];
    }
    case "workbench.browser.control.changed": {
      const key = `browser/${String(p.sessionId)}`;
      const prev = get(key) as { [k: string]: unknown } | undefined;
      if (!prev) return [];
      return [{ key, value: j({ ...prev, controller: String(p.controller), controllerActorId: typeof p.actorId === "string" ? p.actorId : undefined, controlChangedAt: recordedAt }) }];
    }
    case "workbench.browser.screenshot": {
      const key = `browser/${String(p.sessionId)}`;
      const prev = get(key) as { [k: string]: unknown; screenshots?: unknown[] } | undefined;
      if (!prev) return [];
      const screenshots = [...(prev.screenshots ?? []), { path: String(p.path), ...(typeof p.url === "string" ? { url: p.url } : {}), takenAt: recordedAt }];
      return [{ key, value: j({ ...prev, screenshots }) }];
    }
    // J-BROWSER-inspect: the durable annotation. Page-derived context is bounded here (the
    // capability already bounds it; the fold re-bounds defensively) and is data, not instructions.
    case "workbench.browser.annotated": {
      const key = `browser/${String(p.sessionId)}`;
      const prev = get(key) as { [k: string]: unknown; annotations?: unknown[] } | undefined;
      if (!prev) return [];
      const element = (p.element ?? {}) as { [k: string]: unknown };
      const annotation = {
        annotationId: String(p.annotationId),
        note: String(p.note),
        url: String(p.url),
        ...(typeof p.capturedAt === "string" ? { capturedAt: String(p.capturedAt) } : {}),
        ...(typeof p.navigationsAtCapture === "number" ? { navigationsAtCapture: p.navigationsAtCapture } : {}),
        ...(typeof p.evidencePath === "string" ? { evidencePath: p.evidencePath } : {}),
        element: {
          tag: String(element.tag ?? ""),
          role: String(element.role ?? ""),
          ...(typeof element.name === "string" ? { name: element.name.slice(0, 120) } : {}),
          ...(typeof element.text === "string" ? { text: element.text.slice(0, 200) } : {}),
        },
        candidates: Array.isArray(p.candidates) ? (p.candidates as unknown[]).slice(0, 8) : [],
        annotatedAt: recordedAt,
      };
      const annotations = [...(prev.annotations ?? []).slice(-19), annotation];
      return [{ key, value: j({ ...prev, annotations }) }];
    }
    case "workbench.browser.closed": {
      const key = `browser/${String(p.sessionId)}`;
      const prev = get(key) as { [k: string]: unknown } | undefined;
      if (!prev) return [];
      return [{ key, value: j({ ...prev, status: "closed", closedAt: recordedAt, reason: String(p.reason ?? "operator") }) }];
    }
    // J-PREVIEW-register: the explicit, ownership-carrying dev-server registration.
    case "workbench.preview.registered": {
      const row = {
        previewId: String(p.previewId),
        worldId: String(p.worldId),
        worldKind: String(p.worldKind),
        viewUrl: String(p.viewUrl),
        originUrl: String(p.originUrl),
        status: "ready",
        ...(typeof p.workspaceId === "string" ? { workspaceId: p.workspaceId } : {}),
        ...(typeof p.ownerSessionId === "string" ? { ownerSessionId: p.ownerSessionId } : {}),
        ...(typeof p.ownerTaskId === "string" ? { ownerTaskId: p.ownerTaskId } : {}),
        ...(typeof p.ownerRunId === "string" ? { ownerRunId: p.ownerRunId } : {}),
        ...(typeof p.pid === "number" ? { pid: p.pid } : {}),
        registeredAt: recordedAt,
      };
      return [{ key: `preview/${row.previewId}`, value: j(row) }];
    }
    case "workbench.preview.stopped": {
      const key = `preview/${String(p.previewId)}`;
      const prev = get(key) as { [k: string]: unknown } | undefined;
      if (!prev) return [];
      return [{ key, value: j({ ...prev, status: "stopped", stoppedAt: recordedAt, reason: String(p.reason ?? "operator") }) }];
    }
    default:
      return [];
  }
}
