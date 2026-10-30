// Shared helpers for the J-WB-* journey tests: boot the real app, seed a workspace and model, read the
// derived `workbench` projection, and wait on durable state (never on sleeps alone).
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import type { AcceptanceCriterion, TaskContract } from "../src/workbench/types.ts";
import type { TaskRecord } from "../src/workbench/state.ts";
import { bootApp, bootAimock, withTempHome, type MockModel } from "./helpers.ts";
import { makeWorkspace } from "../fixtures/workspace/make-workspace.ts";

export { LOCAL_OPERATOR, bootApp, bootAimock, withTempHome };
export type { AppServer, MockModel };
export type Client = Awaited<ReturnType<typeof bootApp>>["client"];

/** `client.invoke` with domain objects (readonly arrays etc.) as input; the wire is JSON either way. */
export const inv = (c: Client, capability: string, input: unknown) => c.invoke(capability, input as never);

export const SYSTEM = { actor: { id: "system", kind: "system" as const }, tenant: "local" };

export async function wbRows(app: AppServer): Promise<Map<string, unknown>> {
  const rows = ((await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workbench" }))).rows;
  return new Map(rows.map((r) => [r.key, r.value]));
}

export async function waitUntil<T>(what: string, probe: () => Promise<T | undefined | false>, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

export const waitForRow = <T>(app: AppServer, key: string, ok: (v: T) => boolean = () => true) =>
  waitUntil<T>(`workbench row ${key}`, async () => {
    const v = (await wbRows(app)).get(key) as T | undefined;
    return v !== undefined && ok(v) ? v : undefined;
  });

export async function rowsWithPrefix<T>(app: AppServer, prefix: string): Promise<T[]> {
  return [...(await wbRows(app))].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v as T);
}

export async function waitForCompletion(app: AppServer, runId: string) {
  return waitUntil("run completion", async () => {
    const run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId });
    return run.status === "completed" || run.status === "failed" || run.status === "cancelled" ? run : undefined;
  }, 20000);
}

export async function allEvents(app: AppServer): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) out.push(e);
  return out;
}

export interface Seeded {
  readonly workspaceId: string;
  readonly workspaceDir: string;
}


/** Wait until the workspaces projection fold covers the seeded workspace (async fold on PostgreSQL). */
async function waitWorkspaceVisible(client: Client, workspaceId: string): Promise<void> {
  const store = client.projection("workspaces");
  for (let i = 0; i < 400; i++) {
    if (store.get()?.some((row) => row.key === `record/${workspaceId}`)) return;
    await Bun.sleep(25);
  }
  throw new Error(`workspace ${workspaceId} never appeared in the workspaces projection`);
}

/** Configure the mock model and select a real fixture workspace. */
export async function seed(client: Client, home: string, aimockPort: number): Promise<Seeded> {
  await inv(client, "model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimockPort}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
  const workspaceDir = join(home, "ws-wb");
  await makeWorkspace(workspaceDir);
  const { workspaceId } = (await inv(client, "workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };
  await waitWorkspaceVisible(client, workspaceId);
  return { workspaceId, workspaceDir };
}

/** A workspace without a model, for journeys that never run the agent. */
export async function seedWorkspaceOnly(client: Client, home: string): Promise<Seeded> {
  const workspaceDir = join(home, "ws-wb");
  await makeWorkspace(workspaceDir);
  const { workspaceId } = (await inv(client, "workspace.select", { path: workspaceDir })) as { readonly workspaceId: string };
  await waitWorkspaceVisible(client, workspaceId);
  return { workspaceId, workspaceDir };
}

export const ACCEPTANCE: readonly AcceptanceCriterion[] = [
  { id: "ac-1", kind: "test", description: "unit tests pass", required: true },
  { id: "ac-2", kind: "independent-check", description: "totals match an independent calculation", required: true },
  { id: "ac-3", kind: "human", description: "reviewer accepts", required: true },
];

export function fullContract(workspaceId: string, protectedPaths: readonly string[] = []): Partial<TaskContract> {
  return {
    context: { workspaceId, files: [] },
    goal: { outcome: "Update the greeting", nonGoals: [] },
    skills: ["capability.code-repair"],
    authority: {
      filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
      shell: { run: "yes", destructive: "approval" },
      network: { outbound: "no" },
      packages: { install: "no" },
      extensions: { install: "no", enable: "no" },
      protectedPaths,
    },
    executors: [{ role: "primary", executor: "model:mock-model-1", kind: "llm" }],
    budget: { maxTokens: 50000, maxConcurrency: 2 },
    invariants: [{ id: "inv-1", kind: "governance", statement: "protected evidence is never edited" }],
    acceptance: ACCEPTANCE,
  };
}

/** Create a task, wait for its row, and return its id. */
export async function createTask(app: AppServer, client: Client, workspaceId: string, title: string, contract?: Partial<TaskContract>): Promise<string> {
  const { taskId } = (await inv(client, "task.create", { title, workspaceId, ...(contract ? { contract } : {}) })) as { taskId: string };
  await waitForRow<TaskRecord>(app, `task/${taskId}`);
  return taskId;
}

export const newId = () => randomUUID();

/** Drive a task through the whole review gate with real evidence until a person accepts it. */
export async function acceptTask(app: AppServer, client: Client, workspaceId: string, title = "Accepted task"): Promise<string> {
  const taskId = await createTask(app, client, workspaceId, title, fullContract(workspaceId));
  await inv(client, "task.contract.update", { taskId, contract: fullContract(workspaceId) });
  await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => (t.contract.acceptance?.length ?? 0) === 3);
  const ev = async (kind: "test" | "independent-check", criterionId: string, summary: string) =>
    ((await inv(client, "evidence.record", { taskId, kind, status: "pass", summary, criterionId })) as { evidenceId: string }).evidenceId;
  const a = await ev("test", "ac-1", "unit tests pass");
  await ev("independent-check", "ac-2", "independent calculation agrees");
  await waitUntil("evidence", async () => (await rowsWithPrefix(app, `evidence/${taskId}/`)).length === 2);
  await inv(client, "worker.return", { taskId, workerReturn: { changed: ["report.html"], tested: ["bun test"], evidence: [a], remaining: [], risks: [], readyForReview: true } });
  await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => !!t.workerReturn);
  await inv(client, "task.review.request", { taskId });
  await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "READY_FOR_REVIEW");
  await inv(client, "task.review.decide", { taskId, decision: "accept", note: "ok" });
  await waitForRow<TaskRecord>(app, `task/${taskId}`, (t) => t.status === "ACCEPTED");
  return taskId;
}

/** Run Git host-side against a test fixture: setup and commit helpers for journey tests (the
 * app's own Git work goes through `src/workbench/gitOps.ts` inside the execution world). */
export async function gitIn(cwd: string, args: readonly string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture Bot",
      GIT_AUTHOR_EMAIL: "fixture-bot@example.invalid",
      GIT_COMMITTER_NAME: "Fixture Bot",
      GIT_COMMITTER_EMAIL: "fixture-bot@example.invalid",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr}`);
  return stdout;
}
