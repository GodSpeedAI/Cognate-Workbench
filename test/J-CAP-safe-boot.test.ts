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
    } finally { await second.app.runtime.idle().catch(() => {}); await second.app.stop(); }
  });
}, 60000);
