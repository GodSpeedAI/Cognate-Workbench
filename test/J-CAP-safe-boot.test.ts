import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";
import { bootApp, enableCapabilityRuntime, withTempHome } from "./wb-helpers.ts";

test("durable safe-mode exclusion blocks bundle activation before mount after restart", async () => {
  await withTempHome(async (home) => {
    const first = await bootApp(home);
    try {
      await enableCapabilityRuntime(first.app, first.client);
      const source = join(home, "bundle-src", "safe-mode-test");
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "SKILL.md"), "# Safe mode test\n");
      await first.client.invoke("capability.bundle.register", {
        capabilityId: "capability.bundle.safe-mode-test", sourceDir: source,
        manifest: { name: "Safe mode test", purpose: "test", skills: [{ name: "test", entry: "SKILL.md" }], requirements: ["capability.invoke", "skill.load"] },
      });
      await new LifecycleRecorder(first.app.runtime.store, "local").commitBatch("safemode", [{ type: "capability.presentation.faulted", payload: { fragmentKey: "test", capabilityId: "test", faultClass: "core-violation" } }]);
    } finally { await first.app.runtime.idle().catch(() => {}); await first.app.stop(); }
    let mounts = 0;
    const second = await bootApp(home, { capabilityRuntimeHooks: { beforeMount: () => { mounts++; } } });
    try {
      // The grant list waits for authority-index readiness without attempting a mount.
      await second.client.invoke("authority.grant.list", {});
      await new LifecycleRecorder(second.app.runtime.store, "local").commitBatch("test-root-grant", [{ type: "authority.grant.issued", payload: { grantId: "test-root-grant", principalId: "wb-operator:root", permissions: ["*"] } }]);
      expect(await second.client.invoke("authority.grant.list", {})).toMatchObject({ grants: expect.arrayContaining([expect.objectContaining({ grantId: "test-root-grant" })]) });
      await expect(second.client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.safe-mode-test" })).rejects.toThrow(/safe.mode/i);
      expect(mounts).toBe(0);
      expect(await second.client.invoke("workbench.safemode.status", {})).toMatchObject({ safe: true, reason: "core-violation" });
      const agent = { actor: { id: "wb-agent:probe", kind: "agent" as const }, tenant: "local" };
      await expect(second.app.runtime.service.invoke(agent, { capability: "workbench.safemode.clear", input: {} })).rejects.toMatchObject({ code: "permission_denied" });
      const refusalEvents = await second.app.runtime.store.readStream("wb-lifecycle:safemode");
      expect(refusalEvents.some((event) => event.eventType === "workbench.safemode.cleared")).toBe(false);
      expect(refusalEvents.find((event) => event.eventType === "capability.presentation.faulted" && (event.payload as { faultClass?: string }).faultClass === "unauthorized-clear")?.payload).toMatchObject({ fragmentKey: "clear:wb-agent:probe" });
      await second.client.invoke("workbench.safemode.clear", {});
      expect(await second.client.invoke("workbench.safemode.status", {})).toMatchObject({ safe: false, reason: "none" });
      expect((await second.app.runtime.store.readStream("wb-lifecycle:safemode")).filter((e) => e.eventType === "workbench.safemode.cleared")).toHaveLength(1);
      await second.client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.safe-mode-test" });
      expect(mounts).toBe(1);
    } finally { await second.app.runtime.idle().catch(() => {}); await second.app.stop(); }
  });
}, 60000);
