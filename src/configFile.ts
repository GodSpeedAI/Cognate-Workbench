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

/** The durable settings keys the configuration file carries and `config.file.apply` may change. */
export const EDITABLE_SETTING_KEYS = ["workDetails", "permission", "language", "appearance", "fontSize", "performanceDetail", "codingTools", "sendBehavior", "preset", "plugins", "shortcuts"] as const;

/** Top-level fields that describe the install; edits to them are ignored, never applied. */
export const READ_ONLY_CONFIG_KEYS = ["$schema", "note", "home", "environment"] as const;

/** JSON with object keys sorted recursively, so equal settings always serialise identically. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (typeof v === "object" && v !== null) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

/** Optimistic-concurrency token for the editable settings: sha256 of their canonical JSON. */
export function settingsVersion(settings: Readonly<Record<string, unknown>>): string {
  return new Bun.CryptoHasher("sha256").update(canonicalJson(settings)).digest("hex");
}

/**
 * Describes where `text` stops being valid JSON, as "line L, column C: reason". Returns
 * `undefined` when the text parses. Engines differ in whether their own message carries a
 * position, so this walks the grammar itself; it is only called on the error path.
 */
export function describeJsonError(text: string): string | undefined {
  try {
    JSON.parse(text);
    return undefined;
  } catch {
    // fall through to locate the fault
  }
  let i = 0;
  class Fault extends Error {
    constructor(readonly at: number, reason: string) { super(reason); }
  }
  const ws = () => { while (i < text.length && " \t\r\n".includes(text[i]!)) i++; };
  const expect = (ch: string) => {
    if (text[i] !== ch) throw new Fault(i, i >= text.length ? `unexpected end of input, expected '${ch}'` : `unexpected '${text[i]}', expected '${ch}'`);
    i++;
  };
  const string = () => {
    expect('"');
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\n") throw new Fault(i, "unterminated string");
      i += text[i] === "\\" ? 2 : 1;
    }
    if (i >= text.length) throw new Fault(i, "unterminated string");
    i++;
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++; ws();
      if (text[i] === "}") { i++; return; }
      for (;;) {
        ws();
        if (text[i] !== '"') throw new Fault(i, i >= text.length ? "unexpected end of input, expected a property name" : `unexpected '${text[i]}', expected a quoted property name`);
        string(); ws(); expect(":"); value(); ws();
        if (text[i] === ",") { i++; continue; }
        expect("}"); return;
      }
    }
    if (c === "[") {
      i++; ws();
      if (text[i] === "]") { i++; return; }
      for (;;) {
        value(); ws();
        if (text[i] === ",") { i++; continue; }
        expect("]"); return;
      }
    }
    if (c === '"') return string();
    const lit = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (lit) { i += lit[0].length; return; }
    throw new Fault(i, i >= text.length ? "unexpected end of input, expected a value" : `unexpected '${text[i]}', expected a value`);
  };
  let at = 0;
  let reason = "invalid JSON";
  try {
    value(); ws();
    if (i < text.length) throw new Fault(i, `unexpected '${text[i]}' after the end of the document`);
  } catch (e) {
    if (e instanceof Fault) { at = e.at; reason = e.message; }
  }
  const upTo = text.slice(0, at);
  const line = upTo.split("\n").length;
  const column = at - (upTo.lastIndexOf("\n") + 1) + 1;
  return `line ${line}, column ${column}: ${reason}`;
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
  const KEYS = EDITABLE_SETTING_KEYS;
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
