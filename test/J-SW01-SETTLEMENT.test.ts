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
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { seaForgeCall } from "../src/capabilities/governance.ts";
import { bootAimock } from "./helpers.ts";
import { gitWorkspace, liveSettlementEnabled, startLiveCell, treeDigest, until, type LiveCell } from "./liveSettlement.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";

const liveTest = liveSettlementEnabled ? test : test.skip;

liveTest("J-SW01-SETTLEMENT: SEA-Forge settles an agent's work on RealityTrace's evidence, never on Workbench's word", async () => {
  let cell: LiveCell | undefined;
  let app: AppServer | undefined;
  const aimock = await bootAimock();
  try {
    cell = await startLiveCell("wb-sw01");
    const { root, socket, rtData, worldRef, realitytrace, externalAuthority, containmentConfig } = cell;
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
      await gitWorkspace(dir, { "src/greet.ts": "export const greet = () => \"Hello\";\n" });
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
    const evidenceRows = (cell.rtRun(["ledger", "export", "--repo", repoId]) as { record_kind: string }[]).filter((r) => r.record_kind === "evidence.created");
    expect(evidenceRows).toHaveLength(1);
  } finally {
    if (app) await app.stop().catch(() => {});
    await aimock.stop();
    await cell?.stop();
  }
}, 600_000);
