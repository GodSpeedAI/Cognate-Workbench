// J-RW-contained-workspace: opt-in, real Linux namespace proof. This test requires a host-owned
// attestation for the patched Bubblewrap binary and a running controlled
// pg0 database. CI without those host prerequisites skips the OS-boundary test; the ordinary
// containedWorkspace.test.ts suite still covers configuration refusal and missing-config behavior.
// Run with COGNATE_BWRAP_TESTS=1 COGNATE_BWRAP_TEST_ATTESTATION=/path/to/reviewed.json bun test test/J-RW-contained-workspace.test.ts.
import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { AGENT_CONFIG } from "../src/agents/agentConfig.ts";
import { containedWorldId } from "../src/capabilities/executionWorlds.ts";
import type { ContainmentConfig } from "../src/capabilities/containedWorkspace.ts";

const enabled = process.env.COGNATE_BWRAP_TESTS === "1" && process.platform === "linux";
const integrationTest = enabled ? test : test.skip;
const PATCHED_BWRAP_COMMIT = "2a76602a8c71f36c1527cf9fc3417d9149822e0c";

type WorkbenchClient = ReturnType<typeof createClient>;
const clientFor = (app: AppServer): WorkbenchClient => createClient({
  service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)),
  caller: LOCAL_OPERATOR,
});

async function verifiedContainmentConfig(): Promise<ContainmentConfig> {
  const proofPath = process.env.COGNATE_BWRAP_TEST_ATTESTATION;
  if (!proofPath) throw new Error("COGNATE_BWRAP_TESTS=1 requires COGNATE_BWRAP_TEST_ATTESTATION pointing to a reviewed host attestation JSON");
  const supplied = JSON.parse(await readFile(proofPath, "utf8")) as ContainmentConfig;
  expect(supplied.executablePath).toBeTruthy();
  expect(supplied.provenance.operatorVerified).toBe(true);
  expect(supplied.provenance.patchedCve202687766).toBe(true);
  const binaryHash = createHash("sha256").update(await readFile(supplied.executablePath)).digest("hex");
  expect(supplied.provenance.binarySha256).toBe(binaryHash);
  const version = await Bun.$`${supplied.executablePath} --version`.text();
  expect(version.trim()).toBe("bubblewrap 0.12.0");
  expect(supplied.provenance.version).toContain(version.trim());
  expect(supplied.provenance.source).toContain("v0.12.0");
  expect(supplied.provenance.source).toContain(PATCHED_BWRAP_COMMIT);
  expect(supplied.runtimeRoots).toEqual(["/usr/bin", "/usr/lib", "/lib", "/lib64"]);
  expect(supplied.bunExecutable).toBe(process.execPath);
  return supplied;
}

async function events(app: AppServer): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const event of app.runtime.service.events(LOCAL_OPERATOR, {})) {
    out.push(event);
  }
  return out;
}

async function stop(app: AppServer | undefined): Promise<void> {
  if (app) await app.stop();
}

integrationTest("J-RW-contained-workspace: real bwrap isolates a selected workspace, survives configured restart, and fails closed without host config", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "workbench-contained-"));
  const home = join(fixture, "app-home");
  const workspace = join(fixture, "workspace-root");
  const hostSentinel = join(fixture, "sibling-host-sentinel.txt");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(hostSentinel, "host-only-sentinel-9c32e6\n");
  await writeFile(join(workspace, "notes.txt"), "before\n");

  let app: AppServer | undefined;
  let networkCanary: ReturnType<typeof Bun.serve> | undefined;
  let receivedHostLoopbackRequests = 0;
  try {
    const config = await verifiedContainmentConfig();
    app = await startServer({ port: 0, home, containmentConfig: config });
    let client = clientFor(app);

    // A host listener is reachable only in the host namespace. The child must be unable to
    // contact it even though it knows the loopback address and port.
    networkCanary = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() { receivedHostLoopbackRequests++; return new Response("host-canary"); },
    });

    const selected = await client.invoke("workspace.contained.select", { path: workspace }) as {
      workspaceId: string;
      root: string;
      executionWorldId: string;
    };
    expect(selected.root).toBe(workspace);
    expect(selected.executionWorldId).toMatch(/^contained-[a-f0-9]{16}$/);

    const readInput = { workspaceRoot: workspace, executionWorldId: selected.executionWorldId, file_path: "notes.txt" };
    expect(await client.invoke("tool.read", readInput)).toMatchObject({ content: "before\n" });
    expect(await client.invoke("tool.edit", {
      ...readInput, old_string: "before", new_string: "after",
    })).toMatchObject({ replacements: 1 });
    expect(await readFile(join(workspace, "notes.txt"), "utf8")).toBe("after\n");

    const bash = await client.invoke("tool.bash", {
      workspaceRoot: workspace,
      executionWorldId: selected.executionWorldId,
      command: "printf bash-contained-ok",
    }) as { exitCode: number; stdout: string };
    expect(bash).toMatchObject({ exitCode: 0, stdout: "bash-contained-ok" });

    const code = await client.invoke("tool.run_code", {
      workspaceRoot: workspace,
      executionWorldId: selected.executionWorldId,
      code: 'const result = await tools.bash({ command: "printf run-code-contained-ok" }); console.log(result.stdout);',
    }) as { exitCode: number; stdout: string };
    expect(code.exitCode).toBe(0);
    expect(code.stdout).toContain("run-code-contained-ok");

    const directExec = await client.invoke("process.exec", {
      worldId: selected.executionWorldId,
      argv: ["/usr/bin/printf", "native-exec-contained-ok"],
      cwd: workspace,
    }) as { exitCode: number; stdout: string };
    expect(directExec).toMatchObject({ exitCode: 0, stdout: "native-exec-contained-ok" });

    // The child sees the host sibling as absent; this uses a direct process path so the app's
    // filesystem path validation cannot be mistaken for OS-level isolation.
    const siblingProbe = await client.invoke("process.exec", {
      worldId: selected.executionWorldId,
      argv: ["/usr/bin/cat", hostSentinel],
      cwd: workspace,
    }) as { exitCode: number; stdout: string; stderr: string };
    expect(siblingProbe.exitCode).not.toBe(0);
    expect(`${siblingProbe.stdout}${siblingProbe.stderr}`).not.toContain("host-only-sentinel-9c32e6");
    expect(await readFile(hostSentinel, "utf8")).toContain("host-only-sentinel-9c32e6");

    const networkProbe = await client.invoke("process.exec", {
      worldId: selected.executionWorldId,
      argv: ["/usr/bin/bash", "-c", `echo probe >/dev/tcp/127.0.0.1/${networkCanary.port}`],
      cwd: workspace,
      timeoutMs: 3_000,
    }) as { exitCode: number; timedOut: boolean };
    expect(networkProbe.exitCode).not.toBe(0);
    expect(networkProbe.timedOut).toBe(false);
    expect(receivedHostLoopbackRequests).toBe(0);

    const persisted = JSON.stringify(await events(app));
    expect(persisted).toContain(workspace);
    expect(persisted).toContain(selected.executionWorldId);
    expect(persisted).not.toContain(config.provenance.binarySha256);
    expect(persisted).not.toContain("operatorVerified");
    expect(persisted).not.toContain("runtimeRoots");
    expect(persisted).not.toContain("patchedCve202687766");
    expect(persisted).not.toContain(config.executablePath);
    expect(persisted).not.toContain(process.execPath);

    await stop(app);
    app = await startServer({ port: 0, home, containmentConfig: config });
    client = clientFor(app);
    const afterRestart = await client.invoke("process.exec", {
      worldId: selected.executionWorldId,
      argv: ["/usr/bin/cat", "/workspace/notes.txt"],
      cwd: workspace,
    }) as { exitCode: number; stdout: string };
    expect(afterRestart).toMatchObject({ exitCode: 0, stdout: "after\n" });

    await stop(app);
    app = await startServer({ port: 0, home });
    client = clientFor(app);
    await expect(client.invoke("process.exec", {
      worldId: selected.executionWorldId,
      argv: ["/usr/bin/touch", join(workspace, "must-not-fallback")],
      cwd: workspace,
    })).rejects.toThrow(/unavailable|configuration/i);
    expect(await Bun.file(join(workspace, "must-not-fallback")).exists()).toBe(false);
  } finally {
    networkCanary?.stop(true);
    await stop(app);
    await rm(fixture, { recursive: true, force: true });
  }
}, 120_000);

integrationTest("J-RW-contained-workspace: lost configuration start acknowledgments reuse one durable contained-workspace receipt across retry and restart", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "workbench-contained-lost-ack-"));
  const home = join(fixture, "app-home");
  const workspace = join(fixture, "workspace-root");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });

  let app: AppServer | undefined;
  let client: WorkbenchClient | undefined;
  let service: RuntimeService | undefined;
  let originalStartRun: RuntimeService["startRun"] | undefined;
  let droppedAcknowledgments = 0;
  let containedStartCalls = 0;
  try {
    const config = await verifiedContainmentConfig();
    app = await startServer({ port: 0, home, containmentConfig: config });
    client = clientFor(app);
    const expectedWorldId = containedWorldId(config, workspace);
    service = app.runtime.service;
    originalStartRun = service.startRun.bind(service);
    const realStartRun = originalStartRun;
    service.startRun = async (caller, request) => {
      const receipt = await realStartRun(caller, request);
      const input = request.input && typeof request.input === "object" && !Array.isArray(request.input)
        ? request.input as { readonly kind?: unknown; readonly requestId?: unknown }
        : undefined;
      if (request.agent === AGENT_CONFIG && input?.kind === "workspace.contained.added" && input.requestId === expectedWorldId) {
        containedStartCalls++;
        if (droppedAcknowledgments < 2) {
          droppedAcknowledgments++;
          throw new Error("simulated lost startRun acknowledgment after durable acceptance");
        }
      }
      return receipt;
    };

    let uncertain: unknown;
    try {
      await client.invoke("workspace.contained.select", { path: workspace });
    } catch (error) {
      uncertain = error;
    }
    expect(String(uncertain)).toMatch(/configuration acceptance is uncertain/i);
    expect(droppedAcknowledgments).toBe(2);
    expect(containedStartCalls).toBe(2);

    // The first invocation could not receive either startRun receipt, but its accepted run
    // registered the preflighted provider. A native process command proves it stayed usable.
    const retainedProvider = await client.invoke("process.exec", {
      worldId: expectedWorldId,
      argv: ["/usr/bin/printf", "provider-retained-after-lost-ack"],
      cwd: workspace,
    }) as { readonly exitCode: number; readonly stdout: string };
    expect(retainedProvider).toMatchObject({ exitCode: 0, stdout: "provider-retained-after-lost-ack" });

    const configRuns = await service.listRuns(LOCAL_OPERATOR, { agent: AGENT_CONFIG });
    const acceptedRuns = configRuns.filter(run => {
      const input = run.input && typeof run.input === "object" && !Array.isArray(run.input)
        ? run.input as { readonly kind?: unknown; readonly requestId?: unknown; readonly root?: unknown }
        : undefined;
      return input?.kind === "workspace.contained.added" && input.requestId === expectedWorldId && input.root === workspace;
    });
    expect(acceptedRuns).toHaveLength(1);
    const acceptedRunId = acceptedRuns[0]!.runId;

    const selected = await client.invoke("workspace.contained.select", { path: workspace }) as {
      readonly workspaceId: string;
      readonly root: string;
      readonly executionWorldId: string;
    };
    expect(selected).toMatchObject({ root: workspace, executionWorldId: expectedWorldId });
    // Projection catch-up may let this retry select the known workspace directly, or recover
    // its original receipt. The creation-run and event identities below are the durable contract.
    const recovered = await service.getRun(LOCAL_OPERATOR, { runId: acceptedRunId });
    expect(recovered.status).toBe("completed");

    const beforeRestart = (await events(app)).filter((raw) => {
      const event = raw as { readonly runId?: string; readonly eventType?: string };
      return event.runId === acceptedRunId && ["execution.world.connected", "workspace.added"].includes(event.eventType ?? "");
    });
    expect(beforeRestart.map(raw => (raw as { readonly eventType?: string }).eventType).sort()).toEqual([
      "execution.world.connected", "workspace.added",
    ]);

    await stop(app);
    app = await startServer({ port: 0, home, containmentConfig: config });
    client = clientFor(app);
    const afterRestartSelection = await client.invoke("workspace.contained.select", { path: workspace }) as {
      readonly workspaceId: string;
      readonly root: string;
      readonly executionWorldId: string;
    };
    expect(afterRestartSelection).toEqual(selected);
    const afterRestartExec = await client.invoke("process.exec", {
      worldId: expectedWorldId,
      argv: ["/usr/bin/printf", "provider-restored-after-restart"],
      cwd: "/workspace",
    }) as { readonly exitCode: number; readonly stdout: string };
    expect(afterRestartExec).toMatchObject({ exitCode: 0, stdout: "provider-restored-after-restart" });

    const allEvents = await events(app);
    const createdWorlds = allEvents.filter((raw) => {
      const event = raw as { readonly eventType?: string; readonly payload?: { readonly worldId?: unknown } };
      return event.eventType === "execution.world.connected" && event.payload?.worldId === expectedWorldId;
    });
    const addedWorkspaces = allEvents.filter((raw) => {
      const event = raw as { readonly eventType?: string; readonly payload?: { readonly workspaceId?: unknown } };
      return event.eventType === "workspace.added" && event.payload?.workspaceId === selected.workspaceId;
    });
    expect(createdWorlds).toHaveLength(1);
    expect(addedWorkspaces).toHaveLength(1);
    await app.runtime.idle();
    expect((await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "execution-worlds" })).rows.filter(row => row.key === `record/${expectedWorldId}` || row.key.endsWith(`/record/${expectedWorldId}`))).toHaveLength(1);
    expect((await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows.filter(row => row.key === `record/${selected.workspaceId}` || row.key.endsWith(`/record/${selected.workspaceId}`))).toHaveLength(1);
  } finally {
    if (service && originalStartRun) service.startRun = originalStartRun;
    await client?.close().catch(() => {});
    await stop(app);
    await rm(fixture, { recursive: true, force: true });
  }
}, 120_000);

integrationTest("J-RW-contained-workspace: a mismatched host binary digest fails before any durable workspace/world record", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "workbench-contained-bad-hash-"));
  const home = join(fixture, "app-home");
  const workspace = join(fixture, "workspace-root");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  let app: AppServer | undefined;
  try {
    const validConfig = await verifiedContainmentConfig();
    app = await startServer({
      port: 0,
      home,
      containmentConfig: {
        ...validConfig,
        provenance: {
          ...validConfig.provenance,
          binarySha256: "0".repeat(64),
        },
      },
    });
    const client = clientFor(app);
    await expect(client.invoke("workspace.contained.select", { path: workspace })).rejects.toThrow(/changed since operator verification/i);
    const worldRows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "execution-worlds" })).rows;
    const workspaceRows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
    expect(worldRows).toEqual([]);
    expect(workspaceRows).toEqual([]);
  } finally {
    await stop(app);
    await rm(fixture, { recursive: true, force: true });
  }
}, 60_000);

integrationTest("J-RW-contained-workspace: a launcher copied into the writable root is rejected before durable registration", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "workbench-contained-launcher-in-root-"));
  const home = join(fixture, "app-home");
  const workspace = join(fixture, "workspace-root");
  const copiedLauncher = join(workspace, "reviewed-bwrap");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  let app: AppServer | undefined;
  try {
    const hostConfig = await verifiedContainmentConfig();
    const originalMode = (await stat(hostConfig.executablePath)).mode;
    await copyFile(hostConfig.executablePath, copiedLauncher);
    await chmod(copiedLauncher, originalMode & 0o777);
    expect(createHash("sha256").update(await readFile(copiedLauncher)).digest("hex"))
      .toBe(hostConfig.provenance.binarySha256);

    const config: ContainmentConfig = { ...hostConfig, executablePath: copiedLauncher };
    app = await startServer({ port: 0, home, containmentConfig: config });
    const client = clientFor(app);
    await expect(client.invoke("workspace.contained.select", { path: workspace }))
      .rejects.toThrow(/launcher must be outside the writable workspace/i);

    await app.runtime.idle();
    const allEvents = await events(app);
    expect(allEvents.filter(raw => {
      const event = raw as { readonly eventType?: string; readonly payload?: { readonly root?: unknown } };
      return (event.eventType === "execution.world.connected" || event.eventType === "workspace.added")
        && event.payload?.root === workspace;
    })).toEqual([]);
    expect((await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "execution-worlds" })).rows).toEqual([]);
    expect((await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows).toEqual([]);
    const configRuns = await app.runtime.service.listRuns(LOCAL_OPERATOR, { agent: AGENT_CONFIG });
    expect(configRuns.some(run => {
      const input = run.input as { readonly root?: unknown } | undefined;
      return input?.root === workspace;
    })).toBe(false);
  } finally {
    await stop(app);
    await rm(fixture, { recursive: true, force: true });
  }
}, 60_000);

integrationTest("J-RW-contained-workspace: queued contained configuration is cancelled before it can commit after a slow Expert releases admission", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "workbench-contained-queued-cancel-"));
  const home = join(fixture, "app-home");
  const localWorkspace = join(fixture, "local-workspace");
  const containedWorkspace = join(fixture, "contained-workspace");
  await mkdir(home, { recursive: true });
  await mkdir(localWorkspace, { recursive: true });
  await mkdir(containedWorkspace, { recursive: true });

  let providerEntered!: () => void;
  let releaseProvider!: () => void;
  const entered = new Promise<void>(resolve => { providerEntered = resolve; });
  const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
  let providerSignal: AbortSignal | undefined;
  let app: AppServer | undefined;
  let client: WorkbenchClient | undefined;
  try {
    const config = await verifiedContainmentConfig();
    app = await startServer({
      port: 0,
      home,
      containmentConfig: config,
      expertProviderFactory(route) {
        return {
          id: route.providerId,
          model: route.model,
          features: { generate: true, stream: false, tool_use: true, structured_output: false, multimodal_input: false, context_limit: 32_000 },
          async generate(_request, signal) {
            providerSignal = signal;
            providerEntered();
            await providerGate;
            return { message: { role: "assistant", content: "Held Expert finished." }, toolCalls: [], finishReason: "stop", model: route.model };
          },
          async *stream() {},
        };
      },
    });
    client = clientFor(app);
    await client.invoke("experts.seed", {});

    const selectedLocal = await client.invoke("workspace.select", { path: localWorkspace }) as { workspaceId: string };
    const experts = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "experts" })).rows;
    const current = experts.find(row => row.key === "current")?.value as {
      readonly experts: Record<string, { readonly name: string; readonly definition: { readonly specialization: string; readonly instructions: string } }>;
    } | undefined;
    const builder = current?.experts.builder?.definition;
    expect(builder).toBeDefined();
    await client.invoke("expert.save", {
      expertId: "builder",
      name: "Queued cancellation fixture Expert",
      specialization: builder!.specialization,
      instructions: builder!.instructions,
      tools: [],
      route: {
        providerId: "queued-cancel-expert",
        baseURL: "http://127.0.0.1:9/v1",
        protocol: "openai-compatible",
        model: "queued-cancel-model",
      },
      maxSteps: 1,
    });

    const conversation = await client.invoke("expert.converse", {
      expertId: "builder",
      workspaceId: selectedLocal.workspaceId,
      message: "Hold this model call while a contained workspace is preflighted.",
    }) as { assignmentId: string };
    await entered;

    let containedFailure: unknown;
    try {
      await client.invoke("workspace.contained.select", { path: containedWorkspace });
    } catch (error) {
      containedFailure = error;
    }
    expect(containedFailure).toBeDefined();
    expect(String(containedFailure)).toMatch(/timed out and was cancelled|cancelled/i);
    expect(providerSignal?.aborted).toBe(false);

    releaseProvider();
    const deadline = Date.now() + 20_000;
    let assignmentRunId: string | undefined;
    while (Date.now() < deadline) {
      const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "experts" })).rows;
      const current = rows.find(row => row.key === "current")?.value as {
        readonly assignments: { readonly [key: string]: { readonly runId?: string; readonly status?: string } };
      } | undefined;
      assignmentRunId = current?.assignments[conversation.assignmentId]?.runId;
      if (assignmentRunId) {
        const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: assignmentRunId });
        if (["completed", "failed", "cancelled"].includes(run.status)) break;
      }
      await Bun.sleep(25);
    }
    expect(assignmentRunId).toBeTruthy();
    const expertRun = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: assignmentRunId! });
    expect(["completed", "failed", "cancelled"]).toContain(expertRun.status);

    const configRuns = await app.runtime.service.listRuns(LOCAL_OPERATOR, { agent: AGENT_CONFIG });
    const latestConfigRun = configRuns.find(run => {
      const input = run.input as { readonly root?: unknown } | undefined;
      return input?.root === containedWorkspace;
    });
    expect(latestConfigRun).toBeDefined();
    expect(["failed", "cancelled"]).toContain(latestConfigRun!.status);

    const eventRows = await events(app);
    const configEffects = eventRows.filter((raw) => {
      const event = raw as { readonly runId?: string; readonly eventType?: string };
      return event.runId === latestConfigRun!.runId && ["execution.world.connected", "workspace.added"].includes(event.eventType ?? "");
    });
    expect(configEffects).toEqual([]);
    expect((await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows.some(row => JSON.stringify(row).includes(containedWorkspace))).toBe(false);
    expect((await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "execution-worlds" })).rows.some(row => JSON.stringify(row).includes(containedWorkspace))).toBe(false);
    expect(await Bun.file(join(containedWorkspace, "must-not-fallback")).exists()).toBe(false);
  } finally {
    releaseProvider();
    await client?.close().catch(() => {});
    await stop(app);
    await rm(fixture, { recursive: true, force: true });
  }
}, 90_000);
