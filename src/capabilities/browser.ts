// J-BROWSER-session: the shared browser capabilities. Every handler is operator-only for now:
// the person drives the panel (open, navigate, screenshot, evaluate, control handoff, close);
// agents receive their browser tool set deliberately in the agent phase, through the same
// service and the same control-ownership rule (a read never conflicts; a write requires
// control). Untrusted page content flows back as data — an accessibility snapshot or an
// evaluation result is never treated as instructions.
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Json } from "@godspeedai/cognate-events";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import type { BrowserService } from "../browser/service.ts";

export interface BrowserCapabilityOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly service: BrowserService;
  /** Screenshot evidence lands here (per data home), referenced by durable events. */
  readonly evidenceDir: string;
  readonly semanticRefs: Readonly<Record<string, SemanticRef | undefined>>;
}

const operatorOnly = (ctx: HandlerContext, capability: string): void => {
  if (ctx.actor.kind !== "user" || ctx.runId) {
    throw new Error(`${capability}: only a direct human operator may ${capability}`);
  }
};

const ownerOf = (ctx: HandlerContext): { tenant: string; actorId: string } => ({ tenant: ctx.tenant, actorId: ctx.actor.id });

export function browserComponent(options: BrowserCapabilityOptions): Component {
  const service = options.getService;
  const ref = (id: string) => options.semanticRefs[id];

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
      if (run.status === "failed" || run.status === "cancelled") throw new Error(`browser: recording failed (${run.status})`);
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    throw new Error("browser: recording timed out");
  };

  return {
    id: "browser:session",
    provides: [
      { id: "browser.open", version: "1.0.0", semanticRef: ref("browser.open") },
      { id: "browser.navigate", version: "1.0.0", semanticRef: ref("browser.navigate") },
      { id: "browser.snapshot", version: "1.0.0", semanticRef: ref("browser.snapshot") },
      { id: "browser.screenshot", version: "1.0.0", semanticRef: ref("browser.screenshot") },
      { id: "browser.control", version: "1.0.0", semanticRef: ref("browser.control") },
      { id: "browser.close", version: "1.0.0", semanticRef: ref("browser.close") },
    ],
    activate(fiber) {
      fiber.provide({ id: "browser.open", version: "1.0.0", semanticRef: ref("browser.open") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "browser.open");
        const input = rawInput as { readonly url?: unknown; readonly workspaceId?: unknown };
        if (input.url !== undefined && (typeof input.url !== "string" || !/^https?:\/\//.test(input.url))) {
          throw new Error("browser.open: url must be an http(s) URL when given");
        }
        const view = await options.service.open({
          owner: ownerOf(ctx),
          ...(typeof input.url === "string" ? { url: input.url } : {}),
          ...(typeof input.workspaceId === "string" ? { workspaceId: input.workspaceId } : {}),
        });
        await recordAndWait(
          [{
            type: "workbench.browser.opened",
            payload: { sessionId: view.sessionId, providerId: view.providerId, ...(view.url ? { url: view.url } : {}), ...(view.title ? { title: view.title } : {}), ...(view.workspaceId ? { workspaceId: view.workspaceId } : {}) },
          }],
          `browser/${view.sessionId}`,
        );
        return view;
      });

      fiber.provide({ id: "browser.navigate", version: "1.0.0", semanticRef: ref("browser.navigate") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "browser.navigate");
        const input = rawInput as { readonly sessionId?: unknown; readonly url?: unknown };
        if (typeof input.sessionId !== "string" || typeof input.url !== "string") {
          throw new Error("browser.navigate: sessionId and url are required");
        }
        const view = await options.service.navigate(input.sessionId, "human", input.url);
        await recordAndWait(
          [{
            type: "workbench.browser.navigated",
            payload: { sessionId: view.sessionId, url: view.url ?? input.url, ...(view.title ? { title: view.title } : {}) },
          }],
          `browser/${view.sessionId}`,
        );
        return view;
      });

      fiber.provide({ id: "browser.snapshot", version: "1.0.0", semanticRef: ref("browser.snapshot") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "browser.snapshot");
        const input = rawInput as { readonly sessionId?: unknown };
        if (typeof input.sessionId !== "string") throw new Error("browser.snapshot: a sessionId is required");
        return options.service.snapshot(input.sessionId);
      });

      fiber.provide({ id: "browser.screenshot", version: "1.0.0", semanticRef: ref("browser.screenshot") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "browser.screenshot");
        const input = rawInput as { readonly sessionId?: unknown };
        if (typeof input.sessionId !== "string") throw new Error("browser.screenshot: a sessionId is required");
        const view = options.service.list(ownerOf(ctx)).find(entry => entry.sessionId === input.sessionId);
        await mkdir(options.evidenceDir, { recursive: true });
        const path = join(options.evidenceDir, `${input.sessionId}-${Date.now()}.png`);
        await options.service.screenshot(input.sessionId, path);
        await recordAndWait(
          [{
            type: "workbench.browser.screenshot",
            payload: { sessionId: input.sessionId, path, ...(view?.url ? { url: view.url } : {}) },
          }],
          `browser/${input.sessionId}`,
        );
        return { path };
      });

      fiber.provide({ id: "browser.control", version: "1.0.0", semanticRef: ref("browser.control") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "browser.control");
        const input = rawInput as { readonly sessionId?: unknown; readonly controller?: unknown };
        if (typeof input.sessionId !== "string" || (input.controller !== "human" && input.controller !== "agent")) {
          throw new Error("browser.control: sessionId and controller ('human' | 'agent') are required");
        }
        const view = options.service.setController(input.sessionId, input.controller, ctx.actor.id);
        await recordAndWait(
          [{
            type: "workbench.browser.control.changed",
            payload: { sessionId: view.sessionId, controller: view.controller, actorId: ctx.actor.id },
          }],
          `browser/${view.sessionId}`,
        );
        return view;
      });

      fiber.provide({ id: "browser.close", version: "1.0.0", semanticRef: ref("browser.close") }, async (rawInput, ctx) => {
        operatorOnly(ctx, "browser.close");
        const input = rawInput as { readonly sessionId?: unknown };
        if (typeof input.sessionId !== "string") throw new Error("browser.close: a sessionId is required");
        await options.service.close(input.sessionId);
        await recordAndWait(
          [{
            type: "workbench.browser.closed",
            payload: { sessionId: input.sessionId, reason: "operator" },
          }],
          `browser/${input.sessionId}`,
        );
        return { closed: true };
      });
    },
  };
}
