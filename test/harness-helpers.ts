// Shared setup for the J-HARNESS-* journeys: fake harness CLIs (test/fixtures/harness/*) installed as
// wrapper scripts on a temp PATH, and a real app boot that detects them there.
import { chmodSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createClient } from "@godspeedai/cognate-client";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/harness/", import.meta.url));

export interface FakeHost {
  readonly dir: string;
  readonly binDir: string;
  readonly workspace: string;
  readonly log: string;
  readonly env: Record<string, string>;
}

async function wrapper(binDir: string, name: string, script: string, extra = ""): Promise<void> {
  const path = join(binDir, name);
  await writeFile(path, `#!/bin/sh\n${extra}exec "${process.execPath}" "${FIXTURES}${script}" "$@"\n`);
  chmodSync(path, 0o755);
}

export async function makeFakeHost(binaries: readonly string[] = ["claude", "codex", "opencode"]): Promise<FakeHost> {
  const dir = await mkdtemp(join(tmpdir(), "harness-fake-"));
  const binDir = join(dir, "bin");
  const workspace = join(dir, "ws");
  await mkdir(binDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "hello.txt"), "hello\n");
  const script: Record<string, string> = { claude: "fake-claude.ts", codex: "fake-codex.ts", opencode: "fake-acp.ts", kimi: "fake-acp.ts", gemini: "fake-acp.ts" };
  for (const b of binaries) await wrapper(binDir, b, script[b] ?? "fake-acp.ts");
  const log = join(dir, "argv.log");
  return { dir, binDir, workspace, log, env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: join(dir, "home"), FAKE_HARNESS_LOG: log } };
}

export async function bootHarnessApp(home: string, host: FakeHost): Promise<{ readonly app: AppServer; readonly client: ReturnType<typeof createClient> }> {
  // FAKE_HARNESS_LOG is passed through the opt-in list, like an operator would pass a variable.
  const app = await startServer({
    executionPosture: "uncontained-local",
    devAuth: true,
    port: 0,
    home,
    harnessHost: { env: { ...host.env, COGNATE_HARNESS_ENV_PASSTHROUGH: "FAKE_HARNESS_LOG" }, homeDir: host.env.HOME! },
  });
  const service = createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR));
  return { app, client: createClient({ service, caller: LOCAL_OPERATOR }) };
}

export type HarnessClient = Awaited<ReturnType<typeof bootHarnessApp>>["client"];

export async function newSession(app: AppServer, client: HarnessClient, path: string): Promise<{ readonly sessionId: string; readonly workspaceId: string }> {
  const { workspaceId } = (await client.invoke("workspace.select", { path })) as { readonly workspaceId: string };
  const { sessionId } = (await client.invoke("session.create", { workspaceId, requestId: randomUUID() } as never)) as { readonly sessionId: string };
  await app.runtime.idle();
  return { sessionId, workspaceId };
}

export async function startTurn(client: HarnessClient, sessionId: string, workspaceId: string, message: string): Promise<string> {
  const view = await client.startRun("agent.harness", { sessionId, workspaceId, message } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
  return view.runId;
}

export async function waitRun(app: AppServer, runId: string, statuses: readonly string[] = ["completed", "failed", "cancelled"], ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    if (statuses.includes(run.status)) return run;
    if (Date.now() > end) throw new Error(`run ${runId} still ${run.status} after ${ms}ms`);
    await Bun.sleep(25);
  }
}

export async function runEvents(app: AppServer, runId: string): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  for await (const e of app.runtime.service.events(LOCAL_OPERATOR, { runId })) out.push(e);
  return out;
}

export async function openApproval(app: AppServer, runId: string, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const open = (await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId, status: "OPEN" })).find((c) => c.type === "tool-approval");
    if (open) return open;
    if (Date.now() > end) throw new Error("no tool-approval continuation opened");
    await Bun.sleep(25);
  }
}

export async function waitFor<T>(fn: () => Promise<T | undefined> | T | undefined, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("condition not met in time");
    await Bun.sleep(25);
  }
}

export function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function readPids(workspace: string): Promise<number[]> {
  const text = await waitFor(async () => { try { return await readFile(join(workspace, "hang.pids"), "utf8"); } catch { return undefined; } });
  return text.trim().split(/\s+/).map(Number);
}

export const PROTOCOLS = [
  { id: "claude", text: "claude-stream-json" },
  { id: "codex", text: "codex-app-server" },
  { id: "opencode", text: "acp" },
] as const;

export { dirname };
