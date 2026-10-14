import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SchedulesPanel } from "../src/ui/experts/SchedulesPanel.tsx";
import type { NativeSchedule, ScheduleOccurrence } from "../src/schedules/types.ts";

const schedule: NativeSchedule = {
  id: "schedule-a", creatorId: "operator", workspaceId: "workspace-a", target: { kind: "team", id: "cognate-team" }, objective: "Review a report",
  accessMode: "read-only", recurrence: { kind: "daily", time: "09:00", timezone: "UTC" }, misfire: "coalesce", maxInFlight: 1, revision: 2,
  lifecycle: "active", nextDueAt: "2026-10-15T09:00:00.000Z", createdAt: "2026-10-14T10:00:00.000Z", updatedAt: "2026-10-14T10:00:00.000Z",
};
const occurrence: ScheduleOccurrence = {
  id: "schedule-occ-a", scheduleId: schedule.id, revision: 2, dueAt: "2026-10-14T09:00:00.000Z", status: "waiting",
  assignmentId: "schedule-assignment-a", intent: { creatorId: "operator", workspaceId: schedule.workspaceId, target: schedule.target, objective: schedule.objective, accessMode: "read-only" },
  conversationId: "conversation-a", runId: "run-a", error: null, failureKind: null, attempts: 1, retryAt: null,
  reservedAt: "2026-10-14T09:00:00.000Z", updatedAt: "2026-10-14T09:00:01.000Z",
};

describe("SchedulesPanel", () => {
  test("shows durable lifecycle, native run receipt, explicit misfire and read-only scope", () => {
    const html = renderToStaticMarkup(<SchedulesPanel schedules={[schedule]} occurrences={[occurrence]} experts={[]} teams={[]} workspaceId="workspace-a" onCommand={async () => ({})} />);
    expect(html).toContain("Schedules");
    expect(html).toContain("Coalesce to latest due time");
    expect(html).toContain("Scheduled work is read-only");
    expect(html).toContain("cognate-team");
    expect(html).toContain("waiting");
    expect(html).toContain("Run run-a");
    expect(html).toContain("Pause");
    expect(html).toContain("Edit");
    expect(html).toContain("Cancel");
    expect(html).toContain("Delete");
  });

  test("retains visible tombstones and occurrence history", () => {
    const deleted = { ...schedule, lifecycle: "deleted" as const, nextDueAt: null };
    const html = renderToStaticMarkup(<SchedulesPanel schedules={[deleted]} occurrences={[occurrence]} experts={[]} teams={[]} workspaceId={undefined} onCommand={async () => ({})} />);
    expect(html).toContain("deleted");
    expect(html).toContain("schedule-assignment-a");
    expect(html.includes("No schedules yet.")).toBe(false);
    expect(html).not.toContain(">Pause</button>");
    expect(html).not.toContain(">Cancel</button>");
  });
});
