// `config.path` (T11, J-CFG-config-path): resolves where this app's configuration lives and hands
// the operator a real, non-secret configuration to edit.
//
// The browser/server filesystem boundary is respected by construction: this capability never reads
// `secrets.json`, never returns a sensitive environment variable's value, and never opens a handle.
// It reports the home directory, whether the conventional config file is present, the current
// durable settings reduced to the keys this app reads, and the recognised environment variables with
// sensitive values redacted. The UI turns that into a downloadable file, which is what makes "open
// the configuration" a working action rather than a path in a modal.
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { resolveGeneralSettings } from "../settings.ts";
import { buildConfigExport, describeEnvironment, renderConfigExport, resolveConfigFilePath, type EnvEntry } from "../configFile.ts";

export interface ConfigPathResult {
  readonly ok: true;
  readonly home: string;
  readonly configFile: string;
  readonly configFileExists: boolean;
  /** The resolved durable settings, reduced to the keys this app reads. Never includes secrets. */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly environment: readonly EnvEntry[];
  /** Exact bytes of the configuration file the UI offers to download. */
  readonly export: string;
}

export function configPathComponent(options: {
  readonly home: string;
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly semanticRef: SemanticRef | undefined;
}): Component {
  const contract = { id: "config.path", version: "1.0.0", semanticRef: options.semanticRef };
  return {
    id: "config:path",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (): Promise<ConfigPathResult> => {
        const configFile = resolveConfigFilePath(options.home);
        let configFileExists = false;
        try {
          await access(configFile, constants.R_OK);
          configFileExists = true;
        } catch {
          configFileExists = false;
        }
        const rows = (await options.getService().readProjection(options.systemCaller, { name: "settings" })).rows;
        // `readProjection` returns tenant-relative keys ("current"), so match both forms.
        const current = rows.find((r) => r.key === "current" || r.key.endsWith("/current"))?.value;
        const resolved = resolveGeneralSettings(current) as unknown as Record<string, unknown>;
        const env = describeEnvironment(process.env);
        return {
          ok: true,
          home: options.home,
          configFile,
          configFileExists,
          settings: resolved,
          environment: env,
          export: renderConfigExport(buildConfigExport({ home: options.home, settings: resolved, env })),
        };
      });
    },
  };
}
