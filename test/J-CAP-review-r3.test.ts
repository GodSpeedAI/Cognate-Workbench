// Journey J-CAP-review-r3: Codex round 3 on PR #38. The structural fix: ONE authorization function
// (`authorizeCapabilityOp`) that every capability-runtime entry point calls. Each test fails on 1ef8c0d.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { capabilityRuntimeComponent } from "../src/capabilities/capabilityRuntime.ts";
import { runStartResolverComponent, createRunStartResolver } from "../src/agents/runStartResolver.ts";
import { AuthorityIndex, type ActivationRow } from "../src/workbench/authorityIndex.ts";
import { buildDescriptor, DESCRIPTOR_BUDGETS, estimateTokens } from "../src/capabilities/skillLoader.ts";
import { PRESET_TOOLS } from "../src/agents/agentCoding.ts";
import { bootApp, enableCapabilityRuntime, registerBundle, waitUntil, withTempHome } from "./wb-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";

type Handler = (raw: unknown, ctx: unknown) => Promise<Record<string, any>>;
const CAP = "capability.bundle.r3";
const V = "v1hash";
const row = (over: Partial<ActivationRow> = {}): ActivationRow => ({ capabilityId: CAP, level: "user", version: V, ceiling: ["capability.invoke", "skill.load", "harness.modify"], clampProvenance: "operator", state: "active", suspensionReasons: [], ...over });
const mkIndex = (rows: ActivationRow[], grants: Record<string, unknown>[]) => {
  const index = new AuthorityIndex({ onCommitted: () => () => {} } as never, "local");
  for (const r of rows) index.activations.set(index.activationKey(r.capabilityId, r.level, r.sessionId), r);
  for (const g of grants) index.grants.set(`grant:${g.grantId}`, { status: "active", recordedAt: "", ...g } as never);
  return index;
};
const agentGrant = { grantId: "g-agent", principalId: "wb-agent:coding", permissions: ["skill.load", "capability.invoke", "bundle.activate", "harness.modify"] };
const rootGrant = { grantId: "g-root", principalId: "wb-operator:root", permissions: ["*"] };
const manifestRows = (harnessDecl?: unknown, requirements?: string[]) => [{ key: `bundle/${CAP}`, value: { versionHash: V, dir: "/nonexistent" } }, { key: `bundle-version/${CAP}/${V}`, value: { manifest: { name: "r3", purpose: "r3", skills: [{ name: "guide", entry: "G.md" }], requirements, harness: harnessDecl } } }];
const patch = { instructionPatches: [{ section: "style", operation: "append", payload: "PATCH-APPLIED" }] };
const capture = (component: { activate(f: never): void }) => {
  const handlers = new Map<string, Handler>();
  component.activate({ provide: (c: { id: string }, h: Handler) => handlers.set(c.id, h), effects: { register() {} } } as never);
  return handlers;
};
const dispatcher = (index: AuthorityIndex, extra: { runSession?: string; requirements?: string[]; recorded?: Record<string, unknown>[] } = {}) =>
  capture(capabilityRuntimeComponent({
    getKernel: () => ({}) as never, getRootScope: () => ({}) as never, tenant: "local", getRecorder: () => ({ commitBatch: async () => ({}) }) as never,
    getService: () => ({ getRun: async () => ({ input: extra.runSession ? { sessionId: extra.runSession } : {} }), readProjection: async () => ({ rows: manifestRows(undefined, extra.requirements) }) }) as never,
    getIndex: () => index, isEnabled: async () => true, recordDecision: async (e) => { extra.recorded?.push(e.payload as Record<string, unknown>); }, activeSet: [],
  }));

describe("J-CAP-review-r3", () => {
  describe("R3-1 the authority index is idempotent under rebuild", () => {
    const committed: ((events: unknown[]) => void)[] = [];
    const store = { onCommitted: (fn: (events: unknown[]) => void) => { committed.push(fn); return () => { const i = committed.indexOf(fn); if (i >= 0) committed.splice(i, 1); }; } };
    test("rebuild twice, revoke once: one entry per grant id, and the grant is gone", async () => {
      const index = new AuthorityIndex(store as never, "local");
      const rows = [{ key: "grant/g-agent", value: { ...agentGrant, status: "active", recordedAt: "" } }, { key: "grant/g-root", value: { ...rootGrant, status: "active", recordedAt: "" } }];
      await index.rebuild(rows);
      await index.rebuild(rows);
      expect(index.grants.size).toBe(2);
      expect(committed.length).toBe(1);
      for (const fn of committed) fn([{ eventType: "authority.grant.revoked", tenant: "local", payload: { grantId: "g-agent" }, recordedAt: "" }]);
      expect(index.grantFor("wb-agent:coding")).toBeUndefined();
    });
    test("rebuild, revoke, resolve: the harness patch is refused", async () => {
      const index = new AuthorityIndex(store as never, "local");
      index.activations.set(index.activationKey(CAP, "user"), row());
      const rows = [{ key: "grant/g-agent", value: { ...agentGrant, status: "active", recordedAt: "" } }, { key: "grant/g-root", value: { ...rootGrant, status: "active", recordedAt: "" } }];
      await index.rebuild(rows);
      await index.rebuild(rows);
      for (const fn of committed) fn([{ eventType: "authority.grant.revoked", tenant: "local", payload: { grantId: "g-agent" }, recordedAt: "" }]);
      const r = await createRunStartResolver({ isEnabled: async () => true, getIndex: () => index, readRows: async () => manifestRows(patch) })
        .resolve({ runId: "run", actor: { id: "wb-agent:coding", kind: "agent" }, preset: "standard", baseTools: PRESET_TOOLS.standard });
      if (!r.enabled || r.refused) throw new Error("expected resolved");
      expect(r.instructions).not.toContain("PATCH-APPLIED");
    });
  });

  describe("R3-2 the resolver handler takes the session from the run context only", () => {
    test("an input sessionId cannot select another session; the run's suspended session governs", async () => {
      const index = mkIndex([row(), row({ sessionId: "S", state: "suspended", suspensionReasons: ["operator-yank"] })], [agentGrant, rootGrant]);
      const handlers = capture(runStartResolverComponent({ isEnabled: async () => true, getIndex: () => index, readRows: async () => manifestRows(patch), getService: () => ({ getRun: async () => ({ input: { sessionId: "S" } }) }), tenant: "local" }));
      const ctx = { runId: "run-S", actor: { id: "wb-agent:coding", kind: "agent" } };
      const r = await handlers.get("capability.harness.resolve")!({ sessionId: "other", preset: "standard", baseTools: PRESET_TOOLS.standard }, ctx);
      expect(r.instructions).not.toContain("PATCH-APPLIED");
    });
  });

  describe("R3-3 the deployment invariant is re-validated at every enablement check", () => {
    test("marker present but external PostgreSQL without the single-writer declaration now: refused and recorded; with it: serves", async () => {
      await withTempHome(async (home) => {
        const { app, client } = await bootApp(home);
        const saved = { url: process.env.COGNATE_POSTGRES_URL, sw: process.env.COGNATE_CAPABILITY_SINGLE_WRITER };
        try {
          await enableCapabilityRuntime(app, client);
          const dir = join(home, "authoring", "r3");
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, "GUIDE.md"), "# r3");
          await registerBundle(app, client, { capabilityId: CAP, sourceDir: dir, manifest: { name: "r3", purpose: "p", skills: [{ name: "guide", entry: "GUIDE.md" }], requirements: ["capability.invoke", "skill.load"] } });
          await client.invoke("capability.bundle.activate", { capabilityId: CAP });
          expect(((await client.invoke("tool.skill_load", { capabilityId: CAP, skillId: "guide" })) as Record<string, unknown>).ok).toBe(true);
          process.env.COGNATE_POSTGRES_URL = "postgres://127.0.0.1:1/never-connected";
          delete process.env.COGNATE_CAPABILITY_SINGLE_WRITER;
          const refused = await client.invoke("tool.skill_load", { capabilityId: CAP, skillId: "guide" }) as Record<string, unknown>;
          expect(refused.ok).toBe(false);
          expect(refused.reasonCode === "deployment-invariant" || refused.reasonCode === "runtime-disabled").toBe(true);
          expect(refused.reasonCode).toBe("deployment-invariant");
          process.env.COGNATE_CAPABILITY_SINGLE_WRITER = "1";
          expect(((await client.invoke("tool.skill_load", { capabilityId: CAP, skillId: "guide" })) as Record<string, unknown>).ok).toBe(true);
        } finally {
          for (const [k, v] of [["COGNATE_POSTGRES_URL", saved.url], ["COGNATE_CAPABILITY_SINGLE_WRITER", saved.sw]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 90000);
  });

  describe("R3-4 / R3-5 activation and deactivation need the actor's grant AND the root's", () => {
    test("root lacks bundle.activate: an agent holding it is refused (beyond-operator), recorded", async () => {
      const recorded: Record<string, unknown>[] = [];
      const handlers = dispatcher(mkIndex([], [agentGrant, { ...rootGrant, permissions: ["skill.load"] }]), { requirements: ["skill.load"], recorded });
      await expect(handlers.get("capability.bundle.activate")!({ capabilityId: CAP }, { actor: { id: "wb-agent:coding", kind: "agent" } })).rejects.toThrow(/exceeds the operator root/);
      expect(recorded.some((d) => d.operation === "activate" && d.reasonCode === "beyond-operator")).toBe(true);
    });
    test("deactivation needs bundle.deactivate on the agent grant (refused, recorded); the operator root passes the permission stage", async () => {
      const recorded: Record<string, unknown>[] = [];
      const handlers = dispatcher(mkIndex([row()], [agentGrant, rootGrant]), { recorded });
      await expect(handlers.get("capability.bundle.deactivate")!({ capabilityId: CAP }, { actor: { id: "wb-agent:coding", kind: "agent" } })).rejects.toThrow(/bundle\.deactivate/);
      expect(recorded.some((d) => d.operation === "deactivate" && d.reasonCode === "beyond-grant")).toBe(true);
      await expect(handlers.get("capability.bundle.deactivate")!({ capabilityId: "capability.bundle.other" }, { actor: { id: "operator", kind: "user" } })).rejects.toThrow(/no live activation/);
    });
    test("root grant revoked: even the operator cannot deactivate (no-root-grant)", async () => {
      const handlers = dispatcher(mkIndex([row()], [agentGrant]));
      await expect(handlers.get("capability.bundle.deactivate")!({ capabilityId: CAP }, { actor: { id: "operator", kind: "user" } })).rejects.toThrow(/no active grant/);
    });
  });

  describe("R3-6 activation is serialized", () => {
    test("two concurrent activations of bundles owning the same preset toolset: exactly one wins", async () => {
      await withTempHome(async (home) => {
        const { app, client } = await bootApp(home, { capabilityRuntimeHooks: { beforeMount: async () => { await new Promise((r) => setTimeout(r, 250)); } } });
        try {
          await enableCapabilityRuntime(app, client);
          const dir = join(home, "authoring", "r3b");
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, "GUIDE.md"), "# r3");
          const manifest = (name: string) => ({ name, purpose: name, skills: [{ name: "guide", entry: "GUIDE.md" }], requirements: ["capability.invoke", "skill.load", "harness.modify"], harness: { toolsetOverrides: [{ preset: "standard", tools: ["read", "capability_invoke", "skill_load"] }] } });
          await registerBundle(app, client, { capabilityId: "capability.bundle.rival-a", sourceDir: dir, manifest: manifest("A") });
          await registerBundle(app, client, { capabilityId: "capability.bundle.rival-b", sourceDir: dir, manifest: manifest("B") });
          const results = await Promise.allSettled([
            client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.rival-a" }),
            client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.rival-b" }),
          ]);
          expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
          await waitUntil("settled", async () => true);
        } finally {
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 90000);
  });

  describe("R3-7 refresh honours enablement", () => {
    test("a disabled runtime refreshes nothing", async () => {
      const index = mkIndex([row()], [agentGrant, rootGrant]);
      const resolver = createRunStartResolver({ isEnabled: async () => false, getIndex: () => index, readRows: async () => manifestRows() });
      expect(await resolver.refresh({ sinceSequence: -1 })).toEqual({ changed: false, sequence: -1 });
    });
  });

  describe("R3-8 the token bound never under-counts non-ASCII text", () => {
    test("a 1,000-character 龘 skill name stays inside the per-capability budget", () => {
      const d = buildDescriptor("capability.bundle.cjk", "0123456789abcdef", { name: "n", purpose: "p", skills: [{ name: "龘".repeat(1000), entry: "A.md" }] });
      // Independent measure: UTF-8 bytes are an upper bound on tokens for non-ASCII text.
      expect(Buffer.byteLength(d.text, "utf8")).toBeLessThanOrEqual(DESCRIPTOR_BUDGETS.perCapabilityTokens * 4);
      expect(d.tokens).toBeLessThanOrEqual(DESCRIPTOR_BUDGETS.perCapabilityTokens);
      expect(estimateTokens("龘".repeat(10))).toBeGreaterThanOrEqual(10);
    });
  });

  describe("every entry point routes through authorizeCapabilityOp", () => {
    const registered = (component: { activate(f: never): void }) => [...capture(component).keys()].sort();
    const runtimeIds = registered(capabilityRuntimeComponent({ getKernel: () => ({}) as never, getRootScope: () => ({}) as never, tenant: "local", getRecorder: () => ({}) as never, getService: () => ({}) as never, isEnabled: async () => true, recordDecision: async () => {}, activeSet: [] }));
    const resolverIds = registered(runStartResolverComponent({ isEnabled: async () => true, getIndex: () => ({}) as never, readRows: async () => [], getService: () => ({}), tenant: "local" }));

    test("the registered handler set is pinned (a new handler forces this test to be extended)", () => {
      expect(runtimeIds).toEqual(["capability.bundle.activate", "capability.bundle.deactivate", "tool.capability_invoke", "tool.skill_load"]);
      expect(resolverIds).toEqual(["capability.harness.refresh", "capability.harness.resolve"]);
    });

    const blockOf = (source: string, id: string): string => {
      const start = source.indexOf(`provide("${id}"`);
      expect(start).toBeGreaterThan(-1);
      const next = source.indexOf("provide(\"", start + 10);
      return source.slice(start, next === -1 ? undefined : next);
    };
    test("each runtime handler decides through check() -> authorizeCapabilityOp (directly or via invokeFlow)", () => {
      const source = readFileSync(join(import.meta.dir, "../src/capabilities/capabilityRuntime.ts"), "utf8");
      for (const id of runtimeIds) {
        const block = blockOf(source, id);
        expect(block.includes("check(") || block.includes("invokeFlow(")).toBe(true);
      }
      const flow = source.slice(source.indexOf("const invokeFlow"), source.indexOf("provide(\"tool.capability_invoke\""));
      expect(flow).toContain("check(");
      expect(source.slice(source.indexOf("const check = (op"), source.indexOf("const check = (op") + 900)).toContain("authorizeCapabilityOp(");
    });
    test("each resolver entry decides through authorizeCapabilityOp", () => {
      const source = readFileSync(join(import.meta.dir, "../src/agents/runStartResolver.ts"), "utf8");
      const resolve = source.slice(source.indexOf("async resolve("), source.indexOf("async refresh("));
      const refresh = source.slice(source.indexOf("async refresh("), source.indexOf("export type RunStartResolver"));
      expect(resolve).toContain("authorizeCapabilityOp(\"harness.resolve\"");
      expect(refresh).toContain("authorizeCapabilityOp(\"harness.refresh\"");
      expect(source).toMatch(/resolver\.resolve\(/);
      expect(source).toMatch(/resolver\.refresh\(/);
      expect(source).toContain("authorizeCapabilityOp(\"harness.apply\"");
    });
  });
});
