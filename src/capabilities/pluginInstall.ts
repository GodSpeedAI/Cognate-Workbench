// `plugin.install` / `plugin.uninstall` (T11, J-PLG-install): installs and removes plugins from the
// durable record. Same shape as `session.setArchived`: validate, then start a deterministic
// `agent.config` run whose `plugin.installed` / `plugin.uninstalled` event the `plugins` projection
// folds — the event log owns installation state, not component memory.
//
// Two outcomes, both honest. A catalog entry whose implementation verifies records itself active.
// An entry that cannot be verified records itself inert — present, visible, and reported in plain
// words, never rendered as a working switch. Refusals (unknown id, core infrastructure, already
// installed) record nothing and return the reason for display.
import { randomUUID } from "node:crypto";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import type { PluginRegistry } from "../components/pluginRegistry.ts";
import { pluginViews, type PluginRecord, type PluginView } from "../plugins.ts";

export interface PluginInstallResult {
  readonly ok: boolean;
  readonly pluginId?: string;
  readonly activated?: boolean;
  readonly message: string;
}

/** What `plugin.catalog` returns: the server-authoritative merged catalog with each entry's status
 *  already resolved against the durable install records. Read-only — records no event. */
export interface PluginCatalogResult {
  readonly ok: true;
  readonly views: readonly PluginView[];
  readonly records: readonly PluginRecord[];
  readonly installable: readonly string[];
  readonly sources: readonly string[];
}

export function pluginInstallComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly plugins: PluginRegistry;
  readonly installSemanticRef: SemanticRef | undefined;
  readonly uninstallSemanticRef: SemanticRef | undefined;
  /** T11: `plugin.catalog` shares the Plugin entity anchor with install/uninstall. */
  readonly catalogSemanticRef?: SemanticRef | undefined;
}): Component {
  const installContract = { id: "plugin.install", version: "1.0.0", semanticRef: options.installSemanticRef };
  const uninstallContract = { id: "plugin.uninstall", version: "1.0.0", semanticRef: options.uninstallSemanticRef };
  const catalogContract = { id: "plugin.catalog", version: "1.0.0", semanticRef: options.catalogSemanticRef ?? options.installSemanticRef };

  return {
    id: "plugin:install",
    provides: [installContract, uninstallContract, catalogContract],
    activate(fiber) {
      fiber.provide(catalogContract, async (): Promise<PluginCatalogResult> => {
        const rows = (await options.getService().readProjection(options.systemCaller, { name: "plugins" })).rows;
        // `readProjection` returns tenant-relative keys ("record/<id>").
        const records: PluginRecord[] = rows
          .map((r) => r.value as { readonly pluginId?: unknown; readonly installedAt?: unknown; readonly implementation?: unknown } | undefined)
          .filter((v): v is NonNullable<typeof v> => typeof v?.pluginId === "string")
          .map((v) => ({
            pluginId: v.pluginId as string,
            installedAt: typeof v.installedAt === "string" ? v.installedAt : "",
            ...(typeof v.implementation === "string" ? { implementation: v.implementation } : {}),
          }));
        const catalog = options.plugins.catalog();
        return {
          ok: true,
          views: pluginViews(records, catalog),
          records,
          installable: catalog.filter((e) => e.lifecycle === "optional").map((e) => e.id),
          sources: options.plugins.sourceIds,
        };
      });

      fiber.provide(installContract, async (rawInput) => {
        const input = rawInput as { readonly pluginId?: unknown };
        if (typeof input.pluginId !== "string" || input.pluginId.trim().length === 0) {
          throw new Error("plugin.install: a non-empty pluginId is required");
        }
        const rows = (await options.getService().readProjection(options.systemCaller, { name: "plugins" })).rows;
        const installedIds = rows.map((r) => r.key.split("/").pop() ?? "").filter((id) => id.length > 0);
        const planned = options.plugins.planInstall(input.pluginId, installedIds);
        if ("refused" in planned) {
          // A refusal is not an error the operator did wrong; it is a fact about the request, so it
          // returns a structured result rather than throwing.
          return { ok: false as const, message: planned.refused };
        }
        await options.getService().startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: {
            kind: "plugin.installed",
            pluginId: planned.pluginId,
            implementation: planned.activated ? "active" : "inert",
          },
          idempotencyKey: randomUUID(),
        });
        return {
          ok: true as const,
          pluginId: planned.pluginId,
          activated: planned.activated,
          message: planned.activated ? planned.reason : `Installed, but inert. ${planned.reason}`,
        };
      });

      fiber.provide(uninstallContract, async (rawInput) => {
        const input = rawInput as { readonly pluginId?: unknown };
        if (typeof input.pluginId !== "string" || input.pluginId.trim().length === 0) {
          throw new Error("plugin.uninstall: a non-empty pluginId is required");
        }
        const rows = (await options.getService().readProjection(options.systemCaller, { name: "plugins" })).rows;
        // `readProjection` returns tenant-relative keys, so the row is "record/<id>".
        if (!rows.some((r) => r.key === `record/${input.pluginId}` || r.key.endsWith(`/record/${input.pluginId}`))) {
          const entry = options.plugins.entry(input.pluginId);
          return { ok: false as const, message: entry ? `${entry.name} is not installed.` : `${input.pluginId} is not in this deployment's catalog.` };
        }
        await options.getService().startRun(options.systemCaller, {
          agent: AGENT_CONFIG,
          input: { kind: "plugin.uninstalled", pluginId: input.pluginId },
          idempotencyKey: randomUUID(),
        });
        return { ok: true as const, pluginId: input.pluginId, message: "Removed." };
      });
    },
  };
}
