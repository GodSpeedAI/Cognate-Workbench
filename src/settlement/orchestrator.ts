// Governed settlement of an agent run (readiness P03, WB-2).
//
// After a governed agent.coding run ends, its consequential operations (the edits, commands and code it ran
// under a SEA-Forge allow) are settled by SEA-Forge on evidence RealityTrace produced:
//   1. the proof the operator declared for the workspace BEFORE the run started is the expectation;
//   2. RealityTrace runs it, contained and read-only, and derives evidence from the exit code;
//   3. that evidence is packaged per operation and submitted to SEA-Forge, which corroborates it against
//      RealityTrace's ledger (when configured) and settles: settled, rejected or unsettled.
// Workbench never decides the outcome. Every step is recorded, and a restart resumes from the record:
// RealityTrace's evidence is reused, SEA-Forge dedupes the packet and replays a final settlement.
import { evidencePacketEnvelope } from "@godspeedai/cognate-realitytrace";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { SeaForgeAuthority } from "@godspeedai/cognate-runtime-bun";
import type { Json, StoredEvent } from "@godspeedai/cognate-events";
import type { ContainmentConfig } from "../capabilities/containedWorkspace.ts";
import type { ExternalAuthority } from "../capabilities/governance.ts";
import { containedVerifierLauncher } from "./launcher.ts";
import { RealityTraceCli, type DeclaredProof, type RealityTraceSettings } from "./realitytrace.ts";

/** Agent capabilities whose effects settlement must account for. */
export const CONSEQUENTIAL_CAPABILITIES: ReadonlySet<string> = new Set(["tool.edit", "tool.bash", "tool.run_code"]);
export const PROOF_DECLARED = "workbench.proof.declared";
export const SETTLEMENT_EVIDENCE = "workbench.settlement.evidence";
export const SETTLEMENT_RECORDED = "workbench.settlement.recorded";
const SETTLED_AGENT = "agent.coding";
const TERMINAL = new Set(["run.completed", "run.failed", "run.cancelled"]);

export interface SettlementOptions {
  readonly authority: ExternalAuthority;
  readonly realitytrace: RealityTraceSettings;
  readonly containment: ContainmentConfig;
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  /** Durably records workbench.* events and resolves once they are committed. */
  readonly record: (events: readonly { readonly type: string; readonly payload: Json }[], correlationId?: string) => Promise<void>;
}

interface Operation {
  readonly operationId: string;
  readonly decisionEnvelopeId: string;
  readonly worldRef: string;
  readonly capability: string;
}

export type SettlementStatus = "settled" | "rejected" | "unsettled" | "refused" | "not-attempted";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

async function collect(it: AsyncIterable<StoredEvent>): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

export function createSettlementOrchestrator(options: SettlementOptions) {
  const rt = new RealityTraceCli(options.realitytrace);
  const seaForge = new SeaForgeAuthority({ socketPath: options.authority.socketPath, actor: options.authority.service, ...(options.authority.timeoutMs ? { timeoutMs: options.authority.timeoutMs } : {}) });
  const service = () => options.getService();
  let chain: Promise<unknown> = Promise.resolve();

  async function settleRun(runId: string): Promise<void> {
    const runEvents = await collect(service().events(options.systemCaller, { runId }));
    const started = runEvents.find((e) => e.eventType === "run.started");
    if (!started || !runEvents.some((e) => TERMINAL.has(e.eventType))) return;
    if (obj(started.metadata).agent !== SETTLED_AGENT) return;
    const operations: Operation[] = [];
    for (const e of runEvents) {
      if (e.eventType !== "run.invocation") continue;
      const meta = obj(e.metadata);
      const authority = obj(obj(meta.decision).authority);
      if (meta.ok !== true || !CONSEQUENTIAL_CAPABILITIES.has(String(meta.capability)) || typeof authority.operationId !== "string") continue;
      operations.push({ operationId: authority.operationId, decisionEnvelopeId: String(authority.decisionEnvelopeId), worldRef: String(authority.worldRef), capability: String(meta.capability) });
    }
    if (operations.length === 0) return;

    // What this run already recorded (settlement records live in later system runs, so scan from the start).
    const later = await collect(service().events(options.systemCaller, { afterPosition: started.position }));
    const mine = (type: string) => later.filter((e) => e.eventType === type && obj(e.payload).runId === runId).map((e) => obj(e.payload));
    const done = new Set(mine(SETTLEMENT_RECORDED).filter((p) => p.final === true).map((p) => String(p.operationId)));
    const open = operations.filter((op) => !done.has(op.operationId));
    if (open.length === 0) return;

    const input = obj(obj(started.payload).input);
    const workspaceId = String(input.workspaceId ?? "");
    const sessionId = typeof input.sessionId === "string" ? input.sessionId : undefined;
    const base = { runId, workspaceId, ...(sessionId ? { sessionId } : {}) };
    const recordAll = async (status: SettlementStatus, final: boolean, extra: Record<string, Json>) =>
      options.record(open.map((op) => ({ type: SETTLEMENT_RECORDED, payload: { ...base, operationId: op.operationId, capability: op.capability, status, final, ...extra } as Json })), `settlement:${runId}`);

    // The expectation: the proof declared for this workspace before the run started. Declaring one later
    // cannot reach back.
    const before = await collect(service().events(options.systemCaller, {}));
    const proofEvent = before
      .filter((e) => e.eventType === PROOF_DECLARED && e.position < started.position && obj(e.payload).workspaceId === workspaceId)
      .at(-1);
    if (!proofEvent) {
      await recordAll("not-attempted", true, { reason: "no proof was declared for this workspace before the run started" });
      return;
    }
    const declared = obj(proofEvent.payload);
    const proof: DeclaredProof = { argv: declared.argv as string[], cwd: String(declared.cwd ?? "."), timeoutS: Number(declared.timeoutS ?? 900) };

    // The evidence: reuse what RealityTrace already recorded for this run, else have it verify now.
    let evidence = mine(SETTLEMENT_EVIDENCE).at(-1);
    if (!evidence) {
      const rows = (await service().readProjection(options.systemCaller, { name: "workspaces" })).rows;
      const root = obj(rows.find((r) => r.key === `record/${workspaceId}` || r.key.endsWith(`/record/${workspaceId}`))?.value).root;
      if (typeof root !== "string") {
        await recordAll("not-attempted", true, { reason: "the run's workspace is not recorded" });
        return;
      }
      try {
        const launcher = await containedVerifierLauncher(options.containment, root);
        const verified = await rt.verify({ root, snapshot: `workbench:${runId}`, proof, launcher });
        evidence = {
          ...base, proofEventId: proofEvent.eventId, argv: proof.argv as unknown as Json, cwd: proof.cwd,
          repoId: verified.repoId, sxrRunId: verified.sxrRunId, observationId: verified.observationId,
          exitCode: verified.exitCode, targetDigest: verified.targetDigest, evidenceId: verified.evidenceId,
          row: verified.row as unknown as Json, question: verified.question as Json,
        };
        await options.record([{ type: SETTLEMENT_EVIDENCE, payload: evidence as Json }], `settlement:${runId}`);
      } catch (error) {
        await recordAll("not-attempted", false, { reason: `RealityTrace could not verify the proof: ${error instanceof Error ? error.message : String(error)}`.slice(0, 600) });
        return;
      }
    }

    const facts = { exitCode: evidence.exitCode as Json, targetDigest: String(evidence.targetDigest), evidenceId: String(evidence.evidenceId) };
    const results: { type: string; payload: Json }[] = [];
    for (const op of open) {
      const packet = evidencePacketEnvelope({
        worldRef: op.worldRef,
        authority: { operationId: op.operationId, decisionEnvelopeId: op.decisionEnvelopeId },
        question: obj(evidence.question),
        rows: [evidence.row as never],
      });
      const receipt = await seaForge.submitEvidence(packet);
      if (!receipt.ok) {
        results.push({ type: SETTLEMENT_RECORDED, payload: { ...base, operationId: op.operationId, capability: op.capability, status: "refused", final: false, ...facts, reason: `${receipt.errorClass}: ${receipt.error}`.slice(0, 600) } });
        continue;
      }
      const settled = await seaForge.settle(op.operationId, op.worldRef);
      results.push({
        type: SETTLEMENT_RECORDED,
        payload: settled.ok
          ? { ...base, operationId: op.operationId, capability: op.capability, status: settled.status, final: settled.final, ...facts, ledgerEntry: settled.ledgerEntry }
          : { ...base, operationId: op.operationId, capability: op.capability, status: "refused", final: false, ...facts, reason: `${settled.errorClass}: ${settled.error}`.slice(0, 600) },
      });
    }
    await options.record(results, `settlement:${runId}`);
  }

  /** Settle runs one at a time, in order. */
  const enqueue = (runId: string): Promise<void> => {
    const next = chain.then(() => settleRun(runId)).catch((error) => {
      console.warn(`[cognate-workbench] settlement of ${runId} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    chain = next;
    return next as Promise<void>;
  };

  return {
    settleRun: enqueue,
    /** A committed batch may end runs: settle each one. */
    onCommitted(events: readonly StoredEvent[]): void {
      for (const e of events) if (TERMINAL.has(e.eventType) && e.streamId.startsWith("run-")) void enqueue(e.streamId.slice("run-".length));
    },
    /** At boot: every ended agent run is checked; ones already settled return at once. */
    async sweep(): Promise<void> {
      const runs = await service().listRuns(options.systemCaller, { agent: SETTLED_AGENT });
      for (const run of runs) if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") await enqueue(run.runId);
    },
    idle: () => chain.then(() => undefined),
  };
}
