// Journey J-CAP-review-cr: the CodeRabbit threads on PR #38 (CR-1, 2, 4, 5, 6, 7; CR-3 is covered
// by J-CAP-review-r4 "handlers are keyed by activation scope"; CR-8 fixed in J-CAP-review-r2).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AuthorityIndex } from "../src/workbench/authorityIndex.ts";
import { liveGrant } from "../src/workbench/authoritySelection.ts";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, enableCapabilityRuntime, registerBundle, waitForRow, waitUntil, wbRows, withTempHome, type Client, type AppServer } from "./wb-helpers.ts";

const CAP = "capability.bundle.cr";
const manifest = (requirements = ["capability.invoke", "skill.load"]) => ({ name: "cr", purpose: "coderabbit", skills: [{ name: "guide", entry: "GUIDE.md" }], requirements });
const author = async (home: string, label: string, text: string) => {
  const dir = join(home, "authoring", label);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "GUIDE.md"), text);
  return dir;
};
const load = (client: Client) => client.invoke("tool.skill_load", { capabilityId: CAP, skillId: "guide" }) as Promise<Record<string, any>>;
const activation = async (app: AppServer) => (await wbRows(app)).get(`activation/${CAP}/user`) as { state: string; version: string; ceiling: string[]; suspensionReasons: string[] };

describe("J-CAP-review-cr", () => {
  test("CR-1: an integrity failure on a version drained after a repoint does not suspend the healthy replacement", async () => {
    await withTempHome(async (home) => {
      let hold: string | undefined;
      let entered!: () => void;
      const enteredP = new Promise<void>((r) => { entered = r; });
      let release!: () => void;
      const releaseP = new Promise<void>((r) => { release = r; });
      const { app, client } = await bootApp(home, { capabilityRuntimeHooks: { beforeInterpret: async ({ version }) => { if (hold && version === hold) { hold = undefined; entered(); await releaseP; } } } });
      try {
        await enableCapabilityRuntime(app, client);
        const v1 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "a", "# v1"), manifest: manifest() });
        await client.invoke("capability.bundle.activate", { capabilityId: CAP });
        const v2 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "b", "# v2"), manifest: manifest() });
        hold = v1.version;
        const inFlight = load(client);
        await enteredP;
        await client.invoke("capability.bundle.activate", { capabilityId: CAP }); // repoint to v2
        await writeFile(join(v1.dir, "GUIDE.md"), "tampered after the call began");
        release();
        const old = await inFlight;
        expect(old.ok).toBe(false);
        expect(old.code).toBe("integrity");
        await waitUntil("stale fault recorded", async () => (await wbRows(app)).get(`fault/capability.integrity_failed/${CAP}`) ?? true);
        const row = await activation(app);
        expect(row.version).toBe(v2.version);
        expect(row.state).toBe("active"); // v2 is healthy and must keep serving
        expect(((await load(client)).ok)).toBe(true);
      } finally {
        release();
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 90000);

  test("CR-2: a repoint carries the replacement's authorized ceiling (reducer fold and authority index)", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await enableCapabilityRuntime(app, client);
        await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "a", "# v1"), manifest: manifest(["capability.invoke", "skill.load"]) });
        await client.invoke("capability.bundle.activate", { capabilityId: CAP });
        expect((await waitForRow<{ ceiling: string[] }>(app, `activation/${CAP}/user`)).ceiling.sort()).toEqual(["capability.invoke", "skill.load"]);
        const v2 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "b", "# v2"), manifest: manifest(["skill.load"]) });
        await client.invoke("capability.bundle.activate", { capabilityId: CAP });
        const row = await waitForRow<{ version: string; ceiling: string[] }>(app, `activation/${CAP}/user`, (r) => r.version === v2.version);
        expect(row.ceiling).toEqual(["skill.load"]);
        const refused = await client.invoke("tool.capability_invoke", { capabilityId: CAP, tool: "echo", arguments: {} }) as Record<string, unknown>;
        expect(refused.reasonCode).toBe("beyond-ceiling"); // the index enforces v2's narrower ceiling
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 90000);

  test("CR-2 (unit): the authority index applies a repoint's ceiling and provenance", () => {
    const listeners: ((e: unknown[]) => void)[] = [];
    const index = new AuthorityIndex({ onCommitted: (fn: (e: unknown[]) => void) => { listeners.push(fn); return () => {}; } } as never, "local");
    index.activations.set(index.activationKey(CAP, "user"), { capabilityId: CAP, level: "user", version: "a", ceiling: ["capability.invoke"], clampProvenance: "operator", state: "active", suspensionReasons: [] });
    void index.rebuild([]); // subscribes
    index.activations.set(index.activationKey(CAP, "user"), { capabilityId: CAP, level: "user", version: "a", ceiling: ["capability.invoke"], clampProvenance: "operator", state: "active", suspensionReasons: [] });
    for (const fn of listeners) fn([{ eventType: "capability.repointed", tenant: "local", recordedAt: "", payload: { capabilityId: CAP, level: "user", from: "a", to: "b", ceiling: ["skill.load"], clampProvenance: "grant-x" } }]);
    expect(index.selectActivation(CAP, "user")).toMatchObject({ version: "b", ceiling: ["skill.load"], clampProvenance: "grant-x" });
  });

  test("CR-4: a version still draining an in-flight call is never pruned by a later registration", async () => {
    await withTempHome(async (home) => {
      let hold: string | undefined;
      let entered!: () => void;
      const enteredP = new Promise<void>((r) => { entered = r; });
      let release!: () => void;
      const releaseP = new Promise<void>((r) => { release = r; });
      const { app, client } = await bootApp(home, { capabilityRuntimeHooks: { beforeInterpret: async ({ version }) => { if (hold && version === hold) { hold = undefined; entered(); await releaseP; } } } });
      try {
        await enableCapabilityRuntime(app, client);
        const v1 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "a", "# v1"), manifest: manifest() });
        await client.invoke("capability.bundle.activate", { capabilityId: CAP });
        await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "b", "# v2"), manifest: manifest() });
        hold = v1.version;
        const inFlight = load(client);
        await enteredP;
        await client.invoke("capability.bundle.activate", { capabilityId: CAP }); // v1 now only drains
        // Register until v1 would be a pruning candidate (retention keeps the 3 highest-sorted others).
        for (let i = 0; i < 24; i++) {
          await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, `n${i}`, `# n${i}`), manifest: manifest() });
        }
        expect(existsSync(v1.dir)).toBe(true);
        release();
        expect((await inFlight).ok).toBe(true);
      } finally {
        release();
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 120000);

  test("CR-5: uninstall after a re-registration is a new act, not a replay of the earlier uninstall", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const src = await author(home, "a", "# v1");
        await registerBundle(app, client, { capabilityId: CAP, sourceDir: src, manifest: manifest() });
        await client.invoke("capability.bundle.uninstall", { capabilityId: CAP });
        await waitForRow<{ uninstalled?: boolean }>(app, `bundle/${CAP}`, (r) => r.uninstalled === true);
        await registerBundle(app, client, { capabilityId: CAP, sourceDir: src, manifest: manifest() });
        await waitForRow<{ uninstalled?: boolean }>(app, `bundle/${CAP}`, (r) => r.uninstalled !== true);
        await client.invoke("capability.bundle.uninstall", { capabilityId: CAP });
        const row = await waitForRow<{ uninstalled?: boolean }>(app, `bundle/${CAP}`, (r) => r.uninstalled === true);
        expect(row.uninstalled).toBe(true);
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 90000);

  test("CR-6: a suspension committed during the replacement's mount is not overwritten by the repoint", async () => {
    await withTempHome(async (home) => {
      let suspendNow = false;
      let recorder: LifecycleRecorder | undefined;
      const { app, client } = await bootApp(home, { capabilityRuntimeHooks: { beforeFinalRecheck: async ({ capabilityId }) => {
        if (!suspendNow) return;
        suspendNow = false;
        await recorder!.commitBatch(capabilityId, [{ type: "capability.suspended", payload: { capabilityId, level: "user", reason: "operator-yank" } }]);
      } } });
      try {
        recorder = new LifecycleRecorder(app.runtime.store, LOCAL_OPERATOR.tenant);
        await enableCapabilityRuntime(app, client);
        const v1 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "a", "# v1"), manifest: manifest() });
        await client.invoke("capability.bundle.activate", { capabilityId: CAP });
        await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "b", "# v2"), manifest: manifest() });
        suspendNow = true;
        await expect(client.invoke("capability.bundle.activate", { capabilityId: CAP })).rejects.toThrow(/changed before the repoint commit|suspended/);
        const row = await waitForRow<{ state: string; version: string }>(app, `activation/${CAP}/user`, (r) => r.state === "suspended");
        expect(row.version).toBe(v1.version);
        expect(row.state).toBe("suspended");
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 90000);

  test("CR-7: an expired grant does not mask a newer valid grant of the same principal", () => {
    const index = new AuthorityIndex({ onCommitted: () => () => {} } as never, "local");
    index.grants.set("grant:old", { grantId: "old", principalId: "wb-agent:x", permissions: ["skill.load"], status: "active", expiresAt: new Date(Date.now() - 60_000).toISOString(), recordedAt: "" });
    index.grants.set("grant:new", { grantId: "new", principalId: "wb-agent:x", permissions: ["skill.load"], status: "active", recordedAt: "" });
    const live = liveGrant(index, "wb-agent:x", Date.now());
    expect(live.ok && live.grant.grantId).toBe("new");
    index.grants.set("grant:new", { ...index.grants.get("grant:new")!, status: "revoked" });
    const none = liveGrant(index, "wb-agent:x", Date.now());
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.code).toBe("grant-expired");
  });
});
