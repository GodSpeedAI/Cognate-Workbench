// Pure configuration-file logic (T11, J-CFG-config-path): which environment variables this app
// recognises, which of them may carry a secret, how a durable settings row becomes a file the
// operator can actually edit, and where such a file belongs. No filesystem access here — the
// capability resolves existence and paths — so the redaction and export rules are unit-testable
// (test/workbench-config-file.test.ts).
//
// The governing boundary: a browser cannot open a file manager or an editor, and this app's server
// must not hand a client anything secret. So "open the configuration" is realised as: report the
// real locations, and produce a real, non-secret configuration file the operator can save and edit.

/** Every environment variable `src/` reads, in a stable order. */
export const RECOGNIZED_ENV_VARS: readonly string[] = [
  "COGNATE_WORKBENCH_HOME",
  "COGNATE_HARNESS_HOME",
  "COGNATE_POSTGRES_URL",
  "COGNATE_PG",
  "MODEL_RETRY_BACKOFF_MS",
  "PORT",
  "SXR_BIN",
];

/**
 * Variables whose *value* may carry a credential. `COGNATE_POSTGRES_URL` is the important one: a
 * postgres URL commonly embeds `user:password@`, so its value must never leave the server.
 */
const SENSITIVE_ENV_VARS = new Set(["COGNATE_POSTGRES_URL"]);

export function isSensitiveEnvVar(name: string): boolean {
  return SENSITIVE_ENV_VARS.has(name);
}

export interface EnvEntry {
  readonly name: string;
  /** `null` when unset. Redacted to a marker for sensitive variables. */
  readonly value: string | null;
  readonly sensitive: boolean;
  readonly set: boolean;
}

/** Projects `process.env` down to the recognised names, redacting sensitive values. */
export function describeEnvironment(env: Readonly<Record<string, string | undefined>>): readonly EnvEntry[] {
  return RECOGNIZED_ENV_VARS.map((name) => {
    const raw = env[name];
    const sensitive = isSensitiveEnvVar(name);
    return {
      name,
      value: raw === undefined ? null : sensitive ? "<set, hidden>" : raw,
      sensitive,
      set: raw !== undefined,
    };
  });
}

/** The conventional location for an operator-editable configuration, inside the app home. */
export function resolveConfigFilePath(home: string): string {
  return home.replace(/\/+$/, "") + "/cognate.config.json";
}

/**
 * The file this app offers for download: the durable settings row plus the recognised environment
 * variable names, with no secret values. Deliberately JSON rather than TypeScript so the operator
 * can edit it without a build step, and so nothing in it can execute.
 */
export interface ConfigExport {
  readonly $schema: string;
  readonly note: string;
  readonly home: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly environment: readonly { readonly name: string; readonly value: string | null; readonly sensitive: boolean }[];
}

export function buildConfigExport(options: {
  readonly home: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly env: readonly EnvEntry[];
}): ConfigExport {
  // Only copy the settings keys this app actually reads, so a future projection field never leaks
  // into a file the operator is told is the configuration.
  const KEYS = ["workDetails", "permission", "language", "appearance", "fontSize", "performanceDetail", "codingTools", "sendBehavior", "preset", "plugins", "shortcuts"] as const;
  const settings: Record<string, unknown> = {};
  for (const key of KEYS) {
    if (Object.hasOwn(options.settings, key)) settings[key] = options.settings[key];
  }
  return {
    $schema: "https://cognate.dev/schemas/cognate.config.json",
    note: "Non-secret configuration for Cognate Workbench. Secret values are never written here; set them with the environment variables named below.",
    home: options.home,
    settings,
    environment: options.env.map((e) => ({ name: e.name, value: e.value, sensitive: e.sensitive })),
  };
}

/** Pretty-printed export, the exact bytes the UI offers to download. */
export function renderConfigExport(exported: ConfigExport): string {
  return `${JSON.stringify(exported, null, 2)}\n`;
}
