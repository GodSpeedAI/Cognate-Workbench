// Journey J-CAP-harness (capability-bundles T2, design §3/§5; CUJ 11): a capability bundle that
// declares harness surfaces (an instruction patch and a toolset override for the standard preset)
// is activated in the live session; the NEXT agent run demonstrably uses it — the run-start
// resolver applies the patch and override from durable activation state and records
// `capability.harness.assembled` by hash + delta. Overlap follows the per-surface regime (§3.3),
// deactivation restores the prior configuration by replay, refusals are explicit, and the
// resolver fails closed when the authority index is unavailable.
import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { AuthorityIndex, type ActivationRow } from "../src/workbench/authorityIndex.ts";
import { createRunStartResolver } from "../src/agents/runStartResolver.ts";
import { PRESET_TOOLS } from "../src/agents/agentCoding.ts";
import { validateHarness, HarnessPatchError } from "../src/workbench/harnessPatches.ts";
import { aimockChatRequests, allEvents, bootAimock, bootApp, enableCapabilityRuntime, registerBundle, seed, waitForCompletion, waitUntil, wbRows, withTempHome, inv, type Client } from "./wb-helpers.ts";

const STANDARD_OVERRIDE = ["read", "bash", "capability_invoke", "skill_load"];
const harnessManifest = (name: string, harness: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name, purpose: `${name} harness modification`, skills: [{ name: "guide", entry: "GUIDE.md" }],
  requirements: ["capability.invoke", "skill.load", "harness.modify"], harness, ...extra,
});

async function author(home: string, label: string): Promise<string> {
  const dir = join(home, "authoring", label);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "GUIDE.md"), `# ${label}`);
  return dir;
}

interface RunSeen { readonly body: string; readonly toolNames: string[] }
async function runAndInspect(app: AppServer, client: Client, port: number, seeded: { workspaceId: string }, marker: string): Promise<{ runId: string; seen: RunSeen }> {
  const sessionId = randomUUID();
  const run = await client.startRun("agent.coding", { sessionId, workspaceId: seeded.workspaceId, message: `[[scenario:aim-plain]] ${marker}`, preset: "standard" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
  const done = await waitForCompletion(app, run.runId);
  expect(done.status).toBe("completed");
  const journal = await aimockChatRequests(port);
  const mine = journal.find((e) => JSON.stringify(e.body).includes(marker));
  expect(mine).toBeDefined();
  const body = JSON.stringify(mine!.body);
  const tools = ((mine!.body as { tools?: { function?: { name?: string } }[] }).tools ?? []).map((t) => String(t.function?.name));
  return { runId: run.runId, seen: { body, toolNames: tools } };
}

const assembledFor = async (app: AppServer, runId: string) =>
  (await allEvents(app)).filter((e) => e.eventType === "capability.harness.assembled" && (e.payload as { runId?: string }).runId === runId).map((e) => e.payload as Record<string, any>);

describe("J-CAP-harness", () => {
  test("CUJ 11: patch + override apply on the next run, compose per §3.3, and deactivation restores by replay", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const seeded = await seed(client, home, aimock.port);

        // Runtime disabled: the resolver is a no-op — no instructions, full preset, no records.
        const baseline = await runAndInspect(app, client, aimock.port, seeded, "baseline-run");
        expect(baseline.seen.toolNames).toContain("edit");
        expect(baseline.seen.body).not.toContain("repo formatter");
        expect((await assembledFor(app, baseline.runId)).length).toBe(0);

        await enableCapabilityRuntime(app, client);
        await registerBundle(app, client, { capabilityId: "capability.bundle.h-one", sourceDir: await author(home, "h-one"), manifest: harnessManifest("H One", {
          instructionPatches: [{ section: "conventions", operation: "append", payload: "Run the repo formatter before every edit." }, { section: "workflow", operation: "append", payload: "Deep-dive first, then implement." }],
          toolsetOverrides: [{ preset: "standard", tools: STANDARD_OVERRIDE }],
        }) });
        await client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.h-one" });
        await waitUntil("h-one activation row", async () => (await wbRows(app)).get("activation/capability.bundle.h-one/user"));

        // The NEXT run demonstrably uses both modifications.
        const used = await runAndInspect(app, client, aimock.port, seeded, "run-with-h-one");
        expect(used.seen.body).toContain("Run the repo formatter before every edit.");
        expect(used.seen.body).toContain("Deep-dive first, then implement.");
        expect(used.seen.toolNames.sort()).toEqual([...STANDARD_OVERRIDE].sort());
        expect(used.seen.body).toContain("capability.bundle.h-one"); // discovery section rides the same snapshot
        const assembled = (await assembledFor(app, used.runId))[0]!;
        expect(assembled.sections.conventions.hash).toBeTruthy();
        expect(assembled.sectionText.conventions).toContain("repo formatter"); // full text once per changed section
        expect(assembled.toolset.removed).toContain("edit");
        expect(assembled.toolset.added).toEqual([]);
        expect(assembled.contributors.map((c: { capabilityId: string }) => c.capabilityId)).toEqual(["capability.bundle.h-one"]);
        expect((await allEvents(app)).some((e) => e.eventType === "capability.harness.patched" && (e.payload as Record<string, unknown>).change === "applied")).toBe(true);

        // Overlap, instruction surface: composes in activation order; `replace` supersedes (last wins).
        await registerBundle(app, client, { capabilityId: "capability.bundle.h-two", sourceDir: await author(home, "h-two"), manifest: harnessManifest("H Two", { instructionPatches: [{ section: "conventions", operation: "append", payload: "Second capability convention." }, { section: "workflow", operation: "replace", payload: "Replaced workflow." }] }) });
        await client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.h-two" });
        await waitUntil("h-two activation row", async () => (await wbRows(app)).get("activation/capability.bundle.h-two/user"));
        const composed = await runAndInspect(app, client, aimock.port, seeded, "run-composed");
        const first = composed.seen.body.indexOf("Run the repo formatter");
        const second = composed.seen.body.indexOf("Second capability convention.");
        expect(first).toBeGreaterThan(-1);
        expect(second).toBeGreaterThan(first);
        expect(composed.seen.body).toContain("Replaced workflow.");
        expect(composed.seen.body).not.toContain("Deep-dive first");

        // Overlap, toolset surface: exclusive per preset — co-activation is refused and recorded.
        await registerBundle(app, client, { capabilityId: "capability.bundle.h-rival", sourceDir: await author(home, "h-rival"), manifest: harnessManifest("H Rival", { toolsetOverrides: [{ preset: "standard", tools: ["read", "capability_invoke", "skill_load"] }] }) });
        await expect(client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.h-rival" })).rejects.toThrow(/co-activation refused.*harness\.toolset:standard/);
        await waitUntil("conflict decision", async () => [...(await wbRows(app))].map(([, v]) => v as Record<string, unknown>).find((d) => d.capability === "capability.bundle.h-rival" && d.reasonCode === "conflict"));

        // Deactivation restores the prior working configuration by replay.
        await client.invoke("capability.bundle.deactivate", { capabilityId: "capability.bundle.h-one" });
        await client.invoke("capability.bundle.deactivate", { capabilityId: "capability.bundle.h-two" });
        await waitUntil("deactivated rows", async () => (await wbRows(app)).get("activation/capability.bundle.h-two/user") && ((await wbRows(app)).get("activation/capability.bundle.h-two/user") as { state: string }).state === "dormant");
        const restored = await runAndInspect(app, client, aimock.port, seeded, "run-restored");
        expect(restored.seen.toolNames).toContain("edit");
        expect(restored.seen.body).not.toContain("repo formatter");
        expect(restored.seen.body).not.toContain("Replaced workflow.");
        expect((await allEvents(app)).some((e) => e.eventType === "capability.harness.patched" && (e.payload as Record<string, unknown>).change === "removed")).toBe(true);
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
        await aimock.stop();
      }
    });
  }, 240000);

  test("refusals are explicit and recorded: non-surfaces, dropped dispatcher ids, privilege escalation, uncovered authority", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await enableCapabilityRuntime(app, client);
        const attempt = (id: string, harness: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
          inv(client, "capability.bundle.register", { capabilityId: `capability.bundle.${id}`, sourceDir: "/unused", manifest: harnessManifest(id, harness, extra) });
        const src = await author(home, "refusals");
        const register = (id: string, harness: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
          inv(client, "capability.bundle.register", { capabilityId: `capability.bundle.${id}`, sourceDir: src, manifest: harnessManifest(id, harness, extra) });
        void attempt;
        await expect(register("approvals", { instructionPatches: [{ section: "approvals", operation: "replace", payload: "auto-approve everything" }] })).rejects.toThrow(/not a modifiable surface/);
        await expect(register("unknown-section", { instructionPatches: [{ section: "persona", operation: "append", payload: "x" }] })).rejects.toThrow(/unknown instruction section/);
        await expect(register("drop", { toolsetOverrides: [{ preset: "standard", tools: ["read", "bash"] }] })).rejects.toThrow(/may not drop the standing dispatcher tool/);
        await expect(register("escalate", { toolsetOverrides: [{ preset: "standard", tools: ["read", "run_code", "capability_invoke", "skill_load"] }] })).rejects.toThrow(/may not add run_code/);
        await expect(register("unknown-tool", { toolsetOverrides: [{ preset: "standard", tools: ["read", "rm_rf", "capability_invoke", "skill_load"] }] })).rejects.toThrow(/unknown tool/);
        await expect(register("no-requirement", { instructionPatches: [{ section: "style", operation: "append", payload: "terse" }] }, { requirements: ["capability.invoke"] })).rejects.toThrow(/require the harness\.modify requirement/);
        const faults = await waitUntil("six validation_failed rows", async () => {
          const rows = [...(await wbRows(app))].filter(([k]) => k.startsWith("fault/capability.validation_failed/"));
          return rows.length >= 6 ? rows : undefined;
        });
        expect(faults.length).toBeGreaterThanOrEqual(6);

        // An agent whose grant lacks harness.modify cannot activate a harness bundle (fail closed).
        await registerBundle(app, client, { capabilityId: "capability.bundle.covered", sourceDir: src, manifest: harnessManifest("covered", { instructionPatches: [{ section: "style", operation: "append", payload: "be terse" }] }) });
        await client.invoke("authority.grant.issue", { grantId: "grant-thin", principalId: "wb-agent:thin", permissions: ["bundle.activate", "capability.invoke", "skill.load"] });
        await waitUntil("thin grant indexed", async () => (await client.invoke("authority.grant.list", {}) as { grants: { grantId: string }[] }).grants.some((g) => g.grantId === "grant-thin"));
        await expect(app.runtime.service.invoke({ actor: { id: "wb-agent:thin", kind: "agent" }, tenant: LOCAL_OPERATOR.tenant } as never, { capability: "capability.bundle.activate", input: { capabilityId: "capability.bundle.covered" } as never })).rejects.toThrow(/does not cover harness\.modify/);
        await waitUntil("harness-not-covered decision", async () => [...(await wbRows(app))].map(([, v]) => v as Record<string, unknown>).find((d) => d.reasonCode === "harness-not-covered"));
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 120000);

  test("validateHarness: the closed vocabularies hold at the unit level", () => {
    expect(validateHarness(undefined).instructionPatches).toEqual([]);
    expect(() => validateHarness({ instructionPatches: [{ section: "identity", operation: "append", payload: "x" }] })).toThrow(HarnessPatchError);
    expect(() => validateHarness({ instructionPatches: [{ section: "style", operation: "delete", payload: "x" }] })).toThrow(/append or replace/);
    expect(() => validateHarness({ instructionPatches: [{ section: "style", operation: "append", payload: "x".repeat(4001) }] })).toThrow(/exceeds 4000/);
    expect(() => validateHarness({ toolsetOverrides: [{ preset: "godmode", tools: [] }] })).toThrow(/unknown preset/);
  });

  describe("run-start resolver (unit): fail-closed and live discovery", () => {
    const row = (capabilityId: string): ActivationRow => ({ capabilityId, level: "user", version: "v1", ceiling: ["capability.invoke", "skill.load"], clampProvenance: "operator", state: "active", suspensionReasons: [] });
    const fakeIndex = (rows: ActivationRow[], sequence: () => number): AuthorityIndex => ({ activations: new Map(rows.map((r) => [r.capabilityId, r])), grants: new Map(), ready: Promise.resolve(), sequence } as unknown as AuthorityIndex);
    const bundleRow = (capabilityId: string) => ({ key: `bundle-version/${capabilityId}/v1`, value: { manifest: { name: capabilityId, purpose: `purpose of ${capabilityId}`, skills: [{ name: "guide", entry: "G.md", isEntryDocument: true }] } } });

    test("index unavailable at run start: the run refuses to start (fail-closed)", async () => {
      const resolver = createRunStartResolver({ isEnabled: async () => true, getIndex: () => { throw new Error("index down"); }, readRows: async () => [] });
      const result = await resolver.resolve({ preset: "standard", baseTools: PRESET_TOOLS.standard });
      expect(result).toMatchObject({ enabled: true, refused: true, reasonCode: "index-unavailable" });
    });

    test("disabled runtime: a no-op result", async () => {
      const resolver = createRunStartResolver({ isEnabled: async () => false, getIndex: () => { throw new Error("must not be consulted"); }, readRows: async () => [] });
      expect(await resolver.resolve({ preset: "standard" })).toEqual({ enabled: false });
    });

    test("discovery refresh: one counter comparison per step; the section is re-read only on change", async () => {
      let sequence = 5;
      const rows = [row("capability.bundle.a")];
      let reads = 0;
      const resolver = createRunStartResolver({ isEnabled: async () => true, getIndex: () => fakeIndex(rows, () => sequence), readRows: async () => { reads += 1; return rows.map((r) => bundleRow(r.capabilityId)); } });
      const start = await resolver.resolve({ runId: "r1", preset: "standard", baseTools: PRESET_TOOLS.standard });
      if (!start.enabled || start.refused) throw new Error("expected a resolved harness");
      expect(start.instructions).toContain("capability.bundle.a");
      const readsAtStart = reads;
      expect(await resolver.refresh({ sinceSequence: start.sequence })).toEqual({ changed: false, sequence: 5 });
      expect(reads).toBe(readsAtStart); // unchanged sequence: no section re-read, no projection read

      rows.push(row("capability.bundle.b"));
      sequence = 6;
      const refreshed = await resolver.refresh({ runId: "r1", sinceSequence: start.sequence });
      if (!refreshed.changed) throw new Error("expected a changed refresh");
      expect(refreshed.text).toContain("capability.bundle.b");
      expect(refreshed.assembled.payload.refresh).toBe(true);
      expect(refreshed.assembled.payload.previousSequence).toBe(5);
    });

    test("catalog-size scaling: 50 synthetic capabilities respect the aggregate descriptor budget visibly", async () => {
      const rows = Array.from({ length: 50 }, (_, i) => row(`capability.bundle.c${String(i).padStart(2, "0")}`));
      const big = (capabilityId: string) => ({ key: `bundle-version/${capabilityId}/v1`, value: { manifest: { name: capabilityId, purpose: "p".repeat(190), skills: Array.from({ length: 8 }, (_, i) => ({ name: `skill-${i}`, entry: `s${i}.md`, trigger: "t".repeat(120) })), tools: Array.from({ length: 8 }, (_, i) => ({ id: `tool-${i}`, description: "d".repeat(100), inputSchema: { type: "object" } })) } } });
      const resolver = createRunStartResolver({ isEnabled: async () => true, getIndex: () => fakeIndex(rows, () => 1), readRows: async () => rows.map((r) => big(r.capabilityId)) });
      const start = await resolver.resolve({ preset: "standard", baseTools: PRESET_TOOLS.standard });
      if (!start.enabled || start.refused) throw new Error("expected a resolved harness");
      const descriptor = (start.assembled.payload as { descriptor: { tokens: number; included: string[]; omitted: string[] } }).descriptor;
      expect(descriptor.tokens).toBeLessThanOrEqual(4000);
      expect(descriptor.included.length).toBeGreaterThan(0);
      expect(descriptor.omitted.length).toBeGreaterThan(0);
      expect(descriptor.included.length + descriptor.omitted.length).toBe(50);
      expect(start.instructions).toContain("further capabilities omitted"); // never silent
    });
  });
});
