import { expect, test } from "bun:test";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, withTempHome } from "./wb-helpers.ts";

test("expert recovery remains operator-only while safe mode is active", async () => {
  await withTempHome(async (home) => {
    const first = await bootApp(home);
    try {
      await new LifecycleRecorder(first.app.runtime.store, "local").commitBatch("safemode", [{ type: "capability.presentation.faulted", payload: { fragmentKey: "test", capabilityId: "test", faultClass: "core-violation" } }]);
    } finally { await first.app.runtime.idle().catch(() => {}); await first.client.close(); await first.app.stop(); }
    const second = await bootApp(home);
    try {
      expect(await second.client.invoke("workbench.safemode.status", {})).toMatchObject({ safe: true });
      const agent = { actor: { id: "wb-agent:probe", kind: "agent" as const }, tenant: "local" };
      await expect(second.app.runtime.service.invoke(agent, { capability: "experts.restore", input: {} })).rejects.toThrow(/human operator/);
      const experts = new ExpertsService(second.app.runtime.service, LOCAL_OPERATOR);
      await expect(experts.command("experts.restore", {}, { actor: { id: "operator", kind: "user" }, tenant: LOCAL_OPERATOR.tenant, runId: "run-1" } as never)).rejects.toThrow(/inside a run/);
      const result = await second.client.invoke("experts.restore", {}) as { kept: string[] };
      expect(result.kept).toContain("cognate-team");
      expect(await second.client.invoke("workbench.safemode.status", {})).toMatchObject({ safe: true });
    } finally { await second.app.runtime.idle().catch(() => {}); await second.client.close(); await second.app.stop(); }
  });
}, 60000);
