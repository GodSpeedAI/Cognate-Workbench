// `config.file.read` / `config.file.apply` (J-CFG-config-edit): the Settings "configuration file"
// as something the operator can view and EDIT from the app.
//
// The durable event log stays the source of truth. The file text is a rendering of the current
// durable settings (never whatever is on disk), and an edit is applied by validating every changed
// key with the SAME guards the `settings.change*` capabilities use, then appending the same
// `settings.changed` events, and only then mirroring the new rendering to `cognate.config.json`
// (temp file + rename, mode 0600). Informational fields (`$schema`, `note`, `home`, `environment`)
// are never applied; secrets are never in the text because `buildConfigExport` redacts them.
import { chmod, mkdir, rename, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { resolveGeneralSettings } from "../settings.ts";
import {
  buildConfigExport,
  canonicalJson,
  describeEnvironment,
  describeJsonError,
  EDITABLE_SETTING_KEYS,
  READ_ONLY_CONFIG_KEYS,
  renderConfigExport,
  resolveConfigFilePath,
  settingsVersion,
} from "../configFile.ts";
import { recordSettingChange, SETTING_FIELDS, shortcutPatchProblem } from "./settingsChange.ts";

export interface ConfigFileReadResult {
  readonly ok: true;
  readonly path: string;
  readonly home: string;
  /** Whether `path` currently exists on disk (the text shown is the durable settings either way). */
  readonly exists: boolean;
  /** Exact editable text: the current durable settings rendered as the configuration file. */
  readonly text: string;
  /** Opaque token to send back as `expectedVersion` when applying an edit of this text. */
  readonly version: string;
  /** Top-level fields shown for information; edits to them are ignored on apply. */
  readonly readOnlyKeys: readonly string[];
}

export interface ConfigFileApplyInput {
  readonly text: string;
  readonly expectedVersion: string;
}

export interface ConfigFileApplyResult {
  readonly ok: true;
  /** Settings keys whose value changed and was recorded (empty for a no-op). */
  readonly applied: readonly string[];
  /** Human-readable notes on edits that were not applied (informational fields, shortcut removals). */
  readonly ignored: readonly string[];
  /** The version after this apply; use it as the next `expectedVersion`. */
  readonly version: string;
  readonly path: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function configFileComponent(options: {
  readonly home: string;
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly readSemanticRef: SemanticRef | undefined;
  readonly applySemanticRef: SemanticRef | undefined;
}): Component {
  const readContract = { id: "config.file.read", version: "1.0.0", semanticRef: options.readSemanticRef };
  const applyContract = { id: "config.file.apply", version: "1.0.0", semanticRef: options.applySemanticRef };
  const path = resolveConfigFilePath(options.home);

  async function currentSettings(): Promise<Record<string, unknown>> {
    const rows = (await options.getService().readProjection(options.systemCaller, { name: "settings" })).rows;
    const current = rows.find((r) => r.key === "current" || r.key.endsWith("/current"))?.value;
    return resolveGeneralSettings(current) as unknown as Record<string, unknown>;
  }

  function render(settings: Readonly<Record<string, unknown>>) {
    const exported = buildConfigExport({ home: options.home, settings, env: describeEnvironment(process.env) });
    return { exported, text: renderConfigExport(exported), version: settingsVersion(exported.settings) };
  }

  // Applies are serialised so two edits cannot interleave their validate/record/mirror steps.
  let queue: Promise<unknown> = Promise.resolve();

  async function apply(input: ConfigFileApplyInput): Promise<ConfigFileApplyResult> {
    if (typeof input?.text !== "string") throw new Error("config.file.apply: text must be a string containing the configuration file");
    if (typeof input.expectedVersion !== "string") throw new Error("config.file.apply: expectedVersion is required; read the file first");

    const syntax = describeJsonError(input.text);
    if (syntax !== undefined) throw new Error(`config.file.apply: the file is not valid JSON (${syntax})`);
    const parsed: unknown = JSON.parse(input.text);
    if (!isObject(parsed)) throw new Error("config.file.apply: the file must be a JSON object with a 'settings' object");

    const before = render(await currentSettings());
    if (input.expectedVersion !== before.version) {
      throw new Error("config.file.apply: conflict — the settings changed since this file was loaded. Reload the file and re-apply your edit.");
    }

    const allowedTop = new Set<string>([...READ_ONLY_CONFIG_KEYS, "settings"]);
    for (const key of Object.keys(parsed)) {
      if (!allowedTop.has(key)) throw new Error(`config.file.apply: unknown top-level key '${key}'; only 'settings' is editable`);
    }
    const edited = parsed["settings"];
    if (!isObject(edited)) throw new Error("config.file.apply: 'settings' must be a JSON object");

    const ignored: string[] = [];
    for (const key of READ_ONLY_CONFIG_KEYS) {
      if (!Object.hasOwn(parsed, key)) continue;
      if (canonicalJson(parsed[key]) !== canonicalJson((before.exported as unknown as Record<string, unknown>)[key])) {
        ignored.push(`'${key}' is informational and was not changed`);
      }
    }

    const editable = new Set<string>(EDITABLE_SETTING_KEYS);
    const current = before.exported.settings;
    // Plan every change first; nothing is recorded until all of them validate.
    const plan: { readonly field: string; readonly value: unknown; readonly merged: unknown }[] = [];
    const problems: string[] = [];
    for (const [key, value] of Object.entries(edited)) {
      if (!editable.has(key)) {
        problems.push(`unknown settings key '${key}' (editable keys: ${EDITABLE_SETTING_KEYS.join(", ")})`);
        continue;
      }
      if (key === "plugins" || key === "shortcuts") {
        // Map settings merge per key, so only the entries that differ are sent.
        if (!isObject(value)) {
          problems.push(`'${key}' must be an object`);
          continue;
        }
        const standing = isObject(current[key]) ? (current[key] as Record<string, unknown>) : {};
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          if (canonicalJson(standing[k]) !== canonicalJson(v) || !Object.hasOwn(standing, k)) patch[k] = v;
        }
        for (const k of Object.keys(standing)) {
          if (Object.hasOwn(value, k)) continue;
          if (key === "plugins") patch[k] = false;
          else ignored.push(`shortcuts.${k} was removed; a durable override cannot be deleted, set it to null to unbind it`);
        }
        if (Object.keys(patch).length === 0) continue;
        const field = SETTING_FIELDS.find((f) => f.field === key)!;
        if (key === "shortcuts") {
          const problem = shortcutPatchProblem(patch, standing);
          if (problem !== undefined) problems.push(`shortcuts: ${problem}`);
          else plan.push({ field: key, value: patch, merged: { ...standing, ...patch } });
        } else if (!field.validate(patch)) {
          problems.push(`plugins: only known toggleable plugins (${"realitytrace"}) may be set, each to true or false`);
        } else {
          plan.push({ field: key, value: patch, merged: { ...standing, ...patch } });
        }
        continue;
      }
      if (canonicalJson(current[key]) === canonicalJson(value)) continue;
      const field = SETTING_FIELDS.find((f) => f.field === key)!;
      if (!field.validate(value)) {
        problems.push(`invalid value for '${key}': ${JSON.stringify(value)}`);
      } else {
        plan.push({ field: key, value, merged: value });
      }
    }
    if (problems.length > 0) {
      throw new Error(`config.file.apply: nothing was applied. ${problems.join("; ")}`);
    }

    const service = options.getService();
    for (const step of plan) {
      await recordSettingChange(service, options.systemCaller, step.field as never, step.value);
    }

    const nextSettings: Record<string, unknown> = { ...current };
    for (const step of plan) nextSettings[step.field] = step.merged;
    const after = render(nextSettings);
    await mirror(after.text);
    return { ok: true, applied: plan.map((s) => s.field), ignored, version: after.version, path };
  }

  async function mirror(text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, text, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, path);
  }

  return {
    id: "config:file",
    provides: [readContract, applyContract],
    activate(fiber) {
      fiber.provide(readContract, async (): Promise<ConfigFileReadResult> => {
        const { text, version } = render(await currentSettings());
        const exists = await access(path, constants.R_OK).then(() => true, () => false);
        return { ok: true, path, home: options.home, exists, text, version, readOnlyKeys: READ_ONLY_CONFIG_KEYS };
      });
      fiber.provide(applyContract, (rawInput) => {
        const run = queue.then(() => apply(rawInput as ConfigFileApplyInput));
        queue = run.catch(() => undefined);
        return run;
      });
    },
  };
}
