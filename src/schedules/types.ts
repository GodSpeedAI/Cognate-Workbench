export const SCHEDULES_THREAD = "schedules:registry";

export type ScheduleTarget = { readonly kind: "expert" | "team"; readonly id: string };
export type ScheduleRecurrence =
  | { readonly kind: "once"; readonly at: string }
  | { readonly kind: "daily"; readonly time: string; readonly timezone: string }
  | { readonly kind: "weekly"; readonly time: string; readonly timezone: string; readonly weekdays: readonly number[] };
export type ScheduleLifecycle = "active" | "paused" | "cancelled" | "deleted";
export type OccurrenceStatus = "reserved" | "queued" | "issued" | "waiting" | "completed" | "failed" | "cancelled" | "skipped";
export type OccurrenceFailureKind = "dispatch" | "assignment" | null;

export interface NativeSchedule {
  readonly id: string;
  readonly creatorId: string;
  readonly workspaceId: string;
  readonly target: ScheduleTarget;
  readonly objective: string;
  readonly accessMode: "read-only";
  readonly recurrence: ScheduleRecurrence;
  readonly misfire: "coalesce" | "skip";
  readonly maxInFlight: 1;
  readonly revision: number;
  lifecycle: ScheduleLifecycle;
  nextDueAt: string | null;
  readonly createdAt: string;
  updatedAt: string;
}

export interface ScheduleOccurrence {
  readonly id: string;
  readonly scheduleId: string;
  readonly revision: number;
  readonly dueAt: string;
  status: OccurrenceStatus;
  readonly assignmentId: string | null;
  readonly intent: { readonly creatorId: string; readonly workspaceId: string; readonly target: ScheduleTarget; readonly objective: string; readonly accessMode: "read-only" };
  conversationId: string | null;
  runId: string | null;
  error: string | null;
  failureKind: OccurrenceFailureKind;
  attempts: number;
  retryAt: string | null;
  readonly reservedAt: string;
  updatedAt: string;
}

export interface ScheduleState {
  readonly schema: 1;
  schedules: Record<string, NativeSchedule>;
  occurrences: Record<string, ScheduleOccurrence>;
  receipts: Record<string, { readonly fingerprint: string; readonly result: unknown }>;
}

export const emptyScheduleState = (): ScheduleState => ({ schema: 1, schedules: {}, occurrences: {}, receipts: {} });
