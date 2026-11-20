import { expect, test } from "bun:test";
import { allowCapabilities } from "@godspeedai/cognate-kernel-api";
import { createRuntime, type Runtime } from "@godspeedai/cognate-runtime-bun";
import { capabilityBundlesComponent } from "../src/capabilities/capabilityBundles.ts";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";
import { readBootExclusion, SafeModeController } from "../src/workbench/safeMode.ts";

const operator = { actor: { id: "operator", kind: "user" as const }, tenant: "local" };

test("safe-mode control follows the real runtime operator guard and durable state", async () => {
  let runtime: Runtime;
  let controller: SafeModeController;
  const component = capabilityBundlesComponent({
    home: "/unused", tenant: "local", getService: () => runtime.service,
    lifecycleRecorder: () => new LifecycleRecorder(runtime.store, "local"),
    authorityIndex: () => { throw new Error("unused"); }, safeMode: () => controller,
  });
  runtime = await createRuntime({
    store: ":memory:",
    policy: allowCapabilities("test", ["workbench.safemode.status", "workbench.safemode.clear"]),
    actions: { authorize: () => ({ allow: true, reason: "test" }) },
    components: [component],
    agents: [],
  });
  try {
    await new LifecycleRecorder(runtime.store, "local").commitBatch("safemode", [{ type: "capability.presentation.faulted", payload: { fragmentKey: "core", capabilityId: "core", faultClass: "core-violation" } }]);
    controller = new SafeModeController(runtime.store, "local", await readBootExclusion(runtime.store, []), []);
    const invoke = (caller: typeof operator | { actor: { id: string; kind: "agent" }; tenant: string }, capability: string) => runtime.service.invoke(caller, { capability, input: {} });
    expect(await invoke(operator, "workbench.safemode.status")).toMatchObject({ safe: true, reason: "core-violation", canClear: true });
    const agent = { actor: { id: "agent", kind: "agent" as const }, tenant: "local" };
    expect(await invoke(agent, "workbench.safemode.status")).toMatchObject({ safe: true, canClear: false });
    await expect(invoke(agent, "workbench.safemode.clear")).rejects.toThrow(/direct operator/);
    const refusedEvents = await runtime.store.readStream("wb-lifecycle:safemode");
    expect(refusedEvents.filter((e) => e.eventType === "workbench.safemode.cleared")).toHaveLength(0);
    expect(refusedEvents.filter((e) => e.eventType === "capability.presentation.faulted" && (e.payload as { faultClass?: string }).faultClass === "unauthorized-clear")).toHaveLength(1);
    expect(await invoke(operator, "workbench.safemode.clear")).toMatchObject({ ok: true });
    expect(controller.read()).toMatchObject({ safe: false, reason: "none" });
    expect((await runtime.store.readStream("wb-lifecycle:safemode")).filter((e) => e.eventType === "workbench.safemode.cleared")).toHaveLength(1);
  } finally { await runtime.close(); }
});


test("safe-mode clear refuses a user identity inherited by an agent run", async () => {
  const handlers = new Map<string, (input: unknown, ctx: unknown) => Promise<unknown>>();
  const component = capabilityBundlesComponent({
    home: "/unused", tenant: "local", getService: () => { throw new Error("unused"); },
    lifecycleRecorder: () => { throw new Error("unused"); }, authorityIndex: () => { throw new Error("unused"); },
    safeMode: () => ({ read: () => ({ safe: true, reason: "core-violation" }) }) as SafeModeController,
  });
  component.activate({ provide: (contract: { id: string }, handler: (input: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(contract.id, handler) } as never);
  const context = { actor: operator.actor, runId: "run-1" };
  expect(await handlers.get("workbench.safemode.status")!({}, context)).toMatchObject({ safe: true, canClear: false });
  await expect(handlers.get("workbench.safemode.clear")!({}, context)).rejects.toThrow(/direct operator/);
});


test("safe-mode capabilities use the capability bundle semantic binding", async () => {
  const { bindCapabilityRuntime, loadDomain } = await import("../domain/index.ts");
  const domain = await loadDomain();
  const refs = bindCapabilityRuntime(domain);
  const component = capabilityBundlesComponent({
    home: "/unused", tenant: "local", getService: () => { throw new Error("unused"); },
    lifecycleRecorder: () => { throw new Error("unused"); }, authorityIndex: () => { throw new Error("unused"); }, semanticRefs: refs,
  });
  for (const id of ["workbench.safemode.status", "workbench.safemode.clear"]) {
    expect(refs[id]?.id).toBe(domain.semanticId("CapabilityBundle"));
    expect(component.provides?.find((contract) => contract.id === id)?.semanticRef).toEqual(refs[id]);
  }
});
