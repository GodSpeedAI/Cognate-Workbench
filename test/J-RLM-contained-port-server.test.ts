// J-RLM-contained-port wiring (SEA-Forge #114): the real server with and without `rlmContainedPort`.
// The spawn path is the `agent.rlm` child run, and it must sit behind `governedRlmComponent`'s admission
// and grant checks: only a child the governed rlm.invoke admitted may reach the spawn port. A stand-in
// launcher records every invocation, so no bubblewrap is needed: this test is about WHO can reach the port.
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { Json } from "@godspeedai/cognate-events";
import type { GovernedOperation } from "@godspeedai/cognate-runtime-bun";
import type { InvocationView, ProviderFacts, RlmInvokeRequest, RlmProvider } from "@godspeedai/cognate-runtime-api";
import { RLM_AGENT_ID, RLM_CAPABILITIES } from "@godspeedai/cognate-runtime-api";
import type { ContainedStdioPortConfig } from "../src/capabilities/containedLaunch.ts";
import { containedStdioSpawnPort } from "../src/capabilities/containedStdioPort.ts";
import { profileAuthorize } from "../src/capabilities/containedProfileAuthority.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { collaborationResponder, configureDefaultRoutes, invoke, waitForAssignment, withExpertApp, type FakeResponder } from "./expert-helpers.ts";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

interface Recorder { readonly invokes: RlmInvokeRequest[]; readonly spawns: string[] }

function containedProvider(id: string, config: ContainedStdioPortConfig, exe: string, cwd: string): RlmProvider & Recorder {
  const facts: ProviderFacts = {
    capabilities: { maxDepth: 2, contextDecomposition: true, providerInternalSubagents: false, streaming: true, isolation: "process", resultDelivery: "return", cancellation: "process", paymentMetering: "unreported" },
    toolPolicy: "contained",
    executable: { version: "1", sha256: sha("exe") },
  };
  const state: Recorder = { invokes: [], spawns: [] };
  const views = new Map<string, InvocationView>();
  const provider: RlmProvider = {
    id,
    async probe() { return facts; },
    async invoke(req, spawn, ctx) {
      state.invokes.push(req);
      try {
        await spawn.spawn({ argv: [exe], cwd, env: {}, restrictions: {} }, { intentId: ctx.runId, runId: ctx.runId });
        state.spawns.push("spawned");
      } catch (error) { state.spawns.push(String((error as Error).message)); }
      views.set(ctx.runId, { status: "completed", evidence: [`${id}:done`], payment: { currency: "money", spent: "unknown", basis: "unmeasured" }, isolation: "process", lastEventAt: new Date().toISOString(), resultRef: `result:${id}` });
      return { runId: ctx.runId };
    },
    async inspect(runId) { return views.get(runId)!; },
    async cancel() {},
  };
  return Object.assign(provider, { invokes: state.invokes, spawns: state.spawns });
}

const portGovernance = { world: "contained-streaming", reach: { filesystem: "workspace-ro", network: "none", process: "group-kill", lifetime: "parent-death" }, evidence: "process-ledger" } as const;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "contained-server-"));
  const bin = join(root, "bin"); const ws = join(root, "ws");
  await mkdir(bin); await mkdir(ws);
  const marker = join(root, "launcher-ran");
  const launcherText = `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "bubblewrap 0.13.1"; exit 0; fi\necho "$@" >> ${marker}\nexit 0\n`;
  const exeText = "#!/bin/sh\necho child\n";
  await writeFile(join(bin, "bwrap"), launcherText); await chmod(join(bin, "bwrap"), 0o755);
  await writeFile(join(bin, "child"), exeText); await chmod(join(bin, "child"), 0o755);
  const config: ContainedStdioPortConfig = { launcher: { path: join(bin, "bwrap"), sha256: sha(launcherText) }, executables: [{ path: join(bin, "child"), sha256: sha(exeText) }], workspaceRoot: ws, writableRoots: [] };
  const exe = join(bin, "child");
  // What an operator writes into policy: the execution profile digest of this provider's spawn spec.
  const profileDigest = (await containedStdioSpawnPort(config).executionProfile({ argv: [exe], cwd: ws, env: {}, restrictions: {} })).digest;
  return { root, ws, marker, exe, config, profileDigest };
}

/** The server's #116 authority route, with a stand-in SEA-Forge whose policy lists `allowed` profile digests. */
function withAuthority(config: ContainedStdioPortConfig, allowed: readonly string[]): { config: ContainedStdioPortConfig; asked: string[] } {
  const asked: string[] = [];
  const authority = { decide: async (operation: GovernedOperation) => {
    const digest = String(operation.kind === "capability" ? operation.claims?.execution_profile_digest ?? "" : "");
    asked.push(digest);
    return allowed.includes(digest) ? { disposition: "boundary" as const, reason: "ok", constraints: [{ type: "execution_profile", value: digest }], decisionRef: "L-1" } : { disposition: "deny" as const, reason: "no profile rule" };
  } };
  return { config: { ...config, authorize: profileAuthorize({ authority, worldRef: `world:t@sha256:${"a".repeat(64)}`, actor: { id: "system", kind: "system" }, tenant: "local" }) }, asked };
}
const markerLines = async (marker: string): Promise<number> => (existsSync(marker) ? (await readFile(marker, "utf8")).split("\n").filter(Boolean).length : 0);

const cases: Record<string, readonly { id: string; args: Record<string, Json> }[]> = {};
const responder: FakeResponder = async (route, request) => {
  if (route.model !== "pm-model") return collaborationResponder(route, request);
  const name = /CASE:([a-z0-9-]+)/.exec(JSON.stringify(request.messages))?.[1];
  const planned = name ? cases[name] : undefined;
  if (planned && !request.messages.some((m) => m.role === "tool")) {
    return { message: { role: "assistant", content: "" }, toolCalls: planned.map((c) => ({ id: c.id, name: "rlm_delegate", arguments: c.args })), finishReason: "tool_calls", model: route.model };
  }
  return { message: { role: "assistant", content: "done" }, toolCalls: [], finishReason: "stop", model: route.model };
};

describe("J-RLM-contained-port wiring", () => {
  test("without rlmContainedPort a contained provider is refused (today's behaviour) and nothing spawns", async () => {
    const f = await fixture();
    try {
      const provider = containedProvider("cp", f.config, f.exe, f.ws);
      await withExpertApp(responder, async (t) => {
        await configureDefaultRoutes(t);
        const listed = await invoke(t, RLM_CAPABILITIES.providers, {}) as { providers: { id: string; workbench: { admitted: boolean; refusalCode?: string } }[] };
        expect(listed.providers[0]!.workbench).toMatchObject({ admitted: false, refusalCode: "rlm-containment-unavailable" });
      }, { rlmProviders: [{ provider, label: "cp", portGovernance }] });
      expect(provider.invokes).toEqual([]);
      expect(await markerLines(f.marker)).toBe(0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

  test("with rlmContainedPort the governed flow reaches the port, and a directly started agent.rlm run does not", async () => {
    const f = await fixture();
    try {
      const provider = containedProvider("cp", f.config, f.exe, f.ws);
      const authority = withAuthority(f.config, [f.profileDigest]);
      await withExpertApp(responder, async (t) => {
        await configureDefaultRoutes(t);
        const current = (await t.state()).experts["product-manager"]!;
        await invoke(t, "expert.save", { expertId: "product-manager", name: current.name, specialization: current.definition.specialization, instructions: current.definition.instructions, tools: current.definition.tools, route: current.definition.route, budget: { contextTokens: 32000, maxOutputTokens: 400, maxCostUsd: 5, prices: { inputUsdPerMillion: 1, outputUsdPerMillion: 1 } } });
        const listed = await invoke(t, RLM_CAPABILITIES.providers, {}) as { providers: { workbench: { admitted: boolean } }[] };
        expect(listed.providers[0]!.workbench.admitted).toBe(true);

        // Control: the governed path spawns (the stand-in launcher is invoked for the preflight and the spawn).
        cases.governed = [{ id: "c1", args: { purpose: "Investigate recursively", acceptance: ["Report"], contextRefs: ["assignment"], tools: ["read"], budget: { limit: 0.5 } } }];
        const started = await invoke(t, "team.converse", { teamId: "cognate-team", workspaceId: t.workspaceId, message: "CASE:governed", requestId: "contained-governed", rlmProvider: "cp" }) as { assignmentId: string };
        await waitForAssignment(t, started.assignmentId, (a) => !!a.handoff && !["queued", "running", "waiting"].includes(a.status), 90_000);
        expect(provider.invokes).toHaveLength(1);
        expect(provider.spawns).toEqual(["spawned"]);
        await Bun.sleep(300); // the stand-in launcher writes after spawn returns
        const governedLines = await markerLines(f.marker);
        expect(governedLines).toBeGreaterThanOrEqual(2);

        // Attack: replay the genuine admission. The child input the governed rlm.invoke derived is recorded in the child run.
        const [genuine] = await t.app.runtime.service.listRuns(LOCAL_OPERATOR, { agent: RLM_AGENT_ID });
        const real = genuine!.input as Record<string, unknown>;
        const terminal = async (runId: string): Promise<string> => {
          let status = "";
          for (let i = 0; i < 200 && !["failed", "completed", "cancelled"].includes(status); i++) { await Bun.sleep(50); status = (await t.app.runtime.service.getRun(LOCAL_OPERATOR, { runId })).status; }
          return status;
        };
        const replays: Record<string, Record<string, unknown>> = {
          identicalSecondUse: real,
          widenedAuthority: { ...real, authority: { tools: ["read", "bash"], mode: "read-only" } },
          biggerBudget: { ...real, budget: { ...(real.budget as object), limit: 50 } },
        };
        for (const [name, replayInput] of Object.entries(replays)) {
          const replay = await t.app.runtime.service.startRun(LOCAL_OPERATOR, { agent: RLM_AGENT_ID, idempotencyKey: `replay-${name}`, correlationId: genuine!.correlationId ?? `rlm:replay:${name}`, input: replayInput as unknown as Json });
          expect(await terminal(replay.runId)).toBe("failed");
          const failure = String(((await t.app.runtime.service.getRun(LOCAL_OPERATOR, { runId: replay.runId })) as { error?: unknown }).error ?? "");
          if (name === "identicalSecondUse") expect(failure).toContain("parent run's principal"); // the operator is not the parent's agent principal
          expect(provider.invokes).toHaveLength(1); // never invoked again
          expect(await markerLines(f.marker)).toBe(governedLines); // and the launcher never ran again
        }

        // Attack: start the agent.rlm child run directly, bypassing rlm.invoke's grant, depth and reservation checks.
        const forged = await t.app.runtime.service.startRun(LOCAL_OPERATOR, {
          agent: RLM_AGENT_ID, idempotencyKey: "forged-direct", correlationId: "rlm:forged:forged",
          input: { invocationId: "forged:rlm:forged", providerId: "cp", runId: "forged", depth: 1, maxDepth: 2, task: { purpose: "x", acceptance: [], contextRefs: [], contextDigest: "0".repeat(64) }, authority: { tools: ["bash"], mode: "read-only" }, budget: { currency: "money", limit: 1 } } as unknown as Json,
        });
        let status = "";
        for (let i = 0; i < 200 && !["failed", "completed", "cancelled"].includes(status); i++) {
          await Bun.sleep(50);
          status = (await t.app.runtime.service.getRun(LOCAL_OPERATOR, { runId: forged.runId })).status;
        }
        expect(status).toBe("failed");
        expect(provider.invokes).toHaveLength(1); // the provider was never invoked for the forged child
        expect(await markerLines(f.marker)).toBe(governedLines); // and the launcher never ran again
      }, { rlmProviders: [{ provider, label: "cp", portGovernance }], rlmContainedPort: authority.config });
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }, 120_000);

  test("#116: with no policy for the profile the governed flow reaches the port but SEA-Forge's deny stops the sandbox; with the digest in policy it spawns", async () => {
    const f = await fixture();
    try {
      const provider = containedProvider("cp", f.config, f.exe, f.ws);
      const denied = withAuthority(f.config, []);
      await withExpertApp(responder, async (t) => {
        await configureDefaultRoutes(t);
        const current = (await t.state()).experts["product-manager"]!;
        await invoke(t, "expert.save", { expertId: "product-manager", name: current.name, specialization: current.definition.specialization, instructions: current.definition.instructions, tools: current.definition.tools, route: current.definition.route, budget: { contextTokens: 32000, maxOutputTokens: 400, maxCostUsd: 5, prices: { inputUsdPerMillion: 1, outputUsdPerMillion: 1 } } });
        cases.denied = [{ id: "c1", args: { purpose: "Investigate recursively", acceptance: ["Report"], contextRefs: ["assignment"], tools: ["read"], budget: { limit: 0.5 } } }];
        const started = await invoke(t, "team.converse", { teamId: "cognate-team", workspaceId: t.workspaceId, message: "CASE:denied", requestId: "contained-denied", rlmProvider: "cp" }) as { assignmentId: string };
        await waitForAssignment(t, started.assignmentId, (a) => !!a.handoff && !["queued", "running", "waiting"].includes(a.status), 90_000);
        expect(denied.asked).toEqual([f.profileDigest]);                       // SEA-Forge was asked about exactly this profile
        expect(provider.spawns).toHaveLength(1);
        expect(provider.spawns[0]).toContain("rlm-profile-unauthorized");
        expect(await markerLines(f.marker)).toBeLessThanOrEqual(1);            // at most the namespace preflight: no sandbox launched
        expect(existsSync(f.marker) ? (await readFile(f.marker, "utf8")).includes("--serve") : false).toBe(false);
      }, { rlmProviders: [{ provider, label: "cp", portGovernance }], rlmContainedPort: denied.config });
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }, 120_000);

  test("#116: a contained port with neither SEA-Forge governance nor an explicit authorize hook is refused at startup", async () => {
    const f = await fixture();
    try {
      await expect(withExpertApp(responder, async () => {}, { rlmContainedPort: f.config })).rejects.toThrow(/authority decision/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }, 60_000);
});
