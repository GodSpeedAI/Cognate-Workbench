// `case.escalate`: the OPTIONAL operator escalation of a frozen Case to a named Gauntlet runner.
//
// Gauntlet is a separate product with its own agent host, its own frozen reference and its own
// Controlled Run Settlement. This capability is the one narrow seam between the two: the operator
// explicitly names a Gauntlet runner and a non-empty gate criterion, and Workbench projects the
// Case's frozen criterion into Gauntlet's reference format, writes ONE configuration file, and
// spawns `gauntlet run --config <path> <intent>` through the existing governed execution-world port.
//
// What this capability deliberately does NOT do:
//   * it never runs at boot and never on a timer — an ordinary Workbench install with no `gauntlet`
//     binary configured stays fully usable; escalation happens only from an explicit operator call
//     (duration alone never escalates);
//   * it never chooses a runner for the operator (`runners.default` is refused when unset, never
//     silently filled with a product default);
//   * it never re-freezes a changed reference — the reference projection is written once per Case
//     and then left alone, so Gauntlet's own `.gauntlet/reference.lock` check refuses a mutated
//     artifact and Workbench surfaces that refusal instead of rewriting the ruler;
//   * it never settles: no `world.settled`, no `workbench.settlement.recorded` and no SEA-Forge
//     receipt follows from an escalation. Gauntlet's disposition is its own.
//
// The exit code is authoritative (0 only for `settled`, 1 otherwise, 2 for usage). The six terminal
// states are Gauntlet's: `settled | blocked | budget_exhausted | escalated | aborted | inconclusive`.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExecInput, ExecResult } from "@godspeedai/cognate-execution";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { CASE_EVENTS } from "../cognitive/case.ts";
import { hashOf, sha256 } from "../cognitive/canonical.ts";
import type { FrozenCriterion } from "../cognitive/criterion.ts";
import type { ExecutionPosture } from "../executionPosture.ts";
import { requireOperator } from "../workbench/operatorGuard.ts";
import type { CapabilityLease, Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Json } from "@godspeedai/cognate-events";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";

export const ESCALATE_CAPABILITY = "case.escalate";
/** Record-before-spawn: the admitted intent, committed before any Gauntlet process starts. */
export const ESCALATION_INTENDED = "workbench.escalation.intended";
/** The escalation's own disposition — Gauntlet's report and exit code, never a Workbench settlement. */
export const ESCALATION_RECORDED = "workbench.escalation.recorded";

/** Gauntlet's six terminal states (crates/gauntlet-domain/src/values.rs:266-268), wire spellings. */
export const GAUNTLET_TERMINALS = ["settled", "blocked", "budget_exhausted", "escalated", "aborted", "inconclusive"] as const;
export type GauntletTerminal = (typeof GAUNTLET_TERMINALS)[number];

export interface EscalateInput {
  readonly caseId: string;
  readonly assignmentId: string;
  /** Named gate criteria; each must be a required check of the Case's frozen criterion. */
  readonly criteria: readonly string[];
  /** The operator-named Gauntlet runner (`runners.default`). Never defaulted by Workbench. */
  readonly runner: string;
  /** Gauntlet budget ceilings projected into the configuration's `budget` section. */
  readonly budget?: Readonly<Record<string, number>>;
}

export interface EscalateResult {
  readonly escalationId: string;
  readonly exitCode: number;
  /** Archived stdout — the report (or an empty file when Gauntlet produced none). */
  readonly stdoutRef: string;
  readonly stderrRef: string;
  /** Parsed from the report; `null` when Gauntlet never reached a terminal state (e.g. a refusal). */
  readonly gauntletTerminal: GauntletTerminal | null;
}

export interface EscalateOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  /** The posture this Workbench booted with. Only `uncontained-local` admits a host spawn. */
  readonly executionPosture: ExecutionPosture;
  /** Where escalation projects and stdout/stderr archives live (a subdirectory of the app home). */
  readonly home: string;
  /** The Gauntlet executable; production resolves `COGNATE_GAUNTLET_BIN` then PATH (`gauntlet`). */
  readonly binary?: string;
  /** The execution world the binary is spawned in; default `local`. */
  readonly worldId?: string;
  readonly semanticRef?: SemanticRef;
}

/** A typed pre-spawn refusal. `exitCode === -1` is reserved for "no process ran". */
export class EscalationRefusedError extends Error {
  override readonly name = "EscalationRefusedError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

type Lease = CapabilityLease;
async function call<I, O>(lease: Lease, input: I, ctx: HandlerContext): Promise<O> {
  const result = await lease.invoke(input, ctx);
  if (result.ok) return result.value as O;
  const failure = result.failure;
  if (failure.kind === "failed") throw failure.error;
  throw new Error(`capability ${lease.contract.id} failed: ${failure.kind}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new EscalationRefusedError("escalate-invalid-input", "case.escalate requires an input object");
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new EscalationRefusedError("escalate-invalid-input", `case.escalate: ${field} must contain 1–${max} characters`);
  return value.trim();
}

function validateInput(raw: unknown): EscalateInput {
  const value = asRecord(raw);
  const criteria = Array.isArray(value.criteria) ? value.criteria.filter((c): c is string => typeof c === "string" && c.trim().length > 0) : [];
  if (criteria.length === 0) throw new EscalationRefusedError("escalate-criteria-required", "case.escalate requires at least one named gate criterion");
  const budget = value.budget && typeof value.budget === "object" && !Array.isArray(value.budget)
    ? Object.fromEntries(Object.entries(value.budget as Record<string, unknown>).filter(([, v]) => typeof v === "number" && Number.isFinite(v))) as Record<string, number>
    : {};
  return {
    caseId: boundedString(value.caseId, "caseId"),
    assignmentId: boundedString(value.assignmentId, "assignmentId"),
    criteria,
    // Empty is preserved (not coerced): the refusal below must be able to tell "not named" apart.
    runner: typeof value.runner === "string" ? value.runner.trim() : "",
    budget,
  };
}

/** A case id is operator data; it may only name one directory level under the escalation root. */
function safeKey(caseId: string): string {
  const key = caseId.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  return key || "case";
}

function latestFrozenCriterion(events: readonly { readonly eventType: string; readonly payload: unknown }[], caseId: string): FrozenCriterion | undefined {
  const match = [...events].reverse().find((e) => e.eventType === CASE_EVENTS.criterion && (e.payload as { caseId?: string }).caseId === caseId);
  return match ? (match.payload as { readonly criterion: FrozenCriterion }).criterion : undefined;
}

/** Gauntlet's reference, projected from the frozen criterion. Deterministic: equal criteria yield
 *  equal bytes, so the lock digest is stable across escalations. */
export function projectAnswerKey(caseId: string, criterion: FrozenCriterion): string {
  const list = (items: readonly string[]): string => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)");
  return [
    `# Frozen reference — case ${caseId}`,
    "",
    `criterion-hash: ${criterion.criterionHash}`,
    `version: ${criterion.version}`,
    "",
    "## Required checks",
    list(criterion.requiredChecks),
    "",
    "## Observed",
    list(criterion.observed),
    "",
    "## Unobserved",
    list(criterion.unobserved),
    "",
    "## Guardrails",
    list(criterion.guardrails),
    "",
    "## Protected invariants",
    list(criterion.protectedInvariants),
    "",
  ].join("\n");
}

export function projectManifest(caseId: string, criterion: FrozenCriterion): string {
  const seq = (items: readonly string[]): string => (items.length ? items.map((i) => `  - ${JSON.stringify(i)}`).join("\n") : "  []");
  return [
    `case: ${caseId}`,
    `criterion_hash: ${criterion.criterionHash}`,
    `version: ${criterion.version}`,
    "required_checks:",
    seq(criterion.requiredChecks),
    "observed:",
    seq(criterion.observed),
    "unobserved:",
    seq(criterion.unobserved),
    "guardrails:",
    seq(criterion.guardrails),
    "protected_invariants:",
    seq(criterion.protectedInvariants),
    "",
  ].join("\n");
}

export function projectConfig(caseId: string, criterion: FrozenCriterion, runner: string, budget: Readonly<Record<string, number>> = {}): string {
  const ceiling = (key: string, fallback: number): number => (typeof budget[key] === "number" && Number.isFinite(budget[key]) ? budget[key]! : fallback);
  return [
    "---",
    `runners:`,
    `  default: ${JSON.stringify(runner)}`,
    "reference:",
    "  manifest: reference/reference.yaml",
    "  answer_key: reference/answer-key.md",
    "  digest_algo: sha256",
    "budget:",
    `  max_rounds: ${ceiling("max_rounds", 4)}`,
    `  max_wall_seconds: ${ceiling("max_wall_seconds", 600)}`,
    `  max_tokens: ${ceiling("max_tokens", 200000)}`,
    `  max_cost_usd: ${ceiling("max_cost_usd", 5)}`,
    "---",
    "",
    `# Cognate Workbench escalation — case ${caseId}`,
    `criterion-hash: ${criterion.criterionHash}`,
    "",
  ].join("\n");
}

/** Parse Gauntlet's terminal state from its stdout report. The JSON report's `terminal_state` is
 *  authoritative; the human `run: terminal=<state>` line is the fallback. Anything else is `null`. */
export function parseGauntletTerminal(stdout: string): GauntletTerminal | null {
  const json = stdout.match(/"terminal_state"\s*:\s*"([a-z_]+)"/);
  if (json && (GAUNTLET_TERMINALS as readonly string[]).includes(json[1]!)) return json[1] as GauntletTerminal;
  const line = stdout.match(/(?:^|\n)run:\s*terminal=([a-z_]+)/);
  if (line && (GAUNTLET_TERMINALS as readonly string[]).includes(line[1]!)) return line[1] as GauntletTerminal;
  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

interface Projection {
  readonly configRef: string;
  readonly referenceDigest: string;
  readonly referenceProjectionDigest: string;
}

/**
 * Writes the escalation project ONCE per Case: one `GAUNTLET.md` configuration plus the reference
 * projection (`reference/answer-key.md`, `reference/reference.yaml`, `.gauntlet/reference.lock`).
 * On later escalations the frozen project is reused verbatim — Workbench never re-freezes a
 * changed reference. Gauntlet's own lock check is what refuses a mutated artifact.
 */
async function ensureProjection(projectDir: string, caseId: string, criterion: FrozenCriterion, runner: string, budget: Readonly<Record<string, number>>): Promise<Projection> {
  const configRef = join(projectDir, "GAUNTLET.md");
  const answerKeyPath = join(projectDir, "reference", "answer-key.md");
  const manifestPath = join(projectDir, "reference", "reference.yaml");
  const lockPath = join(projectDir, ".gauntlet", "reference.lock");
  const answerKey = projectAnswerKey(caseId, criterion);
  const manifest = projectManifest(caseId, criterion);
  const referenceProjectionDigest = sha256(answerKey);
  if (await exists(configRef)) {
    // Frozen. Do not rewrite anything; report the digest Workbench recorded at freeze time.
    return { configRef, referenceDigest: criterion.criterionHash, referenceProjectionDigest };
  }
  await mkdir(dirname(answerKeyPath), { recursive: true });
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(answerKeyPath, answerKey);
  await writeFile(manifestPath, manifest);
  await writeFile(lockPath, JSON.stringify({
    answer_key_path: "reference/answer-key.md",
    manifest_path: "reference/reference.yaml",
    answer_key_digest: sha256(answerKey),
    manifest_digest: sha256(manifest),
    unit_count: criterion.requiredChecks.length,
    criterion_hash: criterion.criterionHash,
  }, null, 2));
  await writeFile(configRef, projectConfig(caseId, criterion, runner, budget));
  return { configRef, referenceDigest: criterion.criterionHash, referenceProjectionDigest };
}

export function escalateComponent(options: EscalateOptions): Component {
  const contract = { id: ESCALATE_CAPABILITY, version: "1.0.0", ...(options.semanticRef ? { semanticRef: options.semanticRef } : {}) };
  const binary = () => options.binary ?? process.env.COGNATE_GAUNTLET_BIN ?? "gauntlet";

  const waitDone = async (service: RuntimeService, caller: Caller, runId: string): Promise<void> => {
    for (let i = 0; i < 400; i++) {
      const run = await service.getRun(caller, { runId });
      if (run.status === "completed") return;
      if (run.status === "failed" || run.status === "cancelled") throw new Error(`escalation record failed: run ${runId} ${run.status}`);
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error(`escalation record timed out: ${runId}`);
  };

  const record = async (events: readonly { readonly type: string; readonly payload: Json }[], idempotencyKey: string): Promise<void> => {
    const service = options.getService();
    const { runId } = await service.startRun(options.systemCaller, {
      agent: AGENT_CONFIG,
      input: { kind: "workbench.recorded", events } as unknown as Json,
      idempotencyKey,
    });
    await waitDone(service, options.systemCaller, runId);
  };

  return {
    id: "cognitive:escalate",
    provides: [contract],
    requires: { exec: { capability: "process.exec" } },
    activate(fiber) {
      const exec = fiber.dependencies.exec;
      fiber.provide(contract, async (raw: unknown, ctx: HandlerContext): Promise<EscalateResult> => {
        // A case escalation is a human decision: never a step inside an agent run.
        await requireOperator(ctx, ESCALATE_CAPABILITY, (event) => record([event as { type: string; payload: Json }], `escalate-refusal:${randomUUID()}`));
        const input = validateInput(raw);

        // Refuse before any spawn — in this order, cheapest and most binding first.
        if (options.executionPosture !== "uncontained-local") {
          throw new EscalationRefusedError("escalate-posture-refuses-host-spawn",
            `case.escalate refused: this Workbench runs in the "${options.executionPosture}" posture, which does not admit a host spawn (src/executionPosture.ts). ` +
            `Escalation requires COGNATE_EXECUTION_POSTURE=uncontained-local.`);
        }
        if (!input.runner) {
          throw new EscalationRefusedError("escalate-runner-not-named",
            "case.escalate refused: the operator must name a Gauntlet runner (runners.default). Workbench never chooses one on the operator's behalf.");
        }
        const service = options.getService();
        const events: { readonly eventType: string; readonly payload: unknown }[] = [];
        for await (const e of service.events(options.systemCaller, {})) events.push({ eventType: e.eventType, payload: e.payload });
        const frozen = latestFrozenCriterion(events, input.caseId);
        if (!frozen) {
          throw new EscalationRefusedError("escalate-no-frozen-criterion",
            `case.escalate refused: case ${input.caseId} has no frozen criterion to escalate against.`);
        }
        for (const id of input.criteria) {
          if (!frozen.requiredChecks.includes(id)) {
            throw new EscalationRefusedError("escalate-criteria-not-frozen",
              `case.escalate refused: "${id}" is not a required check of the frozen criterion for case ${input.caseId}.`);
          }
        }
        const opened = events.find((e) => e.eventType === CASE_EVENTS.opened && (e.payload as { caseId?: string }).caseId === input.caseId);
        const intent = String((opened?.payload as { desiredOutcome?: string } | undefined)?.desiredOutcome ?? "").trim() || input.caseId;

        const escalationId = `esc-${randomUUID()}`;
        const projectDir = join(options.home, "escalations", safeKey(input.caseId));
        const projection = await ensureProjection(projectDir, input.caseId, frozen, input.runner, input.budget ?? {});
        const argv = [binary(), "run", "--config", projection.configRef, intent];
        const argvDigest = hashOf(argv);
        const common = {
          escalationId,
          caseId: input.caseId,
          assignmentId: input.assignmentId,
          criteria: input.criteria,
          runner: input.runner,
          referenceDigest: frozen.criterionHash,
          referenceProjectionDigest: projection.referenceProjectionDigest,
          version: frozen.version,
          argvDigest,
          configRef: projection.configRef,
          intent,
        };
        await record([{ type: ESCALATION_INTENDED, payload: common as unknown as Json }], `escalation-intended:${escalationId}`);

        const runDir = join(projectDir, "runs", escalationId);
        await mkdir(runDir, { recursive: true });
        const stdoutRef = join(runDir, "stdout.txt");
        const stderrRef = join(runDir, "stderr.txt");

        let outcome: ExecResult;
        try {
          outcome = await call<ExecInput, ExecResult>(exec!, { worldId: options.worldId ?? "local", argv, cwd: projectDir, timeoutMs: 600_000 }, ctx);
        } catch (error) {
          // A refused spawn or an uncontained-world refusal: archive the reason and record it. No
          // report exists, so there is no terminal state to claim.
          const reason = error instanceof Error ? error.message : String(error);
          await writeFile(stdoutRef, "");
          await writeFile(stderrRef, reason);
          await record([{ type: ESCALATION_RECORDED, payload: { ...common, exitCode: -1, reportRef: stdoutRef, stdoutRef, stderrRef, gauntletTerminal: null, spawnRefused: reason } as unknown as Json }], `escalation-recorded:${escalationId}`);
          throw new EscalationRefusedError("escalate-spawn-refused", `case.escalate refused before spawn: ${reason}`);
        }

        await writeFile(stdoutRef, outcome.stdout);
        await writeFile(stderrRef, outcome.stderr);
        const gauntletTerminal = parseGauntletTerminal(outcome.stdout);
        await record([{ type: ESCALATION_RECORDED, payload: {
          ...common,
          exitCode: outcome.exitCode,
          reportRef: stdoutRef,
          stdoutRef,
          stderrRef,
          gauntletTerminal,
          timedOut: outcome.timedOut,
        } as unknown as Json }], `escalation-recorded:${escalationId}`);
        // Gauntlet's refusal is surfaced (exitCode + stderrRef), never translated into a Workbench
        // settlement and never followed by a re-freeze.
        return { escalationId, exitCode: outcome.exitCode, stdoutRef, stderrRef, gauntletTerminal };
      });
    },
  };
}
