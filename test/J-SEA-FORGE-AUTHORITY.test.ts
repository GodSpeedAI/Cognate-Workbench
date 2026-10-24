// J-SEA-FORGE-AUTHORITY (P02): SEA-Forge is Workbench's external authority, end to end.
// A real sea-forge-server governs Workbench's own interaction model as a DomainForge world. An agent
// edit in a real contained workspace escalates and does not run; the service identity cannot approve
// its own escalation; the operator approves through Workbench (on_behalf_of, via the gateway) and the
// edit then runs exactly once; a rejected escalation leaves the file untouched.
// Opt-in: SEA_FORGE_SERVER_BIN (built with the `resources` policy filter), a `domainforge` CLI at the
// stack lockstep version (WB_DOMAINFORGE_BIN or PATH), and the real-bwrap prerequisites
// (COGNATE_BWRAP_TESTS=1, COGNATE_BWRAP_TEST_ATTESTATION) as in J-RW-contained-workspace.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { externalAuthorityFromEnv, seaForgeCall } from "../src/capabilities/governance.ts";
import type { ContainmentConfig } from "../src/capabilities/containedWorkspace.ts";
import { bootAimock } from "./helpers.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";

const BIN = process.env.SEA_FORGE_SERVER_BIN;
const DF = process.env.WB_DOMAINFORGE_BIN ?? "domainforge";
const enabled = Boolean(BIN) && process.env.COGNATE_BWRAP_TESTS === "1" && Boolean(process.env.COGNATE_BWRAP_TEST_ATTESTATION) && process.platform === "linux";
const liveTest = enabled ? test : test.skip;

// Consequential agent capabilities escalate; everything else Workbench calls is allowed. First match wins.
const POLICY = `version: "0.1"
rules:
  - name: consequential-agent-effects
    verdict: allow
    requires_approval: true
    actor_role: service
    operation_kind: cognate_capability
    resources: ["tool.edit", "tool.bash", "tool.run_code", "expert.tool.invoke", "plugin.install", "plugin.uninstall"]
  - name: workbench-capabilities
    verdict: allow
    actor_role: service
    operation_kind: cognate_capability
  - name: workbench-actions
    verdict: allow
    actor_role: service
    operation_kind: cognate_action
  - name: operator-approves
    verdict: allow
    actor_role: operator
    operation_kind: approval_resolution
`;

const clientFor = (app: AppServer) => createClient({
  service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)),
  caller: LOCAL_OPERATOR,
});

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what} (last: ${JSON.stringify(v).slice(0, 300)})`);
    await Bun.sleep(50);
  }
}

liveTest("J-SEA-FORGE-AUTHORITY: an agent edit waits for SEA-Forge; only the operator's approval lets it run, once", async () => {
  const root = await mkdtemp(join(tmpdir(), "wb-sf-"));
  const socket = join(tmpdir(), `wb-sf-${process.pid}-${randomUUID().slice(0, 8)}.sock`);
  let server: ReturnType<typeof Bun.spawn> | undefined;
  let app: AppServer | undefined;
  const aimock = await bootAimock();
  try {
    // Workbench's interaction model is the governed world; DomainForge and SEA-Forge must agree on it.
    await mkdir(join(root, "worlds"));
    await copyFile(join(import.meta.dir, "../.sea/interaction/interaction-model.sea"), join(root, "worlds/interaction-model.sea"));
    const envelope = Bun.spawnSync([DF, "envelope", "--emit", "cep", "--world-name", "workbench", "interaction-model.sea"], { cwd: join(root, "worlds") });
    expect(envelope.exitCode, envelope.stderr.toString()).toBe(0);
    const worldRef = JSON.parse(envelope.stdout.toString()).scope.world_ref as string;

    const uid = process.getuid!();
    await writeFile(join(root, "policy.yaml"), POLICY);
    await writeFile(join(root, "server.yaml"), JSON.stringify({
      socket_path: socket,
      root,
      // One uid = one actor: this process is the service principal and the gateway; the operator has no
      // uid of its own and is reached only through on_behalf_of.
      identity: { bindings: [{ uid, actor_id: "cognate-service", roles: ["service"] }, { actor_id: "operator", roles: ["operator"] }] },
      gateway: { uid, actor: "cognate-service", delegable_actors: ["operator"] },
      cep_authority: { enabled: true, policy: "policy.yaml", worlds: [{ name: "workbench", base: "worlds", entry: "interaction-model.sea", files: ["interaction-model.sea"] }] },
    }));
    server = Bun.spawn([BIN!], { env: { ...process.env, SEA_FORGE_ROOT: root, SEA_FORGE_SOCKET: socket }, stdout: "ignore", stderr: process.env.WB_SF_LOG ? Bun.file(process.env.WB_SF_LOG) : "ignore" });
    await until(async () => existsSync(socket), Boolean, "sea-forge-server socket");

    const externalAuthority = externalAuthorityFromEnv({
      COGNATE_GOVERNANCE: "sea-forge", COGNATE_SEA_FORGE_SOCKET: socket, COGNATE_WORLD_REF: worldRef, COGNATE_SEA_FORGE_OPERATOR: "operator",
    })!;
    const containmentConfig = JSON.parse(await readFile(process.env.COGNATE_BWRAP_TEST_ATTESTATION!, "utf8")) as ContainmentConfig;
    app = await startServer({ devAuth: true, port: 0, home: join(root, "home"), containmentConfig, externalAuthority });
    const client = clientFor(app);
    expect(await client.invoke("governance.status", {})).toMatchObject({ mode: "sea-forge", worldRef, operator: "operator" });

    await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });

    const runEdit = async (dir: string) => {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(join(dir, "src/greet.ts"), "export const greet = () => \"Hello\";\n");
      const { workspaceId } = await client.invoke("workspace.contained.select", { path: dir }) as { workspaceId: string };
      const sessionId = randomUUID();
      const view = await client.startRun("agent.coding", { sessionId, workspaceId, message: "[[scenario:edit]] change the greeting" } as never,
        { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
      const runId = view.runId;
      await until(() => app!.runtime.service.getRun(LOCAL_OPERATOR, { runId }).then((r) => r.status), (s) => s === "waiting", "run waits on SEA-Forge");
      const wait = (await app!.runtime.service.listContinuations(LOCAL_OPERATOR, { runId, status: "OPEN" }))[0]!;
      const approvalId = (wait.condition as { approvalId: string }).approvalId;
      expect(approvalId).toMatch(/^apr-/);
      return { runId, sessionId, approvalId, file: join(dir, "src/greet.ts") };
    };
    // Edit tool-call events of one kind in this session (all events; tool events carry sessionId).
    const editEvents = async (sessionId: string, eventType: string) => {
      let n = 0;
      for await (const e of app!.runtime.service.events(LOCAL_OPERATOR, {})) {
        const p = e.payload as { sessionId?: string; tool?: string };
        if (e.eventType === eventType && p.sessionId === sessionId && p.tool === "edit") n++;
      }
      return n;
    };

    // 1. Escalated: the edit has not run, and SEA-Forge lists the approval.
    const a = await runEdit(join(root, "ws-approve"));
    expect(await readFile(a.file, "utf8")).toContain("Hello");
    const listed = await client.invoke("governance.approvals.list", {}) as { approvals: Array<{ approval_id: string; state: string }> };
    expect(listed.approvals.find((x) => x.approval_id === a.approvalId)?.state).toBe("pending");

    // 2. The requester (this process's own service identity) cannot approve its own escalation.
    const self = await seaForgeCall(socket, { verb: "authority_approval", approval_id: a.approvalId, resolution: "approved", request_id: "self", actor: { actor_id: "cognate-service", role: "service" } });
    expect(self.error_class).toBe("cep_approval_refused");
    expect(await readFile(a.file, "utf8")).toContain("Hello");

    // 3. The operator approves through Workbench; the run resumes and the edit runs exactly once.
    expect(await client.invoke("governance.approval.resolve", { approvalId: a.approvalId, resolution: "approved" })).toMatchObject({ resolvedBy: "operator" });
    await until(() => app!.runtime.service.getRun(LOCAL_OPERATOR, { runId: a.runId }).then((r) => r.status), (s) => s === "completed", "run completes after approval");
    expect(await readFile(a.file, "utf8")).toBe("export const greet = () => \"Howdy\";\n");
    expect(await editEvents(a.sessionId, "tool.call.started")).toBe(1);
    expect(await editEvents(a.sessionId, "tool.call.completed")).toBe(1);
    const after = await client.invoke("governance.approvals.list", {}) as { approvals: Array<{ approval_id: string; state: string }> };
    expect(after.approvals.find((x) => x.approval_id === a.approvalId)?.state).toBe("used");

    // 4. A rejected escalation never runs.
    const r = await runEdit(join(root, "ws-reject"));
    await client.invoke("governance.approval.resolve", { approvalId: r.approvalId, resolution: "rejected" });
    await until(() => app!.runtime.service.getRun(LOCAL_OPERATOR, { runId: r.runId }).then((x) => x.status), (s) => s !== "waiting" && s !== "running", "rejected run leaves waiting");
    expect(await readFile(r.file, "utf8")).toContain("Hello");
    expect(await editEvents(r.sessionId, "tool.call.completed")).toBe(0);
    expect(await readFile(r.file, "utf8")).toContain("Hello");
  } finally {
    if (app) await app.stop();
    await aimock.stop();
    server?.kill();
    await rm(root, { recursive: true, force: true });
    await rm(socket, { force: true });
  }
}, 180_000);
