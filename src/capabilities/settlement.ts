// Operator surface of governed settlement (readiness P03, WB-1):
// - `workspace.proof.declare` fixes the proof a workspace's agent runs are judged by. Only a direct human
//   operator, outside any run, may declare it, so an agent can never choose how its own work is judged.
//   A declaration applies to runs that start after it.
// - `workspace.proof.declare_contract` (readiness P05) takes that proof from a SWE_SEED eval spec in the
//   workspace, pinned by the operator's sha256: SWE_SEED checks the digest and exports the command_check as it
//   would run it. The declaration records the contract (spec id, check id, digest) as the proof's source.
//   With COGNATE_PROOF_SOURCE=swe_seed it is the only way to declare a proof.
// - `settlement.status` reports, per run, what RealityTrace observed and what SEA-Forge settled.
import { randomUUID } from "node:crypto";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import type { Json, StoredEvent } from "@godspeedai/cognate-events";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { PROOF_DECLARED, SETTLEMENT_EVIDENCE, SETTLEMENT_RECORDED, workspaceRoot } from "../settlement/orchestrator.ts";
import { ENV_PROOF_SOURCE, exportSweSeedProof, normaliseSha256, type SweSeedSettings } from "../settlement/sweSeed.ts";

export const PROOF_DECLARE = "workspace.proof.declare";
export const PROOF_DECLARE_CONTRACT = "workspace.proof.declare_contract";
export const SETTLEMENT_STATUS = "settlement.status";

/** Durably record workbench.* events through the replay-safe configuration agent, and wait until committed. */
export async function recordWorkbenchEvents(service: RuntimeService, caller: Caller, events: readonly { readonly type: string; readonly payload: Json }[], correlationId?: string): Promise<void> {
  const { runId } = await service.startRun(caller, {
    agent: AGENT_CONFIG,
    input: { kind: "workbench.recorded", events: JSON.parse(JSON.stringify(events)) as Json },
    idempotencyKey: randomUUID(),
    ...(correlationId ? { correlationId } : {}),
  });
  for (let i = 0; i < 2000; i++) {
    const run = await service.getRun(caller, { runId });
    if (run.status === "completed") return;
    if (run.status === "failed" || run.status === "cancelled") throw new Error(`settlement: recording failed (${run.status})`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("settlement: recording timed out");
}

const SAFE_ARG = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096 && !v.includes("\0");

export function validateProof(raw: unknown): { workspaceId: string; argv: string[]; cwd: string; timeoutS: number } {
  const v = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const unknown = Object.keys(v).filter((k) => !["workspaceId", "argv", "cwd", "timeoutS"].includes(k));
  if (unknown.length) throw new Error(`${PROOF_DECLARE}: unknown field(s) ${unknown.join(", ")}`);
  if (typeof v.workspaceId !== "string" || !v.workspaceId) throw new Error(`${PROOF_DECLARE}: workspaceId is required`);
  if (!Array.isArray(v.argv) || v.argv.length === 0 || v.argv.length > 64 || !v.argv.every(SAFE_ARG)) throw new Error(`${PROOF_DECLARE}: argv must be 1-64 non-empty strings`);
  const cwd = v.cwd === undefined ? "." : v.cwd;
  if (typeof cwd !== "string" || cwd.startsWith("/") || cwd.split("/").some((part) => part === "..") || cwd.includes("\0")) throw new Error(`${PROOF_DECLARE}: cwd must be a relative path inside the workspace`);
  const timeoutS = v.timeoutS === undefined ? 900 : v.timeoutS;
  if (typeof timeoutS !== "number" || !Number.isInteger(timeoutS) || timeoutS < 1 || timeoutS > 3600) throw new Error(`${PROOF_DECLARE}: timeoutS must be an integer from 1 to 3600`);
  return { workspaceId: v.workspaceId, argv: v.argv as string[], cwd, timeoutS };
}

const RELATIVE_PATH = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 4096 && !v.startsWith("/") && !v.includes("\0") && !v.split("/").some((part) => part === "..");

export function validateProofContract(raw: unknown): { workspaceId: string; specPath: string; specSha256: string; checkId: string; timeoutS: number } {
  const v = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const unknown = Object.keys(v).filter((k) => !["workspaceId", "specPath", "specSha256", "checkId", "timeoutS"].includes(k));
  if (unknown.length) throw new Error(`${PROOF_DECLARE_CONTRACT}: unknown field(s) ${unknown.join(", ")}`);
  if (typeof v.workspaceId !== "string" || !v.workspaceId) throw new Error(`${PROOF_DECLARE_CONTRACT}: workspaceId is required`);
  if (!RELATIVE_PATH(v.specPath)) throw new Error(`${PROOF_DECLARE_CONTRACT}: specPath must be a relative path inside the workspace`);
  if (typeof v.checkId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v.checkId)) throw new Error(`${PROOF_DECLARE_CONTRACT}: checkId must be a check id`);
  let specSha256: string;
  try { specSha256 = normaliseSha256(v.specSha256); }
  catch (error) { throw new Error(`${PROOF_DECLARE_CONTRACT}: ${(error as Error).message}`); }
  const timeoutS = v.timeoutS === undefined ? 900 : v.timeoutS;
  if (typeof timeoutS !== "number" || !Number.isInteger(timeoutS) || timeoutS < 1 || timeoutS > 3600) throw new Error(`${PROOF_DECLARE_CONTRACT}: timeoutS must be an integer from 1 to 3600`);
  return { workspaceId: v.workspaceId, specPath: v.specPath, specSha256, checkId: v.checkId, timeoutS };
}

export function settlementComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly getKnownWorkspaceIds: () => ReadonlySet<string>;
  /** Whether a settlement orchestrator runs (SEA-Forge governance and RealityTrace configured). */
  readonly active: boolean;
  readonly semanticRefs?: Readonly<Record<string, SemanticRef | undefined>>;
  /** Where declared proofs may come from (readiness P05); default: any, without SWE_SEED. */
  readonly sweSeed?: SweSeedSettings;
}): Component {
  const contract = (id: string) => ({ id, version: "1.0.0", ...(options.semanticRefs?.[id] ? { semanticRef: options.semanticRefs[id] } : {}) });
  const declare = contract(PROOF_DECLARE);
  const declareContract = contract(PROOF_DECLARE_CONTRACT);
  const mode = options.sweSeed?.mode ?? "any";
  const status = contract(SETTLEMENT_STATUS);
  const operatorOnly = (ctx: HandlerContext, id: string) => {
    if (ctx.actor.kind !== "user" || ctx.runId) throw new Error(`${id}: only a direct human operator may do this`);
  };
  return {
    id: "settlement:governed",
    provides: [declare, declareContract, status],
    activate(fiber) {
      fiber.provide(declare, async (raw, ctx) => {
        operatorOnly(ctx, PROOF_DECLARE);
        if (mode === "swe_seed") throw new Error(`${PROOF_DECLARE}: refused under ${ENV_PROOF_SOURCE}=swe_seed; declare the proof from a SWE_SEED contract with ${PROOF_DECLARE_CONTRACT}`);
        const proof = validateProof(raw);
        if (!options.getKnownWorkspaceIds().has(proof.workspaceId)) throw new Error(`${PROOF_DECLARE}: unknown workspace ${proof.workspaceId}`);
        await recordWorkbenchEvents(options.getService(), options.systemCaller, [{ type: PROOF_DECLARED, payload: { ...proof, declaredBy: ctx.actor.id } }], `proof:${proof.workspaceId}`);
        return { ...proof, appliesTo: "runs that start after this declaration" };
      });
      fiber.provide(declareContract, async (raw, ctx) => {
        operatorOnly(ctx, PROOF_DECLARE_CONTRACT);
        const input = validateProofContract(raw);
        if (!options.getKnownWorkspaceIds().has(input.workspaceId)) throw new Error(`${PROOF_DECLARE_CONTRACT}: unknown workspace ${input.workspaceId}`);
        const bin = options.sweSeed?.bin;
        if (!bin) throw new Error(`${PROOF_DECLARE_CONTRACT}: SWE_SEED is not configured (COGNATE_SWE_SEED_BIN)`);
        const root = await workspaceRoot(options.getService(), options.systemCaller, input.workspaceId);
        if (root === undefined) throw new Error(`${PROOF_DECLARE_CONTRACT}: workspace ${input.workspaceId} has no recorded root`);
        const exported = await exportSweSeedProof({ bin, root, specPath: input.specPath, specSha256: input.specSha256, checkId: input.checkId });
        // The same bounds as a typed proof: SWE_SEED's answer is not trusted further than the operator's.
        const proof = validateProof({ workspaceId: input.workspaceId, argv: exported.argv, cwd: exported.cwd, timeoutS: input.timeoutS });
        await recordWorkbenchEvents(options.getService(), options.systemCaller, [{ type: PROOF_DECLARED, payload: { ...proof, source: { ...exported.source }, declaredBy: ctx.actor.id } as unknown as Json }], `proof:${proof.workspaceId}`);
        return { ...proof, source: { ...exported.source }, appliesTo: "runs that start after this declaration" } as unknown as Json;
      });
      fiber.provide(status, async (raw, ctx) => {
        operatorOnly(ctx, SETTLEMENT_STATUS);
        const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const runId = typeof v.runId === "string" ? v.runId : undefined;
        const sessionId = typeof v.sessionId === "string" ? v.sessionId : undefined;
        const wanted = (p: Record<string, unknown>) => (runId ? p.runId === runId : true) && (sessionId ? p.sessionId === sessionId : true);
        const events: StoredEvent[] = [];
        for await (const e of options.getService().events(options.systemCaller, {})) {
          if ((e.eventType === SETTLEMENT_RECORDED || e.eventType === SETTLEMENT_EVIDENCE) && wanted(e.payload as Record<string, unknown>)) events.push(e);
        }
        // The latest record per operation is its current standing.
        const latest = new Map<string, Record<string, unknown>>();
        for (const e of events.filter((x) => x.eventType === SETTLEMENT_RECORDED)) latest.set(String((e.payload as Record<string, unknown>).operationId), e.payload as Record<string, unknown>);
        return {
          active: options.active,
          operations: [...latest.values()] as Json,
          evidence: events.filter((x) => x.eventType === SETTLEMENT_EVIDENCE).map((x) => x.payload) as Json,
        };
      });
    },
  };
}
