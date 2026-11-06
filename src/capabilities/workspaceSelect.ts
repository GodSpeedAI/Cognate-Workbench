// `workspace.select`: validates the chosen root in the selected execution world, derives a stable
// workspace id from (world, root), then starts `agent.config` to durably record `workspace.added` +
// `workspace.selected` (new workspace) or just `workspace.selected` (already known).
//
// The root is canonicalized and validated by the world's provider, not by this handler — so a
// remote root is a POSIX path the provider owns, and an unknown/unreachable world fails the select
// rather than silently falling back to the local machine.
import { createHash, randomUUID } from "node:crypto";
import type { ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";

export interface WorkspaceSelectInput {
  readonly path: string;
  /** Which execution world owns this root. Defaults to `local` (existing behaviour). */
  readonly worldId?: string;
}

/** Stable workspace identity: the same root in two different worlds is two different workspaces. */
export function workspaceIdFor(worldId: string, root: string): string {
  return createHash("sha256").update(`${worldId}\u0000${root}`).digest("hex").slice(0, 16);
}

function titleFor(root: string, worldId: string): string {
  return root.split("/").filter(Boolean).pop() ?? worldId;
}

export function workspaceSelectComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly getKnownWorkspaceIds: () => ReadonlySet<string>;
  /** Synchronously note a validated workspace id the moment it is selected — the projection fold
   *  is asynchronous, so this keeps "does this workspace exist?" answerable without a race for
   *  capabilities invoked immediately after a select (J-SESSION-draft's session.create). */
  readonly noteKnownWorkspace?: (workspaceId: string) => void;
  /** The execution worlds this app can place a workspace in. */
  readonly registry: ExecutionWorldRegistry;
  readonly semanticRef?: SemanticRef;
}): Component {
  return {
    id: "workspace:select",
    provides: [{ id: "workspace.select", version: "1.0.0", semanticRef: options.semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "workspace.select", version: "1.0.0", semanticRef: options.semanticRef }, async (rawInput) => {
        const input = rawInput as WorkspaceSelectInput;
        if (!input.path) throw new Error("workspace.select: path is required");
        const worldId = input.worldId ?? "local";
        // Unknown world -> WorldUnavailableError. There is no local fallback.
        const provider = options.registry.get(worldId);
        const root = provider.fileSystem.resolve(input.path, ".");
        const stat = await provider.fileSystem.stat(root);
        if (!stat || stat.kind !== "directory") throw new Error(`workspace.select: not a directory in world ${worldId}: ${root}`);
        const workspaceId = workspaceIdFor(worldId, root);
        // Order matters: decide "add vs reselect" from the set BEFORE noting the id, or every
        // select would look like a reselect and never record `workspace.added`.
        const isNew = !options.getKnownWorkspaceIds().has(workspaceId);
        options.noteKnownWorkspace?.(workspaceId);
        const service = options.getService();
        await service.startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: isNew
            ? { kind: "workspace.added", workspaceId, root, title: titleFor(root, worldId), executionWorldId: worldId }
            : { kind: "workspace.selected", workspaceId },
          idempotencyKey: randomUUID(),
        });
        return { ok: true, workspaceId, root, executionWorldId: worldId };
      });
    },
  };
}
