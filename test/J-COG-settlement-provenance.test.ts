// Journey J-COG-settlement-provenance (#117): the two settlement machines are told apart by payload
// alone, and the governed family reaches RealityTrace.
//
//   local Candidate Promotion -> `world.settled` with settlementScope:"local", receiptRef:null;
//   governed SEA-Forge settlement -> `workbench.settlement.recorded` with settlementScope:"governed"
//   and, when SEA-Forge returns a ledger entry, that entry as a non-null `receiptRef`.
//
// A record that predates the field (absent provenance) reads as local/null, never as governed, and
// replay preserves producer, subject, issuer (receiptRef), disposition (status) and finality (final).
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { observationOutboxFor } from "../src/observations.ts";
import { settlementProvenance } from "../src/settlement/provenance.ts";
import { SETTLEMENT_RECORDED, createSettlementOrchestrator } from "../src/settlement/orchestrator.ts";
import type { Json, StoredEvent } from "@godspeedai/cognate-events";
import { withTempHome } from "./helpers.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";

const clientFor = (app: AppServer) => createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
const events = async (app: AppServer) => {
  const out: { position: number; eventType: string; payload: any }[] = [];
  for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) out.push({ position: e.position, eventType: e.eventType, payload: e.payload });
  return out;
};

describe("J-COG-settlement-provenance", () => {
  test("a local Candidate Promotion is world.settled with settlementScope:local and receiptRef:null", async () => {
    await withTempHome(async (home) => {
      const app = await startServer({ executionPosture: "uncontained-local", devAuth: true, port: 0, home });
      const client = clientFor(app);
      try {
        const repo = join(home, "repo");
        await mkdir(repo, { recursive: true });
        await writeFile(join(repo, "a.txt"), "a");
        await client.invoke("case.open", { caseId: "P1", desiredOutcome: "distinguish local from governed" });
        const { criterionHash } = (await client.invoke("criterion.freeze", { caseId: "P1", spec: { version: 1, requiredChecks: ["unit"], observed: ["x"], unobserved: [], guardrails: [], protectedInvariants: [] } })) as { criterionHash: string };
        const base = (await client.invoke("world.freeze", { caseId: "P1", kind: "baseline", worldId: "local", root: repo, criterionHash })) as { worldHash: string };
        await writeFile(join(repo, "a.txt"), "changed");
        const cand = (await client.invoke("world.freeze", { caseId: "P1", kind: "candidate", worldId: "local", root: repo, parentWorldHash: base.worldHash, criterionHash })) as { worldHash: string };
        await client.invoke("verification.run", { caseId: "P1", worldId: "local", root: repo, candidateHash: cand.worldHash, checks: [{ id: "unit", argv: ["true"] }] });
        await client.invoke("world.settle", { caseId: "P1", candidateHash: cand.worldHash });

        const settled = (await events(app)).find((e) => e.eventType === "world.settled");
        expect(settled).toBeDefined();
        // Local promotion is local by payload: a governed scope or a receipt would misreport it.
        expect(settled!.payload).toMatchObject({ settlementScope: "local", receiptRef: null });
        expect(settled!.payload.settlementScope).not.toBe("governed");
        expect(settled!.payload.receiptRef).toBeNull();
      } finally {
        await app.stop();
      }
    });
  }, 60_000);

  test("the governed settlement family reaches the outbox and world.settled stays observed", () => {
    const base = { tenant: "t", correlationId: "session:s", causationId: "c", runId: "r", scopeId: "s", recordedAt: new Date().toISOString(), streamId: "x" };
    for (const eventType of ["world.settled", "workbench.settlement.recorded", "workbench.settlement.evidence"]) {
      const intents = observationOutboxFor({ ...base, eventId: `e-${eventType}`, eventType, payload: { settlementScope: "governed", receiptRef: "ledger-1" } } as never);
      expect(intents, eventType).toHaveLength(1);
    }
    // A pre-distinction record (no scope) is observed on the same terms — absence changes nothing.
    const legacy = observationOutboxFor({ ...base, eventId: "e-legacy", eventType: "workbench.settlement.recorded", payload: { operationId: "op-1", status: "settled", final: true } } as never);
    expect(legacy).toHaveLength(1);
  });

  test("absent provenance reads as local/null and is never promoted to governed", () => {
    expect(settlementProvenance(undefined)).toEqual({ settlementScope: "local", receiptRef: null });
    expect(settlementProvenance({ operationId: "op-1", status: "settled", final: true })).toEqual({ settlementScope: "local", receiptRef: null });
    expect(settlementProvenance({ settlementScope: "local", receiptRef: null })).toEqual({ settlementScope: "local", receiptRef: null });
    // A governed attempt with no receipt is still governed; the reader never fabricates a receipt.
    expect(settlementProvenance({ settlementScope: "governed", receiptRef: null })).toEqual({ settlementScope: "governed", receiptRef: null });
    expect(settlementProvenance({ settlementScope: "governed", receiptRef: "ledger-9" })).toEqual({ settlementScope: "governed", receiptRef: "ledger-9" });
  });

  test("a governed settlement carries SEA-Forge's status/finality and a non-null receipt, preserved on replay", async () => {
    const LEDGER = "ledger-entry-117";
    const WORLD_REF = `world:workbench@sha256:${"a".repeat(64)}`;
    const runId = "run-117";
    const socketPath = join(tmpdir(), `sf-117-${process.pid}-${randomUUID().slice(0, 8)}.sock`);

    // A minimal SEA-Forge stand-in: one NDJSON request/response per connection, answering only the two
    // verbs the settlement path uses. `authority_settle` returns a well-formed settlement_packet for
    // this operation and world, which is what `interpretSettlement` requires to accept it.
    const seen: string[] = [];
    const buffers = new Map<unknown, string>();
    const server = Bun.listen({
      unix: socketPath,
      socket: {
        open(s) { buffers.set(s, ""); },
        data(s, chunk) {
          const buffered = (buffers.get(s) ?? "") + chunk.toString("utf8");
          const newline = buffered.indexOf("\n");
          if (newline < 0) { buffers.set(s, buffered); return; }
          const request = JSON.parse(buffered.slice(0, newline)) as { verb: string; operation_id?: string; envelope?: { envelope_id?: string } };
          seen.push(request.verb);
          const response = request.verb === "authority_evidence"
            ? { ok: true, operation_id: "op-117", envelope_id: request.envelope?.envelope_id ?? "env", items: 1, ledger_entry: "ledger-evidence" }
            : request.verb === "authority_settle"
              ? { ok: true, status: "settled", final: true, replayed: false, ledger_entry: LEDGER, envelope: {
                  envelope_kind: "settlement_packet",
                  scope: { world_ref: WORLD_REF },
                  extensions: {
                    "cep.profile": { profile_id: "godspeed.settlement_packet", profile_version: "1.0.0" },
                    "godspeed.settlement_packet": { operation_id: request.operation_id, overall_status: "settled" },
                  },
                } }
              : { ok: false, error_class: "unknown_verb", error: request.verb };
          s.write(`${JSON.stringify(response)}\n`);
        },
        close(s) { buffers.delete(s); },
      },
    });

    const ev = (position: number, eventType: string, payload: Json, metadata?: Json): StoredEvent => ({ position, eventType, payload, metadata, runId } as unknown as StoredEvent);
    let position = 0;
    const log: StoredEvent[] = [
      ev(position++, "workbench.proof.declared", { workspaceId: "ws-117", argv: ["true"], cwd: "." }),
      ev(position++, "run.started", { input: { workspaceId: "ws-117" } }, { agent: "agent.coding" }),
      ev(position++, "run.invocation", {}, { ok: true, capability: "tool.edit", decision: { authority: { operationId: "op-117", decisionEnvelopeId: "env-117", worldRef: WORLD_REF } } }),
      ev(position++, "run.completed", {}),
      ev(position++, "workbench.settlement.evidence", { runId, workspaceId: "ws-117", exitCode: 0, targetDigest: `sha256:${"b".repeat(64)}`, evidenceId: "ev-117", row: { evidence: { evidence_id: "ev-117" }, position: { ledger_id: "led-1", append_ordinal: 0 } }, question: {} }),
    ];
    const service = {
      events: (_caller: unknown, filter: { runId?: string; afterPosition?: number } = {}) => (async function* () {
        for (const e of [...log].sort((a, b) => a.position - b.position)) {
          if (filter.runId !== undefined && e.runId !== filter.runId) continue;
          if (filter.afterPosition !== undefined && !(e.position > filter.afterPosition)) continue;
          yield e;
        }
      })(),
    };
    const recorded: { type: string; payload: Json }[] = [];
    const orchestrator = createSettlementOrchestrator({
      authority: { socketPath, service: { actor_id: "cognate-service", role: "service" } } as never,
      realitytrace: { bin: "/nonexistent/realitytrace", dataHome: "/nonexistent", stateHome: "/nonexistent" } as never,
      containment: {} as never,
      getService: (() => service) as never,
      systemCaller: LOCAL_OPERATOR,
      record: async (batch) => {
        for (const e of batch) {
          recorded.push(e);
          // Model replay faithfully: recorded events become part of the log, so a second sweep sees the
          // final record and re-records nothing.
          log.push(ev(position++, e.type, e.payload));
        }
      },
    });

    try {
      await orchestrator.settleRun(runId);
      expect(seen).toEqual(["authority_evidence", "authority_settle"]);

      const records = recorded.filter((e) => e.type === SETTLEMENT_RECORDED);
      expect(records).toHaveLength(1);
      const payload = records[0]!.payload as Record<string, unknown>;
      expect(payload).toMatchObject({ runId, operationId: "op-117", status: "settled", final: true, settlementScope: "governed", receiptRef: LEDGER });
      // Producer, subject, issuer, disposition and finality all survive in the record.
      expect(payload.runId).toBe(runId);          // producer
      expect(payload.operationId).toBe("op-117"); // subject
      expect(payload.receiptRef).toBe(LEDGER);    // issuer's ledger reference
      expect(payload.status).toBe("settled");     // disposition
      expect(payload.final).toBe(true);           // finality

      // Replay: the operation is already final, so nothing new is recorded and the standing is unchanged.
      await orchestrator.settleRun(runId);
      expect(recorded.filter((e) => e.type === SETTLEMENT_RECORDED)).toHaveLength(1);
      expect(settlementProvenance(payload)).toEqual({ settlementScope: "governed", receiptRef: LEDGER });
    } finally {
      server.stop(true);
      await rm(socketPath, { force: true });
    }
  }, 30_000);
});
