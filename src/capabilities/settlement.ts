// Operator surface of governed settlement (readiness P03, WB-1):
// - `workspace.proof.declare` fixes the proof a workspace's agent runs are judged by. Only a direct human
//   operator, outside any run, may declare it, so an agent can never choose how its own work is judged.
//   A declaration applies to runs that start after it.
// - `settlement.status` reports, per run, what RealityTrace observed and what SEA-Forge settled.
import { randomUUID } from "node:crypto";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import type { Json, StoredEvent } from "@godspeedai/cognate-events";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { PROOF_DECLARED, SETTLEMENT_EVIDENCE, SETTLEMENT_RECORDED } from "../settlement/orchestrator.ts";

export const PROOF_DECLARE = "workspace.proof.declare";
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

export function settlementComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly getKnownWorkspaceIds: () => ReadonlySet<string>;
  /** Whether a settlement orchestrator runs (SEA-Forge governance and RealityTrace configured). */
  readonly active: boolean;
  readonly semanticRefs?: Readonly<Record<string, SemanticRef | undefined>>;
}): Component {
  const contract = (id: string) => ({ id, version: "1.0.0", ...(options.semanticRefs?.[id] ? { semanticRef: options.semanticRefs[id] } : {}) });
  const declare = contract(PROOF_DECLARE);
  const status = contract(SETTLEMENT_STATUS);
  const operatorOnly = (ctx: HandlerContext, id: string) => {
    if (ctx.actor.kind !== "user" || ctx.runId) throw new Error(`${id}: only a direct human operator may do this`);
  };
  return {
    id: "settlement:governed",
    provides: [declare, status],
    activate(fiber) {
      fiber.provide(declare, async (raw, ctx) => {
        operatorOnly(ctx, PROOF_DECLARE);
        const proof = validateProof(raw);
        if (!options.getKnownWorkspaceIds().has(proof.workspaceId)) throw new Error(`${PROOF_DECLARE}: unknown workspace ${proof.workspaceId}`);
        await recordWorkbenchEvents(options.getService(), options.systemCaller, [{ type: PROOF_DECLARED, payload: { ...proof, declaredBy: ctx.actor.id } }], `proof:${proof.workspaceId}`);
        return { ...proof, appliesTo: "runs that start after this declaration" };
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
