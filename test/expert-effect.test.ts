import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@godspeedai/cognate-store-memory";
import type { CapabilityHandler, Component, HandlerContext } from "@godspeedai/cognate-kernel-api";
import type { Runtime } from "@godspeedai/cognate-runtime-bun";
import type { ExpertsService } from "../src/experts/service.ts";
import { emptyExpertState, type ExpertState, type Assignment, type ExpertTool } from "../src/experts/types.ts";
import { expertEffectComponent, ExpertEffectReconciliationRequired, type ExpertToolInvokeInput } from "../src/capabilities/expertEffect.ts";

function harness(options: { readonly failAfterEffect?: boolean; readonly allowedTools?: readonly string[] } = {}) {
  const store = createMemoryStore();
  const controller = new AbortController();
  let effects = 0;
  let assignment: Assignment = {
    id: "assignment-1", expertId: "builder", conversationId: "conversation-1", teamId: "team-1", parentId: "parent-1",
    purpose: "write the requested file", acceptance: ["file changed"], depth: 1, attempt: 1, status: "running", workspaceId: "workspace-1", mode: "workspace-write",
    authorityTools: [...(options.allowedTools ?? ["edit"])] as ExpertTool[],
    execution: { expertId: "builder", assignmentId: "assignment-1", conversationId: "conversation-1", teamId: "team-1", instructions: "", route: { providerId: "fake", model: "fake", baseURL: "https://example.invalid", protocol: "openai-compatible" }, tools: [...(options.allowedTools ?? ["edit"])] as ExpertTool[], maxSteps: 4, context: [] },
    runId: "run-1", handoff: null, reconciled: false, review: null, settlement: null, effects: {},
  };
  const runtime = {
    store,
    kernel: {
      resolve({ capability }: { capability: string }) {
        return { async invoke(input: unknown, ctx: { signal: AbortSignal }) {
          if (ctx.signal.aborted) return { ok: false, failure: { kind: "cancelled" } };
          effects++;
          if (options.failAfterEffect) return { ok: false, failure: { kind: "failed" } };
          return { ok: true, value: { capability, input, committed: true } };
        } };
      },
    },
  } as unknown as Runtime;
  const registry=emptyExpertState();
  registry.conversations[assignment.conversationId]={id:assignment.conversationId,scope:"team",expertId:null,teamId:"team-1",workspaceId:"workspace-1",title:"Effects",messageIds:[],assignmentIds:[assignment.id]};
  const experts = {
    systemCaller: { tenant: "tenant-1", actor: { id: "system", kind: "system" } },
    caller(tenant: string) { return { tenant, actor: { id: "system", kind: "system" } }; },
    async invocation(_ctx: HandlerContext, assignmentId: unknown) {
      if (assignmentId !== assignment.id) throw new Error("Assignment impersonation denied");
      if (assignment.status !== "running" || assignment.runId !== "run-1") throw new Error("Assignment is not authorized");
      return structuredClone(assignment);
    },
    async mutate(_tenant: string, _id: string, _command: unknown, fn: (state: ExpertState) => unknown) {
      const state = {...registry, assignments: { [assignment.id]: assignment } };
      const result = fn(state);
      assignment = state.assignments[assignment.id]!;
      return result;
    },
    async state() { return { assignments: { [assignment.id]: structuredClone(assignment) } }; },
  } as unknown as ExpertsService;
  let handlers: Record<string, (input: unknown, ctx: HandlerContext) => Promise<unknown>> = {};
  const remount = () => {
    handlers = {};
    const component: Component = expertEffectComponent({ getRuntime: () => runtime, getExperts: () => experts });
    component.activate({ provide(contract: { id: string }, implementation: CapabilityHandler) { handlers[contract.id] = implementation as (input: unknown, ctx: HandlerContext) => Promise<unknown>; } } as never);
  };
  remount();
  const context = {
    runId: "run-1", tenant: "tenant-1", scopeId: "scope-1", correlationId: "expert:assignment-1:1", causationId: "event-1",
    actor: { id: "system", kind: "system" }, signal: controller.signal,
  } as HandlerContext;
  const humanContext = { ...context, runId: undefined, actor: { id: "operator", kind: "user" }, capability: { id: "expert.effect.resolve", version: "1.0.0" } } as unknown as HandlerContext;
  const input: ExpertToolInvokeInput = {
    assignmentId: "assignment-1", toolCallId: "expert:0:0", tool: "edit",
    input: { workspaceRoot: "/work", executionWorldId: "local", file_path: "README.md", old_string: "before", new_string: "after" },
  };
  return {
    invoke: (value: unknown = input) => handlers["expert.tool.invoke"]!(value, context),
    resolve: (value: unknown) => handlers["expert.effect.resolve"]!(value, humanContext),
    remount,
    controller,
    setEffectState(toolCallId: string, state: string) {
      const effect = assignment.effects?.[toolCallId];
      if (effect) assignment.effects![toolCallId] = { ...effect, state };
    },
    clearEffects() { assignment.effects = {}; },
    get effects() { return effects; },
    get assignment() { return structuredClone(assignment); },
  };
}

describe("Expert effect replay guard", () => {
  test("returns the durable result on replay without executing the native tool twice", async () => {
    const h = harness();
    const first = await h.invoke();
    const replay = await h.invoke();
    expect(first).toEqual(replay);
    expect(h.effects).toBe(1);
    expect(Object.values(h.assignment.effects ?? {}).map((effect) => effect.state)).toEqual(["SUCCEEDED"]);
  });

  test("repairs a stale Assignment status from the committed native result", async () => {
    const h = harness();
    const first = await h.invoke();
    h.setEffectState("1:expert:0:0", "DISPATCHING");
    h.remount();
    const recovered = await h.invoke();
    expect(recovered).toEqual(first);
    expect(h.effects).toBe(1);
    expect(Object.values(h.assignment.effects ?? {}).map((effect) => effect.state)).toEqual(["SUCCEEDED"]);
  });

  test("recovers a native commitment when the registry missed its final event before restart", async () => {
    const h = harness();
    const first = await h.invoke();
    h.clearEffects();
    h.remount();
    const recovered = await h.invoke();
    expect(recovered).toEqual(first);
    expect(h.effects).toBe(1);
    expect(Object.values(h.assignment.effects ?? {}).map((effect) => effect.state)).toEqual(["SUCCEEDED"]);
  });

  test("accepts JSONB-style key reordering while still rejecting changed effect values", async () => {
    const h = harness();
    const first = await h.invoke();
    const reordered = {
      assignmentId: "assignment-1", toolCallId: "expert:0:0", tool: "edit",
      input: { new_string: "after", old_string: "before", file_path: "README.md", executionWorldId: "local", workspaceRoot: "/work" },
    };
    expect(await h.invoke(reordered)).toEqual(first);
    expect(h.effects).toBe(1);
  });

  test("a lost response after an effect becomes unknown and is never redelivered", async () => {
    const h = harness({ failAfterEffect: true });
    await expect(h.invoke()).rejects.toBeInstanceOf(ExpertEffectReconciliationRequired);
    await expect(h.invoke()).rejects.toBeInstanceOf(ExpertEffectReconciliationRequired);
    expect(h.effects).toBe(1);
    expect(Object.values(h.assignment.effects ?? {}).map((effect) => effect.state)).toContain("UNKNOWN_RECONCILIATION_REQUIRED");
  });

  test("rejects reuse of a stable effect identity for different arguments", async () => {
    const h = harness();
    await h.invoke();
    const altered = {
      assignmentId: "assignment-1", toolCallId: "expert:0:0", tool: "edit",
      input: { workspaceRoot: "/work", executionWorldId: "local", file_path: "README.md", old_string: "after", new_string: "different" },
    };
    await expect(h.invoke(altered)).rejects.toThrow("different effect input");
    expect(h.effects).toBe(1);
  });

  test("rejects a tool outside the frozen assignment allowlist before dispatch", async () => {
    const h = harness({ allowedTools: ["bash"] });
    const denied = { assignmentId: "assignment-1", toolCallId: "expert:0:0", tool: "edit", input: { workspaceRoot: "/work" } };
    await expect(h.invoke(denied)).rejects.toThrow("does not authorize edit");
    expect(h.effects).toBe(0);
  });

  test("human resolution closes an ambiguous effect without replaying it", async () => {
    const h = harness({ failAfterEffect: true });
    await expect(h.invoke()).rejects.toBeInstanceOf(ExpertEffectReconciliationRequired);
    const effect = Object.entries(h.assignment.effects ?? {})[0]!;
    const resolved = await h.resolve({ assignmentId: "assignment-1", toolCallId: effect[0], outcome: "failed", reason: "Verified the requested file did not change" });
    expect((resolved as { state: string }).state).toBe("FAILED");
    expect(h.effects).toBe(1);
    expect(Object.values(h.assignment.effects ?? {}).map((item) => item.state)).toEqual(["FAILED"]);
    expect(Object.values(h.assignment.effects ?? {})[0]?.resolvedBy).toBe("operator");
    expect((await h.resolve({assignmentId:"assignment-1",toolCallId:effect[0],outcome:"failed",reason:"Verified the requested file did not change"}) as {state:string}).state).toBe("FAILED");
  });

  test("propagates cancellation to the native tool lease and never replays the cancelled call", async () => {
    const h = harness();
    h.controller.abort(new Error("operator cancelled"));
    await expect(h.invoke()).rejects.toBeInstanceOf(ExpertEffectReconciliationRequired);
    expect(h.effects).toBe(0);
  });
});
