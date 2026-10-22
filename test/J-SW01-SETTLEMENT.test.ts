// J-SW01-SETTLEMENT (readiness P03): an agent's governed work is settled by SEA-Forge on evidence RealityTrace
// produced, never on Workbench's word. Real Workbench, real sea-forge-server (with RealityTrace corroboration),
// real RealityTrace, real bubblewrap; only the model is mocked.
//   1. The operator declares the proof before the run. An approved edit that makes it pass is settled, final.
//      The proof itself checks it ran contained and read-only, and RealityTrace's target digest equals one
//      computed here over the workspace.
//   2. An edit the proof contradicts is rejected, final.
//   3. A packet with the recorded direction flipped is refused by SEA-Forge; the settlement stands.
//   4. A run that ends while settlement is off is settled at the next boot, once: one RealityTrace evidence
//      record and one final SEA-Forge settlement, however often Workbench restarts.
// Opt-in: SEA_FORGE_SERVER_BIN (with corroboration), REALITYTRACE_BIN (with the command verifier), a
// `domainforge` CLI (WB_DOMAINFORGE_BIN or PATH), and the real-bwrap prerequisites.
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { externalAuthorityFromEnv, seaForgeCall } from "../src/capabilities/governance.ts";
import type { ContainmentConfig } from "../src/capabilities/containedWorkspace.ts";
import { bootAimock } from "./helpers.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";

const SF = process.env.SEA_FORGE_SERVER_BIN;
const RT = process.env.REALITYTRACE_BIN;
const DF = process.env.WB_DOMAINFORGE_BIN ?? "domainforge";
const enabled = Boolean(SF && RT) && process.env.COGNATE_BWRAP_TESTS === "1" && Boolean(process.env.COGNATE_BWRAP_TEST_ATTESTATION) && process.platform === "linux";
const liveTest = enabled ? test : test.skip;

const POLICY = `version: "0.1"
rules:
  - name: consequential-agent-effects
    verdict: allow
    requires_approval: true
    actor_role: service
    operation_kind: cognate_capability
    resources: ["tool.edit", "tool.bash", "tool.run_code"]
  - { name: workbench-capabilities, verdict: allow, actor_role: service, operation_kind: cognate_capability }
  - { name: workbench-actions, verdict: allow, actor_role: service, operation_kind: cognate_action }
  - { name: evidence, verdict: allow, actor_role: service, operation_kind: evidence_mutation }
  - { name: settlement, verdict: allow, actor_role: service, operation_kind: settlement_declaration }
  - { name: operator-approves, verdict: allow, actor_role: operator, operation_kind: approval_resolution }
`;

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what} (last: ${JSON.stringify(v).slice(0, 400)})`);
    await Bun.sleep(100);
  }
}

/** RealityTrace's documented target digest, recomputed here without its code. */
async function treeDigest(root: string): Promise<string> {
  const lines: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== ".git") await walk(p); }
      else if (e.isFile()) lines.push(`${relative(root, p)}\0f\0${createHash("sha256").update(await readFile(p)).digest("hex")}\n`);
    }
  };
  await walk(root);
  lines.sort();
  return `sha256:${createHash("sha256").update(lines.join("")).digest("hex")}`;
}

liveTest("J-SW01-SETTLEMENT: SEA-Forge settles an agent's work on RealityTrace's evidence, never on Workbench's word", async () => {
  const root = await mkdtemp(join(tmpdir(), "wb-sw01-"));
  const socket = join(tmpdir(), `wb-sw01-${process.pid}-${randomUUID().slice(0, 8)}.sock`);
  const rtData = join(root, "rt-data");
  const rtState = join(root, "rt-state");
  await mkdir(rtData);
  await mkdir(rtState);
  const realitytrace = { bin: RT!, dataHome: rtData, stateHome: rtState };
  const rtRun = (args: string[]) => {
    const p = Bun.spawnSync([RT!, ...args, "--json"], { env: { XDG_DATA_HOME: rtData, XDG_STATE_HOME: rtState, PATH: process.env.PATH ?? "" } });
    expect(p.exitCode, p.stderr.toString()).toBe(0);
    return JSON.parse(p.stdout.toString());
  };
  let server: ReturnType<typeof Bun.spawn> | undefined;
  let app: AppServer | undefined;
  const aimock = await bootAimock();
  try {
    await mkdir(join(root, "worlds"));
    await copyFile(join(import.meta.dir, "../.sea/interaction/interaction-model.sea"), join(root, "worlds/interaction-model.sea"));
    const envelope = Bun.spawnSync([DF, "envelope", "--emit", "cep", "--world-name", "workbench", "interaction-model.sea"], { cwd: join(root, "worlds") });
    expect(envelope.exitCode, envelope.stderr.toString()).toBe(0);
    const worldRef = JSON.parse(envelope.stdout.toString()).scope.world_ref as string;
    const uid = process.getuid!();
    await writeFile(join(root, "policy.yaml"), POLICY);
    await writeFile(join(root, "server.yaml"), JSON.stringify({
      socket_path: socket,
      root,
      identity: { bindings: [{ uid, actor_id: "cognate-service", roles: ["service"] }, { actor_id: "operator", roles: ["operator"] }] },
      gateway: { uid, actor: "cognate-service", delegable_actors: ["operator"] },
      cep_authority: {
        enabled: true, policy: "policy.yaml",
        worlds: [{ name: "workbench", base: "worlds", entry: "interaction-model.sea", files: ["interaction-model.sea"] }],
        realitytrace: { bin: RT, data_home: rtData, state_home: rtState, require_corroboration: true },
      },
    }));
    server = Bun.spawn([SF!], { env: { ...process.env, SEA_FORGE_ROOT: root, SEA_FORGE_SOCKET: socket }, stdout: "ignore", stderr: process.env.WB_SF_LOG ? Bun.file(process.env.WB_SF_LOG) : "ignore" });
    await until(async () => existsSync(socket), Boolean, "sea-forge-server socket");

    const externalAuthority = externalAuthorityFromEnv({ COGNATE_GOVERNANCE: "sea-forge", COGNATE_SEA_FORGE_SOCKET: socket, COGNATE_WORLD_REF: worldRef, COGNATE_SEA_FORGE_OPERATOR: "operator" })!;
    const containmentConfig = JSON.parse(await readFile(process.env.COGNATE_BWRAP_TEST_ATTESTATION!, "utf8")) as ContainmentConfig;
    const home = join(root, "home");
    const boot = async (settle: boolean) => {
      const a = await startServer({ devAuth: true, port: 0, home, containmentConfig, externalAuthority, realitytrace: settle ? realitytrace : null });
      const c = createClient({ service: createRemoteRuntimeService(connectTransport(a.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
      await c.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
      return { a, c };
    };
    let booted = await boot(true);
    app = booted.a;

    /** A git workspace whose declared proof is `script`; an approved agent edit (Hello -> Howdy) runs in it. */
    const approvedEdit = async (name: string, script: string) => {
      const dir = join(root, name);
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src/greet.ts"), "export const greet = () => \"Hello\";\n");
      for (const args of [["init", "-q"], ["add", "-A"], ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]]) {
        expect(Bun.spawnSync(["git", ...args], { cwd: dir }).exitCode).toBe(0);
      }
      const { client: c, app: a } = { client: booted.c, app: booted.a };
      const { workspaceId } = await c.invoke("workspace.contained.select", { path: dir }) as { workspaceId: string };
      await c.invoke("workspace.proof.declare", { workspaceId, argv: ["/usr/bin/sh", "-c", script] });
      const sessionId = randomUUID();
      const { runId } = await c.startRun("agent.coding", { sessionId, workspaceId, message: "[[scenario:edit]] change the greeting" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
      await until(() => a.runtime.service.getRun(LOCAL_OPERATOR, { runId }).then((r) => r.status), (s) => s === "waiting", "the edit waits for approval");
      const wait = (await a.runtime.service.listContinuations(LOCAL_OPERATOR, { runId, status: "OPEN" }))[0]!;
      await c.invoke("governance.approval.resolve", { approvalId: (wait.condition as { approvalId: string }).approvalId, resolution: "approved" });
      await until(() => a.runtime.service.getRun(LOCAL_OPERATOR, { runId }).then((r) => r.status), (s) => s === "completed", "the run completes");
      expect(await readFile(join(dir, "src/greet.ts"), "utf8")).toContain("Howdy");
      return { dir, runId };
    };
    const statusOf = async (runId: string) => booted.c.invoke("settlement.status", { runId }) as Promise<{ active: boolean; operations: Record<string, unknown>[]; evidence: Record<string, unknown>[] }>;
    const finalOf = (runId: string) => until(() => statusOf(runId), (s) => s.operations.length > 0 && s.operations.every((o) => o.final === true), `run ${runId} settles`, 120_000);

    // 1. Settled. The proof passes only if the edit landed AND it cannot see RealityTrace's data, the
    //    SEA-Forge socket or a home, AND it cannot write the workspace.
    const contained = `grep -q Howdy src/greet.ts && test ! -e ${rtData} && test ! -e ${socket} && test ! -e /home && ! touch src/probe 2>/dev/null`;
    const ok = await approvedEdit("ws-settled", contained);
    const settled = await finalOf(ok.runId);
    expect(settled.active).toBe(true);
    expect(settled.operations).toHaveLength(1);
    expect(settled.operations[0]).toMatchObject({ capability: "tool.edit", status: "settled", final: true, exitCode: 0 });
    expect(settled.operations[0]!.targetDigest).toBe(await treeDigest(ok.dir));
    expect(existsSync(join(ok.dir, "src/probe"))).toBe(false);
    // SEA-Forge holds the settlement: asking again replays it.
    const opId = String(settled.operations[0]!.operationId);
    const replay = await seaForgeCall(socket, { verb: "authority_settle", operation_id: opId, request_id: `t-${randomUUID()}`, actor: { actor_id: "cognate-service", role: "service" } });
    expect(replay).toMatchObject({ ok: true, status: "settled", final: true, replayed: true });

    // 2. Rejected: the declared proof expects a greeting the agent did not write.
    const bad = await approvedEdit("ws-rejected", "grep -q Hola src/greet.ts");
    const rejected = await finalOf(bad.runId);
    expect(rejected.operations[0]).toMatchObject({ status: "rejected", final: true });
    expect(rejected.operations[0]!.exitCode).not.toBe(0);

    // 3. A packet that flips RealityTrace's recorded direction is refused, and nothing changes.
    const recorded = (rejected.evidence[0]!.row as { evidence: Record<string, unknown>; position: { ledger_id: string; append_ordinal: number } });
    expect(recorded.evidence.direction).toBe("contradicts");
    const { evidencePacketEnvelope } = await import("@godspeedai/cognate-realitytrace");
    const badOp = rejected.operations[0]!;
    const decisionEnvelopeId = `env-authority_decision-${badOp.operationId}`;
    const forged = evidencePacketEnvelope({
      worldRef, authority: { operationId: String(badOp.operationId), decisionEnvelopeId },
      question: rejected.evidence[0]!.question as Record<string, unknown>,
      rows: [{ evidence: { ...recorded.evidence, direction: "supports" }, position: recorded.position }],
    });
    const refused = await seaForgeCall(socket, { verb: "authority_evidence", envelope: forged, request_id: `t-${randomUUID()}`, actor: { actor_id: "cognate-service", role: "service" } });
    expect(refused.error_class).toBe("cep_evidence_refused");
    expect(String(refused.error)).toContain("direction differs");
    const still = await seaForgeCall(socket, { verb: "authority_settle", operation_id: String(badOp.operationId), request_id: `t-${randomUUID()}`, actor: { actor_id: "cognate-service", role: "service" } });
    expect(still).toMatchObject({ ok: true, status: "rejected", replayed: true });

    // 4. A run that ends while settlement is off is settled at the next boot, exactly once.
    await booted.a.stop();
    booted = await boot(false);
    app = booted.a;
    const offline = await approvedEdit("ws-offline", "grep -q Howdy src/greet.ts");
    expect((await statusOf(offline.runId)).operations).toHaveLength(0);
    await booted.a.stop();
    booted = await boot(true);
    app = booted.a;
    const later = await finalOf(offline.runId);
    expect(later.operations[0]).toMatchObject({ status: "settled", final: true });
    await booted.a.stop();
    booted = await boot(true);
    app = booted.a;
    await booted.a.settlement!.settleRun(offline.runId);
    const once = await statusOf(offline.runId);
    expect(once.evidence).toHaveLength(1);
    const repoId = String(once.evidence[0]!.repoId);
    const evidenceRows = (rtRun(["ledger", "export", "--repo", repoId]) as { record_kind: string }[]).filter((r) => r.record_kind === "evidence.created");
    expect(evidenceRows).toHaveLength(1);
  } finally {
    if (app) await app.stop().catch(() => {});
    await aimock.stop();
    server?.kill();
    await rm(root, { recursive: true, force: true });
    await rm(socket, { force: true });
  }
}, 600_000);
