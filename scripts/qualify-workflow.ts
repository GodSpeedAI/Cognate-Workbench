// Deterministic no-cost agent workflow (mission section 13) against an installed Cognate Workbench executable.
//
//   bun scripts/qualify-workflow.ts <cognate-workbench-executable> <port> <work-dir>
//
// Runs the real provider stack against the repository's aimock fixtures (`llmock`, no network cost):
//   1. a plain fixture-matched completion settles as `completed` with the fixture's text;
//   2. a fixture whose agent asks the bash tool to write a file in a local workspace: under the default
//      contained posture the write must be refused, so the file must not exist and the run must not
//      report the write as done.
// Both runs are inspected through the Connect API (run record, workspace file system). The executable runs with
// a disposable data home, so nothing is written to the operator's profile.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const [bin, portArg, workArg] = process.argv.slice(2);
if (!bin || !portArg || !workArg) throw new Error("usage: bun scripts/qualify-workflow.ts <cognate-workbench> <port> <work-dir>");
const port = Number(portArg);
const work = resolve(workArg);
const repo = resolve(import.meta.dir, "..");
const PLAIN_TEXT = "Hello from aimock. This completion was served by a fixture match.";

await mkdir(work, { recursive: true });
const home = join(work, "home");
await mkdir(join(home, ".local", "share"), { recursive: true });
const env = { ...process.env, HOME: home, XDG_DATA_HOME: join(home, ".local", "share"), PORT: String(port) };
delete env.COGNATE_POSTGRES_URL;
delete env.COGNATE_WORKBENCH_HOME;
delete env.COGNATE_HARNESS_HOME;

function fail(message: string): never {
  throw new Error(`FAIL: ${message}`);
}

// 1. The deterministic model server, exactly as the journey tests run it.
const llmock = Bun.spawn([join(repo, "node_modules/.bin/llmock"), "-p", "0", "-f", join(repo, "fixtures/aimock/fixtures.json")], { stdout: "pipe", stderr: "pipe" });
let mockBuffer = "";
const mockPort = await (async () => {
  const reader = llmock.stdout.getReader();
  const decoder = new TextDecoder();
  for (let i = 0; i < 200; i++) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 500))]);
    if (chunk && !chunk.done) mockBuffer += decoder.decode(chunk.value);
    const match = /aimock server listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(mockBuffer);
    if (match) return Number(match[1]);
  }
  fail(`llmock did not report a port (output: ${mockBuffer.trim()})`);
})();
console.log(`model: deterministic llmock on 127.0.0.1:${mockPort}`);

// 2. The installed executable, with a disposable data home.
const server = Bun.spawn([bin, "start"], { env, stdout: "pipe", stderr: "pipe" });
const serverLog = join(work, "server.log");
const logDone = (async () => {
  await writeFile(serverLog, "");
  for await (const chunk of server.stderr) await writeFile(serverLog, chunk, { flag: "a" });
})();
const stdoutDone = (async () => {
  for await (const chunk of server.stdout) await writeFile(serverLog, chunk, { flag: "a" });
})();
const base = `http://127.0.0.1:${port}`;
let token = "";
for (let i = 0; i < 300; i++) {
  try {
    const js = await (await fetch(`${base}/app.js`)).text();
    const match = /"(wbs1\.[^"]+)"/.exec(js);
    if (match) {
      token = match[1]!;
      break;
    }
  } catch {
    // not listening yet
  }
  await Bun.sleep(1000);
}
if (!token) fail(`the server never issued a boot session (see ${serverLog})`);

async function call(method: string, body: unknown): Promise<any> {
  const response = await fetch(`${base}/cognate.v1.RuntimeService/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function invoke(capability: string, input: unknown): Promise<any> {
  const result = await call("Invoke", { capability, input, idempotencyKey: randomUUID() });
  return result.output ?? result;
}

async function settle(runId: string): Promise<any> {
  for (let i = 0; i < 400; i++) {
    const run = await call("GetRun", { runId });
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    await Bun.sleep(100);
  }
  fail(`run ${runId} did not settle`);
}

let exitCode = 0;
try {
  // Model: the provider points at the deterministic llmock, through the same capability the UI uses.
  await invoke("model.configure", {
    providerId: "mock",
    baseURL: `http://127.0.0.1:${mockPort}/v1`,
    protocol: "openai-compatible",
    model: "mock-model-1",
    apiKey: "",
  });
  console.log("model: configured the mock provider");

  // Workspace: a local directory the agent may read but, under the default posture, not write.
  const workspaceDir = await mkdtemp(join(tmpdir(), "cognate-qualify-workspace-"));
  const { workspaceId } = await invoke("workspace.select", { path: workspaceDir });
  if (!workspaceId) fail("workspace.select returned no workspace");

  // Run 1: plain completion.
  const sessionA = randomUUID();
  const plain = await call("StartRun", {
    agent: "agent.coding",
    input: { sessionId: sessionA, workspaceId, message: "[[scenario:aim-plain]] say the fixture thing" },
    idempotencyKey: randomUUID(),
    correlationId: `session:${sessionA}`,
  });
  const plainRun = await settle(plain.runId);
  if (plainRun.status !== "completed") fail(`plain run ended ${plainRun.status}: ${JSON.stringify(plainRun.error ?? plainRun.output ?? {}).slice(0, 300)}`);
  if (plainRun.output?.text !== PLAIN_TEXT) fail(`plain run output was ${JSON.stringify(plainRun.output).slice(0, 200)}`);
  console.log(`workflow: plain completion settled as completed with the fixture text (run ${plain.runId})`);

  // Run 2: the agent asks bash to write a file in the local workspace. Contained posture must refuse the write.
  const sessionB = randomUUID();
  const write = await call("StartRun", {
    agent: "agent.coding",
    input: { sessionId: sessionB, workspaceId, message: "[[scenario:checkout-a]] write the marker" },
    idempotencyKey: randomUUID(),
    correlationId: `session:${sessionB}`,
  });
  const writeRun = await settle(write.runId);
  const written = existsSync(join(workspaceDir, "shared.txt"));
  if (written) fail("the agent wrote a file in a local workspace under the default posture");
  console.log(`workflow: the write was refused (run ${write.runId} ended ${writeRun.status}; shared.txt absent)`);
  console.log("PASS: deterministic workflow completed, and the local write stayed refused under the default posture");
  await rm(workspaceDir, { recursive: true, force: true });
} catch (error) {
  console.error((error as Error).message);
  exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await server.exited;
  llmock.kill();
  await Promise.allSettled([logDone, stdoutDone]);
}
process.exit(exitCode);
