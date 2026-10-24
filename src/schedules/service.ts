import { createHash } from "node:crypto";
import { ServiceError, type Caller } from "@godspeedai/cognate-runtime-api";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import { assertTeamInvariant, fingerprint, json, text } from "../experts/state.ts";
import { ExpertsService } from "../experts/service.ts";
import type { ScheduleEvaluator } from "./evaluator.ts";
import type { NativeSchedule, ScheduleOccurrence, ScheduleRecurrence, ScheduleState, ScheduleTarget } from "./types.ts";
import { emptyScheduleState, SCHEDULES_THREAD } from "./types.ts";
import { nextOccurrenceAfter } from "./evaluator.ts";

type Input = Record<string, unknown>;
function object(value: unknown): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Input;
}
function recurrence(value: unknown): ScheduleRecurrence {
  const input = object(value);
  if (input.kind === "once") {
    if (typeof input.at !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(input.at) || !Number.isFinite(Date.parse(input.at))) throw new Error("One-time schedule requires an offset-bearing instant");
    return { kind: "once", at: new Date(input.at).toISOString() };
  }
  const time = text(input.time, "time", 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Schedule time must be local HH:mm");
  const timezone = text(input.timezone, "timezone", 100);
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0); }
  catch { throw new Error("Schedule timezone must be a valid IANA timezone"); }
  if (input.kind === "daily") return { kind: "daily", time, timezone };
  if (input.kind === "weekly") {
    if (!Array.isArray(input.weekdays) || input.weekdays.length < 1 || input.weekdays.length > 7 || input.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Weekly schedule requires weekdays from 0 through 6");
    return { kind: "weekly", time, timezone, weekdays: [...new Set(input.weekdays as number[])].sort((a, b) => a - b) };
  }
  throw new Error("Unsupported schedule recurrence");
}

export class SchedulesService {
  #tail: Promise<void> = Promise.resolve();
  constructor(readonly experts: ExpertsService, readonly now: () => number = Date.now) {}

  async runSerialized<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await action(); }
    finally { release(); }
  }

  async read(caller: Caller): Promise<{ state: ScheduleState; version: number }> {
    const result = await this.experts.service.readSharedState(this.experts.caller(caller.tenant), { threadId: SCHEDULES_THREAD });
    const raw = result.state as Partial<ScheduleState>;
    if (result.version > 0 && raw.schema !== 1) throw new Error("Unsupported Schedules state schema; an explicit migration is required");
    return { state: raw.schema === 1 ? structuredClone(raw as ScheduleState) : emptyScheduleState(), version: result.version };
  }

  private async mutate<T>(caller: Caller, commandId: string, command: unknown, action: (state: ScheduleState) => T): Promise<T> {
    const digest = fingerprint(command);
    const trusted = this.experts.caller(caller.tenant);
    for (let attempt = 0; attempt < 30; attempt++) {
      const { state, version } = await this.read(trusted);
      const prior = state.receipts[commandId];
      if (prior) {
        if (prior.fingerprint !== digest) throw new Error("Schedule command identity was reused for different work");
        return prior.result as T;
      }
      const result = action(state);
      state.receipts[commandId] = { fingerprint: digest, result: result ?? null };
      try {
        await this.experts.service.updateSharedState(trusted, { threadId: SCHEDULES_THREAD, update: { snapshot: json(state) }, expectedVersion: version, idempotencyKey: commandId + ":" + version + ":" + digest + ":" + fingerprint(state) });
        return result;
      } catch (error) {
        if (!(error instanceof ServiceError) || !["failed_precondition", "unavailable"].includes(error.code)) throw error;
      }
    }
    throw new Error("Schedules are busy; retry this operation");
  }

  private async validateTarget(caller: Caller, target: ScheduleTarget, workspaceId: string): Promise<void> {
    const experts = await this.experts.state(caller.tenant);
    if (target.kind === "expert") {
      const expert = experts.experts[target.id];
      if (!expert || expert.lifecycle !== "active") throw new Error("Schedule target must be an active Expert");
    } else {
      const team = experts.teams[target.id];
      if (!team) throw new Error("Schedule Team not found");
      assertTeamInvariant(experts, team);
      if (team.lifecycle !== "active") throw new Error("Schedule target Team must be active");
    }
    const workspaces = await this.experts.service.readProjection(caller, { name: "workspaces" });
    if (!workspaces.rows.some((row) => (row.value as { id?: string } | null)?.id === workspaceId)) throw new Error("Schedule workspace does not exist");
  }

  async validateDispatch(caller: Caller, scheduleId: string, revision: number, intent: ScheduleOccurrence["intent"]): Promise<void> {
    if (!intent.creatorId || intent.accessMode !== "read-only") throw new Error("Schedule authority is invalid");
    await this.validateTarget(caller, intent.target, intent.workspaceId);
    const current = await this.read(caller);
    const persisted = current.state.schedules[scheduleId];
    if (!persisted || persisted.lifecycle !== "active" || persisted.creatorId !== intent.creatorId || persisted.revision !== revision) throw new Error("Schedule changed or lost authority before dispatch");
  }

  occurrenceId(scheduleId: string, revision: number, dueAt: string): string {
    const digest = createHash("sha256").update(scheduleId + "\0" + revision + "\0" + dueAt).digest("hex").slice(0, 40);
    return "schedule-occ-" + digest;
  }

  async reserve(caller: Caller, schedule: NativeSchedule, dueAt: string, nextDueAt: string | null, skipped: boolean): Promise<ScheduleOccurrence> {
    const id = this.occurrenceId(schedule.id, schedule.revision, dueAt);
    const assignmentId = skipped ? null : "schedule-assignment-" + id.slice("schedule-occ-".length);
    const nowIso = new Date(this.now()).toISOString();
    await this.mutate(caller, "schedule:reserve:" + id, { scheduleId: schedule.id, revision: schedule.revision, dueAt }, (state) => {
      const current = state.schedules[schedule.id];
      if (!current || current.lifecycle !== "active" || current.revision !== schedule.revision) return { ok: false };
      const occurrence = state.occurrences[id];
      if (!occurrence) state.occurrences[id] = { id, scheduleId: schedule.id, revision: schedule.revision, dueAt, status: skipped ? "skipped" : "reserved", assignmentId,
        intent: { creatorId: schedule.creatorId, workspaceId: schedule.workspaceId, target: structuredClone(schedule.target), objective: schedule.objective, accessMode: schedule.accessMode },
        conversationId: null, runId: null, error: null, failureKind: null, attempts: 0, retryAt: null, reservedAt: nowIso, updatedAt: nowIso };
      current.nextDueAt = nextDueAt;
      current.updatedAt = nowIso;
      return { ok: true };
    });
    return (await this.read(caller)).state.occurrences[id]!;
  }

  async recordDispatch(caller: Caller, occurrenceId: string, conversationId: string | null, assignmentId: string): Promise<boolean> {
    return this.mutate(caller, "schedule:dispatch-receipt:" + occurrenceId, { conversationId, assignmentId }, (state) => {
      const occurrence = state.occurrences[occurrenceId];
      if (!occurrence) return false;
      if (occurrence.assignmentId !== assignmentId) throw new Error("Native dispatch returned a conflicting Assignment identity");
      occurrence.conversationId = conversationId;
      const schedule=state.schedules[occurrence.scheduleId];
      if(occurrence.status!=="reserved" || !schedule || schedule.lifecycle!=="active" || schedule.revision!==occurrence.revision){
        if(occurrence.status==="reserved")occurrence.status="cancelled";
        return false;
      }
      occurrence.status = "queued";
      occurrence.error = null;
      occurrence.failureKind = null;
      occurrence.attempts++;
      occurrence.retryAt = null;
      occurrence.updatedAt = new Date(this.now()).toISOString();
      return true;
    });
  }

  async recordFailure(caller: Caller, occurrenceId: string, error: string): Promise<void> {
    const current = (await this.read(caller)).state.occurrences[occurrenceId];
    if (!current) return;
    const attempts = current.attempts + 1;
    const retryAt = attempts < 3 ? this.now() + Math.min(60_000, 1_000 * 2 ** (attempts - 1)) : null;
    await this.mutate(caller, "schedule:failure:" + occurrenceId + ":" + attempts, { error, attempts }, (state) => {
      const occurrence = state.occurrences[occurrenceId];
      if (!occurrence || occurrence.status === "cancelled") return;
      occurrence.status = "failed";
      occurrence.attempts = attempts;
      occurrence.retryAt = retryAt === null ? null : new Date(retryAt).toISOString();
      occurrence.error = error.slice(0, 1000);
      occurrence.failureKind = "dispatch";
      occurrence.updatedAt = new Date(this.now()).toISOString();
    });
  }

  async retryOccurrence(caller: Caller, occurrenceId: string): Promise<void> {
    await this.mutate(caller, "schedule:retry:" + occurrenceId + ":" + this.now(), { occurrenceId }, (state) => {
      const occurrence = state.occurrences[occurrenceId];
      if (!occurrence || occurrence.status !== "failed" || occurrence.attempts >= 3) return;
      occurrence.status = "reserved";
      occurrence.retryAt = null;
      occurrence.updatedAt = new Date(this.now()).toISOString();
    });
  }

  async updateOccurrence(caller: Caller, occurrenceId: string, status: ScheduleOccurrence["status"], runId: string | null, error: string | null): Promise<void> {
    await this.mutate(caller, "schedule:observe:" + occurrenceId + ":" + status + ":" + (runId ?? ""), { occurrenceId, status, runId, error }, (state) => {
      const occurrence = state.occurrences[occurrenceId];
      if (!occurrence) return;
      if(occurrence.status==="cancelled" && status!=="cancelled")return;
      occurrence.status = status;
      occurrence.runId = runId;
      occurrence.error = error;
      occurrence.failureKind = status === "failed" ? "assignment" : null;
      occurrence.updatedAt = new Date(this.now()).toISOString();
    });
  }

  private async reconcileCancelled(caller: Caller): Promise<void> {
    const { state } = await this.read(caller);
    const expertState = await this.experts.state(caller.tenant);
    for (const schedule of Object.values(state.schedules)) {
      if (schedule.lifecycle !== "cancelled" && schedule.lifecycle !== "deleted") continue;
      for (const occurrence of Object.values(state.occurrences).filter((item) => item.scheduleId === schedule.id && !["completed", "failed", "skipped", "cancelled"].includes(item.status))) {
        const assignment = occurrence.assignmentId ? expertState.assignments[occurrence.assignmentId] : undefined;
        if (assignment && ["queued", "running", "waiting"].includes(assignment.status)) {
          await this.experts.service.invoke(caller, { capability: "team.cancel", idempotencyKey: "schedule-cancel:" + occurrence.id, input: { assignmentId: assignment.id, requestId: "schedule-cancel:" + occurrence.id } });
        }
        await this.updateOccurrence(caller, occurrence.id, "cancelled", assignment?.runId ?? occurrence.runId, null);
      }
    }
  }

  async command(capability: string, raw: unknown, caller: Caller): Promise<unknown> {
    if (caller.actor.kind !== "user") throw new Error("Only the human operator may manage schedules");
    const input = object(raw);
    return this.runSerialized(async () => {
      if (capability === "schedule.list") {
        const { state } = await this.read(caller);
        const schedules=Object.values(state.schedules).filter(schedule=>schedule.creatorId===caller.actor.id);
        const visible=new Set(schedules.map(schedule=>schedule.id));
        return { schedules: schedules.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), occurrences: Object.values(state.occurrences).filter(occurrence=>visible.has(occurrence.scheduleId)).sort((a, b) => b.dueAt.localeCompare(a.dueAt)) };
      }
      if (capability === "schedule.save") {
        const requestId = text(input.requestId, "requestId", 300);
        const id = input.scheduleId ? text(input.scheduleId, "scheduleId", 200) : "schedule-" + createHash("sha256").update(caller.actor.id + "\0" + requestId).digest("hex").slice(0, 32);
        const targetInput = object(input.target);
        if (targetInput.kind !== "expert" && targetInput.kind !== "team") throw new Error("Choose an Expert or Team target");
        const target: ScheduleTarget = { kind: targetInput.kind, id: text(targetInput.id, "targetId", 200) };
        const workspaceId = text(input.workspaceId, "workspaceId", 200);
        const objective = text(input.objective, "objective", 4000);
        const scheduleRecurrence = recurrence(input.recurrence);
        if (input.misfire !== "coalesce" && input.misfire !== "skip") throw new Error("Choose a coalesce or skip misfire policy");
        await this.validateTarget(caller, target, workspaceId);
        const now = this.now();
        const nextDueAt = scheduleRecurrence.kind === "once" ? scheduleRecurrence.at : nextOccurrenceAfter(scheduleRecurrence, now - 1);
        const result = await this.mutate(caller, "schedule-command:" + caller.actor.id + ":" + requestId, { capability, input }, (state) => {
          const prior = state.schedules[id];
          if (prior && prior.creatorId !== caller.actor.id) throw new Error("Only the schedule creator may edit it");
          if (prior && ["cancelled", "deleted"].includes(prior.lifecycle)) throw new Error("Cancelled or deleted schedules cannot be edited");
          const schedule: NativeSchedule = {
            id, creatorId: prior?.creatorId ?? caller.actor.id, workspaceId, target, objective, accessMode: "read-only", recurrence: scheduleRecurrence,
            misfire: input.misfire as "coalesce" | "skip", maxInFlight: 1, revision: (prior?.revision ?? 0) + 1, lifecycle: prior?.lifecycle ?? "active", nextDueAt,
            createdAt: prior?.createdAt ?? new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
          };
          if (prior) for (const occurrence of Object.values(state.occurrences)) {
            if (occurrence.scheduleId === id && occurrence.revision === prior.revision && occurrence.status === "reserved") {
              occurrence.status = "cancelled";
              occurrence.updatedAt = new Date(now).toISOString();
            }
          }
          state.schedules[id] = schedule;
          return { scheduleId: id, revision: schedule.revision, nextDueAt };
        });
        await this.reconcileCancelled(caller);
        return result;
      }
      if (capability === "schedule.manage") {
        const requestId = text(input.requestId, "requestId", 300);
        const scheduleId = text(input.scheduleId, "scheduleId", 200);
        const action = input.action;
        if (!["pause", "resume", "cancel", "delete"].includes(String(action))) throw new Error("Unknown schedule action");
        await this.mutate(caller, "schedule-command:" + caller.actor.id + ":" + requestId, { capability, input }, (state) => {
          const schedule = state.schedules[scheduleId];
          if (!schedule || schedule.creatorId !== caller.actor.id) throw new Error("Schedule not found for this creator");
          if (action === "pause" && schedule.lifecycle === "active") schedule.lifecycle = "paused";
          else if (action === "resume" && schedule.lifecycle === "paused") schedule.lifecycle = "active";
          else if (action === "cancel" && !["deleted", "cancelled"].includes(schedule.lifecycle)) schedule.lifecycle = "cancelled";
          else if (action === "delete") schedule.lifecycle = "deleted";
          if (["cancelled", "deleted"].includes(schedule.lifecycle)) schedule.nextDueAt = null;
          schedule.updatedAt = new Date(this.now()).toISOString();
          return { scheduleId, lifecycle: schedule.lifecycle };
        });
        await this.reconcileCancelled(caller);
        const { state } = await this.read(caller);
        return { scheduleId, lifecycle: state.schedules[scheduleId]!.lifecycle };
      }
      throw new Error("Unknown schedule capability");
    });
  }
}

export function schedulesComponent(options: { readonly getSchedules: () => SchedulesService; readonly getEvaluator: () => ScheduleEvaluator; readonly semanticRefs: Readonly<Record<string, SemanticRef | undefined>> }): Component {
  const ids = ["schedule.save", "schedule.manage", "schedule.list", "schedule.dispatch"];
  const contracts = ids.map((id) => ({ id, version: "1.0.0", semanticRef: options.semanticRefs[id] }));
  return { id: "schedules:native", provides: contracts, activate(fiber) {
    for (const contract of contracts) fiber.provide(contract, async (input, ctx: HandlerContext) => {
      if (contract.id === "schedule.dispatch") {
        const expected = options.getSchedules().experts.systemCaller.actor;
        if (ctx.actor.kind !== "system" || ctx.actor.id !== expected.id) throw new Error("Only the internal schedule evaluator may dispatch due work");
        return options.getEvaluator().evaluate(ctx.tenant);
      }
      if(contract.id==="schedule.list"){
        const listing=await options.getSchedules().command(contract.id,input,{actor:ctx.actor,tenant:ctx.tenant}) as Record<string,unknown>;
        return json({...listing,evaluator:options.getEvaluator().status});
      }
      return json(await options.getSchedules().command(contract.id, input, { actor: ctx.actor, tenant: ctx.tenant }));
    });
  } };
}
