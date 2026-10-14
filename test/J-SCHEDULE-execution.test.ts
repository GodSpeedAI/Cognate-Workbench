import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { nextOccurrenceAfter, previousOccurrenceOnOrBefore } from "../src/schedules/evaluator.ts";
import { ScheduleEvaluator } from "../src/schedules/evaluator.ts";
import { SchedulesService } from "../src/schedules/service.ts";
import type { ScheduleRecurrence } from "../src/schedules/types.ts";
import { configureDefaultRoutes, collaborationResponder, route, waitForAssignment, withExpertApp, type FakeResponder } from "./expert-helpers.ts";

const SYSTEM_CALLER = { actor: { id: "system", kind: "system" as const }, tenant: "local" };

describe("J-SCHEDULE-FIRE calendar recurrence", () => {
  test("daily recurrence skips a local time missing in the DST spring gap", () => {
    const recurrence: ScheduleRecurrence = { kind: "daily", time: "02:30", timezone: "America/New_York" };
    expect(nextOccurrenceAfter(recurrence, Date.parse("2026-03-08T00:00:00Z"))).toBe("2026-03-09T06:30:00.000Z");
  });

  test("a repeated fall-fold wall time yields its earlier instant only once that day", () => {
    const recurrence: ScheduleRecurrence = { kind: "daily", time: "01:30", timezone: "America/New_York" };
    expect(previousOccurrenceOnOrBefore(recurrence, Date.parse("2026-11-01T12:00:00Z"))).toBe("2026-11-01T05:30:00.000Z");
    expect(nextOccurrenceAfter(recurrence, Date.parse("2026-11-01T05:30:00Z"))).toBe("2026-11-02T06:30:00.000Z");
  });

  test("weekly recurrence chooses the next configured weekday in the requested zone", () => {
    const recurrence: ScheduleRecurrence = { kind: "weekly", time: "09:15", timezone: "Europe/London", weekdays: [1, 4] };
    expect(nextOccurrenceAfter(recurrence, Date.parse("2026-10-14T09:00:00Z"))).toBe("2026-10-15T08:15:00.000Z");
  });
});

describe("J-SCHEDULE-CREATE / J-SCHEDULE-FIRE / J-SCHEDULE-RECOVER", () => {
  test("schedule lifecycle persists revisions, tombstones and receipts in Cognate shared state", async () => {
    await withExpertApp(collaborationResponder, async (app) => {
      await app.client.invoke("experts.seed", {} as never);
      const experts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      const schedules = new SchedulesService(experts, () => Date.parse("2026-10-14T12:00:00.000Z"));
      const make = (requestId: string, scheduleId?: string) => schedules.command("schedule.save", {
        requestId, ...(scheduleId ? { scheduleId } : {}), target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "Summarize the current project status", recurrence: { kind: "daily", time: "09:00", timezone: "America/New_York" }, misfire: "coalesce",
      }, LOCAL_OPERATOR);
      const created = await make("create-schedule") as { scheduleId: string; revision: number; nextDueAt: string };
      expect(created.revision).toBe(1);
      expect(created.nextDueAt).toBe("2026-10-14T13:00:00.000Z");
      await schedules.command("schedule.manage", { requestId: "pause-schedule", scheduleId: created.scheduleId, action: "pause" }, LOCAL_OPERATOR);
      expect((await schedules.read(LOCAL_OPERATOR)).state.schedules[created.scheduleId]!.lifecycle).toBe("paused");
      await schedules.command("schedule.manage", { requestId: "resume-schedule", scheduleId: created.scheduleId, action: "resume" }, LOCAL_OPERATOR);
      const edited = await make("edit-schedule", created.scheduleId) as { revision: number };
      expect(edited.revision).toBe(2);
      await schedules.command("schedule.manage", { requestId: "delete-schedule", scheduleId: created.scheduleId, action: "delete" }, LOCAL_OPERATOR);
      const listing = await schedules.command("schedule.list", { requestId: "list-schedules" }, LOCAL_OPERATOR) as { schedules: { id: string; lifecycle: string }[]; occurrences: unknown[] };
      expect(listing.schedules.find((item) => item.id === created.scheduleId)?.lifecycle).toBe("deleted");
      expect(listing.occurrences).toEqual([]);
      const skipped = await schedules.command("schedule.save", {
        requestId: "skip-misfire", target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "This overdue occurrence is skipped", recurrence: { kind: "once", at: "2026-10-14T11:00:00.000Z" }, misfire: "skip",
      }, LOCAL_OPERATOR) as { scheduleId: string };
      await new ScheduleEvaluator(schedules, experts, { now: () => Date.parse("2026-10-14T12:00:00.000Z") }).evaluate();
      const skippedReceipt = Object.values((await schedules.read(LOCAL_OPERATOR)).state.occurrences).find((item) => item.scheduleId === skipped.scheduleId)!;
      expect(skippedReceipt).toMatchObject({ status: "skipped", assignmentId: null });
    });
  }, 30000);

  test("skip misfire still fires on-time work and unresolved assignments enforce one global slot", async () => {
    await withExpertApp(collaborationResponder, async (app) => {
      await app.client.invoke("experts.seed", {} as never);
      await configureDefaultRoutes(app);
      const now = Date.parse("2026-10-14T12:00:00.000Z");
      const experts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      const schedules = new SchedulesService(experts, () => now);
      const create = (requestId: string, at: string) => schedules.command("schedule.save", {
        requestId, target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "Run a timely scheduled review", recurrence: { kind: "once", at }, misfire: "skip",
      }, LOCAL_OPERATOR) as Promise<{ scheduleId: string }>;
      const first = await create("timely-skip-policy-1", new Date(now - 500).toISOString());
      const second = await create("timely-skip-policy-2", new Date(now - 400).toISOString());
      const evaluator = new ScheduleEvaluator(schedules, experts, { now: () => now, maxInFlight: 1 });
      await evaluator.evaluate();
      let state = (await schedules.read(LOCAL_OPERATOR)).state;
      expect([first.scheduleId, second.scheduleId].filter((id) => state.schedules[id]!.nextDueAt === null)).toHaveLength(1);
      expect(Object.values(state.occurrences)).toHaveLength(1);
      expect(Object.values(state.occurrences)[0]!.status).toBe("queued");
    });
  }, 30000);

  test("a competing service cancellation cannot resurrect a reserved occurrence at dispatch receipt", async () => {
    await withExpertApp(collaborationResponder,async app=>{
      await configureDefaultRoutes(app);
      const now=Date.parse("2026-10-14T12:00:00Z");
      const experts=new ExpertsService(app.app.runtime.service,SYSTEM_CALLER);
      const first=new SchedulesService(experts,()=>now);
      const second=new SchedulesService(experts,()=>now);
      const created=await first.command("schedule.save",{requestId:"racing-cancel",target:{kind:"expert",id:"builder"},workspaceId:app.workspaceId,objective:"Bounded review",recurrence:{kind:"once",at:new Date(now).toISOString()},misfire:"coalesce"},LOCAL_OPERATOR) as {scheduleId:string};
      const schedule=(await first.read(LOCAL_OPERATOR)).state.schedules[created.scheduleId]!;
      const reserved=await first.reserve(LOCAL_OPERATOR,schedule,schedule.nextDueAt!,null,false);
      await second.command("schedule.manage",{requestId:"racing-cancel-2",scheduleId:schedule.id,action:"cancel"},LOCAL_OPERATOR);
      expect(await first.recordDispatch(LOCAL_OPERATOR,reserved.id,"late-conversation",reserved.assignmentId!)).toBe(false);
      await first.updateOccurrence(LOCAL_OPERATOR,reserved.id,"issued","late-run",null);
      expect((await first.read(LOCAL_OPERATOR)).state.occurrences[reserved.id]!.status).toBe("cancelled");
      const another={tenant:LOCAL_OPERATOR.tenant,actor:{id:"other-human",kind:"user" as const}};
      expect(await second.command("schedule.list",{},another)).toEqual({schedules:[],occurrences:[]});
    });
  },30000);

  test("editing a schedule cancels old-revision reservations before they can be issued", async () => {
    await withExpertApp(collaborationResponder, async (app) => {
      await app.client.invoke("experts.seed", {} as never);
      const now = Date.parse("2026-10-14T12:00:00.000Z");
      const experts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      const schedules = new SchedulesService(experts, () => now);
      const input = {
        target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "Original scheduled objective", recurrence: { kind: "once", at: "2026-10-14T12:01:00.000Z" }, misfire: "coalesce",
      };
      const created = await schedules.command("schedule.save", { ...input, requestId: "edit-reservation-create" }, LOCAL_OPERATOR) as { scheduleId: string };
      const stored = (await schedules.read(LOCAL_OPERATOR)).state.schedules[created.scheduleId]!;
      const reserved = await schedules.reserve(LOCAL_OPERATOR, stored, stored.nextDueAt!, null, false);
      await schedules.command("schedule.save", { ...input, requestId: "edit-reservation-edit", scheduleId: created.scheduleId, objective: "Updated scheduled objective" }, LOCAL_OPERATOR);
      const state = (await schedules.read(LOCAL_OPERATOR)).state;
      expect(state.schedules[created.scheduleId]!.revision).toBe(2);
      expect(state.occurrences[reserved.id]!.status).toBe("cancelled");
      expect(state.occurrences[reserved.id]!.intent.objective).toBe("Original scheduled objective");
    });
  }, 30000);

  test("daily recurrence advances once per due instant and repeated ticks do not duplicate native work", async () => {
    await withExpertApp(collaborationResponder, async (app) => {
      await app.client.invoke("experts.seed", {} as never);
      await configureDefaultRoutes(app);
      let now = Date.parse("2026-10-14T12:00:00.000Z");
      const experts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      const schedules = new SchedulesService(experts, () => now);
      const created = await schedules.command("schedule.save", {
        requestId: "recurring-daily", target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "Summarize the project once each day", recurrence: { kind: "daily", time: "12:00", timezone: "UTC" }, misfire: "coalesce",
      }, LOCAL_OPERATOR) as { scheduleId: string };
      const evaluator = new ScheduleEvaluator(schedules, experts, { now: () => now });

      await evaluator.evaluate();
      let state = (await schedules.read(LOCAL_OPERATOR)).state;
      let occurrences = Object.values(state.occurrences).filter((item) => item.scheduleId === created.scheduleId);
      const first = occurrences[0]!;
      const firstAssignment = await waitForAssignment(app, first.assignmentId!, (item) => item.status === "completed" || item.status === "reconciliation-required");
      await evaluator.evaluate();
      state = (await schedules.read(LOCAL_OPERATOR)).state;
      occurrences = Object.values(state.occurrences).filter((item) => item.scheduleId === created.scheduleId);
      expect(occurrences).toHaveLength(1);
      expect(occurrences[0]!.id).toBe(first.id);
      expect(state.schedules[created.scheduleId]!.nextDueAt).toBe("2026-10-15T12:00:00.000Z");

      now = Date.parse("2026-10-15T12:00:00.000Z");
      await evaluator.evaluate();
      state = (await schedules.read(LOCAL_OPERATOR)).state;
      occurrences = Object.values(state.occurrences).filter((item) => item.scheduleId === created.scheduleId);
      expect(occurrences).toHaveLength(2);
      const second = occurrences.find((item) => item.id !== first.id)!;
      expect(second.dueAt).toBe("2026-10-15T12:00:00.000Z");
      expect(second.assignmentId).not.toBe(first.assignmentId);
      const secondAssignment = await waitForAssignment(app, second.assignmentId!, (item) => item.status === "completed" || item.status === "reconciliation-required");
      await evaluator.evaluate();
      await evaluator.evaluate();
      state = (await schedules.read(LOCAL_OPERATOR)).state;
      occurrences = Object.values(state.occurrences).filter((item) => item.scheduleId === created.scheduleId);
      expect(occurrences).toHaveLength(2);
      expect(state.schedules[created.scheduleId]!.nextDueAt).toBe("2026-10-16T12:00:00.000Z");
      expect((await app.app.runtime.service.getRun(LOCAL_OPERATOR, { runId: firstAssignment.runId! })).correlationId).toBe("expert:" + first.assignmentId + ":1");
      expect((await app.app.runtime.service.getRun(LOCAL_OPERATOR, { runId: secondAssignment.runId! })).correlationId).toBe("expert:" + second.assignmentId + ":1");
    });
  }, 30000);

  test("provider failure stays visible and recovery waits for the next scheduled occurrence", async () => {
    let recover = false;
    let failedAttempts = 0;
    const responder = async (model: Parameters<typeof collaborationResponder>[0], request: Parameters<typeof collaborationResponder>[1]) => {
      if (model.model === "scheduled-flaky" && !recover) { failedAttempts++; throw new Error("scheduled provider unavailable for proof"); }
      return collaborationResponder(model, request);
    };
    await withExpertApp(responder, async (app) => {
      await app.client.invoke("experts.seed", {} as never);
      await configureDefaultRoutes(app, { builder: route("scheduled-flaky") });
      let now = Date.parse("2026-10-14T12:00:00.000Z");
      const experts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      const schedules = new SchedulesService(experts, () => now);
      const created = await schedules.command("schedule.save", {
        requestId: "failure-next-occurrence", target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "Report the current project status", recurrence: { kind: "daily", time: "12:00", timezone: "UTC" }, misfire: "coalesce",
      }, LOCAL_OPERATOR) as { scheduleId: string };
      const evaluator = new ScheduleEvaluator(schedules, experts, { now: () => now });
      await evaluator.evaluate();
      let state = (await schedules.read(LOCAL_OPERATOR)).state;
      let occurrence = Object.values(state.occurrences).find((item) => item.scheduleId === created.scheduleId)!;
      const failedAssignment = await waitForAssignment(app, occurrence.assignmentId!, (item) => item.status === "failed");
      expect(failedAssignment.handoff?.failures.length).toBeGreaterThan(0);
      await evaluator.evaluate();
      state = (await schedules.read(LOCAL_OPERATOR)).state;
      occurrence = state.occurrences[occurrence.id]!;
      expect(occurrence).toMatchObject({ status: "failed", failureKind: "assignment" });
      expect(occurrence.error).toBe((failedAssignment.handoff?.failures ?? []).join("; "));
      const attemptsAfterFailure = failedAttempts;
      await evaluator.evaluate();
      expect(failedAttempts).toBe(attemptsAfterFailure);
      expect(Object.values((await schedules.read(LOCAL_OPERATOR)).state.occurrences).filter((item) => item.scheduleId === created.scheduleId)).toHaveLength(1);

      recover = true;
      now = Date.parse("2026-10-15T12:00:00.000Z");
      await evaluator.evaluate();
      state = (await schedules.read(LOCAL_OPERATOR)).state;
      const next = Object.values(state.occurrences).find((item) => item.scheduleId === created.scheduleId && item.id !== occurrence.id)!;
      expect(next.dueAt).toBe("2026-10-15T12:00:00.000Z");
      const recovered = await waitForAssignment(app, next.assignmentId!, (item) => item.status === "completed" || item.status === "reconciliation-required");
      await evaluator.evaluate();
      state = (await schedules.read(LOCAL_OPERATOR)).state;
      expect(state.occurrences[occurrence.id]!.status).toBe("failed");
      expect(state.occurrences[next.id]!.status).toBe("completed");
      expect(recovered.id).not.toBe(failedAssignment.id);
      expect(failedAttempts).toBe(attemptsAfterFailure);
    });
  }, 60000);

  test("cancelled future work remains inert after restart and after its due time", async () => {
    await withExpertApp(collaborationResponder, async (app) => {
      await app.client.invoke("experts.seed", {} as never);
      const now = Date.now();
      let experts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      let schedules = new SchedulesService(experts, () => now);
      const dueAt = now + 30_000;
      const created = await schedules.command("schedule.save", {
        requestId: "cancel-future-before-restart", target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "This cancelled future objective must stay inert", recurrence: { kind: "once", at: new Date(dueAt).toISOString() }, misfire: "coalesce",
      }, LOCAL_OPERATOR) as { scheduleId: string };
      await schedules.command("schedule.manage", { requestId: "cancel-future", scheduleId: created.scheduleId, action: "cancel" }, LOCAL_OPERATOR);
      await app.restart();
      experts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      schedules = new SchedulesService(experts, () => dueAt + 60_000);
      await new ScheduleEvaluator(schedules, experts, { now: () => dueAt + 60_000 }).evaluate();
      const state = (await schedules.read(LOCAL_OPERATOR)).state;
      expect(state.schedules[created.scheduleId]!.lifecycle).toBe("cancelled");
      expect(Object.values(state.occurrences).filter((item) => item.scheduleId === created.scheduleId)).toHaveLength(0);
      expect(Object.values((await app.state()).assignments).filter((item) => item.purpose === "This cancelled future objective must stay inert")).toHaveLength(0);
    });
  }, 30000);

  test("a scheduled read-only Builder waits for human approval before a Bash side effect", async () => {
    const responder: FakeResponder = async (model, request) => {
      const hasBash = (request.tools ?? []).some((tool) => tool.name === "bash");
      if (model.model === "scheduled-effect" && hasBash && !request.messages.some((message) => message.role === "tool")) return {
        message: { role: "assistant", content: "" },
        toolCalls: [{ id: "scheduled-write", name: "bash", arguments: { command: "echo scheduled-side-effect > scheduled-proof.txt" } }],
        finishReason: "tool_calls" as const, model: model.model,
      };
      return collaborationResponder(model, request);
    };
    await withExpertApp(responder, async (app) => {
      await app.client.invoke("experts.seed", {} as never);
      await configureDefaultRoutes(app, { builder: route("scheduled-effect") });
      const now = Date.parse("2026-10-14T12:00:00.000Z");
      const experts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      const schedules = new SchedulesService(experts, () => now);
      const created = await schedules.command("schedule.save", {
        requestId: "readonly-side-effect-gate", target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "Write a marker so a human can approve the side effect", recurrence: { kind: "once", at: new Date(now).toISOString() }, misfire: "coalesce",
      }, LOCAL_OPERATOR) as { scheduleId: string };
      const evaluator = new ScheduleEvaluator(schedules, experts, { now: () => now });
      await evaluator.evaluate();
      let state = (await schedules.read(LOCAL_OPERATOR)).state;
      const occurrence = Object.values(state.occurrences).find((item) => item.scheduleId === created.scheduleId)!;
      const assignment = await waitForAssignment(app, occurrence.assignmentId!, (item) => !["queued", "running"].includes(item.status));
      expect(["waiting", "reconciliation-required"]).toContain(assignment.status);
      expect(assignment.mode).toBe("read-only");
      await expect(access(join(app.home, "workspace", "scheduled-proof.txt"))).rejects.toThrow();
      const events = [];
      for await (const event of app.app.runtime.service.events(LOCAL_OPERATOR, { runId: assignment.runId! })) events.push(event.eventType);
      expect(events).toContain("tool.approval.requested");
      await evaluator.evaluate();
      state = (await schedules.read(LOCAL_OPERATOR)).state;
      expect(state.occurrences[occurrence.id]!.status).toBe("waiting");
      expect(state.occurrences[occurrence.id]!.assignmentId).toBe(assignment.id);
    });
  }, 30000);

  test("a reserved due intent recovers after runtime restart and reuses one native Assignment identity", async () => {
    await withExpertApp(collaborationResponder, async (app) => {
      await app.client.invoke("experts.seed", {} as never);
      await configureDefaultRoutes(app);
      let now = Date.parse("2026-10-14T12:00:00.000Z");
      let experts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      let schedules = new SchedulesService(experts, () => now);
      const created = await schedules.command("schedule.save", {
        requestId: "recovery-schedule", target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "Recover this scheduled objective", recurrence: { kind: "once", at: "2026-10-14T12:00:02.000Z" }, misfire: "coalesce",
      }, LOCAL_OPERATOR) as { scheduleId: string };
      const beforeDue = new ScheduleEvaluator(schedules, experts, { now: () => now });
      await beforeDue.evaluate();
      expect(Object.values((await schedules.read(LOCAL_OPERATOR)).state.occurrences)).toHaveLength(0);
      now = Date.parse("2026-10-14T12:00:02.000Z");
      const stored = (await schedules.read(LOCAL_OPERATOR)).state.schedules[created.scheduleId]!;
      const reserved = await schedules.reserve(LOCAL_OPERATOR, stored, stored.nextDueAt!, null, false);
      await app.restart();
      experts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      schedules = new SchedulesService(experts, () => now);
      const evaluator = new ScheduleEvaluator(schedules, experts, { now: () => now });
      await evaluator.evaluate();
      const assignment = await waitForAssignment(app, reserved.assignmentId!, (item) => Boolean(item.runId));
      await evaluator.evaluate();
      await evaluator.evaluate();
      const state = (await schedules.read(LOCAL_OPERATOR)).state;
      expect(state.occurrences[reserved.id]).toMatchObject({ assignmentId: reserved.assignmentId, runId: assignment.runId });
      expect(["issued", "completed"]).toContain(state.occurrences[reserved.id]!.status);
      expect(Object.keys((await app.state()).assignments).filter((id) => id === reserved.assignmentId)).toHaveLength(1);
      expect(state.schedules[created.scheduleId]!.nextDueAt).toBeNull();
      expect((await app.app.runtime.service.getRun(LOCAL_OPERATOR, { runId: assignment.runId! })).correlationId).toBe("expert:" + reserved.assignmentId + ":1");
    });
  }, 30000);

  test("durable cancellation serializes against native creation and cancels the deterministic Assignment", async () => {
    await withExpertApp(collaborationResponder, async (app) => {
      await app.client.invoke("experts.seed", {} as never);
      await configureDefaultRoutes(app);
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const dispatchEntered = new Promise<void>((resolve) => { entered = resolve; });
      const base = app.app.runtime.service;
      const delayed = new Proxy(base, { get(target, key) {
        if (key === "invoke") return async (caller: Parameters<RuntimeService["invoke"]>[0], request: Parameters<RuntimeService["invoke"]>[1]) => {
          if (request.capability === "expert.converse") { entered(); await gate; }
          return target.invoke(caller, request);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } }) as RuntimeService;
      let now = Date.parse("2026-10-14T12:00:02.000Z");
      const experts = new ExpertsService(delayed, SYSTEM_CALLER);
      const schedules = new SchedulesService(experts, () => now);
      const created = await schedules.command("schedule.save", {
        requestId: "cancel-race", target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "This objective will be cancelled", recurrence: { kind: "once", at: "2026-10-14T12:00:01.000Z" }, misfire: "coalesce",
      }, LOCAL_OPERATOR) as { scheduleId: string };
      const evaluator = new ScheduleEvaluator(schedules, experts, { now: () => now });
      const dispatch = evaluator.evaluate();
      await dispatchEntered;
      let cancelled = false;
      const cancel = schedules.command("schedule.manage", { requestId: "cancel-after-reservation", scheduleId: created.scheduleId, action: "cancel" }, LOCAL_OPERATOR).then(() => { cancelled = true; });
      await Bun.sleep(10);
      expect(cancelled).toBe(false);
      release();
      await Promise.all([dispatch, cancel]);
      const state = (await schedules.read(LOCAL_OPERATOR)).state;
      const occurrence = Object.values(state.occurrences).find((item) => item.scheduleId === created.scheduleId)!;
      expect(state.schedules[created.scheduleId]!.lifecycle).toBe("cancelled");
      expect((await app.state()).assignments[occurrence.assignmentId!]?.status).toBe("cancelled");
      expect(occurrence.status).toBe("cancelled");
    });
  }, 30000);

  test("a killed evaluator before due is recovered by a fresh subprocess after due", async () => {
    await withExpertApp(collaborationResponder, async (app) => {
      await app.client.invoke("experts.seed", {} as never);
      await configureDefaultRoutes(app);
      const baseExperts = new ExpertsService(app.app.runtime.service, SYSTEM_CALLER);
      const dueAt = Date.now() + 4_000;
      const schedules = new SchedulesService(baseExperts, Date.now);
      const created = await schedules.command("schedule.save", {
        requestId: "subprocess-recovery", target: { kind: "expert", id: "builder" }, workspaceId: app.workspaceId,
        objective: "Recover after the evaluator process is killed", recurrence: { kind: "once", at: new Date(dueAt).toISOString() }, misfire: "coalesce",
      }, LOCAL_OPERATOR) as { scheduleId: string };
      await app.client.close();
      await app.app.stop();

      const source = `
        import { startServer } from "./src/server.ts";
        import { ExpertsService } from "./src/experts/service.ts";
        import { SchedulesService } from "./src/schedules/service.ts";
        const home = ${JSON.stringify(app.home)};
        const system = { actor: { id: "system", kind: "system" }, tenant: "local" };
        const app = await startServer({ port: 0, home, expertProviderFactory: (route) => ({
          id: route.providerId, model: route.model,
          features: { generate: true, stream: false, tool_use: true, structured_output: false, multimodal_input: false, context_limit: 32000 },
          async generate() { return { message: { role: "assistant", content: "Recovered" }, toolCalls: [], finishReason: "stop", model: route.model }; },
          async *stream() {},
        }) });
        const experts = new ExpertsService(app.runtime.service, system);
        const schedules = new SchedulesService(experts);
        process.stdout.write("SIGNAL:READY\\n");
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          const state = (await schedules.read(system)).state;
          const occurrence = Object.values(state.occurrences).find((item) => item.scheduleId === ${JSON.stringify(created.scheduleId)});
          const expertState = await experts.state(system.tenant);
          const assignment = occurrence?.assignmentId ? expertState.assignments[occurrence.assignmentId] : undefined;
          if (occurrence && assignment?.runId && ["completed", "failed"].includes(occurrence.status)) {
            const run = await app.runtime.service.getRun(system, { runId: assignment.runId });
            process.stdout.write("SIGNAL:DISPATCHED:" + JSON.stringify({ status: occurrence.status, occurrenceId: occurrence.id, assignmentId: assignment.id, runId: assignment.runId, correlationId: run.correlationId }) + "\\n");
            break;
          }
          await Bun.sleep(20);
        }
        await new Promise(() => {});
      `;
      const child = () => Bun.spawn(["bun", "-e", source], { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
      const watch = (processHandle: ReturnType<typeof Bun.spawn>) => {
        const lines: string[] = [];
        const waiters: { prefix: string; resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
        let stderr = "";
        void (async () => {
          const stream = processHandle.stderr;
          if (!stream || typeof stream === "number") return;
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              stderr = (stderr + decoder.decode(value, { stream: true })).slice(-16_000);
            }
          } catch { /* process termination closes stderr */ }
        })();
        void (async () => {
          const stream = processHandle.stdout;
          if (!stream || typeof stream === "number") throw new Error("Subprocess stdout was not piped");
          const reader = stream.getReader();
          const decoder = new TextDecoder();
          let remainder = "";
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              remainder += decoder.decode(value, { stream: true });
              const split = remainder.split("\n"); remainder = split.pop() ?? "";
              for (const line of split) {
                lines.push(line);
                for (const waiter of [...waiters]) if (line.startsWith(waiter.prefix)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(line); }
              }
            }
          } catch { /* process termination closes the pipe */ }
          for (const waiter of waiters.splice(0)) waiter.reject(new Error("Schedule subprocess exited before its signal. stderr: " + stderr));
        })();
        return {
          lines,
          waitFor(prefix: string) {
            const existing = lines.find((line) => line.startsWith(prefix));
            if (existing) return Promise.resolve(existing);
            return new Promise<string>((resolve, reject) => {
              const waiter = { prefix, resolve, reject };
              waiters.push(waiter);
              setTimeout(() => {
                const index = waiters.indexOf(waiter);
                if (index >= 0) { waiters.splice(index, 1); reject(new Error(`Timed out waiting for ${prefix}. stderr: ${stderr}`)); }
              }, 25_000).unref?.();
            });
          },
        };
      };

      const first = child();
      const firstWatch = watch(first);
      try {
        await firstWatch.waitFor("SIGNAL:READY");
        expect(Date.now()).toBeLessThan(dueAt);
        first.kill("SIGKILL");
        await first.exited;
        await Bun.sleep(Math.max(0, dueAt - Date.now() + 50));
        const restarted = child();
        const restartedWatch = watch(restarted);
        try {
          await restartedWatch.waitFor("SIGNAL:READY");
          const dispatched = JSON.parse((await restartedWatch.waitFor("SIGNAL:DISPATCHED:")).slice("SIGNAL:DISPATCHED:".length)) as { status: string; occurrenceId: string; assignmentId: string; runId: string; correlationId: string };
          expect(dispatched.status).toBe("completed");
          expect(dispatched.occurrenceId).toContain("schedule-occ-");
          expect(dispatched.assignmentId).toContain("schedule-assignment-");
          expect(dispatched.runId).toBeTruthy();
          expect(dispatched.correlationId).toBe("expert:" + dispatched.assignmentId + ":1");
        } finally {
          restarted.kill("SIGKILL");
          await restarted.exited;
        }
      } finally {
        first.kill("SIGKILL");
        await first.exited;
      }
    });
  }, 30000);
});
