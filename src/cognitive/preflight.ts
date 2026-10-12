// RiskPreflight: derive impact for a consequential shell operation and compose its semantic
// Surface. Nothing here is specific to one command's UI: any destructive command is described by
// (target, impact facts, recovery, authority) and rendered by the generic `preflight` block.
import { validateSurface, type Surface } from "./surface.ts";
import type { MediatorSpec, Outcome } from "./mediation.ts";

export interface Destructive { readonly program: string; readonly targets: readonly string[] }

/** `rm -r`/`rm -rf` style deletions. Anything else is not classified here (unknown != safe, but the
 *  approval gate and containment already cover other tools; this proof classifies one family). */
export function classifyDestructive(command: string): Destructive | undefined {
  const parts = command.trim().split(/\s+/);
  if (parts[0] !== "rm") return undefined;
  const flags = parts.slice(1).filter((p) => p.startsWith("-")).join("");
  if (!/[rR]/.test(flags) && !flags.includes("recursive")) return undefined;
  const targets = parts.slice(1).filter((p) => !p.startsWith("-"));
  return targets.length > 0 ? { program: "rm", targets } : undefined;
}

export interface Impact { readonly files: number; readonly uncommitted: number; readonly recovery: string }

export function composePreflight(input: { readonly caseId?: string; readonly command: string; readonly target: string; readonly impact: Impact; readonly toolCallId: string }): Surface {
  return validateSurface({
    id: `preflight:${input.toolCallId}`,
    title: "Filesystem change",
    intent: "decide",
    purpose: "A consequential operation is waiting for your decision.",
    lifetime: "until-settled",
    provenance: { source: "risk-preflight" },
    ...(input.caseId ? { relatedCase: input.caseId } : {}),
    blocks: [
      {
        type: "preflight",
        title: "FILESYSTEM CHANGE",
        target: input.target,
        command: input.command,
        impact: [
          { key: "Files", value: String(input.impact.files) },
          { key: "Uncommitted", value: String(input.impact.uncommitted) },
        ],
        recovery: input.impact.recovery,
        authority: "human-approval-required",
        actions: [{ id: "allow", label: "Allow once" }, { id: "revise", label: "Revise" }, { id: "decline", label: "Decline" }],
      },
    ],
  });
}

/** The product-tier mediator: derives impact, decides authority need, attaches the Surface. */
export function riskPreflight(derive: (command: string, targets: readonly string[]) => Promise<Impact>): MediatorSpec {
  return {
    id: "risk-preflight",
    tier: "product",
    pattern: "capability.invoke",
    async handler(_ctx, event, next) {
      const input = (event.input ?? {}) as { command?: string; tool?: string; toolCallId?: string; caseId?: string };
      const out: Outcome = await next(event);
      const destructive = typeof input.command === "string" && input.tool === "bash" ? classifyDestructive(input.command) : undefined;
      // Presentation only: it never asserts authority itself. If a lower-trust mod waived the
      // requirement, this mediator sees nothing to present — Sentinel's trusted subchain catches that.
      if (!out.ok || !destructive || (out.value as { approvalRequired?: boolean }).approvalRequired !== true) return out;
      const impact = await derive(input.command!, destructive.targets);
      const surface = composePreflight({ command: input.command!, target: destructive.targets.join(" "), impact, toolCallId: input.toolCallId ?? "call", ...(input.caseId ? { caseId: input.caseId } : {}) });
      return { ok: true, value: { ...(out.value as object), surface, impact } };
    },
  };
}
