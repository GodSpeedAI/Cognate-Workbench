// SEA-Forge as Workbench's external authority (readiness P02 / B-07).
//
// With `COGNATE_GOVERNANCE=sea-forge`, the Cognate runtime's Governor sends every capability invoke
// and consequential action to SEA-Forge as a CEP `authority_request`; an escalation parks the run
// until SEA-Forge records an approval. Workbench's process is the SEA-Forge gateway and speaks as
// the service actor; the operator's approve/reject goes out `on_behalf_of` the operator actor, so
// requester and approver stay distinct and SEA-Forge's self-approval refusal holds.
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import { governanceFromEnv, SeaForgeAuthority, type GovernanceOptions } from "@godspeedai/cognate-runtime-bun";

export const GOVERNANCE_STATUS = "governance.status";
export const GOVERNANCE_APPROVALS_LIST = "governance.approvals.list";
export const GOVERNANCE_APPROVAL_RESOLVE = "governance.approval.resolve";
export const ENV_OPERATOR = "COGNATE_SEA_FORGE_OPERATOR";

export interface SeaForgeActor {
  readonly actor_id: string;
  readonly role: string;
}

export interface ExternalAuthority {
  /** Passed to `createRuntime({ governance })`. */
  readonly governance: GovernanceOptions & { readonly mode: "sea-forge" };
  readonly socketPath: string;
  /** The gateway/service principal this process is bound to in SEA-Forge. */
  readonly service: SeaForgeActor;
  /** The human approver, reached only through the gateway's `on_behalf_of` delegation. */
  readonly operator: SeaForgeActor;
  readonly timeoutMs?: number;
  /** The typed gateway client (the service actor, request ids prefixed `workbench`). */
  readonly client: SeaForgeAuthority;
}

const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** `COGNATE_GOVERNANCE=sea-forge` also needs `COGNATE_SEA_FORGE_OPERATOR`; unset/off gives `undefined`. */
export function externalAuthorityFromEnv(env: Readonly<Record<string, string | undefined>>): ExternalAuthority | undefined {
  const governance = governanceFromEnv(env);
  const operatorId = env[ENV_OPERATOR]?.trim();
  if (governance.mode === "off") {
    if (operatorId) throw new Error(`${ENV_OPERATOR} is set but COGNATE_GOVERNANCE is not 'sea-forge'; refusing to guess`);
    return undefined;
  }
  if (governance.mode !== "sea-forge") throw new Error(`unsupported governance mode ${String(governance.mode)}`);
  if (!operatorId || !ACTOR_ID.test(operatorId)) throw new Error(`${ENV_OPERATOR} must name the operator actor bound in SEA-Forge when COGNATE_GOVERNANCE=sea-forge`);
  const serviceId = env.COGNATE_SEA_FORGE_ACTOR?.trim() || "cognate-service";
  if (operatorId === serviceId) throw new Error(`${ENV_OPERATOR} must differ from the service actor: a requester cannot approve its own escalation`);
  const socketPath = env.COGNATE_SEA_FORGE_SOCKET!.trim();
  const envActor = env.COGNATE_SEA_FORGE_ACTOR?.trim();
  return {
    // Poll SEA-Forge for decided escalations so an approved run resumes on its own.
    governance: { ...governance, approvalPollMs: governance.approvalPollMs ?? 2_000 } as ExternalAuthority["governance"],
    socketPath,
    service: { actor_id: serviceId, role: "service" },
    operator: { actor_id: operatorId, role: "operator" },
    client: new SeaForgeAuthority({ socketPath, requestIdPrefix: "workbench", ...(envActor ? { actor: { actor_id: envActor, role: "service" } } : {}) }),
  };
}

/** `governance.status`, `governance.approvals.list` and `governance.approval.resolve`. */
export function governanceComponent(options: {
  readonly authority: ExternalAuthority | undefined;
  /** Resume runs whose escalation is now decided (the runtime's `pollApprovals`). */
  readonly pollApprovals?: () => Promise<number>;
  readonly semanticRefs?: Readonly<Record<string, SemanticRef | undefined>>;
}): Component {
  const contract = (id: string) => ({ id, version: "1.0.0", ...(options.semanticRefs?.[id] ? { semanticRef: options.semanticRefs[id] } : {}) });
  const status = contract(GOVERNANCE_STATUS);
  const list = contract(GOVERNANCE_APPROVALS_LIST);
  const resolve = contract(GOVERNANCE_APPROVAL_RESOLVE);
  const authority = options.authority;
  const require = (): ExternalAuthority => {
    if (!authority) throw new Error("No external authority is configured (COGNATE_GOVERNANCE is off)");
    return authority;
  };
  return {
    id: "governance:sea-forge",
    provides: [status, list, resolve],
    activate(fiber) {
      fiber.provide(status, () => authority
        ? { mode: "sea-forge", worldRef: authority.governance.worldRef, operator: authority.operator.actor_id, service: authority.service.actor_id }
        : { mode: "off" });
      fiber.provide(list, async () => {
        const a = require();
        const result = await a.client.listApprovals({ timeoutMs: a.timeoutMs });
        if (!result.ok) throw new Error(`SEA-Forge refused the approval list: ${result.errorClass}: ${result.error}`);
        return { approvals: result.approvals as never };
      });
      fiber.provide(resolve, async (raw, ctx) => {
        // Only a direct human operator, outside any run, may answer an escalation: an agent must never
        // approve its own consequential action.
        if (ctx.actor.kind !== "user" || ctx.runId) throw new Error("Only a direct human operator may resolve a SEA-Forge approval");
        const a = require();
        const value = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
        const result = await a.client.resolveApproval({ approvalId: value.approvalId as string, resolution: value.resolution as "approved" | "rejected", onBehalfOf: a.operator, timeoutMs: a.timeoutMs });
        if (!result.ok) throw new Error(result.errorClass === "invalid_input" ? result.error : `SEA-Forge refused the resolution: ${result.error}`);
        await options.pollApprovals?.().catch(() => 0);
        return { approvalId: value.approvalId as string, resolution: value.resolution as string, resolvedBy: a.operator.actor_id };
      });
    },
  };
}
