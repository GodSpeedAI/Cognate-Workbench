// Journey J-CAP-review-r4: Codex round 4 on PR #38. Each test fails on f4a4c1a.
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encode } from "gpt-tokenizer";
import { capabilityRuntimeComponent } from "../src/capabilities/capabilityRuntime.ts";
import { capabilityBundlesComponent } from "../src/capabilities/capabilityBundles.ts";
import { AuthorityIndex, type ActivationRow } from "../src/workbench/authorityIndex.ts";
import { assembleDescriptorSection, buildDescriptor, DESCRIPTOR_BUDGETS, estimateTokens, type Descriptor } from "../src/capabilities/skillLoader.ts";
import { bootApp, enableCapabilityRuntime, registerBundle, waitUntil, wbRows, withTempHome } from "./wb-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";

type Handler = (raw: unknown, ctx: unknown) => Promise<Record<string, any>>;
const CAP = "capability.bundle.r4";
const V = "v1hash";
const capture = (component: { activate(f: never): void }) => {
  const handlers = new Map<string, Handler>();
  component.activate({ provide: (c: { id: string }, h: Handler) => handlers.set(c.id, h), effects: { register() {} } } as never);
  return handlers;
};
const author = async (home: string, label: string, text = "# r4") => {
  const dir = join(home, "authoring", label);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "GUIDE.md"), text);
  return dir;
};
const manifest = (purpose: string) => ({ name: "r4", purpose, skills: [{ name: "guide", entry: "GUIDE.md" }], requirements: ["capability.invoke", "skill.load"] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("J-CAP-review-r4", () => {
  describe("R4-1 uninstall and activation share the runtime mutex", () => {
    test("uninstalling an idle bundle works through the live (lazily resolved) authority index", async () => {
      await withTempHome(async (home) => {
        const { app, client } = await bootApp(home);
        try {
          await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "idle"), manifest: manifest("idle") });
          expect(await client.invoke("capability.bundle.uninstall", { capabilityId: CAP })).toMatchObject({ uninstalled: true });
        } finally {
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 60000);
    test("uninstall raised while an activation is mounting never leaves an uninstalled bundle live", async () => {
      await withTempHome(async (home) => {
        let entered!: () => void;
        const mounting = new Promise<void>((r) => { entered = r; });
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const { app, client } = await bootApp(home, { capabilityRuntimeHooks: { beforeMount: async () => { entered(); await gate; } } });
        try {
          await enableCapabilityRuntime(app, client);
          await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "u"), manifest: manifest("uninstall race") });
          const activation = client.invoke("capability.bundle.activate", { capabilityId: CAP }).then(() => "activated", () => "refused");
          await mounting;
          const uninstall = client.invoke("capability.bundle.uninstall", { capabilityId: CAP }).then(() => "uninstalled", () => "refused");
          await sleep(300);
          release();
          const [a, u] = await Promise.all([activation, uninstall]);
          const served = (await client.invoke("tool.skill_load", { capabilityId: CAP, skillId: "guide" }) as Record<string, unknown>).ok === true;
          // Consistent outcomes only: never both the uninstall and a live, serving activation.
          expect(a === "activated" && u === "uninstalled" && served).toBe(false);
          expect(a === "activated" || u === "uninstalled").toBe(true);
          // The mutex serializes them: activation wins first, so uninstall must refuse (zero-live rule).
          expect(u).toBe("refused");
          const rows = await wbRows(app);
          const uninstalled = (rows.get(`bundle/${CAP}`) as { uninstalled?: boolean } | undefined)?.uninstalled === true;
          const live = (rows.get(`activation/${CAP}/user`) as { state?: string } | undefined)?.state === "active";
          expect(uninstalled && live).toBe(false);
        } finally {
          release();
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 90000);
  });

  describe("R4-2 every mutating op re-authorizes as its last step", () => {
    const row: ActivationRow = { capabilityId: CAP, level: "user", version: V, ceiling: ["capability.invoke", "skill.load"], clampProvenance: "operator", state: "active", suspensionReasons: [] };
    test("deactivation: the grant revoked during the awaited projection read yields a recorded refusal, no commit", async () => {
      const index = new AuthorityIndex({ onCommitted: () => () => {} } as never, "local");
      index.activations.set(index.activationKey(CAP, "user"), row);
      index.grants.set("grant:g-agent", { grantId: "g-agent", principalId: "wb-agent:coding", permissions: ["bundle.deactivate"], status: "active", recordedAt: "" });
      index.grants.set("grant:g-root", { grantId: "g-root", principalId: "wb-operator:root", permissions: ["*"], status: "active", recordedAt: "" });
      const commits: unknown[] = [];
      const recorded: Record<string, unknown>[] = [];
      const handlers = capture(capabilityRuntimeComponent({
        getKernel: () => ({}) as never, getRootScope: () => ({}) as never, tenant: "local",
        getRecorder: () => ({ commitBatch: async (...args: unknown[]) => { commits.push(args); return {}; } }) as never,
        getService: () => ({ getRun: async () => ({ input: {} }), readProjection: async () => {
          index.grants.set("grant:g-agent", { ...index.grants.get("grant:g-agent")!, status: "revoked" }); // revoked DURING the awaited read
          return { rows: [{ key: `bundle-version/${CAP}/${V}`, value: { manifest: { name: "r4", purpose: "p", skills: [] } } }] };
        } }) as never,
        getIndex: () => index, isEnabled: async () => true, recordDecision: async (e) => { recorded.push(e.payload as Record<string, unknown>); }, activeSet: [],
      }));
      await expect(handlers.get("capability.bundle.deactivate")!({ capabilityId: CAP }, { actor: { id: "wb-agent:coding", kind: "agent" } })).rejects.toThrow(/no active grant/);
      expect(commits.length).toBe(0);
      expect(recorded.some((d) => d.operation === "deactivate" && d.outcome === "refused" && String(d.reason).includes("lapsed"))).toBe(true);
    });

    test("grant revoke waits for an in-flight activation (one mutex), then applies", async () => {
      await withTempHome(async (home) => {
        let entered!: () => void;
        const mounting = new Promise<void>((r) => { entered = r; });
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const { app, client } = await bootApp(home, { capabilityRuntimeHooks: { beforeMount: async () => { entered(); await gate; } } });
        try {
          await enableCapabilityRuntime(app, client);
          await client.invoke("authority.grant.issue", { grantId: "grant-m", principalId: "wb-agent:m", permissions: ["skill.load"] });
          await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "m"), manifest: manifest("mutex") });
          const activation = client.invoke("capability.bundle.activate", { capabilityId: CAP });
          await mounting;
          let revoked = false;
          const revoke = client.invoke("authority.grant.revoke", { grantId: "grant-m" }).then(() => { revoked = true; });
          await sleep(400);
          expect(revoked).toBe(false);
          release();
          await activation;
          await revoke;
          expect(revoked).toBe(true);
        } finally {
          release();
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 90000);
  });

  describe("R4-3 handlers are keyed by activation scope", () => {
    test("deactivating a session activation leaves the persistent activation serving", async () => {
      await withTempHome(async (home) => {
        const { app, client } = await bootApp(home);
        try {
          await enableCapabilityRuntime(app, client);
          const v1 = await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "s1", "# v1"), manifest: manifest("persistent") });
          await client.invoke("capability.bundle.activate", { capabilityId: CAP });
          await registerBundle(app, client, { capabilityId: CAP, sourceDir: await author(home, "s2", "# v2"), manifest: manifest("session") });
          await client.invoke("capability.bundle.activate", { capabilityId: CAP, sessionId: "S" });
          await client.invoke("capability.bundle.deactivate", { capabilityId: CAP, sessionId: "S" });
          const served = await client.invoke("tool.skill_load", { capabilityId: CAP, skillId: "guide" }) as Record<string, any>;
          expect(served.ok).toBe(true);
          expect(served.version).toBe(v1.version);
          expect(served.result.content).toContain("v1");
        } finally {
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 90000);
  });

  describe("R4-4 the token bound never under-counts", () => {
    const samples = ["x ".repeat(700), "hello world ".repeat(300), "龘".repeat(500), "混合 mixed 文本 text ".repeat(60), "a,b;c.d!e?".repeat(200), "emoji 🙂🙂🙂 ".repeat(100)];
    test("estimate >= the real gpt-tokenizer count for ASCII, CJK and mixed text", () => {
      for (const text of samples) expect(estimateTokens(text)).toBeGreaterThanOrEqual(encode(text).length);
    });
    test("the aggregate section holds its budget against the real count", () => {
      const tiny = (i: number): Descriptor => ({ capabilityId: `c${String(i).padStart(4, "0")}`, version: "v", text: `x ${"y ".repeat(40)}`, tokens: estimateTokens(`x ${"y ".repeat(40)}`), truncated: false });
      const section = assembleDescriptorSection(Array.from({ length: 300 }, (_, i) => tiny(i)));
      expect(encode(section.text).length).toBeLessThanOrEqual(DESCRIPTOR_BUDGETS.aggregateTokens);
      const one = buildDescriptor("capability.bundle.x", "0123456789abcdef", { name: "n", purpose: "x ".repeat(700), skills: [{ name: "a", entry: "A.md" }] });
      expect(encode(one.text).length).toBeLessThanOrEqual(DESCRIPTOR_BUDGETS.perCapabilityTokens);
    });
  });

  describe("R4-5 registration refusals reach the audit trail", () => {
    const bundles = (started: unknown[]) => capture(capabilityBundlesComponent({
      getService: () => ({ startRun: async (_c: unknown, req: unknown) => { started.push(req); return { runId: "r" }; } }) as never,
      lifecycleRecorder: () => ({}) as never, authorityIndex: () => ({ ready: Promise.resolve(), activations: new Map(), grants: new Map() }) as never, home: "/nonexistent", tenant: "local",
    }));
    test("registration from an agent run records the refusal through ctx.emit", async () => {
      const emitted: { type: string; payload: Record<string, unknown> }[] = [];
      const handlers = bundles([]);
      await expect(handlers.get("capability.bundle.register")!({ capabilityId: CAP, sourceDir: "/x", manifest: {} }, { actor: { id: "wb-agent:coding", kind: "agent" }, runId: "run-1", emit: async (type: string, payload: Record<string, unknown>) => { emitted.push({ type, payload }); } })).rejects.toThrow(/human decision/);
      expect(emitted.some((e) => e.type === "authority.decision.recorded" && e.payload.capability === "capability.bundle.register" && e.payload.outcome === "refused")).toBe(true);
    });
    test("a schema-invalid registration records capability.validation_failed", async () => {
      const started: { input: { events: { type: string }[] } }[] = [];
      const handlers = bundles(started);
      await expect(handlers.get("capability.bundle.register")!({ capabilityId: CAP, sourceDir: "/x", manifest: { name: 7 } }, { actor: { id: "op", kind: "user" } })).rejects.toThrow(/manifest validation failed/);
      expect(started.some((r) => r.input.events.some((e) => e.type === "capability.validation_failed"))).toBe(true);
    });
  });
});
void waitUntil; void LOCAL_OPERATOR;
