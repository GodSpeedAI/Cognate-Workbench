import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import type { Json } from "@godspeedai/cognate-events";
import { awaitConfigurationRun, ConfigurationRunError, containedWorkspaceComponent, validateContainmentConfig } from "../src/capabilities/containedWorkspace.ts";
import { agentConfigAgent } from "../src/agents/agentConfig.ts";
import { buildProvider, containedWorldId, restoreExecutionWorlds, unavailableReason } from "../src/capabilities/executionWorlds.ts";
import type { ContainmentConfig } from "../src/capabilities/containedWorkspace.ts";

const trustedConfig = (runtimeRoots: string[] = ["/usr/bin"]): ContainmentConfig => ({
  executablePath: "/usr/bin/bwrap",
  provenance: { operatorVerified: true, binarySha256: "a".repeat(64), version: "test", source: "operator", patchedCve202687766: true },
  runtimeRoots,
});

const homes: string[] = [];
async function tempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "contained-workspace-"));
  homes.push(path);
  return path;
}
afterEach(async () => { await Promise.all(homes.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

function fixture(input: { configured?: boolean; protectedHome?: string } = {}) {
  const handlers = new Map<string, (raw: unknown, ctx: unknown) => Promise<unknown>>();
  const component = containedWorkspaceComponent({
    getService: () => ({ readProjection: async () => ({ rows: [] }), startRun: async () => ({ runId: "unused" }), getRun: async () => ({ status: "completed" }) } as never),
    systemCaller: { actor: { id: "system", kind: "system" }, tenant: "local" },
    registry: createExecutionWorldRegistry(),
    getKnownWorkspaceIds: () => new Set<string>(),
    semanticRefs: {},
    protectedHome: input.protectedHome,
    ...(input.configured ? { config: trustedConfig() } : {}),
  });
  component.activate({ provide(contract: { id: string }, handler: (raw: unknown, ctx: unknown) => Promise<unknown>) { handlers.set(contract.id, handler); } } as never);
  return handlers;
}

const human = { actor: { id: "operator", kind: "user" }, tenant: "local" };
const noSecrets = { put: async () => {}, get: async () => undefined, delete: async () => {} };

test("J-RW-contained-workspace: inspect reports configuration separately from namespace preflight", async () => {
  const handlers = fixture();
  expect(await handlers.get("execution.containment.inspect")!({}, human)).toMatchObject({
    configured: false, platformSupported: process.platform === "linux", preflightRequired: true,
    reason: "host containment configuration is unavailable",
  });
});

test("J-RW-contained-workspace: selection rejects agent runs before touching host configuration", async () => {
  const handlers = fixture();
  await expect(handlers.get("workspace.contained.select")!({ path: "/tmp" }, { ...human, runId: "run-agent" }))
    .rejects.toThrow("only a direct human operator may select a contained workspace");
});

test("J-RW-contained-workspace: selection accepts only a path and cannot receive browser trust configuration", async () => {
  const root = await tempDir();
  const handlers = fixture({ configured: true });
  await expect(handlers.get("workspace.contained.select")!({ path: root, worldId: "local" }, human))
    .rejects.toThrow("accepts only a path");
});

test("J-RW-contained-workspace: a selected root may not contain the protected application home", async () => {
  const root = await tempDir();
  const protectedHome = join(root, "app-home");
  await mkdir(protectedHome);
  const handlers = fixture({ configured: true, protectedHome });
  await expect(handlers.get("workspace.contained.select")!({ path: root }, human))
    .rejects.toThrow("must not contain the protected application home");
});

test("J-RW-contained-workspace: restored worlds stay unavailable without host-owned config", async () => {
  const registry = createExecutionWorldRegistry();
  const worldId = `missing-config-${crypto.randomUUID()}`;
  await expect(buildProvider(worldId, { kind: "linux-bubblewrap", workspaceRoot: "/tmp" }))
    .rejects.toThrow("host containment configuration is unavailable");
  await restoreExecutionWorlds({
    getService: () => ({ readProjection: async () => ({ rows: [{ key: `record/${worldId}`, value: { worldId, connection: { kind: "linux-bubblewrap", workspaceRoot: "/tmp" } } }] }) } as never),
    systemCaller: { actor: { id: "system", kind: "system" }, tenant: "local" },
    registry,
    secrets: noSecrets,
  });
  expect(registry.has(worldId)).toBe(false);
  expect(unavailableReason(worldId)).toContain("host containment configuration is unavailable");
});

test("J-RW-contained-workspace: restoration refuses changed host config for a saved world identity", async () => {
  const root = await tempDir();
  const savedConfig = trustedConfig();
  const changedConfig = trustedConfig(["/bin"]);
  const worldId = containedWorldId(savedConfig, root);
  const registry = createExecutionWorldRegistry();
  await restoreExecutionWorlds({
    getService: () => ({ readProjection: async () => ({ rows: [{ key: `record/${worldId}`, value: { worldId, connection: { kind: "linux-bubblewrap", workspaceRoot: root } } }] }) } as never),
    systemCaller: { actor: { id: "system", kind: "system" }, tenant: "local" },
    registry,
    secrets: noSecrets,
    containmentConfig: changedConfig,
  });
  expect(registry.has(worldId)).toBe(false);
  expect(unavailableReason(worldId)).toContain("host containment configuration no longer matches");
});

test("J-RW-contained-workspace: configuration validation rejects untrusted or malformed operator input", () => {
  expect(() => validateContainmentConfig({ executablePath: "/usr/bin/bwrap", runtimeRoots: ["/"] })).toThrow("operator-verified provenance is required");
  expect(() => validateContainmentConfig({ ...trustedConfig(), worldId: "browser-selected" })).toThrow("contains unsupported fields");
  expect(() => validateContainmentConfig({ ...trustedConfig(), runtimeRoots: ["/home"] })).toThrow("supported public runtime directories");
  expect(() => validateContainmentConfig({ ...trustedConfig(), provenance: { ...trustedConfig().provenance, binarySha256: "bad" } })).toThrow("provenance fields are invalid");
});

function configRunService(overrides: {
  readonly statuses: string[];
  readonly afterCancel?: string;
  readonly events?: readonly string[];
}) {
  let reads = 0;
  let cancelled = false;
  return {
    get cancelled() { return cancelled; },
    service: {
      startRun: async () => ({ runId: "config-run-1" }),
      getRun: async () => {
        if (cancelled && overrides.afterCancel) return { runId: "config-run-1", status: overrides.afterCancel, error: null };
        const status = overrides.statuses[Math.min(reads++, overrides.statuses.length - 1)] ?? "running";
        return { runId: "config-run-1", status, error: null };
      },
      cancelRun: async () => { cancelled = true; return { status: "cancelled" }; },
      listRuns: async () => [],
      events: async function* () {
        for (const eventType of overrides.events ?? []) yield { eventType };
      },
    } as never,
  };
}

test("J-RW-contained-workspace: lost start acknowledgment retries the identical native idempotency request", async () => {
  const requests: unknown[] = [];
  const service = {
    startRun: async (_caller: unknown, request: unknown) => {
      requests.push(structuredClone(request));
      if (requests.length === 1) throw new Error("acknowledgment lost after commit");
      return { runId: "accepted-config" };
    },
    listRuns: async () => [],
    getRun: async () => ({ runId: "accepted-config", status: "completed" }),
  } as never;
  await awaitConfigurationRun(service, { actor: { id: "system", kind: "system" }, tenant: "local" }, { requestId: "operator-action-1" });
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("J-RW-contained-workspace: unavailable acceptance receipt never permits provider rollback", async () => {
  let starts = 0;
  const service = {
    startRun: async () => { starts++; throw new Error("commit acknowledgment unavailable"); },
    listRuns: async () => [],
  } as never;
  let failure: unknown;
  try { await awaitConfigurationRun(service, { actor: { id: "system", kind: "system" }, tenant: "local" }, { requestId: "operator-action-2" }); }
  catch (error) { failure = error; }
  expect(starts).toBe(2);
  expect(failure).toMatchObject({ safeToRollback: false, reconciliationRequired: true });
});

test("J-RW-contained-workspace: a later invocation reuses the base receipt then advances a safe cancelled attempt", async () => {
  const requests: { input: { requestId: string }; idempotencyKey: string }[] = [];
  const originalInput = { kind: "workspace.contained.added", requestId: "stable-world-operation", workspaceId: "w-1" };
  let acceptedAttempts = 0;
  const priorFailure = { runId: "cancelled-first-attempt", agent: "agent.config", tenant: "local", status: "cancelled", input: originalInput, output: null, error: null, correlationId: "contained-config:w-1", startedBy: "system", waitingOn: [] };
  const service = {
    startRun: async (_caller: unknown, request: { input: { requestId: string }; idempotencyKey: string }) => {
      requests.push(structuredClone(request));
      if (request.input.requestId === originalInput.requestId) {
        acceptedAttempts++;
        if (acceptedAttempts <= 2) throw new Error("acknowledgment lost");
        return priorFailure;
      }
      return { ...priorFailure, runId: "completed-retry", status: "completed" };
    },
    listRuns: async (_caller: unknown, query: { correlationId?: string }) =>
      acceptedAttempts >= 2 && query.correlationId === "contained-config:w-1" ? [priorFailure] : [],
    getRun: async () => ({ ...priorFailure, runId: "completed-retry", status: "completed" }),
    events: async function* () {},
  } as never;
  const caller = { actor: { id: "system", kind: "system" as const }, tenant: "local" };

  await expect(awaitConfigurationRun(service, caller, originalInput as unknown as Json, { correlationId: "contained-config:w-1" }))
    .rejects.toMatchObject({ safeToRollback: false, reconciliationRequired: true });
  await expect(awaitConfigurationRun(service, caller, originalInput as unknown as Json, { correlationId: "contained-config:w-1" }))
    .resolves.toBeUndefined();

  expect(requests.slice(0, 3).map(request => request.idempotencyKey)).toEqual([
    "contained-config:stable-world-operation", "contained-config:stable-world-operation", "contained-config:stable-world-operation",
  ]);
  expect(requests[3]?.input.requestId).toBe("stable-world-operation:retry:cancelled-first-attempt");
});

test("J-RW-contained-workspace: terminal partial events refuse automatic receipt-chain advance", async () => {
  const originalInput = { kind: "workspace.contained.added", requestId: "stable-world-operation" };
  const priorFailure = { runId: "partial-first-attempt", agent: "agent.config", tenant: "local", status: "cancelled", input: originalInput, output: null, error: null, correlationId: "contained-config:w-1", startedBy: "system", waitingOn: [] };
  const requests: unknown[] = [];
  const service = {
    startRun: async (_caller: unknown, request: unknown) => { requests.push(request); return priorFailure; },
    listRuns: async () => [priorFailure],
    getRun: async () => priorFailure,
    events: async function* () { yield { eventType: "execution.world.connected" }; },
  } as never;
  let failure: unknown;
  try {
    await awaitConfigurationRun(service, { actor: { id: "system", kind: "system" }, tenant: "local" }, originalInput as unknown as Json, { correlationId: "contained-config:w-1" });
  } catch (error) { failure = error; }
  expect(failure).toMatchObject({ safeToRollback: false, committedEvents: ["execution.world.connected"], reconciliationRequired: true });
  expect(requests).toHaveLength(1);
});

test("J-RW-contained-workspace: a newly accepted terminal failure is not auto-retried", async () => {
  const requests: unknown[] = [];
  const failed = { runId: "new-failed-attempt", agent: "agent.config", tenant: "local", status: "failed", input: { requestId: "stable-world-operation" }, output: null, error: "failed", correlationId: "contained-config:w-1", startedBy: "system", waitingOn: [] };
  const service = {
    listRuns: async () => [],
    startRun: async (_caller: unknown, request: unknown) => { requests.push(request); return failed; },
    getRun: async () => failed,
    events: async function* () {},
  } as never;
  await expect(awaitConfigurationRun(service, { actor: { id: "system", kind: "system" }, tenant: "local" }, failed.input as unknown as Json, { correlationId: "contained-config:w-1" }))
    .rejects.toMatchObject({ safeToRollback: true, reconciliationRequired: false });
  expect(requests).toHaveLength(1);
});

test("J-RW-contained-workspace: timeout cancels and rereads before allowing safe provider rollback", async () => {
  const fixture = configRunService({ statuses: ["running"], afterCancel: "cancelled" });
  let failure: unknown;
  try { await awaitConfigurationRun(fixture.service, { actor: { id: "system", kind: "system" }, tenant: "local" }, {} as Json, { timeoutMs: 1, pollIntervalMs: 1, cancelWaitMs: 5 }); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ConfigurationRunError);
  expect(failure).toMatchObject({ runId: "config-run-1", safeToRollback: true, committedEvents: [], reconciliationRequired: false });
  expect(fixture.cancelled).toBe(true);
});

test("J-RW-contained-workspace: completion racing timeout is reread and returned as success", async () => {
  const fixture = configRunService({ statuses: ["running"], afterCancel: "completed" });
  await expect(awaitConfigurationRun(fixture.service, { actor: { id: "system", kind: "system" }, tenant: "local" }, {} as Json, { timeoutMs: 1, pollIntervalMs: 1, cancelWaitMs: 5 })).resolves.toBeUndefined();
  expect(fixture.cancelled).toBe(true);
});

test("J-RW-contained-workspace: synchronous cancel failure still rereads durable run status", async () => {
  let reads = 0;
  const service = {
    startRun: async () => ({ runId: "config-run-sync-cancel" }),
    listRuns: async () => [],
    getRun: async () => ({ runId: "config-run-sync-cancel", status: reads++ === 0 ? "running" : "cancelled", error: null }),
    cancelRun: () => { throw new Error("transport unavailable"); },
    events: async function* () {},
  } as never;
  let failure: unknown;
  try { await awaitConfigurationRun(service, { actor: { id: "system", kind: "system" }, tenant: "local" }, {} as Json, { timeoutMs: 1, pollIntervalMs: 1, cancelWaitMs: 5 }); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ConfigurationRunError);
  expect(failure).toMatchObject({ runId: "config-run-sync-cancel", safeToRollback: true, committedEvents: [], reconciliationRequired: false });
});

test("J-RW-contained-workspace: cancelled partial event history retains provider and requires reconciliation", async () => {
  const fixture = configRunService({ statuses: ["running"], afterCancel: "cancelled", events: ["execution.world.connected"] });
  let failure: unknown;
  try { await awaitConfigurationRun(fixture.service, { actor: { id: "system", kind: "system" }, tenant: "local" }, {} as Json, { timeoutMs: 1, pollIntervalMs: 1, cancelWaitMs: 5 }); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ConfigurationRunError);
  expect(failure).toMatchObject({ runId: "config-run-1", safeToRollback: false, committedEvents: ["execution.world.connected"], reconciliationRequired: true });
  expect((failure as Error).message).toContain("provider was retained for reconciliation");
});

test("J-RW-contained-workspace: unresolved post-cancel run is explicit uncertainty even without events", async () => {
  const fixture = configRunService({ statuses: ["running"], afterCancel: "running" });
  let failure: unknown;
  try { await awaitConfigurationRun(fixture.service, { actor: { id: "system", kind: "system" }, tenant: "local" }, {} as Json, { timeoutMs: 1, pollIntervalMs: 1, cancelWaitMs: 5 }); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(ConfigurationRunError);
  expect(failure).toMatchObject({ runId: "config-run-1", safeToRollback: false, committedEvents: [], reconciliationRequired: true });
});

test("J-RW-contained-workspace: typed config run records world, workspace and selection in order", async () => {
  const emitted: { type: string; payload: unknown }[] = [];
  await agentConfigAgent.run({
    kind: "workspace.contained.added", workspaceId: "w-1", root: "/srv/work", title: "work",
    executionWorldId: "contained-1", worldLabel: "Contained: work",
    worldMetadata: { containment: "linux-child-process-namespaces", network: "denied" },
    connection: { kind: "linux-bubblewrap", workspaceRoot: "/srv/work" },
  }, { emit: async (type: string, payload: Json) => { emitted.push({ type, payload }); } } as never);
  expect(emitted.map(event => event.type)).toEqual(["execution.world.connected", "workspace.added", "workspace.selected"]);
  expect(emitted[0]?.payload).toMatchObject({ worldKind: "linux-bubblewrap", connection: { kind: "linux-bubblewrap", workspaceRoot: "/srv/work" } });
  expect(JSON.stringify(emitted)).not.toContain("runtimeRoots");
  expect(JSON.stringify(emitted)).not.toContain("binarySha256");
});
