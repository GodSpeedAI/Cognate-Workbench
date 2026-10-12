// Journey J-RW-ssh-workspaces (Remote Workspaces T5): an SSH host is a workspace location, and the
// model-facing tools, agent loop, approvals and sessions never learn the difference.
// A real SSH server (ssh2) stands in for the remote host: the provider under test is the genuine
// client. Proves: probe-then-pin host trust, secrets stay out of durable state, tools reach the remote
// over SFTP/exec, the remote cwd is honoured, escapes are denied, failure never falls back to local,
// restart rebuilds the world from safe metadata, and disposal closes the connection.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { startSshFixture } from "@godspeedai/cognate-execution-ssh/fixture";
import type { SshFixture } from "@godspeedai/cognate-execution-ssh/fixture";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { postgresUrl, schemaFor } from "../src/store.ts";
import postgres from "postgres";
import { bootAimock, withTempHome } from "./helpers.ts";

const PASSWORD = "s3cret-pass-ZXCV-1234";
const clientFor = (app: AppServer) => createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
type Client = ReturnType<typeof clientFor>;
const finish = async (app: AppServer, runId: string) => { for (let i = 0; i < 600; i++) { const r = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId }); if (["completed", "failed", "cancelled"].includes(r.status)) return r; await new Promise((x) => setTimeout(x, 25)); } throw new Error("run did not finish"); };
const events = async (app: AppServer) => { const out: { eventType: string; payload: any }[] = []; for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) out.push({ eventType: e.eventType, payload: e.payload }); return out; };

async function remoteProject(root: string) {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Remote fixture\n");
  await writeFile(join(root, "src/greet.ts"), 'export const greet = () => "Hello";\n');
}

const sshInput = (f: SshFixture, fingerprint: string) => ({ kind: "ssh" as const, label: "build box", ssh: { host: "127.0.0.1", port: f.port, username: "dev", auth: { kind: "password" as const, password: PASSWORD }, hostKeyFingerprint: fingerprint } });

describe("J-RW-ssh-workspaces", () => {
  test("J-RW-select-world, J-RW-add-workspace, J-RW-read-remote, J-RW-edit-remote, J-RW-exec-remote, J-RW-conn-failure, J-RW-reconnect: probe -> pin -> connect -> workspace -> agent tools over SSH -> restart -> disconnect", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const fixture = await startSshFixture({ users: { dev: { password: PASSWORD } } });
      let app = await startServer({ port: 0, home });
      let client: Client = clientFor(app);
      try {
        const remote = join(home, "remote-root");
        await remoteProject(remote);
        await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });

        // trust is a human act: probing reads the key and stops; a wrong pin is refused
        const probe = (await client.invoke("execution.world.probe", { host: "127.0.0.1", port: fixture.port })) as { fingerprint: string; known: string };
        expect(probe.fingerprint).toBe(fixture.fingerprint);
        expect(fixture.stats.execs).toBe(0);
        await expect(client.invoke("execution.world.connect", sshInput(fixture, "SHA256:" + "A".repeat(43)))).rejects.toThrow(/host key/);
        await expect(client.invoke("execution.world.connect", { ...sshInput(fixture, probe.fingerprint), ssh: { ...sshInput(fixture, probe.fingerprint).ssh, hostKeyFingerprint: "nope" } })).rejects.toThrow(/fingerprint/);

        const world = (await client.invoke("execution.world.connect", sshInput(fixture, probe.fingerprint))) as { worldId: string; label: string; metadata: Record<string, string>; home: string };
        expect(world.label).toBe("build box");
        expect(world.metadata).toMatchObject({ host: "127.0.0.1", username: "dev", auth: "password", hostKey: fixture.fingerprint });
        expect(JSON.stringify(world)).not.toContain(PASSWORD);

        // a remote workspace: the root is a provider-owned POSIX path, not a local placeholder
        const sel = (await client.invoke("workspace.select", { path: remote, worldId: world.worldId })) as { workspaceId: string; root: string; executionWorldId: string };
        expect(sel.executionWorldId).toBe(world.worldId);
        expect(sel.root).toBe(remote);

        // the framework capability reaches the remote with the right cwd
        const pwd = (await client.invoke("process.exec", { worldId: world.worldId, argv: ["pwd"], cwd: remote })) as { stdout: string; exitCode: number };
        expect(pwd.stdout.trim()).toBe(remote);
        const sftpBefore = fixture.stats.sftpOpens; const execsBefore = fixture.stats.execs;

        // the agent loop is unchanged: read, bash and edit (with the read-before-edit guard) all reach
        // the remote — files over SFTP, the command over exec
        const sessionId = randomUUID();
        const run = await client.startRun("agent.coding", { sessionId, workspaceId: sel.workspaceId, message: "[[scenario:multi]] check and change the greeting" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
        expect((await finish(app, run.runId)).status).toBe("completed");
        expect(await readFile(join(remote, "src/greet.ts"), "utf8")).toContain("Howdy");
        expect(fixture.stats.sftpOpens).toBeGreaterThan(sftpBefore);
        expect(fixture.stats.execs).toBeGreaterThan(execsBefore);

        // path escape is denied at the contract boundary
        await expect(client.invoke("filesystem.resolve", { worldId: world.worldId, root: remote, path: "../../etc/passwd" })).rejects.toThrow(/escapes/);

        // secrets never reach events, projections or the durable store; they live only in the 0600 secret store
        const all = JSON.stringify(await events(app));
        const rows = JSON.stringify((await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "execution-worlds" })).rows);
        expect(all).not.toContain(PASSWORD);
        expect(rows).not.toContain(PASSWORD);
        expect(rows).toContain(fixture.fingerprint);
        const secretsFile = await readFile(join(home, "secrets.json"), "utf8");
        expect(secretsFile).toContain(PASSWORD);
        expect((await Bun.file(join(home, "secrets.json")).stat()).mode & 0o777).toBe(0o600);
        // Scan the authoritative PostgreSQL schema for the secret (payloads, metadata, records, folds).
        const scan = postgres(postgresUrl(), { max: 1, onnotice: () => {} });
        try {
          const t = (name: string) => scan`${scan(schemaFor(home))}.${scan(name)}`;
          const texts = [
            ...(await scan`SELECT payload::text AS text FROM ${t("payloads")}`).map((r) => r.text as string),
            ...(await scan`SELECT metadata::text AS text FROM ${t("events")} WHERE metadata IS NOT NULL`).map((r) => r.text as string),
            ...(await scan`SELECT value::text AS text FROM ${t("records")}`).map((r) => r.text as string),
            ...(await scan`SELECT value::text AS text FROM ${t("projection_state")}`).map((r) => r.text as string),
          ];
          expect(texts.length).toBeGreaterThan(0);
          for (const text of texts) expect(text).not.toContain(PASSWORD);
        } finally {
          await scan.end({ timeout: 1 });
        }

        // restart: the world is rebuilt from durable safe metadata + the secret store; reconnect is lazy
        await app.stop();
        for (let i = 0; i < 80 && fixture.stats.open > 0; i++) await Bun.sleep(25);
        expect(fixture.stats.open).toBe(0); // disposal closed the SSH connection
        app = await startServer({ port: 0, home });
        client = clientFor(app);
        const checked = (await client.invoke("execution.world.check", { worldId: world.worldId })) as { ok: boolean; home?: string };
        expect(checked.ok).toBe(true);
        const read = (await client.invoke("filesystem.readText", { worldId: world.worldId, path: join(remote, "README.md") })) as { content: string };
        expect(read.content).toContain("Remote fixture");

        // J-RW-reconnect: after the server drops every session, the next operation re-dials through the same path
        fixture.dropConnections();
        await Bun.sleep(100);
        const again = (await client.invoke("filesystem.readText", { worldId: world.worldId, path: join(remote, "README.md") })) as { content: string };
        expect(again.content).toContain("Remote fixture");

        // failure never falls back to local execution
        await fixture.close();
        const marker = join(home, "ran-locally");
        await expect(client.invoke("process.exec", { worldId: world.worldId, argv: ["touch", marker], cwd: "/tmp" })).rejects.toThrow();
        expect(await Bun.file(marker).exists()).toBe(false);
        const down = (await client.invoke("execution.world.check", { worldId: world.worldId })) as { ok: boolean; error?: string };
        expect(down.ok).toBe(false);
        expect(down.error).toBeTruthy();

        // disconnect is refused while a workspace uses the world, then cleans up secrets
        await expect(client.invoke("execution.world.disconnect", { worldId: world.worldId })).rejects.toThrow(/workspace/);
        await client.invoke("workspace.delete", { workspaceId: sel.workspaceId });
        // The disconnect guard reads the server-side workspaces projection fold; wait for the
        // removal to land there before disconnecting.
        for (let i = 0; i < 400; i++) {
          const current = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
          if (!current.some((r) => r.key === `record/${sel.workspaceId}`)) break;
          await Bun.sleep(25);
        }
        await client.invoke("execution.world.disconnect", { worldId: world.worldId });
        expect(await readFile(join(home, "secrets.json"), "utf8")).not.toContain(PASSWORD);
        await expect(client.invoke("process.exec", { worldId: world.worldId, argv: ["true"], cwd: "/" })).rejects.toThrow();
      } finally {
        await app.stop();
        await fixture.close().catch(() => {});
        await aimock.stop();
      }
    });
  }, 120_000);

  test("J-RW-coexist (part): a local world keeps working beside a connected SSH world", async () => {
    await withTempHome(async (home) => {
      const fixture = await startSshFixture({ users: { dev: { password: PASSWORD } } });
      const app = await startServer({ port: 0, home });
      const client = clientFor(app);
      try {
        await client.invoke("execution.world.connect", sshInput(fixture, fixture.fingerprint));
        const local = join(home, "local-ws");
        await mkdir(local, { recursive: true });
        const sel = (await client.invoke("workspace.select", { path: local })) as { executionWorldId: string; root: string };
        expect(sel.executionWorldId).toBe("local");
        const before = fixture.stats.execs;
        const out = (await client.invoke("process.exec", { worldId: "local", argv: ["pwd"], cwd: local })) as { stdout: string };
        expect(out.stdout.trim()).toBe(local);
        expect(fixture.stats.execs).toBe(before); // nothing leaked to the remote
        await expect(client.invoke("workspace.select", { path: "/definitely/not/here", worldId: "no-such-world" })).rejects.toThrow();
      } finally { await app.stop(); await fixture.close(); }
    });
  }, 60_000);

  test("J-RW-cancel-timeout: cancelling a run ends the remote command (no orphan); a timeout is reported", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const fixture = await startSshFixture({ users: { dev: { password: PASSWORD } } });
      const app = await startServer({ port: 0, home });
      const client = clientFor(app);
      try {
        await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
        const world = (await client.invoke("execution.world.connect", sshInput(fixture, fixture.fingerprint))) as { worldId: string };
        const remote = join(home, "remote-root");
        await mkdir(remote, { recursive: true });
        const sel = (await client.invoke("workspace.select", { path: remote, worldId: world.worldId })) as { workspaceId: string };
        const sessionId = randomUUID();
        const run = await client.startRun("agent.coding", { sessionId, workspaceId: sel.workspaceId, message: "[[scenario:slowbash]] run the long command" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
        for (let i = 0; i < 800 && fixture.stats.liveExecs < 1; i++) await Bun.sleep(25);
        expect(fixture.stats.liveExecs).toBe(1); // really running on the remote
        await client.cancelRun(run.runId, "user-cancelled");
        expect((await finish(app, run.runId)).status).toBe("cancelled");
        for (let i = 0; i < 800 && fixture.stats.liveExecs > 0; i++) await Bun.sleep(25);
        expect(fixture.stats.liveExecs).toBe(0); // the remote command was ended, not orphaned
        const orphans = (await Bun.$`pgrep -x sleep -a`.nothrow().text()).split("\n").filter((l) => l.endsWith(" 4901.3")).length;
        expect(orphans).toBe(0);

        // timeout expiry through the same capability: reported as timed out, process gone
        const t = (await client.invoke("process.exec", { worldId: world.worldId, argv: ["sleep", "4902.4"], cwd: remote, timeoutMs: 400 })) as { timedOut: boolean };
        expect(t.timedOut).toBe(true);
        await Bun.sleep(1500);
        expect((await Bun.$`pgrep -x sleep -a`.nothrow().text()).split("\n").filter((l) => l.endsWith(" 4902.4")).length).toBe(0);
      } finally { await app.stop(); await fixture.close(); await aimock.stop(); }
    });
  }, 90_000);

  test("J-RW-coexist, J-RW-switch: local and two different remote hosts in one process; the same tools, each reaching only its own world", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const hostA = await startSshFixture({ users: { dev: { password: PASSWORD } } });
      const hostB = await startSshFixture({ users: { dev: { password: PASSWORD } } });
      const app = await startServer({ port: 0, home });
      const client = clientFor(app);
      try {
        await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
        const a = (await client.invoke("execution.world.connect", sshInput(hostA, hostA.fingerprint))) as { worldId: string };
        const b = (await client.invoke("execution.world.connect", sshInput(hostB, hostB.fingerprint))) as { worldId: string };
        expect(a.worldId).not.toBe(b.worldId);
        const roots = { local: join(home, "w-local"), a: join(home, "w-a"), b: join(home, "w-b") };
        for (const r of Object.values(roots)) await remoteProject(r);
        const sel = async (root: string, worldId?: string) => (await client.invoke("workspace.select", { path: root, ...(worldId ? { worldId } : {}) })) as { workspaceId: string; executionWorldId: string };
        const wsLocal = await sel(roots.local); const wsA = await sel(roots.a, a.worldId); const wsB = await sel(roots.b, b.worldId);
        expect([wsLocal.executionWorldId, wsA.executionWorldId, wsB.executionWorldId]).toEqual(["local", a.worldId, b.worldId]);
        const agent = async (workspaceId: string) => {
          const sessionId = randomUUID();
          const run = await client.startRun("agent.coding", { sessionId, workspaceId, message: "[[scenario:multi]] check and change the greeting" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
          expect((await finish(app, run.runId)).status).toBe("completed");
        };
        const base = [hostA.stats.execs, hostB.stats.execs]; // connecting verifies each host once
        const execs = () => [hostA.stats.execs - base[0]!, hostB.stats.execs - base[1]!];
        // switch: remote A, then local, then remote B, then back to A — one tool catalog, one agent loop
        await agent(wsA.workspaceId);
        expect(execs()).toEqual([1, 0]); // only host A saw the command
        expect(await readFile(join(roots.a, "src/greet.ts"), "utf8")).toContain("Howdy");
        expect(await readFile(join(roots.b, "src/greet.ts"), "utf8")).toContain("Hello"); // no cross-talk
        await agent(wsLocal.workspaceId);
        expect(execs()).toEqual([1, 0]); // local work did not touch either remote
        expect(await readFile(join(roots.local, "src/greet.ts"), "utf8")).toContain("Howdy");
        await agent(wsB.workspaceId);
        expect(execs()).toEqual([1, 1]);
        expect(await readFile(join(roots.b, "src/greet.ts"), "utf8")).toContain("Howdy");
        // switching back re-selects the same workspace in its own world (idempotent, same id)
        expect((await sel(roots.a, a.worldId)).workspaceId).toBe(wsA.workspaceId);
        // the same remote path in two worlds is two different workspaces
        expect((await sel(roots.a, b.worldId)).workspaceId).not.toBe(wsA.workspaceId);
      } finally { await app.stop(); await hostA.close(); await hostB.close(); await aimock.stop(); }
    });
  }, 90_000);
});
