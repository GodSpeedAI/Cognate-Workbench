// Connect Horizon (Settings action). The operator, from their own signed-in window, mints a
// long-lived session for Horizon. The server writes the token to <setup root>/secrets/workbench.key
// (mode 0600; the setup root is the parent of COGNATE_WORKBENCH_HOME) and a companion
// workbench.key.json {sessionId, expiresAt} that holds no secret. The token is NEVER returned to the
// browser: the reply is {sessionId, expiresAt} only. Same rules as identity.session.issue: a direct
// human operator only (an agent run is refused), the operator identity only, at most 90 days.
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { ensureIdentity, issueSession } from "../auth/identity.ts";

export const CONNECT_HORIZON_MAX_HOURS = 24 * 90;
export const CONNECT_HORIZON_DEFAULT_HOURS = 24 * 90;
export const KEY_FILE = "workbench.key";

export interface ConnectHorizonOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly operatorTenant: string;
  readonly operatorActorId: string;
  /** Where the key files go: `<dirname(COGNATE_WORKBENCH_HOME)>/secrets`. */
  readonly secretsDir: string;
  readonly semanticRef?: SemanticRef;
}

/** Writes `path` with mode 0600 from the first byte, replacing any earlier file atomically. */
function writePrivate(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function connectHorizonComponent(options: ConnectHorizonOptions): Component {
  const capability = { id: "identity.connectHorizon", version: "1.0.0", semanticRef: options.semanticRef };
  return {
    id: "identity:connect-horizon",
    provides: [capability],
    activate(fiber) {
      fiber.provide(capability, async (rawInput, ctx) => {
        if (ctx.actor?.kind !== "user" || ctx.runId) throw new Error(`${capability.id}: only a direct human operator may connect Horizon`);
        if (ctx.tenant !== options.operatorTenant || ctx.actor.id !== options.operatorActorId) throw new Error(`${capability.id}: connecting Horizon belongs to the operator identity only`);
        const input = (rawInput ?? {}) as { readonly ttlHours?: unknown };
        if (typeof input !== "object" || Object.keys(input).some((key) => key !== "ttlHours")) throw new Error(`${capability.id}: accepts ttlHours only`);
        const ttlHours = input.ttlHours === undefined ? CONNECT_HORIZON_DEFAULT_HOURS : input.ttlHours;
        if (typeof ttlHours !== "number" || !Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > CONNECT_HORIZON_MAX_HOURS) {
          throw new Error(`${capability.id}: ttlHours must be between 1 and ${CONNECT_HORIZON_MAX_HOURS} (90 days)`);
        }
        const service = options.getService();
        const identity = await ensureIdentity(service, options.systemCaller, { tenant: options.operatorTenant, actorId: options.operatorActorId, label: "horizon" });
        const issued = await issueSession(service, options.systemCaller, { identityId: identity.id, ttlMs: Math.round(ttlHours * 3_600_000), cause: "horizon" });
        mkdirSync(options.secretsDir, { recursive: true });
        // Companion first: if the key write fails there is no key that the companion could misdescribe.
        writePrivate(join(options.secretsDir, `${KEY_FILE}.json`), `${JSON.stringify({ sessionId: issued.session.sid, expiresAt: issued.session.expiresAt })}\n`);
        writePrivate(join(options.secretsDir, KEY_FILE), `${issued.token}\n`);
        return { sessionId: issued.session.sid, expiresAt: issued.session.expiresAt };
      });
    },
  };
}
