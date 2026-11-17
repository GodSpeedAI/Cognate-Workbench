// Journey J-CAP-reload (capability-bundles T2, design §4.2.6/§4.3; CUJs 2 and 13): a skill is
// modified through the governed re-hash (a fresh registration → a NEW immutable version
// directory), the activation repoints, in-flight calls finish on their dispatch-time snapshot,
// and a failed replacement never repoints — version 1 stays executable, hash-valid and named.
import { describe, expect, test } from "bun:test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";
import { verifyBundleIntegrity } from "../src/capabilities/skillLoader.ts";
import { allEvents, bootApp, enableCapabilityRuntime, registerBundle, waitForRow, waitUntil, wbRows, withTempHome, type Client } from "./wb-helpers.ts";

const CAP = "capability.bundle.reload-demo";
const manifest = { name: "Reload Demo", purpose: "versioned reload", skills: [{ name: "guide", entry: "GUIDE.md", isEntryDocument: true }], requirements: ["capability.invoke", "skill.load"] };

async function author(home: string, label: string, text: string): Promise<string> {
  const dir = join(home, "authoring", label);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "GUIDE.md"), text);
  return dir;
}
const load = (client: Client) => client.invoke("tool.skill_load", { capabilityId: CAP, skillId: "guide" }) as Promise<{ ok: boolean; version?: string; result?: { content: string }; code?: string }>;
const eventsOfType = async (app: AppServer, type: string) => (await allEvents(app)).filter((e) => e.eventType === type);

describe("J-CAP-reload", () => {
  test("CUJ 2: repoint serves the next call from v2 while an in-flight v1 call completes under its snapshot", async () => {
    await withTempHome(async (home) => {
      let holdVersion: string | undefined;
      let entered!: () => void;
      const enteredP = new Promise<void>((resolve) => { entered = resolve; });
      let release!: () => void;
      const releaseP = new Promise<void>((resolve) => { release = resolve; });
      const { app, client } = await bootApp(home, {
        capabilityRuntimeHooks: {
          beforeInterpret: async ({ version }) => {
            if (holdVersion && version === holdVersion) { holdVersion = undefined; entered(); await releaseP; }
          },
        },
      });
      try {
        await enableCapabilityRuntime(app, client);
        const v1 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "v1", "# Guide v1"), manifest });
        await client.invoke("capability.bundle.activate", { capabilityId: CAP });
        await waitForRow(app, `activation/${CAP}/user`);
        const first = await load(client);
        expect(first.ok).toBe(true);
        expect(first.result?.content).toContain("v1");

        // The governed re-hash: a fresh registration materializes a NEW immutable directory.
        const v2 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "v2", "# Guide v2"), manifest });
        expect(v2.version).not.toBe(v1.version);
        expect(v2.dir).not.toBe(v1.dir);

        // Hold a v1 call in flight, then reload.
        holdVersion = v1.version;
        let settled = false;
        const inFlight = load(client).then((r) => { settled = true; return r; });
        await enteredP;
        const repointed = await client.invoke("capability.bundle.activate", { capabilityId: CAP }) as { version: string; repointedFrom?: string };
        expect(repointed.version).toBe(v2.version);
        expect(repointed.repointedFrom).toBe(v1.version);

        // §4.2.6/CUJ 2: the `repointed` commit precedes the old-version call's completion.
        expect(settled).toBe(false);
        expect((await eventsOfType(app, "capability.repointed")).length).toBe(1);
        // The next dispatch-committed call observes v2 without losing the session.
        const next = await load(client);
        expect(next.version).toBe(v2.version);
        expect(next.result?.content).toContain("v2");

        release();
        const old = await inFlight;
        expect(old.ok).toBe(true);
        expect(old.version).toBe(v1.version);
        expect(old.result?.content).toContain("v1");

        // The fold re-pointed the row, retired the old binding, and v1's directory is untouched.
        const row = await waitForRow<{ version: string }>(app, `activation/${CAP}/user`, (r) => r.version === v2.version);
        expect(row.version).toBe(v2.version);
        const retired = await waitForRow<{ versions: string[] }>(app, `binding-retired/${CAP}`);
        expect(retired.versions).toContain(v1.version);
        expect(await verifyBundleIntegrity(v1.dir, v1.version, (await waitForRow<{ manifest: unknown }>(app, `bundle-version/${CAP}/${v1.version}`)).manifest)).toBe(true);
        expect((await readdir(join(home, "bundles", CAP))).sort()).toEqual([v1.version, v2.version].sort());
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 90000);

  describe("CUJ 13: failed replacement never repoints", () => {
    const failedRepointRows = async (app: AppServer) => [...(await wbRows(app))].filter(([k]) => k.startsWith("fault/capability.repoint_failed/")).map(([, v]) => v as { reason: string });

    test("mount failure: v1 stays active, no partial mount, failure recorded as repoint_failed", async () => {
      await withTempHome(async (home) => {
        let failVersion: string | undefined;
        const { app, client } = await bootApp(home, { capabilityRuntimeHooks: { beforeMount: ({ version }) => { if (version === failVersion) throw new Error("injected mount fault"); } } });
        try {
          await enableCapabilityRuntime(app, client);
          const v1 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "v1", "# Guide v1"), manifest });
          await client.invoke("capability.bundle.activate", { capabilityId: CAP });
          const v2 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "v2", "# Guide v2"), manifest });
          failVersion = v2.version;
          await expect(client.invoke("capability.bundle.activate", { capabilityId: CAP })).rejects.toThrow(/mount of .* failed/);

          const faults = await waitUntil("repoint_failed fault row", async () => { const rows = await failedRepointRows(app); return rows.length > 0 ? rows : undefined; });
          expect(faults[0]!.reason).toContain("mount-failed");
          expect((await eventsOfType(app, "capability.repointed")).length).toBe(0);
          // The activation row still names v1; the next invocation uses v1; v1's directory is intact.
          expect(((await wbRows(app)).get(`activation/${CAP}/user`) as { version: string }).version).toBe(v1.version);
          const after = await load(client);
          expect(after.ok).toBe(true);
          expect(after.version).toBe(v1.version);
          expect(after.result?.content).toContain("v1");
          expect(await verifyBundleIntegrity(v1.dir, v1.version, (await waitForRow<{ manifest: unknown }>(app, `bundle-version/${CAP}/${v1.version}`)).manifest)).toBe(true);
        } finally {
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 90000);

    test("activation suspended concurrently: the CAS pre-state check aborts, the mounted v2 handle is disposed", async () => {
      await withTempHome(async (home) => {
        const hookState: { app?: AppServer; suspend?: boolean } = {};
        const { app, client } = await bootApp(home, {
          capabilityRuntimeHooks: {
            beforeRepointCommit: async ({ capabilityId }) => {
              if (!hookState.suspend) return;
              await new LifecycleRecorder(hookState.app!.runtime.store, LOCAL_OPERATOR.tenant).commitBatch(capabilityId, [{ type: "capability.suspended", payload: { capabilityId, level: "user", reason: "operator-yank" } }]);
            },
          },
        });
        hookState.app = app;
        try {
          await enableCapabilityRuntime(app, client);
          const v1 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "v1", "# Guide v1"), manifest });
          await client.invoke("capability.bundle.activate", { capabilityId: CAP });
          await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "v2", "# Guide v2"), manifest });
          hookState.suspend = true;
          await expect(client.invoke("capability.bundle.activate", { capabilityId: CAP })).rejects.toThrow(/changed during replacement/);
          const faults = await waitUntil("repoint_failed fault row", async () => { const rows = await failedRepointRows(app); return rows.length > 0 ? rows : undefined; });
          expect(faults[0]!.reason).toContain("pre-state-changed");
          expect((await eventsOfType(app, "capability.repointed")).length).toBe(0);
          // The suspension wins: the row is suspended at v1 and invocations refuse as suspended.
          const row = await waitForRow<{ version: string; state: string }>(app, `activation/${CAP}/user`, (r) => r.state === "suspended");
          expect(row.version).toBe(v1.version);
          const refused = await load(client);
          expect(refused.ok).toBe(false);
          expect((refused as { reasonCode?: string }).reasonCode).toBe("suspended");
        } finally {
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 90000);

    test("tampered v2 directory: refused on integrity before any mount; v1 untouched", async () => {
      await withTempHome(async (home) => {
        const { app, client } = await bootApp(home);
        try {
          await enableCapabilityRuntime(app, client);
          const v1 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "v1", "# Guide v1"), manifest });
          await client.invoke("capability.bundle.activate", { capabilityId: CAP });
          const v2 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "v2", "# Guide v2"), manifest });
          await writeFile(join(v2.dir, "GUIDE.md"), "# tampered out of band");
          await expect(client.invoke("capability.bundle.activate", { capabilityId: CAP })).rejects.toThrow(/integrity check/);
          const faults = await waitUntil("repoint_failed fault row", async () => { const rows = await failedRepointRows(app); return rows.length > 0 ? rows : undefined; });
          expect(faults[0]!.reason).toContain("integrity");
          expect(((await wbRows(app)).get(`activation/${CAP}/user`) as { version: string }).version).toBe(v1.version);
          expect((await load(client)).result?.content).toContain("v1");
        } finally {
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 90000);

    test("first activation that fails mount leaves the table empty (activation_failed, nothing invocable)", async () => {
      await withTempHome(async (home) => {
        const { app, client } = await bootApp(home, { capabilityRuntimeHooks: { beforeMount: () => { throw new Error("injected mount fault"); } } });
        try {
          await enableCapabilityRuntime(app, client);
          await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "v1", "# Guide v1"), manifest });
          await expect(client.invoke("capability.bundle.activate", { capabilityId: CAP })).rejects.toThrow(/mount of .* failed/);
          await waitUntil("activation_failed fault row", async () => [...(await wbRows(app))].find(([k]) => k.startsWith("fault/capability.activation_failed/"))?.[1]);
          const refused = await load(client);
          expect(refused.ok).toBe(false);
          expect((refused as { reasonCode?: string }).reasonCode).toBe("no-activation");
        } finally {
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 90000);
  });
});
