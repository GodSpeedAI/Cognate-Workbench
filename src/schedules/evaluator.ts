import type { Caller } from "@godspeedai/cognate-runtime-api";
import type { ExpertsService } from "../experts/service.ts";
import { isUnfinished } from "../experts/types.ts";
import type { SchedulesService } from "./service.ts";
import type { ScheduleOccurrence, ScheduleRecurrence, ScheduleState } from "./types.ts";

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };
const dateKey = (p: Pick<LocalParts, "year" | "month" | "day">) => [String(p.year).padStart(4, "0"), String(p.month).padStart(2, "0"), String(p.day).padStart(2, "0")].join("-");
function partsAt(epochMs: number, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(epochMs);
  const fields = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: Number(fields.year), month: Number(fields.month), day: Number(fields.day), hour: Number(fields.hour), minute: Number(fields.minute) };
}
function localDate(date: string, hour: number, minute: number): LocalParts {
  const [year, month, day] = date.split("-").map(Number);
  return { year: year!, month: month!, day: day!, hour, minute };
}
function wallTimeCandidates(date: string, time: string, timezone: string): number[] {
  const [hour, minute] = time.split(":").map(Number);
  const local = localDate(date, hour!, minute!);
  const target = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const matches: number[] = [];
  // Quarter-hour offsets cover current IANA zone offsets and both sides of DST folds.
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = target - offset * 60_000;
    const actual = partsAt(candidate, timezone);
    if (actual.year === local.year && actual.month === local.month && actual.day === local.day && actual.hour === local.hour && actual.minute === local.minute) matches.push(candidate);
  }
  return [...new Set(matches)].sort((a, b) => a - b);
}
function utcDateStep(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return [String(value.getUTCFullYear()).padStart(4, "0"), String(value.getUTCMonth() + 1).padStart(2, "0"), String(value.getUTCDate()).padStart(2, "0")].join("-");
}
function matchesDay(recurrence: ScheduleRecurrence, date: string): boolean {
  if (recurrence.kind === "daily") return true;
  if (recurrence.kind !== "weekly") return false;
  const [year, month, day] = date.split("-").map(Number);
  return recurrence.weekdays.includes(new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay());
}
function validateZone(timezone: string): void {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0); }
  catch { throw new Error("Invalid IANA timezone: " + timezone); }
}

/** Returns the next calendar occurrence strictly after the instant. */
export function nextOccurrenceAfter(recurrence: ScheduleRecurrence, afterMs: number): string | null {
  if (recurrence.kind === "once") return Date.parse(recurrence.at) > afterMs ? new Date(recurrence.at).toISOString() : null;
  validateZone(recurrence.timezone);
  const date = dateKey(partsAt(afterMs, recurrence.timezone));
  for (let day = 0; day <= 8; day++) {
    const candidateDate = utcDateStep(date, day);
    if (!matchesDay(recurrence, candidateDate)) continue;
    const candidate = wallTimeCandidates(candidateDate, recurrence.time, recurrence.timezone)[0];
    if (candidate !== undefined && candidate > afterMs) return new Date(candidate).toISOString();
  }
  return null;
}

/** Returns the latest configured calendar occurrence at or before the instant. */
export function previousOccurrenceOnOrBefore(recurrence: ScheduleRecurrence, atMs: number): string | null {
  if (recurrence.kind === "once") return Date.parse(recurrence.at) <= atMs ? new Date(recurrence.at).toISOString() : null;
  validateZone(recurrence.timezone);
  const date = dateKey(partsAt(atMs, recurrence.timezone));
  for (let day = 0; day <= 8; day++) {
    const candidateDate = utcDateStep(date, -day);
    if (!matchesDay(recurrence, candidateDate)) continue;
    const candidate = wallTimeCandidates(candidateDate, recurrence.time, recurrence.timezone)[0];
    if (candidate !== undefined && candidate <= atMs) return new Date(candidate).toISOString();
  }
  return null;
}

export const SCHEDULE_MISFIRE_GRACE_MS = 60_000;
export interface ScheduleEvaluatorOptions { readonly intervalMs?: number; readonly maxInFlight?: number; readonly now?: () => number }

/** Durable intent evaluator; Cognate's native bridge remains the run executor. */
export class ScheduleEvaluator {
  readonly controller = new AbortController();
  #task: Promise<void> | undefined;
  error: string | null = null;
  get status(){return {running:!!this.#task && !this.controller.signal.aborted,error:this.error,mode:"single-process" as const};}
  constructor(readonly schedules: SchedulesService, readonly experts: ExpertsService, readonly options: ScheduleEvaluatorOptions = {}) {}

  async reconcile(tenant = this.experts.systemCaller.tenant): Promise<void> {
    await this.schedules.runSerialized(async () => {
      const caller = this.experts.caller(tenant);
      const { state } = await this.schedules.read(caller);
      for (const schedule of Object.values(state.schedules)) {
        if (schedule.lifecycle !== "cancelled" && schedule.lifecycle !== "deleted") continue;
        for (const occurrence of Object.values(state.occurrences).filter((item) => item.scheduleId === schedule.id)) {
          await this.cancelAssignment(caller, occurrence);
          if (!(["cancelled", "completed", "failed", "skipped"] as string[]).includes(occurrence.status)) await this.schedules.updateOccurrence(caller, occurrence.id, "cancelled", occurrence.runId, null);
        }
      }
    });
  }

  async evaluate(tenant = this.experts.systemCaller.tenant): Promise<void> {
    await this.reconcile(tenant);
    const now = (this.options.now ?? Date.now)();
    await this.schedules.runSerialized(async () => {
      const caller = this.experts.caller(tenant);
      let { state } = await this.schedules.read(caller);
      await this.syncReceipts(caller, state);
      ({ state } = await this.schedules.read(caller));
      for (const schedule of Object.values(state.schedules)) {
        if (this.controller.signal.aborted) break;
        if (schedule.lifecycle !== "active") continue;
        const cap = Math.max(1, this.options.maxInFlight ?? 1);
        const priorOccurrence = Object.values(state.occurrences).find((item) => item.scheduleId === schedule.id && (item.status === "reserved" || item.status === "failed" && item.failureKind === "dispatch" && item.attempts < 3 && (!item.retryAt || Date.parse(item.retryAt) <= now)));
        if (priorOccurrence) {
          const otherUnresolved = Object.values(state.occurrences).filter((item) => item.id !== priorOccurrence.id && ["reserved", "queued", "issued", "waiting"].includes(item.status));
          if (otherUnresolved.length >= cap) break;
          if (priorOccurrence.status === "failed") await this.schedules.retryOccurrence(caller, priorOccurrence.id);
          await this.dispatch(caller, schedule.id, priorOccurrence.id);
          ({ state } = await this.schedules.read(caller));
          continue;
        }
        const unresolved = Object.values(state.occurrences).filter((item) => ["reserved", "queued", "issued", "waiting"].includes(item.status));
        if (unresolved.length >= cap) break;
        const hasUnresolved = Object.values(state.occurrences).some((item) => item.scheduleId === schedule.id && ["reserved", "queued", "issued", "waiting"].includes(item.status));
        if (hasUnresolved || !schedule.nextDueAt || Date.parse(schedule.nextDueAt) > now) continue;
        const previous = previousOccurrenceOnOrBefore(schedule.recurrence, now);
        if (!previous) continue;
        const missedBy = now - Date.parse(schedule.nextDueAt);
        const skipped = schedule.misfire === "skip" && missedBy > SCHEDULE_MISFIRE_GRACE_MS;
        const dueAt = schedule.misfire === "coalesce" || skipped ? previous : schedule.nextDueAt;
        const nextDueAt = nextOccurrenceAfter(schedule.recurrence, now);
        const occurrenceId = this.schedules.occurrenceId(schedule.id, schedule.revision, dueAt);
        let occurrence = state.occurrences[occurrenceId];
        if (!occurrence) {
          occurrence = await this.schedules.reserve(caller, schedule, dueAt, nextDueAt, skipped);
          ({ state } = await this.schedules.read(caller));
        }
        if (skipped || occurrence.status === "skipped") continue;
        await this.dispatch(caller, schedule.id, occurrence.id);
        ({ state } = await this.schedules.read(caller));
      }
    });
  }

  private async dispatch(caller: Caller, scheduleId: string, occurrenceId: string): Promise<void> {
    const { state } = await this.schedules.read(caller);
    const schedule = state.schedules[scheduleId];
    const occurrence = state.occurrences[occurrenceId];
    if (!schedule || !occurrence || occurrence.status !== "reserved") return;
    if (schedule.lifecycle !== "active" || schedule.revision !== occurrence.revision) {
      await this.cancelAssignment(caller, occurrence);
      await this.schedules.updateOccurrence(caller, occurrence.id, "cancelled", occurrence.runId, "Schedule changed before this occurrence was issued");
      return;
    }
    const assignmentId = occurrence.assignmentId;
    if (!assignmentId) return;
    const creator: Caller = { actor: { id: occurrence.intent.creatorId, kind: "user" }, tenant: caller.tenant };
    try {
      await this.schedules.validateDispatch(creator, scheduleId, occurrence.revision, occurrence.intent);
      const response = await this.experts.service.invoke(creator, {
        capability: occurrence.intent.target.kind === "team" ? "team.converse" : "expert.converse",
        correlationId: "schedule:" + occurrence.id,
        idempotencyKey: "schedule-dispatch:" + occurrence.id,
        input: {
          id: assignmentId, requestId: occurrence.id,
          ...(occurrence.intent.target.kind === "team" ? { teamId: occurrence.intent.target.id } : { expertId: occurrence.intent.target.id }),
          workspaceId: occurrence.intent.workspaceId, message: occurrence.intent.objective, mode: "read-only",
        },
      }) as { conversationId?: string; assignmentId?: string };
      const accepted=await this.schedules.recordDispatch(caller, occurrence.id, response.conversationId ?? null, response.assignmentId ?? assignmentId);
      // A competing cancellation/edit can win after native acceptance. Never resurrect the
      // occurrence; revoke its deterministic Assignment and leave its history attributable.
      if(!accepted)await this.cancelAssignment(caller,occurrence);
    } catch (error) {
      await this.schedules.recordFailure(caller, occurrence.id, error instanceof Error ? error.message : String(error));
    }
  }

  private async syncReceipts(caller: Caller, state: ScheduleState): Promise<void> {
    const expertState = await this.experts.state(caller.tenant);
    for (const occurrence of Object.values(state.occurrences)) {
      if (!occurrence.assignmentId || ["completed", "failed", "cancelled", "skipped"].includes(occurrence.status)) continue;
      const assignment = expertState.assignments[occurrence.assignmentId];
      if (!assignment) continue;
      const status = assignment.status === "waiting" ? "waiting" : assignment.status === "queued" ? "queued" : assignment.status === "running" ? "issued"
        : assignment.status === "completed" || assignment.status === "reconciliation-required" ? "completed" : assignment.status === "cancelled" ? "cancelled" : "failed";
      const error = status === "failed"
        ? (assignment.handoff?.failures ?? []).join("; ").slice(0, 1000) || assignment.handoff?.output.slice(0, 1000) || "Native Assignment failed without a failure receipt"
        : null;
      if (occurrence.status !== status || occurrence.runId !== assignment.runId || occurrence.error !== error) await this.schedules.updateOccurrence(caller, occurrence.id, status, assignment.runId, error);
    }
  }

  private async cancelAssignment(caller: Caller, occurrence: ScheduleOccurrence): Promise<void> {
    const state = await this.experts.state(caller.tenant);
    if (!occurrence.assignmentId) return;
    const assignment = state.assignments[occurrence.assignmentId];
    if (!assignment || !isUnfinished(assignment)) return;
    const creator: Caller = { actor: { id: occurrence.intent.creatorId, kind: "user" }, tenant: caller.tenant };
    await this.experts.service.invoke(creator, { capability: "team.cancel", idempotencyKey: "schedule-cancel:" + occurrence.id, input: { assignmentId: assignment.id, requestId: "schedule-cancel:" + occurrence.id } });
    await this.schedules.updateOccurrence(caller, occurrence.id, "cancelled", assignment.runId, null);
  }

  async start(tenant = this.experts.systemCaller.tenant): Promise<void> {
    await this.reconcile(tenant);
    this.#task = (async () => {
      const interval = this.options.intervalMs ?? 1_000;
      while (!this.controller.signal.aborted) {
        try { await this.evaluate(tenant); this.error = null; }
        catch (error) { this.error = error instanceof Error ? error.message : String(error); }
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); this.controller.signal.removeEventListener("abort", done); resolve(); };
          const timer = setTimeout(done, interval);
          this.controller.signal.addEventListener("abort", done, { once: true });
        });
      }
    })();
  }
  async stop(): Promise<void> { this.controller.abort(); await this.#task; }
}
