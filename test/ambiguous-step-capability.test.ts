// Unit coverage for run.invocation.reconcile resolution shapes, including the non-model "succeeded"
// path the journey cannot reach (its interrupted step is a model call).
import { expect, test } from "bun:test";
import { ambiguousStepComponent, interruptedCapability, isModelGeneration } from "../src/capabilities/ambiguousStep.ts";

type Resolution = { continuationId: string; action: string; input: unknown; idempotencyKey: string };

function harness(capability: string, status = "OPEN") {
  const resolutions: Resolution[] = [];
  const service = {
    listContinuations: async () => [{ id: "c1", runId: "r1", type: "ambiguous-invocation", status, version: 3, payload: { capability, stepId: "s1", priorGeneration: 1 } }],
    resolveContinuation: async (_caller: unknown, input: Resolution) => { resolutions.push(input); return { outcome: "resumed" }; },
  };
  let handler: ((raw: unknown, ctx: unknown) => Promise<unknown>) | undefined;
  ambiguousStepComponent({ getService: () => service as never }).activate!({ provide: (_c: unknown, h: typeof handler) => { handler = h; } } as never);
  const operator = { actor: { id: "operator", kind: "user" }, tenant: "local" };
  return { call: (input: unknown, ctx: unknown = operator) => handler!(input, ctx), resolutions };
}

test("a tool step confirmed as succeeded resumes with the operator's recorded observation", async () => {
  const h = harness("tool.bash");
  await expect(h.call({ continuationId: "c1", outcome: "succeeded", reason: "The deploy log shows it ran." })).resolves.toMatchObject({ runId: "r1", outcome: "succeeded" });
  expect(h.resolutions).toHaveLength(1);
  expect(h.resolutions[0]).toMatchObject({ continuationId: "c1", action: "resume", idempotencyKey: "ambiguous-reconcile:c1" });
  expect(h.resolutions[0]!.input).toEqual({ result: { reconciled: true, outcome: "succeeded", reason: "The deploy log shows it ran.", reconciledBy: "operator" } });
});

test("a step recorded as failed resumes with a failure, never a repeat", async () => {
  const h = harness("tool.bash");
  await h.call({ continuationId: "c1", outcome: "failed", reason: "Nothing changed on the target." });
  expect(h.resolutions[0]!.input).toEqual({ failure: { kind: "operator_reconciled_failure", message: "Nothing changed on the target." } });
});

test("a model call cannot be confirmed as succeeded; failed is accepted", async () => {
  for (const capability of ["model.generate", "expert.model.generate"]) {
    const h = harness(capability);
    await expect(h.call({ continuationId: "c1", outcome: "succeeded", reason: "looks fine" })).rejects.toThrow("cannot be confirmed as succeeded");
    expect(h.resolutions).toHaveLength(0);
    await expect(h.call({ continuationId: "c1", outcome: "failed", reason: "retry it" })).resolves.toMatchObject({ outcome: "failed" });
  }
});

test("agents, run-scoped callers and already-resolved continuations are refused", async () => {
  await expect(harness("tool.bash").call({ continuationId: "c1", outcome: "failed", reason: "x" }, { actor: { id: "a", kind: "agent" }, tenant: "local" })).rejects.toThrow("Only a direct human operator");
  await expect(harness("tool.bash").call({ continuationId: "c1", outcome: "failed", reason: "x" }, { actor: { id: "operator", kind: "user" }, tenant: "local", runId: "r9" })).rejects.toThrow("Only a direct human operator");
  await expect(harness("tool.bash", "RESUMED").call({ continuationId: "c1", outcome: "failed", reason: "x" })).rejects.toThrow("already resumed");
});

test("capability helpers", () => {
  expect(interruptedCapability({ payload: { capability: "tool.edit" } })).toBe("tool.edit");
  expect(interruptedCapability({ payload: {}, condition: { capability: "model.generate" } })).toBe("model.generate");
  expect(interruptedCapability({})).toBeUndefined();
  expect(isModelGeneration("expert.model.generate")).toBe(true);
  expect(isModelGeneration("tool.bash")).toBe(false);
  expect(isModelGeneration(undefined)).toBe(false);
});
