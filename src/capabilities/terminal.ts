// J-TERMINAL-session: the interactive terminal capabilities. `terminal.open` creates one
// PTY-backed session in the workspace's execution world; `terminal.close` terminates it
// including its process group. Both are human acts — an agent run cannot open, attach to or
// steer a terminal (agents keep `tool.bash`, whose governance is untouched). The stream is
// never durable: only metadata (`workbench.terminal.opened`/`closed`) reaches the event log.
//
// The contained posture governs *agent* effects (`UncontainedEffectRefusedError` is aimed at
// agent runs); the operator's own terminal on the machine the Workbench already runs on is
// the operator's standing authority, so local-world terminals stay available under `contained`.
// This is the J-TERMINAL model's stated distinction, not a widened grant: the capability layer
// refuses every non-operator caller before any process exists.
import { randomUUID } from "node:crypto";
import type { ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import type { Json } from "@godspeedai/cognate-events";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { openSecretStore } from "../secrets.ts";
import { localTerminalPort, wslTerminalPort } from "../terminal/local.ts";
import { sshTerminalPort, type SshConnectionFacts } from "../terminal/ssh.ts";
import type { TerminalService } from "../terminal/service.ts";

export interface TerminalCapabilityOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly registry: ExecutionWorldRegistry;
  readonly service: TerminalService;
  readonly home: string;
  /** The connection descriptors `execution.world.connect` recorded, by worldId. */
  readonly connectionFor: (worldId: string) => Promise<{ readonly connection: Json } | undefined>;
  readonly semanticRefs: Readonly<Record<string, SemanticRef | undefined>>;
}

const operatorOnly = (ctx: HandlerContext, capability: string): void => {
  if (ctx.actor.kind !== "user" || ctx.runId) {
    throw new Error(`${capability}: only a direct human operator may use the terminal`);
  }
};

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export function terminalComponent(options: TerminalCapabilityOptions): Component {
  const service = options.getService;
  const ref = (id: string) => options.semanticRefs[id];

  const workspaceRow = async (workspaceId: string): Promise<{ readonly root: string; readonly executionWorldId: string; readonly title: string }> => {
    const rows = (await service().readProjection(options.systemCaller, { name: "workspaces" })).rows;
    const row = rows.find(entry => entry.key === `record/${workspaceId}`)?.value as
      | { readonly root: string; readonly executionWorldId: string; readonly title: string }
      | undefined;
    if (!row) throw new Error(`terminal.open: unknown workspace ${workspaceId}`);
    return row;
  };

  const recordAndWait = async (events: readonly { readonly type: string; readonly payload: Json }[], correlationId: string): Promise<void> => {
    const { runId } = await service().startRun(options.systemCaller, {
      agent: AGENT_CONFIG,
      input: { kind: "workbench.recorded", events: JSON.parse(JSON.stringify(events)) as Json },
      idempotencyKey: randomUUID(),
      correlationId,
    });
    for (let attempt = 0; attempt < 400; attempt++) {
      const run = await service().getRun(options.systemCaller, { runId });
      if (run.status === "completed") return;
      if (run.status === "failed" || run.status === "cancelled") throw new Error(`terminal: recording failed (${run.status})`);
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error("terminal: recording timed out");
  };

  // The service notifies this hook when a process ends on its own (exit or idle reap):
  // the durable close is recorded without any caller involved.
  options.service.onClosed = (sessionId, info) => {
    void recordAndWait(
      [{
        type: "workbench.terminal.closed",
        payload: { sessionId, reason: info.message?.includes("idle timeout") ? "idle" : info.reason === "terminated" ? "terminated" : "exit", exitCode: info.exitCode, ...(info.message ? { message: info.message } : {}) },
      }],
      `terminal/${sessionId}`,
    ).catch((error: Error) => {
      console.error(`terminal: failed to record the close of ${sessionId}: ${error.message}`);
    });
  };

  return {
    id: "terminal:session",
    provides: [
      { id: "terminal.open", version: "1.0.0", semanticRef: ref("terminal.open") },
      { id: "terminal.close", version: "1.0.0", semanticRef: ref("terminal.close") },
    ],
    activate(fiber) {
      fiber.provide({ id: "terminal.open", version: "1.0.0", semanticRef: ref("terminal.open") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "terminal.open");
        const input = rawInput as { readonly workspaceId?: unknown; readonly cwd?: unknown; readonly cols?: unknown; readonly rows?: unknown };
        if (typeof input.workspaceId !== "string" || !input.workspaceId.trim()) {
          throw new Error("terminal.open: a workspaceId is required");
        }
        const workspace = await workspaceRow(input.workspaceId);
        if (!options.registry.has(workspace.executionWorldId)) {
          throw new Error("terminal.open: the workspace's execution world is not connected");
        }
        const provider = options.registry.get(workspace.executionWorldId);
        const cols = typeof input.cols === "number" && Number.isInteger(input.cols) && input.cols >= 2 && input.cols <= 500 ? input.cols : DEFAULT_COLS;
        const rows = typeof input.rows === "number" && Number.isInteger(input.rows) && input.rows >= 2 && input.rows <= 300 ? input.rows : DEFAULT_ROWS;
        // The terminal starts inside the workspace; anything else must still resolve inside it.
        const requestedCwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : workspace.root;
        const cwd = provider.fileSystem.resolve(workspace.root, requestedCwd);

        let argv: readonly string[];
        let worldFacts: unknown;
        if (provider.kind === "ssh") {
          const connection = (await options.connectionFor(workspace.executionWorldId))?.connection as
            | { readonly kind: string; readonly host?: string; readonly port?: number; readonly username?: string; readonly hostKeyFingerprint?: string; readonly auth?: { readonly kind: string; readonly privateKeyPath?: string } }
            | undefined;
          if (!connection || connection.kind !== "ssh" || !connection.hostKeyFingerprint || !connection.host || !connection.username) {
            throw new Error("terminal.open: the SSH world's connection record is missing or malformed");
          }
          const secrets = (await openSecretStore(options.home)).store;
          const password = connection.auth?.kind === "password" ? await secrets.get(`execution-world:${workspace.executionWorldId}:password`) : undefined;
          const passphrase = connection.auth?.kind === "key" ? await secrets.get(`execution-world:${workspace.executionWorldId}:passphrase`) : undefined;
          worldFacts = {
            host: connection.host,
            port: connection.port ?? 22,
            username: connection.username,
            hostKeyFingerprint: connection.hostKeyFingerprint,
            auth: connection.auth?.kind === "password"
              ? { kind: "password", password }
              : connection.auth?.kind === "key"
                ? { kind: "key", privateKeyPath: connection.auth.privateKeyPath ?? "", passphrase }
                : { kind: "agent" },
          } satisfies SshConnectionFacts;
          argv = ["bash", "-l"];
        } else if (provider.kind === "wsl") {
          argv = ["bash", "-l"];
        } else {
          argv = [process.env.SHELL?.trim() || "bash"];
        }

        const { sessionId, view } = await options.service.open({
          owner: { tenant: ctx.tenant, actorId: ctx.actor.id },
          worldId: workspace.executionWorldId,
          worldKind: provider.kind,
          workspaceId: input.workspaceId,
          workspaceLabel: workspace.title,
          cwd,
          argv,
          cols,
          rows,
          worldFacts,
        });
        await recordAndWait(
          [{
            type: "workbench.terminal.opened",
            payload: {
              sessionId,
              worldId: workspace.executionWorldId,
              worldKind: provider.kind,
              workspaceId: input.workspaceId,
              workspaceLabel: workspace.title,
              cwd,
              shell: view.shell,
              ownerActorId: ctx.actor.id,
            },
          }],
          `terminal/${sessionId}`,
        );
        return view;
      });

      fiber.provide({ id: "terminal.close", version: "1.0.0", semanticRef: ref("terminal.close") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "terminal.close");
        const input = rawInput as { readonly sessionId?: unknown };
        if (typeof input.sessionId !== "string" || !input.sessionId.trim()) {
          throw new Error("terminal.close: a sessionId is required");
        }
        const info = await options.service.terminate(input.sessionId, { tenant: ctx.tenant, actorId: ctx.actor.id });
        await recordAndWait(
          [{
            type: "workbench.terminal.closed",
            payload: { sessionId: input.sessionId, reason: "operator", exitCode: info.exitCode, ...(info.message ? { message: info.message } : {}) },
          }],
          `terminal/${input.sessionId}`,
        );
        return { closed: true, ...(info.exitCode !== null ? { exitCode: info.exitCode } : {}) };
      });
    },
  };
}

export { localTerminalPort, wslTerminalPort, sshTerminalPort };
