// `workspace.rename` / `workspace.delete`: client-invoke capabilities for the sidebar's per-workspace
// actions menu (usage pass U3, reference-behavior-matrix.md §12's "Workspace actions" — Rename /
// Delete workspace). Same shape as `workspace.select` / `settings.change*`: the handler validates
// against the live `workspaces` projection and starts a deterministic `agent.config` run whose
// `workspace.renamed` / `workspace.deleted` event the projection folds — the durable event log, not
// component memory, owns the workspace list. Deleting a workspace removes its record (and, if it was
// current, the current pointer); its sessions' events stay in history untouched.
import { randomUUID } from "node:crypto";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";

export interface WorkspaceManageInput {
  readonly workspaceId: string;
  readonly title?: string;
}

export function workspaceManageComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly semanticRefs: { readonly rename: SemanticRef | undefined; readonly remove: SemanticRef | undefined };
}): Component {
  const renameContract = { id: "workspace.rename", version: "1.0.0", semanticRef: options.semanticRefs.rename };
  const deleteContract = { id: "workspace.delete", version: "1.0.0", semanticRef: options.semanticRefs.remove };
  return {
    id: "workspace:manage",
    provides: [renameContract, deleteContract],
    activate(fiber) {
      const knownWorkspaces = async () => {
        const rows = (await options.getService().readProjection(options.systemCaller, { name: "workspaces" })).rows;
        return new Set(rows.filter((r) => r.key.startsWith("record/")).map((r) => r.key.slice("record/".length)));
      };
      fiber.provide(renameContract, async (rawInput) => {
        const input = rawInput as WorkspaceManageInput;
        const title = typeof input.title === "string" ? input.title.trim() : "";
        if (!title) throw new Error("workspace.rename: a non-empty title is required");
        if (!(await knownWorkspaces()).has(input.workspaceId)) throw new Error(`workspace.rename: unknown workspace ${input.workspaceId}`);
        await options.getService().startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "workspace.renamed", workspaceId: input.workspaceId, title },
          idempotencyKey: randomUUID(),
        });
        return { ok: true };
      });
      fiber.provide(deleteContract, async (rawInput) => {
        const input = rawInput as WorkspaceManageInput;
        if (!(await knownWorkspaces()).has(input.workspaceId)) throw new Error(`workspace.delete: unknown workspace ${input.workspaceId}`);
        await options.getService().startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "workspace.deleted", workspaceId: input.workspaceId },
          idempotencyKey: randomUUID(),
        });
        return { ok: true };
      });
    },
  };
}
