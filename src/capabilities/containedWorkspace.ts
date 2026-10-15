// Opt-in Linux child-process namespace containment. Binary trust and runtime roots are host-owned;
// a caller can choose only an existing workspace directory, never the sandbox implementation.
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, sep } from "node:path";
import { bubblewrapExecutionWorld, type BubblewrapExecutionWorldOptions, type ExecutionWorldProvider, type ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import type { Json } from "@godspeedai/cognate-events";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RunView, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { containedWorldId } from "./executionWorlds.ts";
import { workspaceIdFor } from "./workspaceSelect.ts";

export type ContainmentConfig = Omit<BubblewrapExecutionWorldOptions, "worldId" | "workspaceRoot">;
const ALLOWED_RUNTIME_ROOTS = new Set(["/usr/bin", "/usr/lib", "/usr/lib64", "/bin", "/lib", "/lib64"]);

/** Structural validation only; this checks operator input shape, not binary provenance or patch status. */
export function validateContainmentConfig(value: unknown): ContainmentConfig {
  const fail = (reason: string): never => { throw new Error(`invalid host containment configuration: ${reason}`); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("expected an object");
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["executablePath", "provenance", "runtimeRoots", "bunExecutable", "timeoutMs", "maxOutputBytes"]);
  if (Object.keys(raw).some(key => !allowed.has(key))) return fail("contains unsupported fields");
  if (typeof raw.executablePath !== "string" || !raw.executablePath.startsWith("/") || raw.executablePath.includes("\0")) return fail("executablePath must be an absolute path");
  const proof = raw.provenance;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return fail("operator-verified provenance is required");
  const p = proof as Record<string, unknown>;
  if (Object.keys(p).some(key => !["operatorVerified", "binarySha256", "version", "source", "patchedCve202687766"].includes(key))
      || p.operatorVerified !== true || p.patchedCve202687766 !== true
      || typeof p.binarySha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.binarySha256)
      || typeof p.version !== "string" || !p.version.trim()
      || typeof p.source !== "string" || !p.source.trim()) return fail("provenance fields are invalid");
  if (!Array.isArray(raw.runtimeRoots) || raw.runtimeRoots.length === 0
      || raw.runtimeRoots.some(root => typeof root !== "string" || !ALLOWED_RUNTIME_ROOTS.has(root))) return fail("runtimeRoots must contain explicit supported public runtime directories");
  if (raw.bunExecutable !== undefined && (typeof raw.bunExecutable !== "string" || !raw.bunExecutable.startsWith("/") || raw.bunExecutable.includes("\0"))) return fail("bunExecutable must be an absolute path");
  if (raw.timeoutMs !== undefined && (!Number.isSafeInteger(raw.timeoutMs) || Number(raw.timeoutMs) < 1 || Number(raw.timeoutMs) > 300_000)) return fail("timeoutMs is outside the supported range");
  if (raw.maxOutputBytes !== undefined && (!Number.isSafeInteger(raw.maxOutputBytes) || Number(raw.maxOutputBytes) < 1024 || Number(raw.maxOutputBytes) > 16_777_216)) return fail("maxOutputBytes is outside the supported range");
  return {
    executablePath: raw.executablePath,
    provenance: {
      operatorVerified: p.operatorVerified as true,
      binarySha256: p.binarySha256,
      version: p.version,
      source: p.source,
      patchedCve202687766: p.patchedCve202687766 as true,
    },
    runtimeRoots: [...new Set(raw.runtimeRoots as string[])],
    ...(raw.bunExecutable ? { bunExecutable: raw.bunExecutable as string } : {}),
    ...(raw.timeoutMs !== undefined ? { timeoutMs: raw.timeoutMs as number } : {}),
    ...(raw.maxOutputBytes !== undefined ? { maxOutputBytes: raw.maxOutputBytes as number } : {}),
  };
}

export interface ContainedWorkspaceOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly registry: ExecutionWorldRegistry;
  readonly getKnownWorkspaceIds: () => ReadonlySet<string>;
  readonly config?: ContainmentConfig;
  /** Host application data/config directory; used to prevent exposing secrets through the workspace bind. */
  readonly protectedHome?: string;
  readonly semanticRefs: { readonly contained?: SemanticRef; readonly containmentInspect?: SemanticRef };
}

export interface ContainedWorkspaceInput { readonly path: string }

export interface ContainmentInspection {
  readonly configured: boolean;
  readonly platformSupported: boolean;
  readonly preflightRequired: true;
  readonly reason?: string;
  readonly limits: {
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
    readonly runtimeRootCount: number;
  };
}

export interface ConfigurationRunFailureDetails {
  readonly runId?: string;
  readonly safeToRollback: boolean;
  readonly committedEvents: readonly string[];
  readonly reconciliationRequired: boolean;
}

export class ConfigurationRunError extends Error implements ConfigurationRunFailureDetails {
  override readonly name = "ConfigurationRunError";
  constructor(message: string, readonly details: ConfigurationRunFailureDetails) { super(message); }
  get runId(): string | undefined { return this.details.runId; }
  get safeToRollback(): boolean { return this.details.safeToRollback; }
  get committedEvents(): readonly string[] { return this.details.committedEvents; }
  get reconciliationRequired(): boolean { return this.details.reconciliationRequired; }
}

function inside(root: string, path: string): boolean { return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep); }
function titleFor(root: string): string { return root.split(sep).filter(Boolean).at(-1) ?? "Contained workspace"; }

function safeInspection(config: ContainmentConfig | undefined): ContainmentInspection {
  const platformSupported = process.platform === "linux";
  let checked: ContainmentConfig | undefined;
  try { if (config) checked = validateContainmentConfig(config); } catch {}
  const limits = { timeoutMs: checked?.timeoutMs ?? 30_000, maxOutputBytes: checked?.maxOutputBytes ?? 1_048_576, runtimeRootCount: checked?.runtimeRoots.length ?? 0 };
  if (!config) return { configured: false, platformSupported, preflightRequired: true, reason: "host containment configuration is unavailable", limits };
  if (!checked) return { configured: false, platformSupported, preflightRequired: true, reason: "host containment configuration is invalid", limits };
  if (!platformSupported) return { configured: true, platformSupported: false, preflightRequired: true, reason: "Linux namespace containment is unavailable on this host", limits };
  return { configured: true, platformSupported: true, preflightRequired: true, reason: "select a dedicated root to run native containment preflight", limits };
}

async function committedConfigEffects(service: RuntimeService, caller: Caller, runId: string): Promise<{ readonly events: string[]; readonly certain: boolean }> {
  const events: string[] = [];
  try {
    for await (const event of service.events(caller, { runId, follow: false })) {
      if (event.eventType === "execution.world.connected" || event.eventType === "workspace.added") events.push(event.eventType);
    }
    return { events, certain: true };
  } catch {
    return { events, certain: false };
  }
}

/** Wait for the durable configuration run. On deadline, cancel then reread its terminal fold;
 * event evidence controls whether the caller may safely remove the preflighted provider. */
export async function awaitConfigurationRun(
  service: RuntimeService,
  caller: Caller,
  input: Json,
  options: { readonly timeoutMs?: number; readonly pollIntervalMs?: number; readonly cancelWaitMs?: number; readonly correlationId?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 6_000;
  const pollIntervalMs = options.pollIntervalMs ?? 15;
  const cancelWaitMs = options.cancelWaitMs ?? 1_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || !Number.isSafeInteger(cancelWaitMs) || cancelWaitMs < 1) throw new RangeError("configuration wait limits must be positive integers");
  const correlationId = options.correlationId ?? `contained-config:${randomUUID()}`;
  const rawRequestId = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, Json>).requestId : undefined;
  const stableInputRequestId = typeof rawRequestId === "string" ? rawRequestId : undefined;
  const hasStableInputRequestId = stableInputRequestId !== undefined;
  let requestId = stableInputRequestId ?? randomUUID();
  let runId: string | undefined;
  const maxReceiptAttempts = 16;

  const failTerminal = async (terminalRunId: string, run: { readonly status: string; readonly error?: string | null }, timedOut: boolean): Promise<never> => {
    const scan = await committedConfigEffects(service, caller, terminalRunId);
    const safeToRollback = scan.certain && scan.events.length === 0;
    const partial = scan.events.length > 0;
    const detail = timedOut ? "timed out and was cancelled" : `ended ${run.status}${run.error ? `: ${run.error}` : ""}`;
    const state = partial
      ? `committed ${scan.events.join(", ")}; the provider was retained for reconciliation`
      : safeToRollback
        ? "no workspace or world event was committed"
        : "event history could not be verified; the provider was retained for reconciliation";
    throw new ConfigurationRunError(`configuration run ${runId} ${detail}; ${state}`, {
      runId: terminalRunId, safeToRollback, committedEvents: scan.events, reconciliationRequired: !safeToRollback,
    });
  };

  for (let receiptAttempt = 0; receiptAttempt < maxReceiptAttempts; receiptAttempt++) {
    const requestInput = structuredClone(input) as Json;
    if (hasStableInputRequestId && requestInput && typeof requestInput === "object" && !Array.isArray(requestInput)) {
      (requestInput as Record<string, Json>).requestId = requestId;
    }
    const request = { agent: AGENT_CONFIG, input: requestInput, idempotencyKey: `contained-config:${requestId}`, correlationId };

    // A positive exact-input match proves this idempotency receipt predates this selection call.
    // Absence is never used to infer that a previous startRun did not commit.
    let priorReceipt: RunView | undefined;
    if (hasStableInputRequestId) {
      try {
        const matches = (await service.listRuns(caller, { correlationId, agent: AGENT_CONFIG }))
          .filter(run => run.input && typeof run.input === "object" && !Array.isArray(run.input)
            && (run.input as Record<string, Json>).requestId === requestId);
        if (matches.length > 1) throw new ConfigurationRunError(
          `multiple configuration receipts match operation ${requestId}; inspect the runs before retry`,
          { safeToRollback: false, committedEvents: [], reconciliationRequired: true },
        );
        priorReceipt = matches[0];
      } catch (error) {
        if (error instanceof ConfigurationRunError) throw error;
        // The native idempotency receipt remains authoritative. Without a positive prior-run
        // observation, a terminal result from this call will not trigger another attempt.
      }
    }

    let receipt: RunView | undefined;
    let startError: unknown;
    for (let startAttempt = 0; startAttempt < 2; startAttempt++) {
      try {
        receipt = await service.startRun(caller, request);
        break;
      } catch (error) {
        startError = error;
      }
    }
    if (!receipt) throw new ConfigurationRunError(
      `configuration acceptance is uncertain; provider retained; inspect correlation ${correlationId} and operation ${requestId}${startError instanceof Error ? ` (${startError.message})` : ""}`,
      { safeToRollback: false, committedEvents: [], reconciliationRequired: true },
    );
    runId = receipt.runId;

    if (receipt.status === "completed") return;
    if (receipt.status === "failed" || receipt.status === "cancelled") {
      if (priorReceipt?.runId === receipt.runId && hasStableInputRequestId) {
        const scan = await committedConfigEffects(service, caller, receipt.runId);
        if (!scan.certain || scan.events.length > 0) return failTerminal(receipt.runId, receipt, false);
        if (receiptAttempt + 1 < maxReceiptAttempts) {
          requestId = `${requestId}:retry:${receipt.runId}`;
          continue;
        }
        throw new ConfigurationRunError(`configuration run ${receipt.runId} ended ${receipt.status}; no domain events were committed, but the ${maxReceiptAttempts}-attempt recovery limit was reached`, {
          runId: receipt.runId, safeToRollback: true, committedEvents: [], reconciliationRequired: false,
        });
      }
      return failTerminal(receipt.runId, receipt, false);
    }
    break;
  }
  if (!runId) throw new ConfigurationRunError(
    `configuration acceptance is uncertain; provider retained; inspect correlation ${correlationId} and operation ${requestId}`,
    { safeToRollback: false, committedEvents: [], reconciliationRequired: true },
  );

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const run = await service.getRun(caller, { runId });
      if (run.status === "completed") return;
    if (run.status === "failed" || run.status === "cancelled") return failTerminal(runId, run, false);
    } catch {
      // A transient read failure is resolved by the cancel + authoritative reread at the deadline.
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))));
  }

  const cancellation = Promise.resolve().then(() => service.cancelRun(caller, {
    runId,
    reason: "contained workspace configuration deadline exceeded",
    idempotencyKey: `contained-config-timeout:${runId}`,
  })).then(() => undefined, () => undefined);
  await Promise.race([cancellation, new Promise(resolve => setTimeout(resolve, cancelWaitMs))]);
  try {
    const run = await service.getRun(caller, { runId });
    if (run.status === "completed") return;
    if (run.status === "failed" || run.status === "cancelled") return failTerminal(runId, run, true);
    const scan = await committedConfigEffects(service, caller, runId);
    throw new ConfigurationRunError(`configuration run ${runId} remains ${run.status}; ${scan.events.length ? `committed ${scan.events.join(", ")}; ` : ""}provider retained; inspect the run and reconcile before retry`, {
      runId, safeToRollback: false, committedEvents: scan.events, reconciliationRequired: true,
    });
  } catch (error) {
    if (error instanceof ConfigurationRunError) throw error;
    throw new ConfigurationRunError(`configuration run ${runId} could not be reread after cancellation; provider retained; inspect the run and reconcile before retry`, {
      runId, safeToRollback: false, committedEvents: [], reconciliationRequired: true,
    });
  }
}

export function containedWorkspaceComponent(options: ContainedWorkspaceOptions): Component {
  const inspect = { id: "execution.containment.inspect", version: "1.0.0", semanticRef: options.semanticRefs.containmentInspect };
  const contained = { id: "workspace.contained.select", version: "1.0.0", semanticRef: options.semanticRefs.contained };
  const inFlight = new Map<string, Promise<{ readonly workspaceId: string; readonly root: string; readonly executionWorldId: string; readonly title: string }>>();
  const operatorOnly = (ctx: HandlerContext, capability: string) => {
    if (ctx.actor.kind !== "user" || ctx.runId) throw new Error(`${capability}: only a direct human operator may ${capability === "workspace.contained.select" ? "select a contained workspace" : "inspect host containment"}`);
  };

  async function select(input: unknown, ctx: HandlerContext) {
    operatorOnly(ctx, contained.id);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${contained.id}: accepts only a path`);
    const record = input as Record<string, unknown>;
    if (Object.keys(record).some(key => key !== "path") || typeof record.path !== "string" || !record.path.trim() || record.path.includes("\0")) {
      throw new Error(`${contained.id}: accepts only a path`);
    }
    if (!options.config) throw new Error(`${contained.id}: host containment configuration is unavailable`);
    let config: ContainmentConfig;
    try { config = validateContainmentConfig(options.config); }
    catch (error) { throw new Error(`${contained.id}: ${error instanceof Error ? error.message : "host containment configuration is invalid"}`); }
    if (process.platform !== "linux") throw new Error(`${contained.id}: Linux namespace containment is unavailable on this host`);
    if (!options.protectedHome) throw new Error(`${contained.id}: protected application home is unavailable`);

    let root: string;
    let protectedHome: string;
    try {
      [root, protectedHome] = await Promise.all([realpath(record.path), realpath(options.protectedHome)]);
    } catch {
      throw new Error(`${contained.id}: workspace root and protected application home must exist`);
    }
    if (root === "/" || !(await stat(root)).isDirectory()) throw new Error(`${contained.id}: choose an existing dedicated directory, not the filesystem root`);
    if (inside(root, protectedHome)) throw new Error(`${contained.id}: workspace root must not contain the protected application home`);

    const worldId = containedWorldId(config, root);
    const workspaceId = workspaceIdFor(worldId, root);
    const title = titleFor(root);
    const service = options.getService();
    const existing = inFlight.get(worldId);
    if (existing) return existing;
    const task = (async () => {
      let provider: ExecutionWorldProvider | undefined;
      let registeredHere = false;
      let durableWorldAlreadyRecorded = false;
      try {
        const worldRows = (await service.readProjection(options.systemCaller, { name: "execution-worlds" })).rows;
        durableWorldAlreadyRecorded = worldRows.some(row => row.key === `record/${worldId}` || row.key.endsWith(`/record/${worldId}`));
        if (!options.registry.has(worldId)) {
          const connection = { kind: "linux-bubblewrap" as const, workspaceRoot: root };
          provider = await bubblewrapExecutionWorld({ ...config, worldId, workspaceRoot: root } satisfies BubblewrapExecutionWorldOptions);
          options.registry.register(provider);
          registeredHere = true;
        }
        options.registry.get(worldId);
        const metadata = {
          containment: "linux-child-process-namespaces",
          network: "denied",
          workspace: basename(root),
          resourceLimits: "wall-time-and-output-only",
        };
        const connection = { kind: "linux-bubblewrap", workspaceRoot: root } as unknown as Json;
        const correlationId = `contained-config:${workspaceId}`;
        if (options.getKnownWorkspaceIds().has(workspaceId) && durableWorldAlreadyRecorded) {
          await awaitConfigurationRun(service, options.systemCaller, {
            kind: "workspace.selected", workspaceId,
          } as unknown as Json, { correlationId });
        } else {
          await awaitConfigurationRun(service, options.systemCaller, {
            kind: "workspace.contained.added", requestId: worldId, workspaceId, root, title,
            executionWorldId: worldId, worldLabel: `Contained: ${basename(root)}`,
            worldMetadata: metadata, connection,
          } as unknown as Json, { correlationId });
        }
        return { workspaceId, root, executionWorldId: worldId, title };
      } catch (error) {
        const safeToRemoveNewProvider = !(error instanceof ConfigurationRunError) || error.safeToRollback;
        if (registeredHere && !durableWorldAlreadyRecorded && safeToRemoveNewProvider) await options.registry.unregister(worldId).catch(() => {});
        throw error;
      }
    })();
    inFlight.set(worldId, task);
    try { return await task; }
    finally { if (inFlight.get(worldId) === task) inFlight.delete(worldId); }
  }

  return {
    id: "workspace:contained",
    provides: [inspect, contained],
    activate(fiber) {
      fiber.provide(inspect, async (_raw, ctx) => {
        operatorOnly(ctx, inspect.id);
        return safeInspection(options.config);
      });
      fiber.provide(contained, select);
    },
  };
}
