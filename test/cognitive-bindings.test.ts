import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { allowCapabilities, type Component, type SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Json } from "@godspeedai/cognate-events";
import { createExecutionWorldRegistry, localExecutionWorld } from "@godspeedai/cognate-execution";
import { createRuntime, type Runtime } from "@godspeedai/cognate-runtime-bun";
import type { AgentDefinition } from "@godspeedai/cognate-runtime-api";
import { bindCognitiveCapabilities, COGNITIVE_CAPABILITY_ANCHORS, loadDomain } from "../domain/index.ts";
import { cognitiveComponent } from "../src/capabilities/cognitive.ts";
const caller = { actor: { id: "operator", kind: "user" as const }, tenant: "local" };

const CAPABILITY_IDS = [
  "case.open", "criterion.freeze", "world.freeze", "world.fork", "world.attach", "world.discard",
  "verification.run", "case.derive", "world.settle", "risk.assess", "case.observe", "ui.focus.publish",
  "ui.context", "ui.request", "ui.pending", "experiment.round", "experiment.status", "method.review",
  "method.accept", "method.active",
];

describe("cognitive semantic bindings", () => {
  test("binds all 20 published contracts to declared IDM concepts", async () => {
    const domain = await loadDomain();
    const refs = bindCognitiveCapabilities(domain);
    expect(Object.keys(COGNITIVE_CAPABILITY_ANCHORS).sort()).toEqual([...CAPABILITY_IDS].sort());
    expect(Object.keys(refs).sort()).toEqual([...CAPABILITY_IDS].sort());
    for (const [capability, concept] of Object.entries(COGNITIVE_CAPABILITY_ANCHORS)) {
      expect(refs[capability]!.id).toBe(domain.semanticId(concept));
    }

    const component = cognitiveComponent({
      getService: () => { throw new Error("not activated in contract test"); },
      systemCaller: caller,
      registry: {} as never,
      semanticRefs: refs,
    });
    expect(component.provides).toHaveLength(20);
    expect(component.provides?.map((contract) => contract.id).sort()).toEqual([...CAPABILITY_IDS].sort());
    for (const contract of component.provides ?? []) {
      expect(contract.semanticRef).toEqual(refs[contract.id]);
    }

    const fallback: SemanticRef = {
      namespace: "test",
      id: "test::legacy-cognitive-anchor",
      source: { uri: "test", digest: "test" },
      projectionVersion: "test",
    };
    const legacy = cognitiveComponent({
      getService: () => { throw new Error("not activated in compatibility test"); },
      systemCaller: caller,
      registry: {} as never,
      semanticRef: fallback,
    });
    expect(legacy.provides?.every((contract) => contract.semanticRef === fallback)).toBe(true);
  });

  test("J-COG-attention records the bound ref on a real run invocation", async () => {
    const refs = bindCognitiveCapabilities(await loadDomain());
    const dependencyContracts = ["filesystem.resolve", "filesystem.readText", "filesystem.list", "process.exec"].map((id) => ({ id, version: "1.0.0" }));
    const [resolveContract, readContract, listContract, execContract] = dependencyContracts;
    const calls: Component = {
      id: "test:cognitive-dependencies",
      provides: dependencyContracts,
      activate(fiber) {
        fiber.provide(resolveContract!, async (input) => ({ path: String((input as { path?: unknown }).path ?? ".") }));
        fiber.provide(readContract!, async () => ({ content: "" }));
        fiber.provide(listContract!, async () => ({ entries: [] }));
        fiber.provide(execContract!, async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }));
      },
    };
    const attentionAgent: AgentDefinition = {
      id: "test.cognitive-attention",
      version: "1.0.0",
      async run(_input, context) {
        return await context.invoke("ui.context", {}) as Json;
      },
    };
    let runtime: Runtime | undefined;
    const component = cognitiveComponent({
      getService: () => {
        if (!runtime) throw new Error("runtime not initialized");
        return runtime.service;
      },
      systemCaller: caller,
      registry: createExecutionWorldRegistry([localExecutionWorld()]),
      semanticRefs: refs,
    });
    runtime = await createRuntime({
      store: ":memory:",
      policy: allowCapabilities("cognitive-binding-test", ["ui.focus.publish", "ui.context"]),
      actions: { authorize: () => ({ allow: true, reason: "test" }) },
      agents: [attentionAgent],
      components: [calls, component],
    });

    try {
      await runtime.service.invoke(caller, { capability: "ui.focus.publish", input: { focus: { ref: "evidence:1", caseId: "BINDING-1" } } });
      const started = await runtime.service.startRun(caller, {
        agent: attentionAgent.id,
        input: {},
        idempotencyKey: randomUUID(),
      });
      for (let i = 0; i < 200; i++) {
        const state = await runtime.service.getRun(caller, { runId: started.runId });
        if (state.status === "completed") break;
        if (state.status === "failed" || state.status === "cancelled") throw new Error(`attention run ended ${state.status}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect((await runtime.service.getRun(caller, { runId: started.runId })).status).toBe("completed");
      const invocations = [];
      for await (const event of runtime.service.events(caller, { runId: started.runId })) {
        if (event.eventType === "run.invocation" && (event.metadata as { capability?: string }).capability === "ui.context") invocations.push(event);
      }
      expect(invocations).toHaveLength(1);
      expect(invocations[0]!.semanticRef).toEqual(refs["ui.context"]);
      expect((invocations[0]!.payload as { result?: { focused?: boolean } }).result?.focused).toBe(true);
    } finally {
      await runtime.close();
    }
  }, 120_000);
});
