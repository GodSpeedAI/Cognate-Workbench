import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { NativeSchedule, ScheduleOccurrence } from "../../schedules/types.ts";
import type { Expert, Team } from "../../experts/types.ts";

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface SchedulesPanelProps {
  readonly schedules: readonly NativeSchedule[];
  readonly occurrences: readonly ScheduleOccurrence[];
  readonly experts: readonly Expert[];
  readonly teams: readonly Team[];
  readonly workspaceId: string | undefined;
  readonly busy?: boolean;
  readonly onCommand: (capability: "schedule.save" | "schedule.manage", input: Record<string, unknown>) => Promise<unknown>;
  readonly onInspect?: (occurrence:ScheduleOccurrence)=>void;
  readonly evaluator?: {readonly running:boolean;readonly error:string|null;readonly mode:"single-process"};
}

/** Small operator surface over durable schedule intent and its native Assignment receipts. */
export function SchedulesPanel({ schedules, occurrences, experts, teams, workspaceId, busy = false, onCommand,onInspect,evaluator }: SchedulesPanelProps) {
  const [targetKind, setTargetKind] = useState<"expert" | "team">("expert");
  const [targetId, setTargetId] = useState("");
  const [objective, setObjective] = useState("");
  const [recurrenceKind, setRecurrenceKind] = useState<"once" | "daily" | "weekly">("daily");
  const [at, setAt] = useState("");
  const [time, setTime] = useState("09:00");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [weekday, setWeekday] = useState(1);
  const [misfire, setMisfire] = useState<"coalesce" | "skip">("coalesce");
  const [notice, setNotice] = useState("");
  const [editingScheduleId, setEditingScheduleId] = useState<string>();
  const sorted = useMemo(() => [...schedules].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [schedules]);
  const targets = targetKind === "expert" ? experts.filter((expert) => expert.lifecycle === "active") : teams.filter((team) => team.lifecycle === "active");

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !workspaceId || !targetId.trim() || !objective.trim()) return;
    const recurrence = recurrenceKind === "once" ? { kind: "once", at }
      : recurrenceKind === "daily" ? { kind: "daily", time, timezone }
      : { kind: "weekly", time, timezone, weekdays: [weekday] };
    try {
      await onCommand("schedule.save", { ...(editingScheduleId ? { scheduleId: editingScheduleId } : {}), target: { kind: targetKind, id: targetId.trim() }, workspaceId, objective: objective.trim(), recurrence, misfire, requestId: crypto.randomUUID() });
      setNotice(editingScheduleId ? "Schedule revision saved. Existing occurrence receipts remain unchanged." : "Schedule saved. Native Expert work will begin only when its occurrence is due.");
      setEditingScheduleId(undefined);
      setObjective("");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };

  const manage = async (scheduleId: string, action: "pause" | "resume" | "cancel" | "delete") => {
    try { await onCommand("schedule.manage", { scheduleId, action, requestId: crypto.randomUUID() }); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  };

  const edit = (schedule: NativeSchedule) => {
    setEditingScheduleId(schedule.id);
    setTargetKind(schedule.target.kind);
    setTargetId(schedule.target.id);
    setObjective(schedule.objective);
    setRecurrenceKind(schedule.recurrence.kind);
    setMisfire(schedule.misfire);
    if (schedule.recurrence.kind === "once") setAt(schedule.recurrence.at);
    else { setTime(schedule.recurrence.time); setTimezone(schedule.recurrence.timezone); }
    if (schedule.recurrence.kind === "weekly") setWeekday(schedule.recurrence.weekdays[0] ?? 1);
  };

  return <section aria-labelledby="schedules-heading" className="experts-schedules">
    <header><div><p className="eyebrow">Durable intent · read-only dispatch</p><h2 id="schedules-heading">Schedules</h2><p>Schedule a bounded objective for an active Expert or Team. Each occurrence becomes a normal Cognate Assignment.</p></div></header>
    {evaluator && <p role="status">Evaluator {evaluator.running ? "active":"stopped"} · one Workbench process</p>}
    {evaluator?.error && <p role="alert">Evaluator error: {evaluator.error}</p>}
    <form onSubmit={create} className="experts-schedules__form">
      <h3>{editingScheduleId ? "Edit schedule" : "Create schedule"}</h3>
      <label>Target type<select aria-label="Target type" value={targetKind} onChange={(event) => setTargetKind(event.target.value as "expert" | "team")}><option value="expert">Expert</option><option value="team">Team</option></select></label>
      <label>Active {targetKind}<select aria-label={`Active ${targetKind}`} value={targetId} onChange={(event) => setTargetId(event.target.value)} required><option value="">Choose {targetKind}</option>{targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
      <label>Objective<textarea value={objective} onChange={(event) => setObjective(event.target.value)} required maxLength={4000} rows={3} /></label>
      <label>Recurrence<select aria-label="Recurrence" value={recurrenceKind} onChange={(event) => setRecurrenceKind(event.target.value as typeof recurrenceKind)}><option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
      {recurrenceKind === "once" ? <label>Due instant (ISO with timezone)<input value={at} onChange={(event) => setAt(event.target.value)} placeholder="2026-10-14T14:30:00-04:00" required /></label> : <>
        <label>Local time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label>
        <label>IANA timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} required maxLength={100} /></label>
        {recurrenceKind === "weekly" && <label>Weekday<select aria-label="Weekday" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{days.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
      </>}
      <label>Missed occurrence<select aria-label="Missed occurrence" value={misfire} onChange={(event) => setMisfire(event.target.value as typeof misfire)}><option value="coalesce">Coalesce to latest due time</option><option value="skip">Skip missed work</option></select></label>
      <p>Scheduled work is read-only. Credentials and broader execution authority are never stored in a schedule.</p>
      <button type="submit" disabled={busy || !workspaceId}>{editingScheduleId ? "Save revision" : "Save schedule"}</button>
      {editingScheduleId && <button type="button" disabled={busy} onClick={() => setEditingScheduleId(undefined)}>Cancel editing</button>}
    </form>
    {notice && <p role="status">{notice}</p>}
    <div className="experts-schedules__list"><h3>Schedule history</h3>
      {sorted.length === 0 ? <p>No schedules yet.</p> : sorted.map((schedule) => {
        const history = occurrences.filter((item) => item.scheduleId === schedule.id).sort((a, b) => b.dueAt.localeCompare(a.dueAt));
        return <article key={schedule.id} className="experts-schedules__item">
          <header><div><h4>{schedule.target.kind}: {schedule.target.id}</h4><p>{schedule.objective}</p></div><span>{schedule.lifecycle}</span></header>
          <p>Revision {schedule.revision} · next due {schedule.nextDueAt ?? "none"} · {schedule.misfire} missed-work policy · read-only</p>
          <div className="experts-schedules__actions">
            {!(["cancelled", "deleted"].includes(schedule.lifecycle)) && <button type="button" disabled={busy} onClick={() => edit(schedule)}>Edit</button>}
            {schedule.lifecycle === "active" && <button type="button" disabled={busy} onClick={() => void manage(schedule.id, "pause")}>Pause</button>}
            {schedule.lifecycle === "paused" && <button type="button" disabled={busy} onClick={() => void manage(schedule.id, "resume")}>Resume</button>}
            {!(["cancelled", "deleted"].includes(schedule.lifecycle)) && <button type="button" disabled={busy} onClick={() => void manage(schedule.id, "cancel")}>Cancel</button>}
            {schedule.lifecycle !== "deleted" && <button type="button" disabled={busy} onClick={() => void manage(schedule.id, "delete")}>Delete</button>}
          </div>
          <ol>{history.map((item) => <li key={item.id}><strong>{item.status}</strong> · due {item.dueAt}{item.assignmentId ? " · Assignment " + item.assignmentId : ""}{item.runId ? " · Run " + item.runId : ""}{item.error ? " · " + item.error : ""}{item.conversationId && onInspect && <button type="button" onClick={()=>onInspect(item)}>Inspect occurrence</button>}</li>)}</ol>
        </article>;
      })}
    </div>
  </section>;
}
