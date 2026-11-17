// Journey J-CAP-review-r2: regressions for CI round 1 (A1/A2) and Codex review round 2 (B1-B6) of
// PR #38. Each test fails on 34068a4 for the stated reason.
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { capabilityRuntimeComponent } from "../src/capabilities/capabilityRuntime.ts";
import { authorityGrantsComponent, classifyCapabilityStore } from "../src/capabilities/authorityGrants.ts";
import { AuthorityIndex, type ActivationRow } from "../src/workbench/authorityIndex.ts";
import { assembleDescriptorSection, DESCRIPTOR_BUDGETS, loadSkill, type Descriptor } from "../src/capabilities/skillLoader.ts";
import { versionHashFor } from "../src/capabilities/bundleStore.ts";
import { createRunStartResolver } from "../src/agents/runStartResolver.ts";
import { createAgentCodingAgent } from "../src/agents/agentCoding.ts";
import { PRESET_TOOLS } from "../src/agents/agentCoding.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, enableCapabilityRuntime, registerBundle, waitUntil, wbRows, withTempHome } from "./wb-helpers.ts";

type Handler = (raw: unknown, ctx: unknown) => Promise<Record<string, any>>;
const CAP = "capability.bundle.r2";
const V = "v1hash";
const ceiling = ["capability.invoke", "skill.load", "harness.modify"];
const row = (over: Partial<ActivationRow> = {}): ActivationRow => ({ capabilityId: CAP, level: "user", version: V, ceiling, clampProvenance: "operator", state: "active", suspensionReasons: [], ...over });
const mkIndex = (rows: ActivationRow[], grants: Record<string, unknown>[]) => {
  const index = new AuthorityIndex({ onCommitted: () => () => {} } as never, "local");
  for (const r of rows) index.activations.set(index.activationKey(r.capabilityId, r.level, r.sessionId), r);
  for (const g of grants) index.grants.set(`grant:${g.grantId}`, { status: "active", recordedAt: "", ...g } as never);
  return index;
};
const agentGrant = { grantId: "g-agent", principalId: "wb-agent:coding", permissions: ["skill.load", "capability.invoke", "bundle.activate", "harness.modify"] };
const rootGrant = { grantId: "g-root", principalId: "wb-operator:root", permissions: ["*"] };
const agentCtx = { actor: { id: "wb-agent:coding", kind: "agent" } };

function dispatcher(index: AuthorityIndex) {
  const handlers = new Map<string, Handler>();
  capabilityRuntimeComponent({
    getKernel: () => ({}) as never, getRootScope: () => ({}) as never, getService: () => ({ getRun: async () => ({ input: {} }) }) as never, tenant: "local", getRecorder: () => ({}) as never,
    getIndex: () => index, isEnabled: async () => true, recordDecision: async () => {}, activeSet: [],
  }).activate({ provide: (c: { id: string }, h: Handler) => handlers.set(c.id, h), effects: { register() {} } } as never);
  return handlers;
}
const manifestRows = (harnessDecl?: unknown) => [{ key: `bundle-version/${CAP}/${V}`, value: { manifest: { name: "r2", purpose: "r2", skills: [{ name: "guide", entry: "G.md" }], harness: harnessDecl } } }];
const patch = { instructionPatches: [{ section: "style", operation: "append", payload: "PATCH-APPLIED" }] };

describe("J-CAP-review-r2", () => {
  describe("A1 the §1.5 single-writer invariant", () => {
    test("classification: external PostgreSQL is multi-writer unless the operator declares a single-writer deployment", () => {
      expect(classifyCapabilityStore({})).toBe("pg0");
      expect(classifyCapabilityStore({ COGNATE_POSTGRES_URL: "postgres://x" })).toBe("external-postgres");
      expect(classifyCapabilityStore({ COGNATE_POSTGRES_URL: "postgres://x", COGNATE_CAPABILITY_SINGLE_WRITER: "yes" })).toBe("external-postgres");
      expect(classifyCapabilityStore({ COGNATE_POSTGRES_URL: "postgres://x", COGNATE_CAPABILITY_SINGLE_WRITER: "1" })).toBe("external-postgres-single-writer");
    });
    test("enable refuses external-postgres and accepts the declared single-writer kind", async () => {
      const enable = async (storeKind: "external-postgres" | "external-postgres-single-writer") => {
        const handlers = new Map<string, Handler>();
        const committed: unknown[] = [];
        authorityGrantsComponent({ getStore: () => ({ appendConditional: async () => ({}) }) as never, getIndex: () => ({ ready: Promise.resolve() }) as never, tenant: "local", isRemediationVerified: async () => true, storeKind } as never)
          .activate({ provide: (c: { id: string }, h: Handler) => handlers.set(c.id, h), effects: { register() {} } } as never);
        void committed;
        return handlers.get("capability.runtime.enable")!({}, { actor: { id: "op", kind: "user" } });
      };
      await expect(enable("external-postgres")).rejects.toThrow(/unsupported multi-writer store/);
      await expect(enable("external-postgres-single-writer")).rejects.not.toThrow(/unsupported multi-writer store/);
    });
  });

  describe("A2 the run loop never touches the resolver while the runtime is disabled", () => {
    const run = async (probe: (() => Promise<boolean>) | undefined) => {
      const calls: string[] = [];
      const ctx = {
        runId: "r", signal: new AbortController().signal, async emit() {},
        async invoke(capability: string) {
          calls.push(capability);
          if (capability === "capability.harness.resolve") return { enabled: false };
          if (capability === "plan.state") return { on: false, todos: [] };
          if (capability === "workspace.path") return { root: "/w", executionWorldId: "local" };
          if (capability === "expert.model.generate") return { message: { role: "assistant", content: "done" }, toolCalls: [], finishReason: "stop", model: "m" };
          if (capability === "steer.pending") return { steer: [] };
          throw new Error(`unexpected capability ${capability}`);
        },
        async state() { return null; }, async step(_id: string, fn: () => Promise<unknown>) { return fn(); }, async waitFor() { throw new Error("no wait"); },
      };
      const execution = { expertId: "e", assignmentId: "a", conversationId: "c", instructions: "x", route: { providerId: "p", baseURL: "https://p.invalid/v1", protocol: "openai-compatible", model: "m" }, tools: ["read"], maxSteps: 2, context: [] };
      await createAgentCodingAgent(probe ? { isCapabilityRuntimeEnabled: probe } : {}).run({ sessionId: "s", workspaceId: "w", message: "hi", expertExecution: execution } as never, ctx as never);
      return calls;
    };
    test("no probe or a disabled probe: no capability.harness.resolve call", async () => {
      expect(await run(undefined)).not.toContain("capability.harness.resolve");
      expect(await run(async () => false)).not.toContain("capability.harness.resolve");
    });
    test("an enabled runtime resolves at run start", async () => {
      expect(await run(async () => true)).toContain("capability.harness.resolve");
    });
  });

  describe("B1 the live root grant and clamp are checked on every invocation", () => {
    test("operator-provenance activation, root grant revoked: refused (no-root-grant)", async () => {
      const handlers = dispatcher(mkIndex([row()], [agentGrant])); // no live root grant
      const r = await handlers.get("tool.skill_load")!({ capabilityId: CAP, skillId: "guide" }, agentCtx);
      expect(r.reasonCode).toBe("no-root-grant");
    });
    test("a root grant that no longer covers the permission refuses (beyond-operator)", async () => {
      const handlers = dispatcher(mkIndex([row()], [agentGrant, { ...rootGrant, permissions: ["capability.invoke"] }]));
      expect((await handlers.get("tool.skill_load")!({ capabilityId: CAP, skillId: "guide" }, agentCtx)).reasonCode).toBe("beyond-operator");
    });
  });

  describe("B2 harness patches need the responsible principal's grant ∩ the root grant", () => {
    const resolveWith = async (grants: Record<string, unknown>[], principalId: string | undefined) => {
      const index = mkIndex([row()], grants);
      const resolver = createRunStartResolver({ isEnabled: async () => true, getIndex: () => index, readRows: async () => manifestRows(patch) });
      const r = await resolver.resolve({ runId: "run", sessionId: "S", ...(principalId ? { principalId } : {}), preset: "standard", baseTools: PRESET_TOOLS.standard });
      if (!r.enabled || r.refused) throw new Error("expected resolved");
      return r;
    };
    test("a principal without harness.modify gets no patch; the refusal is recorded", async () => {
      const r = await resolveWith([{ ...agentGrant, permissions: ["skill.load"] }, rootGrant], "wb-agent:coding");
      expect(r.instructions).not.toContain("PATCH-APPLIED");
      expect(r.decisions?.[0]?.payload).toMatchObject({ outcome: "refused", reasonCode: "beyond-grant", operation: "harness.apply" });
    });
    test("no principal, or a revoked root grant, gets no patch", async () => {
      expect((await resolveWith([agentGrant, rootGrant], undefined)).instructions).not.toContain("PATCH-APPLIED");
      expect((await resolveWith([agentGrant], "wb-agent:coding")).instructions).not.toContain("PATCH-APPLIED");
    });
    test("control: principal grant and root both cover harness.modify", async () => {
      expect((await resolveWith([agentGrant, rootGrant], "wb-agent:coding")).instructions).toContain("PATCH-APPLIED");
    });
  });

  describe("B3 the resolver uses the dispatcher's governing-row selection", () => {
    const rows = [row(), row({ sessionId: "S", state: "suspended", suspensionReasons: ["operator-yank"] })];
    const resolve = async (sessionId: string | undefined) => {
      const index = mkIndex(rows, [agentGrant, rootGrant]);
      const r = await createRunStartResolver({ isEnabled: async () => true, getIndex: () => index, readRows: async () => manifestRows(patch) }).resolve({ runId: "run", ...(sessionId ? { sessionId } : {}), principalId: "wb-agent:coding", preset: "standard", baseTools: PRESET_TOOLS.standard });
      if (!r.enabled || r.refused) throw new Error("expected resolved");
      return r;
    };
    test("a suspended session row governs: the persistent row's patch and descriptor are not assembled", async () => {
      const r = await resolve("S");
      expect(r.instructions).not.toContain("PATCH-APPLIED");
      expect(r.instructions).not.toContain(CAP);
    });
    test("a run with no session cannot dodge the session-scoped suspension either", async () => {
      expect((await resolve(undefined)).instructions).not.toContain("PATCH-APPLIED");
    });
    test("another session is unaffected (control)", async () => {
      expect((await resolve("T")).instructions).toContain("PATCH-APPLIED");
    });
  });

  describe("B4 activation re-checks authorization at the commit", () => {
    test("the activator's grant revoked while the handle mounts: no activation is committed", async () => {
      await withTempHome(async (home) => {
        let revoke: (() => Promise<unknown>) | undefined;
        const { app, client } = await bootApp(home, { capabilityRuntimeHooks: { beforeMount: async () => { await revoke?.(); } } });
        try {
          await enableCapabilityRuntime(app, client);
          const dir = join(home, "authoring", "r2");
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, "GUIDE.md"), "# r2");
          await registerBundle(app, client, { capabilityId: CAP, sourceDir: dir, manifest: { name: "r2", purpose: "stale", skills: [{ name: "guide", entry: "GUIDE.md" }], requirements: ["capability.invoke", "skill.load"] } });
          await client.invoke("authority.grant.issue", { grantId: "grant-r2", principalId: "wb-agent:r2", permissions: ["bundle.activate", "capability.invoke", "skill.load"] });
          await waitUntil("grant indexed", async () => (await client.invoke("authority.grant.list", {}) as { grants: { grantId: string }[] }).grants.some((g) => g.grantId === "grant-r2"));
          revoke = () => client.invoke("authority.grant.revoke", { grantId: "grant-r2" });
          await expect(app.runtime.service.invoke({ actor: { id: "wb-agent:r2", kind: "agent" }, tenant: LOCAL_OPERATOR.tenant } as never, { capability: "capability.bundle.activate", input: { capabilityId: CAP } as never })).rejects.toThrow(/stale at commit|no active grant/);
          await new Promise((r) => setTimeout(r, 300));
          const activation = (await wbRows(app)).get(`activation/${CAP}/user`) as { state?: string } | undefined;
          expect(activation?.state === "active").toBe(false);
        } finally {
          await app.runtime.idle().catch(() => {});
          await app.stop();
        }
      });
    }, 90000);
  });

  describe("B5 the bytes returned are the bytes verified", () => {
    test("a file swapped concurrently with load is never returned; every ok result is the registered content", async () => {
      await withTempHome(async (home) => {
        const dir = join(home, "bundle");
        await mkdir(dir, { recursive: true });
        const good = "GOOD-CONTENT\n".repeat(50);
        await writeFile(join(dir, "G.md"), good);
        const manifest = { name: "n", purpose: "p", skills: [{ name: "guide", entry: "G.md" }] };
        const { scanBundle } = await import("../src/capabilities/bundleStore.ts");
        const versionHash = versionHashFor((await scanBundle(dir)).manifest, manifest);
        let stop = false;
        const swapper = (async () => {
          while (!stop) {
            await writeFile(join(dir, "G.md"), "EVIL\n".repeat(60));
            await writeFile(join(dir, "G.md"), good);
          }
        })();
        let leaked = 0;
        for (let i = 0; i < 150; i++) {
          const r = await loadSkill({ capabilityId: CAP, versionHash, dir, manifest }, "guide");
          if (r.ok && r.result.content !== good) leaked += 1;
        }
        stop = true;
        await swapper;
        expect(leaked).toBe(0);
      });
    }, 60000);
  });

  describe("B6 the aggregate descriptor budget counts the joining newlines", () => {
    test("thousands of tiny descriptors never exceed the 4,000-token section", () => {
      const tiny = (i: number): Descriptor => ({ capabilityId: `c${String(i).padStart(5, "0")}`, version: "v", text: "abcd", tokens: 1, truncated: false });
      const section = assembleDescriptorSection(Array.from({ length: 4200 }, (_, i) => tiny(i)));
      expect(section.tokens).toBeLessThanOrEqual(DESCRIPTOR_BUDGETS.aggregateTokens);
      expect(section.omitted.length).toBeGreaterThan(0);
    });
  });
});
