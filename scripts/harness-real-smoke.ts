// Real-CLI smoke for the J-HARNESS-session journey: one minimal, tool-free turn through each agent CLI
// installed on this host, using the operator's existing CLI sign-in. Not part of `bun test` (it calls
// real models and costs a few tokens). Usage: bun scripts/harness-real-smoke.ts [claude codex opencode] [--out file.json]
import { mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@godspeedai/cognate-client";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { LOCAL_OPERATOR, startServer } from "../src/server.ts";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : undefined;
const wanted = args.filter((a, i) => !a.startsWith("--") && (outIdx < 0 || i !== outIdx + 1));
const ids = wanted.length ? wanted : ["claude", "codex", "opencode"];

const home = await mkdtemp(join(tmpdir(), "cw-harness-smoke-home-"));
const workspace = await mkdtemp(join(tmpdir(), "cw-harness-smoke-ws-"));
await writeFile(join(workspace, "README.md"), "# smoke\n");
const app = await startServer({
  executionPosture: "uncontained-local",
  devAuth: true,
  port: 0,
  home,
  harnessHost: { env: { PATH: process.env.PATH ?? "", HOME: homedir() }, homeDir: homedir() },
});
const service = createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR));
const client = createClient({ service, caller: LOCAL_OPERATOR });
const results: unknown[] = [];
try {
  const list = (await client.invoke("agent.harness.list", { refresh: true } as never)) as { harnesses: { id: string; installed: boolean; version?: string; permissionModes: { id: string }[] }[] };
  const { workspaceId } = (await client.invoke("workspace.select", { path: workspace } as never)) as { workspaceId: string };
  for (const id of ids) {
    const info = list.harnesses.find((h) => h.id === id);
    if (!info?.installed) { results.push({ id, skipped: "not installed" }); continue; }
    const { sessionId } = (await client.invoke("session.create", { workspaceId, requestId: randomUUID() } as never)) as { sessionId: string };
    await app.runtime.idle();
    const mode = info.permissionModes.find((m) => m.id === "ask")?.id ?? info.permissionModes[0]?.id;
    await client.invoke("session.harness.bind", { sessionId, harnessId: id, permissionMode: mode } as never);
    const started = Date.now();
    const view = await client.startRun("agent.harness", { sessionId, workspaceId, message: "Reply with exactly the single word READY and nothing else. Do not use any tools." } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
    let run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: view.runId });
    while (!["completed", "failed", "cancelled"].includes(run.status) && Date.now() - started < 180_000) {
      await Bun.sleep(250);
      run = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: view.runId });
    }
    const list2: { type: string; runId?: string; payload: Record<string, unknown> }[] = [];
    for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) {
      const raw = e as unknown as { eventType: string; runId?: string; payload: Record<string, unknown> }; const ev = { type: raw.eventType, runId: raw.runId, payload: raw.payload };
      if (ev.runId === view.runId) list2.push(ev);
    }
    const reply = list2.filter((e) => e.type === "message.completed").map((e) => String(e.payload.text ?? "")).join("\n");
    const failure = list2.find((e) => e.type === "turn.failed")?.payload;
    results.push({ id, version: info.version, mode, status: run.status, ms: Date.now() - started, reply, failure, eventTypes: [...new Set(list2.map((e) => e.type))] });
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  if (out) await writeFile(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + "\n");
  console.log("stopping"); const t = Date.now(); await app.stop(); console.log(`stopped in ${Date.now() - t}ms`); process.exit(0);
}
