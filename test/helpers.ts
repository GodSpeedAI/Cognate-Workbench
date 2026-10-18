import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { startServer, LOCAL_OPERATOR, type AppServer } from "../src/server.ts";

export async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "deepseek-harness-t5-"));
  try {
    return await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export async function bootApp(home: string): Promise<{ readonly app: AppServer; readonly client: ReturnType<typeof createClient> }> {
  const app = await startServer({ devAuth: true, port: 0, home });
  const transport = connectTransport(app.url);
  const service = createRemoteRuntimeService(transport, () => devToken(LOCAL_OPERATOR));
  const client = createClient({ service, caller: LOCAL_OPERATOR });
  return { app, client };
}

const AIMOCK_FIXTURES = fileURLToPath(new URL("../fixtures/aimock/fixtures.json", import.meta.url));

/** The `llmock` bin (`@copilotkit/aimock`): the app package's own node_modules first, then the
 *  workspace root's, then whatever resolves on PATH. */
function resolveLlmockBin(): string {
  const candidates = [
    fileURLToPath(new URL("../node_modules/.bin/llmock", import.meta.url)),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return "llmock";
}

export interface MockModel {
  readonly port: number;
  stop(): Promise<void>;
}

/**
 * Runs CopilotKit's aimock server (`llmock`, `@copilotkit/aimock`) as a real, separate process —
 * the simulated OpenAI endpoint for these journey tests — serving the scenario fixtures from
 * `fixtures/aimock/fixtures.json`. `-p 0` makes it pick a free port, which it reports on stdout as
 * `[aimock] aimock server listening on http://127.0.0.1:<port>` (the readiness signal); fixture
 * schema problems abort the boot via `--validate-on-load`. No `--strict`: an unmatched message is
 * an honest HTTP 404 `No fixture matched` (surfaced as a failed run — proven by J-AIM), and a fresh
 * process per test keeps `sequenceIndex` counters (the `retry` scenario) at zero.
 */
export async function bootAimock(): Promise<MockModel> {
  const proc = Bun.spawn([resolveLlmockBin(), "-f", AIMOCK_FIXTURES, "-p", "0", "--validate-on-load", "--log-level", "info"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let port: number | undefined;
  const deadline = Date.now() + 10_000;
  while (port === undefined && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const match = /aimock server listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(buffer);
    if (match) port = Number(match[1]);
  }
  if (port === undefined) {
    proc.kill();
    await proc.exited;
    throw new Error(`aimock (llmock) did not report a port in time (stdout so far: ${buffer.trim()})`);
  }
  return {
    port,
    async stop() {
      proc.kill();
      await proc.exited;
    },
  };
}

/**
 * Reads llmock's request journal (`GET /__aimock/journal`) filtered to chat-completions requests —
 * out-of-process evidence of which requests actually reached the mock endpoint and with what
 * status (200 fixture-served, 404 no-match, 500 scripted error).
 */
export async function aimockChatRequests(port: number): Promise<readonly {
  readonly method: string;
  readonly path: string;
  readonly body: { readonly messages?: readonly { readonly role?: string; readonly content?: unknown }[] };
  readonly response: { readonly status: number };
}[]> {
  const res = await fetch(`http://127.0.0.1:${port}/__aimock/journal?path=/v1/chat/completions`);
  if (!res.ok) throw new Error(`aimock journal fetch failed: HTTP ${res.status}`);
  return (await res.json()) as never;
}
