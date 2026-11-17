// Capability-bundles tranche T3 (design §6.1, CUJ 3/5/12): MCP server lifecycle with supervisor
// integration — start, stop, suspend, resume — and the `McpHost` the dispatcher routes MCP tool
// calls through.
//
// Every entry point decides through `authorizeCapabilityOp` (ops mcp.start / mcp.stop / suspend /
// resume for the lifecycle acts; the dispatcher's `invoke` for calls), every mutating act runs in
// the shared runtime mutex with the authorization as the last step before its commit, and every
// refusal is recorded. The operator's target slot (capability + optional session) is the act's
// explicit target, exactly as for activate/deactivate; a CALLER's session is never read from input.
//
// Suspension (§6.1): a commit listener on the store sees `capability.suspended` / `deactivated` /
// `uninstalled` / `repointed` and `session.archived` synchronously with the commit (the grant
// revoke/expiry batch included), and initiates the stop in that same turn: new calls are refused at
// once (`accepting` flips), a graceful server lets in-flight calls finish under their snapshot
// (bounded drain) before its stdin closes, an emergency server (or an `integrity` suspension) is
// killed at once. The termination outcome is the spawn ledger's `exited` record.
import type { Component, CapabilityContract, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { DurableStore, StoredEvent } from "@godspeedai/cognate-events";
import type { ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import { randomUUID } from "node:crypto";
import { McpClient, boundBytes, describeOpaque, isServerId, type McpRecord, type McpToolDef } from "../mcp/client.ts";
import { authorizeCapabilityOp, type Actor, type CapabilityOp } from "../workbench/authoritySelection.ts";
import type { AuthorityIndex } from "../workbench/authorityIndex.ts";
import type { LifecycleRecorder } from "../workbench/lifecycleRecorder.ts";
import { createRuntimeMutex, type RuntimeMutex } from "../workbench/runtimeMutex.ts";
import { spawnGoverned, type LedgerEvent, type PostureRecord, type SpawnDeps, type SpawnHandle, type SpawnRequest } from "./execSpawn.ts";
import { verifyBundleIntegrity, type BundleManifestData, type McpServerDecl } from "./skillLoader.ts";

export const MCP_CONTRACT_IDS = ["capability.mcp.start", "capability.mcp.stop", "capability.bundle.suspend", "capability.bundle.resume"] as const;

export type McpCallResult =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly retryable: boolean };

/** What the dispatcher sees: tool discovery and calls, never processes. */
export interface McpHost {
  toolsFor(capabilityId: string, version: string, sessionId: string | undefined): readonly McpToolDef[];
  serversFor(capabilityId: string, version: string, sessionId: string | undefined): readonly { serverId: string; state: string }[];
  call(capabilityId: string, version: string, sessionId: string | undefined, toolRef: string, args: Record<string, unknown>, call: { deadlineMs: number; actorId: string }): Promise<McpCallResult>;
}

export interface McpSupervisorOptions {
  readonly tenant: string;
  readonly getRecorder: () => LifecycleRecorder;
  readonly getIndex: () => AuthorityIndex;
  readonly isEnabled: () => Promise<boolean>;
  readonly deploymentOk?: () => boolean;
  readonly now?: () => Date;
  readonly mutex?: RuntimeMutex;
  /** The workbench projection rows (bundle-version/*, spawn/*). */
  readonly readRows: () => Promise<readonly { key: string; value: unknown }[]>;
  readonly recordDecision: (event: { readonly type: string; readonly payload: Record<string, unknown> }) => Promise<void>;
  readonly registry: () => ExecutionWorldRegistry;
  readonly resolveSecret: (key: string) => Promise<string | undefined>;
  readonly slots: SpawnDeps["slots"];
  /** Process view seam (tests); defaults to /proc. */
  readonly proc?: SpawnDeps["proc"];
  readonly getPosture: (worldId: string) => PostureRecord | undefined;
  readonly localHostSpawnAllowed: () => boolean;
  readonly probes?: SpawnDeps["probes"];
  readonly graceMs?: number;
  readonly killMs?: number;
  /** Period of the authority re-check of running servers (catches runtime disable, the section 1.5 invariant and clock expiry). */
  readonly reauthorizeMs?: number;
  /** True in the server: no spawn is admitted until `reconcileBoot` has finished successfully. */
  readonly bootGate?: boolean;
  readonly semanticRefs?: Readonly<Record<string, SemanticRef | undefined>>;
}

interface Running {
  readonly key: string;
  readonly capabilityId: string;
  readonly version: string;
  readonly sessionId: string | undefined;
  readonly serverId: string;
  readonly worldId: string;
  readonly decl: McpServerDecl;
  handle?: SpawnHandle;
  client?: McpClient;
  accepting: boolean;
  starting: boolean;
  cancelled?: string;
  inFlight: number;
  state: "starting" | "running" | "draining" | "stopping";
}

const slotKey = (capabilityId: string, sessionId: string | undefined): string => `${capabilityId}|${sessionId ?? ""}`;
const serverKey = (capabilityId: string, sessionId: string | undefined, serverId: string): string => `${slotKey(capabilityId, sessionId)}|${serverId}`;
const REASON = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

export interface McpSupervisor {
  readonly host: McpHost;
  component(): Component;
  /** Subscribe to commits: suspension/deactivation/uninstall/repoint/session expiry stop servers synchronously. */
  watch(store: DurableStore): () => void;
  /** Test/inspection seam: the live server states. */
  status(): readonly { capabilityId: string; sessionId?: string; serverId: string; version: string; state: string; pid?: number }[];
  /** Boot sweep: reconcile every spawn the ledger left non-terminal. */
  reconcileBoot(): Promise<{ spawnId: string; outcome: string }[]>;
  /** The index (or projection) initialisation failed fatally: no reconciliation runs, admission stays closed, the failure is recorded. */
  failBoot(error: unknown): Promise<void>;
  /** Stop every server (process shutdown). */
  shutdown(): Promise<void>;
}

/** Boot wiring: reconciliation waits for the REAL index initialisation. A fatal initialisation failure does not
 *  reconcile (the sweep depends on the projection it could not read); it records the failure and keeps admission closed. */
export async function reconcileAfterIndex(index: { readonly ready: Promise<void> }, supervisor: Pick<McpSupervisor, "reconcileBoot" | "failBoot">): Promise<void> {
  try { await index.ready; } catch (error) { await supervisor.failBoot(error).catch(() => {}); return; }
  await supervisor.reconcileBoot().catch(() => {});
}

export function createMcpSupervisor(options: McpSupervisorOptions): McpSupervisor {
  const nowMs = (): number => (options.now ?? (() => new Date()))().getTime();
  const mutex = options.mutex ?? createRuntimeMutex();
  const running = new Map<string, Running>();
  const graceMs = options.graceMs ?? 3000;
  // Boot gate: the boot sweep may kill by signature, so a spawn must never overlap it; a failed sweep keeps spawning disabled.
  let gateState: "pending" | "open" | "failed" = options.bootGate ? "pending" : "open";
  let settleGate: (ok: boolean) => void = () => {};
  const gate: Promise<boolean> = options.bootGate ? new Promise<boolean>((resolve) => { settleGate = resolve; }) : Promise.resolve(true);
  const openGate = (ok: boolean): void => { gateState = ok ? "open" : "failed"; settleGate(ok); };
  let shuttingDown = false;
  const pendingStarts = new Set<Promise<unknown>>();
  const tracked = <T,>(promise: Promise<T>): Promise<T> => {
    pendingStarts.add(promise);
    const done = (): void => { pendingStarts.delete(promise); };
    promise.then(done, done);
    return promise;
  };

  const record = async (type: string, payload: Record<string, unknown>, stream: string): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await options.getRecorder().commitBatch(stream, [{ type, payload }]);
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
    throw lastError;
  };
  const ledger = (spawnId: string, events: readonly LedgerEvent[]): Promise<void> =>
    options.getRecorder().commitBatch(`spawn:${spawnId}`, events as never).then(() => undefined);

  const decision = (capabilityId: string, operation: string, actor: Actor, outcome: "refused" | "allowed", reasonCode: string, reason: string, extra: Record<string, unknown> = {}): Promise<void> =>
    options.recordDecision({ type: "authority.decision.recorded", payload: { decisionId: randomUUID(), point: "mcp-manage", actorId: actor.id, actorKind: actor.kind, capability: capabilityId, operation, outcome, reasonCode, reason, ...extra } });

  let enabledCache = false;
  let indexReady = false;
  interface Prep { enabled: boolean; deploymentOk: boolean; index: AuthorityIndex | undefined }
  const prepare = async (): Promise<Prep> => {
    let enabled = false;
    try { enabled = (await options.isEnabled()) === true; } catch { enabled = false; }
    enabledCache = enabled;
    let index: AuthorityIndex | undefined = options.getIndex();
    if (index) { try { await index.ready; indexReady = true; } catch { index = undefined; } }
    return { enabled, deploymentOk: options.deploymentOk ? options.deploymentOk() : true, index };
  };
  const check = (op: CapabilityOp, prep: Prep, ctx: { actor: Actor; runId?: string }, capabilityId: string, sessionId: string | undefined) =>
    authorizeCapabilityOp(op, { enabled: prep.enabled, deploymentOk: prep.deploymentOk, index: prep.index, actor: ctx.actor, ...(ctx.runId ? { runId: ctx.runId } : {}), ...(sessionId ? { sessionId } : {}), capabilityId, ...(op === "mcp.start" ? { permission: "mcp.server" } : {}), nowMs: nowMs() });

  // ---- stop ---------------------------------------------------------------------------------
  const initiateStop = (entry: Running, reason: string, forceEmergency = false): void => {
    entry.accepting = false;
    if (entry.starting) {
      entry.cancelled = reason;
      entry.state = "stopping";
      // The process may already exist (the handshake is pending): an emergency kills it now.
      if (forceEmergency || entry.decl.stop === "emergency") entry.handle?.stop(reason, "emergency");
      return;
    }
    const mode = forceEmergency ? "emergency" : entry.decl.stop ?? "graceful";
    if (mode === "emergency" || entry.inFlight === 0) {
      entry.state = "stopping";
      entry.handle?.stop(reason, mode);
      return;
    }
    // Graceful with calls in flight: they finish under their snapshot (bounded), then the server is stopped.
    entry.state = "draining";
    const deadline = Date.now() + graceMs;
    const timer = setInterval(() => {
      if (entry.inFlight === 0 || Date.now() >= deadline) {
        clearInterval(timer);
        entry.state = "stopping";
        entry.handle?.stop(reason, "graceful");
      }
    }, 25);
    timer.unref?.();
  };

  const stopSlot = (capabilityId: string, sessionId: string | undefined, reason: string, forceEmergency = false, only?: (e: Running) => boolean): void => {
    for (const entry of running.values()) {
      if (entry.capabilityId === capabilityId && entry.sessionId === sessionId && (!only || only(entry))) initiateStop(entry, reason, forceEmergency);
    }
  };

  /** Re-run THE authorization function for every live server (section 6.1/CUJ 12 beyond suspensions): a server whose
   *  authority is gone (operator root or any grant revoked/expired, runtime disabled, section 1.5 invariant failed) is
   *  killed as a group and the loss is recorded. Synchronous over committed index state. */
  const reauthorizeAll = (): void => {
    if (!indexReady) return;
    for (const entry of [...running.values()]) {
      if (entry.state !== "running" && entry.state !== "starting") continue; // draining servers are already being stopped
      const auth = authorizeCapabilityOp("mcp.start", { enabled: enabledCache, deploymentOk: options.deploymentOk ? options.deploymentOk() : true, index: options.getIndex(), actor: { id: "operator", kind: "user" }, capabilityId: entry.capabilityId, ...(entry.sessionId ? { sessionId: entry.sessionId } : {}), permission: "mcp.server", nowMs: nowMs() });
      if (auth.ok) continue;
      initiateStop(entry, `authority-lost:${auth.code}`, true);
      void decision(entry.capabilityId, "mcp.reauthorize", { id: "system", kind: "system" }, "refused", auth.code, boundBytes(auth.reason, 512), { serverId: entry.serverId, version: entry.version }).catch(() => {});
    }
  };

  const watch = (store: DurableStore): (() => void) => {
    const unlisten = watchCommits(store);
    const timer = setInterval(() => { void (async () => { try { enabledCache = (await options.isEnabled()) === true; } catch { enabledCache = false; } reauthorizeAll(); })(); }, options.reauthorizeMs ?? 5000);
    timer.unref?.();
    return () => { clearInterval(timer); unlisten(); };
  };

  const watchCommits = (store: DurableStore): (() => void) => store.onCommitted((events: readonly StoredEvent[]) => {
    for (const event of events) {
      if (event.eventType === "authority.grant.revoked" || event.eventType === "authority.grant.expired") {
        // The index's own listener may run after this one in the same notification: re-check again once it has.
        reauthorizeAll();
        queueMicrotask(reauthorizeAll);
        continue;
      }
      if (event.tenant !== options.tenant) continue;
      const p = (event.payload ?? {}) as Record<string, unknown>;
      const capabilityId = String(p.capabilityId ?? "");
      const sessionId = typeof p.sessionId === "string" ? p.sessionId : undefined;
      switch (event.eventType) {
        case "capability.suspended": {
          const why = String(p.reason ?? "operator-yank");
          stopSlot(capabilityId, sessionId, `suspended:${why}`, why === "integrity");
          break;
        }
        case "capability.deactivated": stopSlot(capabilityId, sessionId, "deactivated"); break;
        case "capability.uninstalled": for (const e of running.values()) if (e.capabilityId === capabilityId) initiateStop(e, "uninstalled", true); break;
        case "capability.repointed": stopSlot(capabilityId, sessionId, "repointed", false, (e) => e.version !== String(p.to ?? "")); break;
        case "session.archived": for (const e of running.values()) if (e.sessionId === String(p.sessionId ?? "\0")) initiateStop(e, "session-archived"); break;
        default: break;
      }
    }
  });

  // ---- start (shared by the start handler and resume's respawn; the caller holds the mutex) ----
  const bundleOf = async (capabilityId: string, version: string): Promise<{ manifest: BundleManifestData; dir: string } | undefined> => {
    const rows = await options.readRows();
    const row = rows.find((r) => r.key === `bundle-version/${capabilityId}/${version}`)?.value as { manifest?: BundleManifestData | null; dir?: string } | undefined;
    if (!row?.manifest || !row.dir) return undefined;
    return { manifest: row.manifest, dir: row.dir };
  };

  const startServer = async (ctx: { actor: Actor; runId?: string }, input: { capabilityId: string; serverId: string; worldId: string; sessionId?: string }): Promise<{ ok: true; state: string; pid: number; tools: number } | { ok: false; code: string; reason: string }> => {
    const { capabilityId, serverId, worldId, sessionId } = input;
    const refuse = async (code: string, reason: string, extra: Record<string, unknown> = {}) => {
      await decision(capabilityId, "mcp.start", ctx.actor, "refused", code, reason, { serverId, worldId, ...extra }).catch(() => {});
      return { ok: false as const, code, reason };
    };
    if (shuttingDown) return refuse("shutting-down", "the runtime is shutting down; no new servers are started");
    // Callers wait for the gate BEFORE taking the shared mutex (the sweep runs inside it); here it is only checked.
    if (gateState !== "open") return refuse("reconcile-failed", "the boot reconciliation of the spawn ledger did not finish; spawning stays disabled");
    const first = check("mcp.start", await prepare(), ctx, capabilityId, sessionId);
    if (!first.ok) return refuse(first.code, first.reason);
    if (!isServerId(serverId)) return refuse("invalid-server-id", `invalid MCP server id ${serverId}`);
    const slotRow = first.row!;
    const bundle = await bundleOf(capabilityId, slotRow.version);
    const decl = bundle?.manifest.mcpServers?.find((s) => s.id === serverId);
    if (!bundle || !decl) return refuse("unknown-server", `${capabilityId}@${slotRow.version} declares no MCP server ${serverId}`);
    const key = serverKey(capabilityId, sessionId, serverId);
    const existing = running.get(key);
    if (existing && existing.version === slotRow.version && existing.state !== "stopping") return { ok: true, state: existing.state, pid: existing.handle?.pid ?? 0, tools: existing.client?.tools().length ?? 0 };
    if (existing) return refuse("still-stopping", `server ${serverId} of ${capabilityId} is still stopping; retry when it has exited`);
    // §4.4: the version directory must match its recorded hash before anything in it is executed.
    if (!(await verifyBundleIntegrity(bundle.dir, slotRow.version, bundle.manifest))) return refuse("integrity", `version ${slotRow.version} of ${capabilityId} failed its integrity check`);

    const entry: Running = { key, capabilityId, version: slotRow.version, sessionId, serverId, worldId, decl, accepting: false, starting: true, inFlight: 0, state: "starting" };
    running.set(key, entry);
    const argv = decl.command.map((arg) => arg.replaceAll("${bundleDir}", bundle.dir));
    const request: SpawnRequest = {
      capabilityId, version: slotRow.version, serverId, ...(sessionId ? { sessionId } : {}), worldId,
      argv, cwd: bundle.dir, bundleDir: bundle.dir,
      secrets: (decl.secrets ?? []).map((s) => ({ env: s.env, key: s.key })),
      restrictions: decl.restrictions ?? {}, stop: decl.stop ?? "graceful",
    };
    const fail = (code: string, reason: string) => { running.delete(key); return refuse(code, reason); };
    let spawned: Awaited<ReturnType<typeof spawnGoverned>>;
    try {
      spawned = await spawnGoverned({
        registry: options.registry(), getPosture: options.getPosture, resolveSecret: options.resolveSecret, ledger,
        recordRefusal: async (req, code, reason, extra) => { await decision(req.capabilityId, "mcp.spawn", ctx.actor, "refused", code, reason, { serverId: req.serverId, worldId: req.worldId, point: "spawn", ...extra }); },
        slots: options.slots, ...(options.proc ? { proc: options.proc } : {}), localHostSpawnAllowed: options.localHostSpawnAllowed,
        ...(options.probes ? { probes: options.probes } : {}),
        // The LAST step before the intent commit: authorization over the live index, nothing awaited between.
        beforeIntent: async () => {
          const last = check("mcp.start", await prepare(), ctx, capabilityId, sessionId);
          if (!last.ok) return { code: last.code, reason: `authorization lapsed before the spawn intent: ${last.reason}` };
          if (last.row!.version !== slotRow.version) return { code: "pre-state-changed", reason: `the activation moved to ${last.row!.version} before the spawn intent` };
          return undefined;
        },
        ...(options.killMs !== undefined ? { killMs: options.killMs } : {}), graceMs,
      }, request);
    } catch (error) {
      return fail("spawn-error", error instanceof Error ? error.message : String(error));
    }
    if (!spawned.ok) { running.delete(key); return { ok: false, code: spawned.code, reason: spawned.reason }; }
    entry.handle = spawned.handle;
    void spawned.handle.exited.then(async () => {
      if (running.get(key) === entry) running.delete(key);
      await entry.client?.close().catch(() => {});
    });
    // The governing row is re-read AFTER the process exists: a suspension that landed meanwhile wins.
    const post = check("mcp.start", await prepare(), ctx, capabilityId, sessionId);
    if (shuttingDown && !entry.cancelled) entry.cancelled = "shutdown";
    if (!post.ok || entry.cancelled) {
      spawned.handle.stop("authority-lapsed-during-start", "emergency");
      await spawned.handle.exited;
      return refuse(post.ok ? "cancelled" : post.code, post.ok ? `start cancelled: ${entry.cancelled}` : `authorization lapsed during the start: ${post.reason}`, { spawnId: spawned.handle.spawnId });
    }
    try {
      entry.client = await McpClient.connect(spawned.handle.channel, {
        capabilityId, version: slotRow.version, serverId, ...(sessionId ? { sessionId } : {}),
        record: (event: McpRecord) => record(event.type, event.payload, `calls:${capabilityId}:${serverId}`),
        scrub: spawned.handle.scrubber.text,
      });
    } catch (error) {
      spawned.handle.stop("handshake-failed", "emergency");
      await spawned.handle.exited;
      return refuse("handshake-failed", describeOpaque(`MCP handshake with ${serverId} failed`, error instanceof Error ? error.message : String(error)), { spawnId: spawned.handle.spawnId });
    }
    entry.starting = false;
    if (entry.cancelled) {
      spawned.handle.stop(entry.cancelled, "emergency");
      return refuse("cancelled", `start cancelled: ${entry.cancelled}`, { spawnId: spawned.handle.spawnId });
    }
    entry.accepting = true;
    entry.state = "running";
    await decision(capabilityId, "mcp.start", ctx.actor, "allowed", "started", `server ${serverId} spawned in ${worldId}`, { serverId, worldId, spawnId: spawned.handle.spawnId, version: slotRow.version }).catch(() => {});
    return { ok: true, state: "running", pid: spawned.handle.pid, tools: entry.client.tools().length };
  };

  const host: McpHost = {
    toolsFor: (capabilityId, version, sessionId) => [...running.values()].filter((e) => e.capabilityId === capabilityId && e.sessionId === sessionId && e.version === version && e.accepting).flatMap((e) => [...(e.client?.tools() ?? [])]),
    serversFor: (capabilityId, version, sessionId) => [...running.values()].filter((e) => e.capabilityId === capabilityId && e.sessionId === sessionId && e.version === version).map((e) => ({ serverId: e.serverId, state: e.state })),
    async call(capabilityId, version, sessionId, toolRef, args, call) {
      const m = /^mcp\.([a-z0-9][a-z0-9-]{0,31})\.(.+)$/.exec(toolRef);
      if (!m) return { ok: false, code: "unknown_tool", message: `${toolRef} is not an mcp.<serverId>.<tool> id`, retryable: false };
      // Snapshot, synchronously: the server this call belongs to, and its in-flight count.
      const entry = running.get(serverKey(capabilityId, sessionId, m[1]!));
      if (!entry || entry.version !== version || !entry.accepting || !entry.client) return { ok: false, code: "server_not_running", message: `MCP server ${m[1]} of ${capabilityId} is not accepting calls`, retryable: true };
      const client = entry.client;
      entry.inFlight += 1;
      try {
        const outcome = await client.callTool(m[2]!, args, { timeoutMs: call.deadlineMs, actorId: call.actorId });
        return outcome.ok ? { ok: true, result: outcome.result } : { ok: false, code: outcome.code, message: outcome.message, retryable: outcome.code === "server_not_running" };
      } finally {
        entry.inFlight -= 1;
      }
    },
  };

  // ---- handlers -----------------------------------------------------------------------------
  const contracts: CapabilityContract[] = MCP_CONTRACT_IDS.map((id) => ({ id, version: "1.0.0", semanticRef: options.semanticRefs?.[id] }));
  type Ctx = HandlerContext & { actor: Actor; runId?: string };

  const component = (): Component => ({
    id: "capability-runtime:mcp",
    provides: contracts,
    activate(fiber) {
      const provide = <I, O>(id: (typeof MCP_CONTRACT_IDS)[number], handler: (input: I, ctx: Ctx) => Promise<O>) =>
        fiber.provide(contracts.find((c) => c.id === id) as CapabilityContract, async (raw: unknown, ctx) => handler(raw as I, ctx as Ctx));
      const slotOf = (input: { sessionId?: string }): string | undefined => (typeof input.sessionId === "string" && input.sessionId ? input.sessionId : undefined);
      const refusing = async (capabilityId: string, op: string, ctx: Ctx, code: string, reason: string): Promise<never> => {
        await decision(capabilityId, op, ctx.actor, "refused", code, reason).catch(() => {});
        throw new Error(`capability.mcp: ${reason}`);
      };

      provide("capability.mcp.start", async (input: { capabilityId: string; serverId: string; worldId?: string; sessionId?: string }, ctx) => { await gate; return mutex.run(async () => {
        const result = await tracked(startServer(ctx, { capabilityId: String(input.capabilityId ?? ""), serverId: String(input.serverId ?? ""), worldId: String(input.worldId ?? "local"), sessionId: slotOf(input) }));
        if (!result.ok) throw new Error(`capability.mcp.start: ${result.reason}`);
        return { capabilityId: input.capabilityId, serverId: input.serverId, state: result.state, pid: result.pid, tools: result.tools };
      }); });

      provide("capability.mcp.stop", (input: { capabilityId: string; serverId: string; sessionId?: string }, ctx) => mutex.run(async () => {
        const capabilityId = String(input.capabilityId ?? "");
        const sessionId = slotOf(input);
        const auth = check("mcp.stop", await prepare(), ctx, capabilityId, sessionId);
        if (!auth.ok) return refusing(capabilityId, "mcp.stop", ctx, auth.code, auth.reason);
        const entry = running.get(serverKey(capabilityId, sessionId, String(input.serverId ?? "")));
        if (!entry) return refusing(capabilityId, "mcp.stop", ctx, "not-running", `server ${input.serverId} of ${capabilityId} is not running`);
        initiateStop(entry, "operator-stop");
        return { capabilityId, serverId: entry.serverId, state: entry.state };
      }));

      provide("capability.bundle.suspend", (input: { capabilityId: string; reason?: string; sessionId?: string }, ctx) => mutex.run(async () => {
        const capabilityId = String(input.capabilityId ?? "");
        const sessionId = slotOf(input);
        const reason = String(input.reason ?? "operator-yank");
        if (!REASON.test(reason)) return refusing(capabilityId, "suspend", ctx, "invalid-reason", "the suspension reason must be a short lowercase identifier");
        const prep = await prepare();
        const first = check("suspend", prep, ctx, capabilityId, sessionId);
        if (!first.ok) return refusing(capabilityId, "suspend", ctx, first.code, first.reason);
        const row = first.index.activations.get(first.index.activationKey(capabilityId, "user", sessionId));
        if (!row || (row.state !== "active" && row.state !== "suspended")) return refusing(capabilityId, "suspend", ctx, "no-activation", `${capabilityId} has no live activation in this slot`);
        // Last step before the commit: authorize, then append (nothing awaited between).
        const last = check("suspend", await prepare(), ctx, capabilityId, sessionId);
        if (!last.ok) return refusing(capabilityId, "suspend", ctx, last.code, `authorization lapsed before the suspension commit: ${last.reason}`);
        await options.getRecorder().commitBatch(capabilityId, [{ type: "capability.suspended", payload: { capabilityId, level: "user", ...(sessionId ? { sessionId } : {}), reason } }], `suspend:${capabilityId}:${randomUUID()}`);
        // The commit listener has already initiated the stops; re-read the governing row.
        const after = last.index.activations.get(last.index.activationKey(capabilityId, "user", sessionId));
        return { capabilityId, state: after?.state ?? "unknown", reasons: after?.suspensionReasons ?? [] };
      }));

      provide("capability.bundle.resume", async (input: { capabilityId: string; clearedReason: string; sessionId?: string; worldId?: string }, ctx) => { await gate; return mutex.run(async () => {
        const capabilityId = String(input.capabilityId ?? "");
        const sessionId = slotOf(input);
        const clearedReason = String(input.clearedReason ?? "");
        const prep = await prepare();
        const first = check("resume", prep, ctx, capabilityId, sessionId);
        if (!first.ok) return refusing(capabilityId, "resume", ctx, first.code, first.reason);
        const row = first.index.activations.get(first.index.activationKey(capabilityId, "user", sessionId));
        if (!row || row.state !== "suspended") return refusing(capabilityId, "resume", ctx, "not-suspended", `${capabilityId} is not suspended in this slot`);
        if (!row.suspensionReasons.includes(clearedReason)) return refusing(capabilityId, "resume", ctx, "reason-not-held", `${capabilityId} is not suspended for "${clearedReason}" (held: ${row.suspensionReasons.join(", ")}); resume clears exactly one named reason`);
        const last = check("resume", await prepare(), ctx, capabilityId, sessionId);
        if (!last.ok) return refusing(capabilityId, "resume", ctx, last.code, `authorization lapsed before the resume commit: ${last.reason}`);
        await options.getRecorder().commitBatch(capabilityId, [{ type: "capability.resumed", payload: { capabilityId, level: "user", ...(sessionId ? { sessionId } : {}), clearedReason } }], `resume:${capabilityId}:${randomUUID()}`);
        const after = last.index.activations.get(last.index.activationKey(capabilityId, "user", sessionId));
        const respawned: { serverId: string; ok: boolean; code?: string }[] = [];
        if (after?.state === "active") {
          // A graceful stop may still be draining: its terminal record must exist before the ledger decides what to respawn.
          const draining = [...running.values()].filter((e) => e.capabilityId === capabilityId && e.sessionId === sessionId && e.state !== "running" && e.state !== "starting");
          await Promise.all(draining.map((e) => e.handle?.exited));
          // Resume re-spawns from the durable declaration: the servers the suspension stopped, with
          // the world re-resolved and secrets re-resolved (fail-closed; each failure is recorded).
          const latest = new Map<string, { serverId: string; worldId: string; intendedAt: string; stopReason: string | null }>();
          for (const r of await options.readRows()) {
            if (!r.key.startsWith("spawn/")) continue;
            const v = r.value as { capabilityId?: string; sessionId?: string; serverId?: string; worldId?: string; intendedAt?: string; stopReason?: string | null; status?: string };
            if (v.capabilityId !== capabilityId || (v.sessionId ?? undefined) !== sessionId || !v.serverId || !v.worldId) continue;
            const prior = latest.get(v.serverId);
            if (!prior || String(v.intendedAt ?? "") > prior.intendedAt) latest.set(v.serverId, { serverId: v.serverId, worldId: v.worldId, intendedAt: String(v.intendedAt ?? ""), stopReason: v.status === "exited" ? v.stopReason ?? null : "still-live" });
          }
          for (const s of latest.values()) {
            if (!s.stopReason?.startsWith("suspended:")) continue;
            const res = await tracked(startServer(ctx, { capabilityId, serverId: s.serverId, worldId: s.worldId, sessionId }));
            respawned.push({ serverId: s.serverId, ok: res.ok, ...(res.ok ? {} : { code: res.code }) });
          }
        }
        return { capabilityId, state: after?.state ?? "unknown", reasons: after?.suspensionReasons ?? [], respawned };
      }); });
    },
  });

  return {
    host, component, watch,
    status: () => [...running.values()].map((e) => ({ capabilityId: e.capabilityId, ...(e.sessionId ? { sessionId: e.sessionId } : {}), serverId: e.serverId, version: e.version, state: e.state, ...(e.handle ? { pid: e.handle.pid } : {}) })),
    async reconcileBoot() {
      try {
        const { reconcileSpawnLedger } = await import("./execSpawn.ts");
        const rows = (await options.readRows()).filter((r) => r.key.startsWith("spawn/")).map((r) => r.value as never);
        const outcomes = await mutex.run(() => reconcileSpawnLedger({ ledger, slots: options.slots }, rows, options.proc));
        // Every ledger row is terminal now and nothing has spawned in this process: any long-lease slot still
        // reserved is orphaned (a spawn that never reached its intent, or a failed release) and is freed.
        // Slots whose reconciliation is incomplete (survivors) stay reserved.
        await options.slots.releaseAll?.(outcomes.filter((o) => o.outcome === "reconcile-incomplete" && o.slotId).map((o) => o.slotId as string));
        openGate(true);
        return outcomes;
      } catch (error) {
        openGate(false);
        throw error;
      }
    },
    async failBoot(error) {
      openGate(false);
      // The cause is recorded by digest and size only (a boot error can quote arbitrary text).
      await decision("runtime", "mcp.boot", { id: "system", kind: "system" }, "refused", "boot-init-failed", describeOpaque("the authority index or projection failed to initialise; no spawn is admitted and the ledger was not reconciled", error instanceof Error ? error.message : String(error))).catch(() => {});
    },
    async shutdown() {
      shuttingDown = true;
      for (const e of [...running.values()]) initiateStop(e, "shutdown", true);
      // A start whose process exists but whose confirmation is pending sees `shuttingDown`/`cancelled` and kills it.
      await Promise.allSettled([...pendingStarts]);
      const all = [...running.values()];
      for (const e of all) { e.accepting = false; e.handle?.stop("shutdown", "emergency"); }
      await Promise.all(all.map((e) => e.handle?.exited));
    },
  };
}
