// The agent-browser adapter: every operation is one bounded CLI invocation against the
// session's daemon (`agent-browser <command> --session <name> --json`), so the Workbench
// never embeds a browser and never speaks raw CDP. Output parsing is uniform: --json where
// the CLI supports it, eval+JSON.stringify for structured page facts.
//
// Runtime resolution: COGNATE_AGENT_BROWSER_BIN first, then the packaged share/bin copy, then
// the repository's node_modules (dev). The BROWSER executable is agent-browser's own concern;
// the host's chromium-family browser or a one-time `agent-browser install` download supplies
// it (AGENT_BROWSER_EXECUTABLE_PATH can pin it; see docs/how-to/desktop.md).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resourcePath } from "../resources.ts";
import type { BrowserProvider, ElementBox, PageState, ViewportSpec } from "./provider.ts";
import { BrowserProviderError } from "./provider.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const SNAPSHOT_TIMEOUT_MS = 45_000;

function resolveCli(): string {
  const override = process.env.COGNATE_AGENT_BROWSER_BIN;
  if (override && existsSync(override)) return override;
  const packaged = resourcePath("bin", "agent-browser");
  if (existsSync(packaged)) return packaged;
  const dev = resourcePath("node_modules", ".bin", "agent-browser");
  if (existsSync(dev)) return dev;
  const direct = resourcePath("node_modules", "agent-browser", "bin", `agent-browser-${platformKey()}${process.platform === "win32" ? ".exe" : ""}`);
  if (existsSync(direct)) return direct;
  throw new BrowserProviderError("browser: the agent-browser CLI is not available; install it (npm i agent-browser) or set COGNATE_AGENT_BROWSER_BIN");
}

function platformKey(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "linux") return `linux-${arch}`;
  if (process.platform === "darwin") return `darwin-${arch}`;
  if (process.platform === "win32") return "win32-x64";
  throw new BrowserProviderError(`browser: unsupported platform ${process.platform}`);
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(args: readonly string[], timeoutMs: number): Promise<RunResult> {
  const cli = resolveCli();
  const child = Bun.spawn([cli, ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }, timeoutMs);
  return Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    .then(([code, stdout, stderr]) => ({ code, stdout, stderr }))
    .finally(() => clearTimeout(timer));
}

async function runJson<T>(args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const result = await run(args, timeoutMs);
  if (result.code !== 0) {
    throw new BrowserProviderError(`browser: agent-browser ${args[0]} failed (${result.code})`, result.stderr.slice(0, 2000));
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    // Some commands print a human line around the JSON; take the first {...} or [...] block.
    const start = result.stdout.search(/[[{]/);
    if (start >= 0) {
      try {
        return JSON.parse(result.stdout.slice(start)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new BrowserProviderError(`browser: agent-browser ${args[0]} returned non-JSON output`, result.stdout.slice(0, 500));
  }
}

async function runOk(args: readonly string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const result = await run(args, timeoutMs);
  if (result.code !== 0) {
    throw new BrowserProviderError(`browser: agent-browser ${args[0]} failed (${result.code})`, result.stderr.slice(0, 2000));
  }
  return result.stdout.trim();
}

export function agentBrowserProvider(): BrowserProvider {
  return {
    id: "agent-browser",

    async open(sessionName, options): Promise<PageState> {
      const args = ["open", ...(options?.url ? [options.url] : []), "--session", sessionName];
      await runOk(args);
      if (options?.viewport) await this.setViewport(sessionName, options.viewport);
      return this.state(sessionName);
    },

    async navigate(sessionName, url): Promise<PageState> {
      await runOk(["open", url, "--session", sessionName]);
      return this.state(sessionName);
    },

    async state(sessionName): Promise<PageState> {
      const url = await runOk(["get", "url", "--session", sessionName]);
      const title = await runOk(["get", "title", "--session", sessionName]);
      return { url: url.replace(/^"|"$/g, ""), title: title.replace(/^"|"$/g, "") };
    },

    async snapshot(sessionName): Promise<string> {
      // The interactive snapshot (refs) is exactly what an agent or the inspector needs; plain text.
      return runOk(["snapshot", "-i", "--session", sessionName], SNAPSHOT_TIMEOUT_MS);
    },

    async screenshot(sessionName, outputPath): Promise<void> {
      await runOk(["screenshot", outputPath, "--session", sessionName]);
    },

    async evaluate(sessionName, expression): Promise<unknown> {
      // The CLI prints the JSON-encoded result on stdout.
      const stdout = await runOk(["eval", expression, "--session", sessionName]);
      try {
        return JSON.parse(stdout) as unknown;
      } catch {
        return stdout;
      }
    },

    async setViewport(sessionName, viewport: ViewportSpec): Promise<void> {
      await runOk(["set", "viewport", String(viewport.width), String(viewport.height), ...(viewport.scale ? [String(viewport.scale)] : []), "--session", sessionName]);
    },

    async streamPort(sessionName): Promise<number> {
      // CLI results are wrapped: {success, data, error}.
      const status = await runJson<{ success: boolean; data?: { enabled?: boolean; port?: number } | null }>(["stream", "status", "--json", "--session", sessionName]);
      if (status.success && status.data?.enabled && status.data.port) return status.data.port;
      const enabled = await runJson<{ success: boolean; data?: { port?: number } | null; error?: string | null }>(["stream", "enable", "--json", "--session", sessionName]);
      if (enabled.success && enabled.data?.port) return enabled.data.port;
      // "already enabled" races the status probe; re-read once.
      const again = await runJson<{ success: boolean; data?: { enabled?: boolean; port?: number } | null }>(["stream", "status", "--json", "--session", sessionName]);
      if (again.success && again.data?.port) return again.data.port;
      throw new BrowserProviderError("browser: the stream server did not report a port", String(enabled.error ?? ""));
    },

    async errors(sessionName): Promise<readonly string[]> {
      const out = await runOk(["errors", "--session", sessionName]).catch(() => "");
      return out ? out.split("\n").filter((line) => line.trim().length > 0) : [];
    },

    async close(sessionName): Promise<void> {
      await runOk(["close", "--session", sessionName]).catch(() => {
        /* closing an already-dead daemon is success for the caller */
      });
    },

    async closeAll(): Promise<void> {
      // Only this app's sessions: named with the cognate prefix by the service.
      await runOk(["close", "--all"]).catch(() => {
        /* nothing running */
      });
    },
  };
}

export type { ElementBox, PageState, ViewportSpec };
