// `agent.config`: deterministic. All side effects (secret write, provider hot-swap, path
// validation) happen in the `model.configure` / `workspace.select` capability handlers *before*
// this run is started (those handlers call `RuntimeService.startRun`, which is not recorded as an
// event itself, then this run durably records the resulting domain event). The run body only emits
// — no I/O, no randomness, replay-safe by construction.
import type { AgentDefinition } from "@godspeedai/cognate-runtime-api";
import type { Json } from "@godspeedai/cognate-events";
import type { SettingsPatch } from "../settings.ts";
import { WORKBENCH_EVENTS } from "../workbench/types.ts";

export type AgentConfigInput =
  | { readonly kind: "model.configured"; readonly providerId: string; readonly baseURL: string; readonly protocol: "openai-compatible" | "openai-completions" | "openai-responses" | "anthropic-messages"; readonly model: string }
  /** `root` is provider-owned and opaque above the execution-world boundary; `executionWorldId`
   *  names where that root lives (see `@godspeedai/cognate-execution`). */
  | { readonly kind: "workspace.added"; readonly workspaceId: string; readonly root: string; readonly title: string; readonly executionWorldId: string }
  /** One replay-safe typed configuration run records the preflighted world and workspace. */
  | { readonly kind: "workspace.contained.added"; readonly requestId: string; readonly workspaceId: string; readonly root: string; readonly title: string; readonly executionWorldId: string; readonly worldLabel: string; readonly worldMetadata: Readonly<Record<string, string>>; readonly connection: Json }
  | { readonly kind: "workspace.selected"; readonly workspaceId: string }
  /** Usage pass U3: the sidebar's per-workspace Rename action (reference-behavior-matrix.md §12). */
  | { readonly kind: "workspace.renamed"; readonly workspaceId: string; readonly title: string }
  /** Usage pass U3: the sidebar's Delete workspace action — removes the record (and a current
   *  pointer to it); the workspace's sessions' events stay in history. */
  | { readonly kind: "workspace.deleted"; readonly workspaceId: string }
  /** T11 (J-CFG-provider-delete): removes a provider configuration. The handler removes the stored
   *  secret *before* this run records the deletion, so a secret is never orphaned by a crash. */
  | { readonly kind: "provider.deleted"; readonly providerId: string }
  /** T11 (J-PLG-install): durable plugin registration. `implementation` names what the catalog entry
   *  declares it can drive; a catalog entry with no implementation installs inert and the UI says so
   *  rather than pretending it runs. */
  | { readonly kind: "plugin.installed"; readonly pluginId: string; readonly implementation?: string }
  | { readonly kind: "plugin.uninstalled"; readonly pluginId: string }
  /** T11 (J-SESSION-archive): reversible, durable archiving of a conversation. The flag only changes
   *  sidebar visibility; no turn, run or event is ever deleted. */
  | { readonly kind: "session.archived"; readonly sessionId: string; readonly archived: boolean }
  /** A remote execution world (SSH host / WSL distribution) the operator connected. `connection` and
   *  `metadata` carry only safe facts (host, user, auth *kind*, key *path*, pinned host-key fingerprint) —
   *  never a password, passphrase or key material. */
  | { readonly kind: "execution.world.connected"; readonly worldId: string; readonly worldKind: string; readonly label: string; readonly metadata: Readonly<Record<string, string>>; readonly connection: Json }
  | { readonly kind: "execution.world.disconnected"; readonly worldId: string }
  | { readonly kind: "onboarding.dismissed"; readonly step: "notice" | "apikey" }
  /** Workbench layer: an ordered batch of `workbench.*` events a validated capability decided to record. */
  | { readonly kind: "workbench.recorded"; readonly events: readonly { readonly type: string; readonly payload: Json }[] }
  | ({ readonly kind: "settings.changed" } & SettingsPatch);

export const AGENT_CONFIG = "agent.config";

export const agentConfigAgent: AgentDefinition = {
  id: AGENT_CONFIG,
  version: "1.0.0",
  async run(input, ctx) {
    const command = input as AgentConfigInput;
    switch (command.kind) {
      case "model.configured": {
        const { kind: _kind, ...payload } = command;
        await ctx.emit("model.configured", payload);
        return { ok: true };
      }
      case "workspace.added": {
        const { kind: _kind, ...payload } = command;
        await ctx.emit("workspace.added", payload);
        await ctx.emit("workspace.selected", { workspaceId: payload.workspaceId });
        return { ok: true };
      }
      case "workspace.contained.added": {
        const { kind: _kind, requestId: _requestId, workspaceId, root, title, executionWorldId, worldLabel, worldMetadata, connection } = command;
        await ctx.emit("execution.world.connected", {
          worldId: executionWorldId,
          worldKind: "linux-bubblewrap",
          label: worldLabel,
          metadata: worldMetadata,
          connection,
        });
        await ctx.emit("workspace.added", { workspaceId, root, title, executionWorldId });
        await ctx.emit("workspace.selected", { workspaceId });
        return { ok: true };
      }
      case "workspace.selected": {
        const { kind: _kind, ...payload } = command;
        await ctx.emit("workspace.selected", payload);
        return { ok: true };
      }
      case "workspace.renamed": {
        const { kind: _kind, ...payload } = command;
        await ctx.emit("workspace.renamed", payload);
        return { ok: true };
      }
      case "workspace.deleted": {
        const { kind: _kind, ...payload } = command;
        await ctx.emit("workspace.deleted", payload);
        return { ok: true };
      }
      case "execution.world.connected":
      case "execution.world.disconnected": {
        const { kind, ...payload } = command;
        await ctx.emit(kind, payload as unknown as Json);
        return { ok: true };
      }
      case "workbench.recorded": {
        // Only workbench events may be minted this way; the capability layer already validated them.
        for (const event of command.events) {
          if (!(WORKBENCH_EVENTS as readonly string[]).includes(event.type)) throw new Error(`agent.config: ${event.type} is not a workbench event`);
          await ctx.emit(event.type, event.payload);
        }
        return { ok: true };
      }
      case "onboarding.dismissed": {
        const { kind: _kind, ...payload } = command;
        await ctx.emit("onboarding.dismissed", payload);
        return { ok: true };
      }
      case "provider.deleted": {
        const { kind: _kind, ...payload } = command;
        await ctx.emit("provider.deleted", payload);
        return { ok: true };
      }
      case "plugin.installed":
      case "plugin.uninstalled": {
        const { kind, ...payload } = command;
        await ctx.emit(kind, payload as unknown as Json);
        return { ok: true };
      }
      case "session.archived": {
        const { kind: _kind, ...payload } = command;
        await ctx.emit("session.archived", payload);
        return { ok: true };
      }
      case "settings.changed": {
        const { kind: _kind, ...payload } = command;
        await ctx.emit("settings.changed", payload);
        return { ok: true };
      }
      default: {
        const exhaustive: never = command;
        throw new Error(`agent.config: unknown command ${JSON.stringify(exhaustive)}`);
      }
    }
  },
};
