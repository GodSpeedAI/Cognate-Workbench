// J-PREVIEW-register: the governed preview capabilities. Registration is agent-invocable —
// an agent that legitimately started a dev server through governed execution registers it, and
// the Workbench answers whether the port is actually reachable. Stopping follows ownership:
// an agent may stop only a preview its own run registered; the operator may stop any. The
// durable record is workbench.preview.* metadata folded into the workbench projection.
import { randomUUID } from "node:crypto";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Json } from "@godspeedai/cognate-events";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { openSecretStore } from "../secrets.ts";
import type { SshConnectionFacts } from "../terminal/ssh.ts";
import type { PreviewService } from "../preview/service.ts";

export interface PreviewCapabilityOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly service: PreviewService;
  /** World records for the preview's execution world (same projection the terminal reads). */
  readonly connectionFor: (worldId: string) => Promise<{ readonly connection: Json } | undefined>;
  readonly worldKindFor: (worldId: string) => "local" | "ssh" | "wsl" | undefined;
  /** The data home — the secret store lives here (SSH credentials). */
  readonly home: string;
  readonly semanticRefs: Readonly<Record<string, SemanticRef | undefined>>;
}

export function previewComponent(options: PreviewCapabilityOptions): Component {
  const ref = (id: string) => options.semanticRefs[id];

  const recordAndWait = async (events: readonly { readonly type: string; readonly payload: Json }[], correlationId: string): Promise<void> => {
    const { runId } = await options.getService().startRun(options.systemCaller, {
      agent: AGENT_CONFIG,
      input: { kind: "workbench.recorded", events: JSON.parse(JSON.stringify(events)) as Json },
      idempotencyKey: randomUUID(),
      correlationId,
    });
    for (let attempt = 0; attempt < 400; attempt++) {
      const run = await options.getService().getRun(options.systemCaller, { runId });
      if (run.status === "completed") return;
      if (run.status === "failed" || run.status === "cancelled") throw new Error(`preview: recording failed (${run.status})`);
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error("preview: recording timed out");
  };

  /** The SSH world's connection facts — the terminal's exact recipe, reused verbatim. */
  const sshFactsFor = async (worldId: string): Promise<SshConnectionFacts> => {
    const connection = (await options.connectionFor(worldId))?.connection as
      | { readonly kind: string; readonly host?: string; readonly port?: number; readonly username?: string; readonly hostKeyFingerprint?: string; readonly auth?: { readonly kind: string; readonly privateKeyPath?: string } }
      | undefined;
    if (!connection || connection.kind !== "ssh" || !connection.hostKeyFingerprint || !connection.host || !connection.username) {
      throw new Error("preview.register: the SSH world's connection record is missing or malformed");
    }
    const secrets = (await openSecretStore(options.home)).store;
    const password = connection.auth?.kind === "password" ? await secrets.get(`execution-world:${worldId}:password`) : undefined;
    const passphrase = connection.auth?.kind === "key" ? await secrets.get(`execution-world:${worldId}:passphrase`) : undefined;
    return {
      host: connection.host,
      port: connection.port ?? 22,
      username: connection.username,
      hostKeyFingerprint: connection.hostKeyFingerprint,
      auth: connection.auth?.kind === "password"
        ? { kind: "password", password }
        : connection.auth?.kind === "key"
          ? { kind: "key", privateKeyPath: connection.auth.privateKeyPath ?? "", passphrase }
          : { kind: "agent" },
    };
  };

  return {
    id: "preview:register",
    provides: [
      { id: "preview.register", version: "1.0.0", semanticRef: ref("preview.register") },
      { id: "preview.stop", version: "1.0.0", semanticRef: ref("preview.stop") },
    ],
    activate(fiber) {
      fiber.provide({ id: "preview.register", version: "1.0.0", semanticRef: ref("preview.register") }, async (rawInput, ctx: HandlerContext) => {
        const input = rawInput as {
          readonly url?: unknown;
          readonly worldId?: unknown;
          readonly workspaceId?: unknown;
          readonly ownerSessionId?: unknown;
          readonly ownerTaskId?: unknown;
          readonly pid?: unknown;
        };
        if (typeof input.url !== "string" || !/^https?:\/\//.test(input.url)) {
          throw new Error("preview.register: an http(s) url is required");
        }
        const worldId = typeof input.worldId === "string" && input.worldId ? input.worldId : "local";
        const worldKind = options.worldKindFor(worldId);
        if (!worldKind) throw new Error(`preview.register: the execution world ${worldId} is not connected`);
        const view = await options.service.register({
          worldId,
          worldKind,
          originUrl: input.url,
          ...(typeof input.workspaceId === "string" ? { workspaceId: input.workspaceId } : {}),
          ...(typeof input.ownerSessionId === "string" ? { ownerSessionId: input.ownerSessionId } : {}),
          ...(typeof input.ownerTaskId === "string" ? { ownerTaskId: input.ownerTaskId } : {}),
          ...(ctx.runId ? { ownerRunId: ctx.runId } : {}),
          ...(typeof input.pid === "number" && Number.isInteger(input.pid) && input.pid > 0 ? { pid: input.pid } : {}),
          ...(worldKind === "ssh" ? { worldFacts: await sshFactsFor(worldId) } : {}),
        });
        await recordAndWait(
          [{
            type: "workbench.preview.registered",
            payload: {
              previewId: view.previewId,
              worldId: view.worldId,
              worldKind: view.worldKind,
              viewUrl: view.viewUrl,
              originUrl: view.originUrl,
              ...(view.workspaceId ? { workspaceId: view.workspaceId } : {}),
              ...(view.ownerSessionId ? { ownerSessionId: view.ownerSessionId } : {}),
              ...(view.ownerTaskId ? { ownerTaskId: view.ownerTaskId } : {}),
              ...(view.ownerRunId ? { ownerRunId: view.ownerRunId } : {}),
              ...(view.pid ? { pid: view.pid } : {}),
            },
          }],
          `preview/${view.previewId}`,
        );
        return view;
      });

      fiber.provide({ id: "preview.stop", version: "1.0.0", semanticRef: ref("preview.stop") }, async (rawInput, ctx: HandlerContext) => {
        const input = rawInput as { readonly previewId?: unknown };
        if (typeof input.previewId !== "string") throw new Error("preview.stop: a previewId is required");
        // An agent run may stop only what its own run registered; the operator may stop any.
        if (ctx.runId && !options.service.mayStopByRun(input.previewId, ctx.runId)) {
          throw new Error("preview.stop: this preview was registered by another run — ask the operator");
        }
        // The service's injected recorder folds the durable stop event for every path.
        const view = await options.service.stop(input.previewId, ctx.runId ? "agent" : "operator");
        return view;
      });
    },
  };
}
