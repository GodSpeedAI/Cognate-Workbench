// `workspace.path`: resolves a `workspaceId` to the workspace's execution-world reference and its
// provider-owned root, via the `workspaces` projection. `agent.coding`'s tool loop needs both to
// scope every `tool.<name>` / `filesystem.*` / `process.exec` call to the right world
// (`ctx.invoke("workspace.path", ...)`, so the lookup is itself recorded/replayable). `root` is
// opaque above the execution-world boundary — an OS path locally, a POSIX path for SSH.
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";

export interface WorkspacePathInput {
  readonly workspaceId: string;
}
export interface WorkspacePathResult {
  readonly root: string;
  readonly executionWorldId: string;
  readonly title: string;
}

export function workspacePathComponent(getService: () => RuntimeService, semanticRef?: SemanticRef): Component {
  return {
    id: "workspace:path",
    provides: [{ id: "workspace.path", version: "1.0.0", semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "workspace.path", version: "1.0.0", semanticRef }, async (rawInput, ctx): Promise<WorkspacePathResult> => {
        const input = rawInput as WorkspacePathInput;
        const service = getService();
        const caller = { actor: ctx.actor, tenant: ctx.tenant ?? "local" };
        const rows = ((await service.readProjection(caller, { name: "workspaces" }))).rows;
        const row = rows.find((r) => r.key === `record/${input.workspaceId}`);
        if (!row) throw new Error(`workspace.path: unknown workspaceId ${input.workspaceId}`);
        const value = row.value as { readonly root: string; readonly executionWorldId: string; readonly title: string };
        return { root: value.root, executionWorldId: value.executionWorldId, title: value.title };
      });
    },
  };
}
