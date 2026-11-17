// Journey J-CAP-refusal (capability-bundles T2, design §1.4/§2.3/§2.5; CUJ 4 bundle-path matrix
// plus the enablement-gate variant). Every forged or out-of-authority attempt on the bundle path
// is refused at its traced enforcement point, with an explicit structured envelope, AND durably
// recorded in `authority.decision.recorded` with a reason code and the deciding point.
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { capabilityRuntimeComponent } from "../src/capabilities/capabilityRuntime.ts";
import { authorityGrantsComponent } from "../src/capabilities/authorityGrants.ts";
import { capabilityBundlesComponent } from "../src/capabilities/capabilityBundles.ts";
import { AuthorityIndex } from "../src/workbench/authorityIndex.ts";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";
import { bootApp, enableCapabilityRuntime, registerBundle, SYSTEM, waitForRow, waitUntil, wbRows, withTempHome } from "./wb-helpers.ts";

const agent = (id: string) => ({ actor: { id, kind: "agent" as const }, tenant: LOCAL_OPERATOR.tenant });
const invokeAs = (app: AppServer, caller: { actor: { id: string; kind: "agent" | "system" | "user" }; tenant: string }, capability: string, input: unknown) =>
  app.runtime.service.invoke(caller as never, { capability, input: input as never }) as Promise<Record<string, unknown>>;

async function author(home: string, label: string): Promise<string> {
  const dir = join(home, "authoring", label);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "GUIDE.md"), `# ${label}`);
  return dir;
}
const manifestOf = (requirements: string[]) => ({ name: "Refusal Demo", purpose: "refusal matrix", skills: [{ name: "guide", entry: "GUIDE.md" }], tools: [{ id: "echo", description: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } }], requirements });

async function decisionWhere(app: AppServer, match: (d: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return waitUntil("decision record", async () => [...(await wbRows(app))].filter(([k]) => k.startsWith("decision/")).map(([, v]) => v as Record<string, unknown>).find(match));
}

describe("J-CAP-refusal", () => {
  test("enablement gate: with the marker absent nothing mounts, activates or serves; refusals are recorded", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const registered = await registerBundle(app, client, { capabilityId: "capability.bundle.gated", sourceDir: await author(home, "gated"), manifest: manifestOf(["capability.invoke", "skill.load"]) });
        expect(registered.files).toBe(1); // registration is T1 register/validate only — harmless unenabled
        await expect(client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.gated" })).rejects.toThrow(/not enabled/);
        const served = await client.invoke("tool.skill_load", { capabilityId: "capability.bundle.gated", skillId: "guide" }) as Record<string, unknown>;
        expect(served.ok).toBe(false);
        expect(served.reasonCode).toBe("runtime-disabled");
        const decision = await decisionWhere(app, (d) => d.capability === "capability.bundle.gated" && d.reasonCode === "runtime-disabled" && d.operation === "guide");
        expect(decision.point).toBe("dispatcher");
        expect(decision.outcome).toBe("refused");

        // The operator-only enable command is itself fail-closed: marker absent => refused.
        await expect(client.invoke("capability.runtime.enable", {})).rejects.toThrow(/remediation evidence marker is absent/);
        await enableCapabilityRuntime(app, client);
        await client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.gated" });
        const ok = await client.invoke("tool.skill_load", { capabilityId: "capability.bundle.gated", skillId: "guide" }) as Record<string, unknown>;
        expect(ok.ok).toBe(true);
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 90000);

  test("CUJ 4 bundle-path matrix: forged grants, beyond-grant, beyond-ceiling, system caller, alternate path, suspension, expiry, clamp revocation", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await enableCapabilityRuntime(app, client);
        const wide = "capability.bundle.wide";
        const narrow = "capability.bundle.narrow";
        await registerBundle(app, client, { capabilityId: wide, sourceDir: await author(home, "wide"), manifest: manifestOf(["capability.invoke", "skill.load"]) });
        await registerBundle(app, client, { capabilityId: narrow, sourceDir: await author(home, "narrow"), manifest: manifestOf(["skill.load"]) });
        await client.invoke("capability.bundle.activate", { capabilityId: wide });
        await client.invoke("capability.bundle.activate", { capabilityId: narrow });

        // 1. Forged grants: the agent holds none; caller-supplied "grant" fields are inert input.
        const forged = await invokeAs(app, agent("wb-agent:probe"), "tool.skill_load", { capabilityId: wide, skillId: "guide", permissions: ["*"], grant: { permissions: ["*"] }, principalId: "wb-operator:root" });
        expect(forged.ok).toBe(false);
        expect(forged.reasonCode).toBe("no-grant");
        await decisionWhere(app, (d) => d.actorId === "wb-agent:probe" && d.reasonCode === "no-grant" && d.capability === wide);

        // 2. Beyond grant: skill.load only — the agent may load but not invoke operations.
        await client.invoke("authority.grant.issue", { grantId: "grant-probe", principalId: "wb-agent:probe", permissions: ["skill.load"] });
        await waitUntil("grant indexed", async () => (await client.invoke("authority.grant.list", {}) as { grants: { grantId: string }[] }).grants.some((g) => g.grantId === "grant-probe"));
        const loaded = await invokeAs(app, agent("wb-agent:probe"), "tool.skill_load", { capabilityId: wide, skillId: "guide" });
        expect(loaded.ok).toBe(true);
        const beyondGrant = await invokeAs(app, agent("wb-agent:probe"), "tool.capability_invoke", { capabilityId: wide, op: "tools.list" });
        expect(beyondGrant.reasonCode).toBe("beyond-grant");
        await decisionWhere(app, (d) => d.actorId === "wb-agent:probe" && d.reasonCode === "beyond-grant" && d.outcome === "refused");
        // The allowed load is recorded too (every bundle-path allow is evidence).
        await decisionWhere(app, (d) => d.actorId === "wb-agent:probe" && d.outcome === "allowed" && d.capability === wide);

        // 3. Beyond the activation ceiling: even the operator's root grant cannot widen it.
        const beyondCeiling = await client.invoke("tool.capability_invoke", { capabilityId: narrow, op: "tools.list" }) as Record<string, unknown>;
        expect(beyondCeiling.reasonCode).toBe("beyond-ceiling");
        await decisionWhere(app, (d) => d.capability === narrow && d.reasonCode === "beyond-ceiling");

        // 4. The system caller is refused at the dispatcher (anti-laundering), though policy admits the id.
        const asSystem = await invokeAs(app, SYSTEM as never, "tool.skill_load", { capabilityId: wide, skillId: "guide" });
        expect(asSystem.ok).toBe(false);
        expect(asSystem.reasonCode).toBe("system-caller");
        await decisionWhere(app, (d) => d.actorId === "system" && d.reasonCode === "system-caller");

        // 5. Alternate path: bundle ids are never kernel-resolved — direct invokes find no provider.
        await expect(invokeAs(app, LOCAL_OPERATOR as never, wide, {})).rejects.toThrow();
        await expect(invokeAs(app, agent("wb-agent:probe"), `${wide}.echo`, { text: "x" })).rejects.toThrow();

        // 6. Closed operation vocabulary and declared-schema validation.
        const unknownOp = await client.invoke("tool.capability_invoke", { capabilityId: wide, op: "shell.exec" }) as Record<string, unknown>;
        expect(unknownOp.code).toBe("unknown_operation");
        const badArgs = await client.invoke("tool.capability_invoke", { capabilityId: wide, tool: "echo", arguments: { text: 7 } }) as Record<string, unknown>;
        expect(badArgs.code).toBe("schema_invalid");
        const noHandler = await client.invoke("tool.capability_invoke", { capabilityId: wide, tool: "echo", arguments: { text: "hi" } }) as Record<string, unknown>;
        expect(noHandler.code).toBe("no_executable_handler"); // executable handlers are T3; never an in-process fallback

        // 7. Activation beyond the agent's grant is refused and recorded (the park is a later stand-in).
        await expect(invokeAs(app, agent("wb-agent:probe"), "capability.bundle.activate", { capabilityId: narrow })).rejects.toThrow(/bundle\.activate/);
        await decisionWhere(app, (d) => d.actorId === "wb-agent:probe" && d.operation === "activate" && d.reasonCode === "beyond-grant");

        // 8. Expired grant (wall clock at decision time).
        await client.invoke("authority.grant.issue", { grantId: "grant-stale", principalId: "wb-agent:stale", permissions: ["skill.load"], expiresAt: new Date(Date.now() - 60_000).toISOString() });
        await waitUntil("stale grant indexed", async () => (await client.invoke("authority.grant.list", {}) as { grants: { grantId: string }[] }).grants.some((g) => g.grantId === "grant-stale"));
        const stale = await invokeAs(app, agent("wb-agent:stale"), "tool.skill_load", { capabilityId: wide, skillId: "guide" });
        expect(stale.reasonCode).toBe("grant-expired");

        // 9. Clamp revocation: an agent-established activation dies with its clamp grant.
        await client.invoke("authority.grant.issue", { grantId: "grant-maker", principalId: "wb-agent:maker", permissions: ["bundle.activate", "capability.invoke", "skill.load"] });
        await waitUntil("maker grant indexed", async () => (await client.invoke("authority.grant.list", {}) as { grants: { grantId: string }[] }).grants.some((g) => g.grantId === "grant-maker"));
        const made = "capability.bundle.made";
        await registerBundle(app, client, { capabilityId: made, sourceDir: await author(home, "made"), manifest: manifestOf(["capability.invoke", "skill.load"]) });
        const activated = await invokeAs(app, agent("wb-agent:maker"), "capability.bundle.activate", { capabilityId: made });
        expect(activated.state).toBe("active");
        const makerRow = await waitForRow<{ clampProvenance: string }>(app, `activation/${made}/user`);
        expect(makerRow.clampProvenance).toBe("grant-maker");
        expect(((await client.invoke("tool.skill_load", { capabilityId: made, skillId: "guide" })) as Record<string, unknown>).ok).toBe(true);
        await client.invoke("authority.grant.revoke", { grantId: "grant-maker" });
        const afterRevoke = await waitUntil("suspended after revoke", async () => {
          const r = await client.invoke("tool.skill_load", { capabilityId: made, skillId: "guide" }) as Record<string, unknown>;
          return r.ok === false ? r : undefined;
        });
        expect(["suspended", "clamp-revoked"]).toContain(afterRevoke.reasonCode as string);

        // 10. Suspension blocks, and `activate` does not clear it (resumption is an explicit act).
        await new LifecycleRecorder(app.runtime.store, LOCAL_OPERATOR.tenant).commitBatch(wide, [{ type: "capability.suspended", payload: { capabilityId: wide, level: "user", reason: "operator-yank" } }]);
        const suspended = await client.invoke("tool.skill_load", { capabilityId: wide, skillId: "guide" }) as Record<string, unknown>;
        expect(suspended.reasonCode).toBe("suspended");
        await decisionWhere(app, (d) => d.capability === wide && d.reasonCode === "suspended");
        await expect(client.invoke("capability.bundle.activate", { capabilityId: wide })).rejects.toThrow(/resumption is an explicit act/);
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 180000);

  describe("principal mapping invariants (§1.6.ii/§1.6.iii)", () => {
    type Handler = (raw: unknown, ctx: unknown) => Promise<unknown>;
    const capture = (component: { activate(f: never): void }): Map<string, Handler> => {
      const handlers = new Map<string, Handler>();
      component.activate({ provide: (c: { id: string }, h: Handler) => handlers.set(c.id, h), effects: { register() {} } } as never);
      return handlers;
    };
    const inRun = { actor: { id: "operator", kind: "user" }, runId: "run-1" };

    test("the shared operator guard still refuses every human-gated handler inside a run", async () => {
      const index = { ready: Promise.resolve(), activations: new Map(), grants: new Map() } as unknown as AuthorityIndex;
      const grants = capture(authorityGrantsComponent({ getStore: () => ({}) as never, getIndex: () => index, tenant: "local", isRemediationVerified: () => true, storeKind: "pg0" }));
      const bundles = capture(capabilityBundlesComponent({ getService: () => ({}) as never, lifecycleRecorder: {} as never, authorityIndex: index, home: "/nonexistent", tenant: "local" }));
      const attempts: [Map<string, Handler>, string, unknown][] = [
        [grants, "authority.grant.issue", { principalId: "wb-agent:x", permissions: ["skill.load"] }],
        [grants, "authority.grant.revoke", { grantId: "g" }],
        [grants, "authority.grant.list", {}],
        [grants, "capability.runtime.enable", {}],
        [bundles, "capability.bundle.register", { capabilityId: "capability.bundle.x", sourceDir: "/x", manifest: {} }],
        [bundles, "capability.bundle.uninstall", { capabilityId: "capability.bundle.x" }],
      ];
      for (const [map, id, input] of attempts) {
        await expect(map.get(id)!(input, inRun)).rejects.toThrow(/human decision|only a direct/);
      }
    });

    test("a user-kind actor inside a run maps to wb-agent:coding, which with no grant is refused (the mapping grants nothing)", async () => {
      const recorded: Record<string, unknown>[] = [];
      const index = { ready: Promise.resolve(), activations: new Map(), grants: new Map(), selectActivation: () => ({ capabilityId: "c", level: "user", version: "v", ceiling: ["*"], clampProvenance: "operator", state: "active", suspensionReasons: [] }), grantFor: (principal: string) => { recorded.push({ looked: principal }); return undefined; } } as unknown as AuthorityIndex;
      const handlers = capture(capabilityRuntimeComponent({ getKernel: () => ({}) as never, getRootScope: () => ({}) as never, getService: () => ({}) as never, tenant: "local", getRecorder: () => ({}) as never, getIndex: () => index, isEnabled: async () => true, recordDecision: async (e) => { recorded.push(e.payload as Record<string, unknown>); }, activeSet: [] }));
      const result = await handlers.get("tool.skill_load")!({ capabilityId: "c", skillId: "s" }, inRun) as Record<string, unknown>;
      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe("no-grant");
      expect(recorded).toContainEqual({ looked: "wb-agent:coding" }); // not the operator root principal
      // And the operator's root principal is never consulted for an in-run call.
      expect(recorded.some((r) => r.looked === "wb-operator:root")).toBe(false);
    });
  });
});
