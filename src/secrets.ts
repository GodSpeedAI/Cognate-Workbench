// Secret storage for API keys and remote-world passwords. Two backends behind one `SecretStore`:
//
//  - native: the operating system's secret store through `Bun.secrets` (macOS Keychain, Linux Secret
//    Service / libsecret, Windows Credential Manager). Service is "Cognate Workbench"; each entry's
//    account name is `${scope}/${key}` where `scope` is the first 12 hex digits of the sha256 of the
//    resolved data-home path, so two data homes on one machine never read or overwrite each other's keys.
//  - file: `<home>/secrets.json`, mode 0600 (owner-only permissions; NOT encrypted). Used when the
//    native store is unavailable or forced with COGNATE_SECRET_STORE=file.
//
// Read only by server-side code that needs to build a live provider (never by an agent's `run()`,
// never returned to a client, never logged, never placed in an event payload or a projection).
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface SecretStore {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  delete(key: string): Promise<void>;
}

export function secretStore(path: string): SecretStore {
  async function readAll(): Promise<Record<string, string>> {
    try {
      const text = await readFile(path, "utf8");
      return JSON.parse(text) as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async function writeAll(secrets: Record<string, string>): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(path, 0o600);
  }

  return {
    async put(key, value) {
      const secrets = await readAll();
      secrets[key] = value;
      await writeAll(secrets);
    },
    async get(key) {
      const secrets = await readAll();
      return secrets[key];
    },
    async delete(key) {
      const secrets = await readAll();
      delete secrets[key];
      await writeAll(secrets);
    },
  };
}

// ---- native backend ----

export const SECRET_SERVICE = "Cognate Workbench";

/** The slice of `Bun.secrets` this module uses; injectable for tests. */
export interface NativeSecretBackend {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
}

/** Short, stable identifier of a data home: first 12 hex digits of sha256(resolved path). */
export function secretScope(home: string): string {
  return createHash("sha256").update(resolve(home)).digest("hex").slice(0, 12);
}

export function nativeSecretStore(options: { readonly service?: string; readonly scope: string; readonly backend?: NativeSecretBackend }): SecretStore {
  const service = options.service ?? SECRET_SERVICE;
  const backend = options.backend ?? (Bun.secrets as NativeSecretBackend);
  const name = (key: string) => `${options.scope}/${key}`;
  return {
    async put(key, value) {
      // Bun treats an empty value as a delete; keep put/get symmetric by doing that explicitly.
      if (value === "") {
        await backend.delete({ service, name: name(key) });
        return;
      }
      await backend.set({ service, name: name(key), value });
    },
    async get(key) {
      return (await backend.get({ service, name: name(key) })) ?? undefined;
    },
    async delete(key) {
      await backend.delete({ service, name: name(key) });
    },
  };
}

// ---- backend selection ----

export type SecretBackendKind = "keychain" | "credential-manager" | "secret-service" | "file";

export interface OpenedSecretStore {
  readonly store: SecretStore;
  readonly backend: SecretBackendKind;
  /** Why the file backend is in use (absent when the native store was selected without incident). */
  readonly reason?: string;
  /** One line describing a file-to-native migration, when one ran. */
  readonly migration?: SecretMigrationResult;
}

export interface OpenSecretStoreOptions {
  readonly backend?: NativeSecretBackend;
  readonly platform?: NodeJS.Platform;
  readonly probeTimeoutMs?: number;
  readonly log?: (line: string) => void;
}

export function nativeBackendKind(platform: NodeJS.Platform): SecretBackendKind | undefined {
  if (platform === "darwin") return "keychain";
  if (platform === "win32") return "credential-manager";
  if (platform === "linux") return "secret-service";
  return undefined;
}

const NATIVE_LABEL: Readonly<Record<SecretBackendKind, string>> = {
  keychain: "macOS Keychain",
  "credential-manager": "Windows Credential Manager",
  "secret-service": "Secret Service (libsecret)",
  file: "Protected file (owner-only permissions)",
};
export const secretBackendLabel = (kind: SecretBackendKind): string => NATIVE_LABEL[kind];

function unavailableReason(platform: NodeJS.Platform, detail: string): string {
  const where =
    platform === "linux" ? "no usable Secret Service on this Linux session (start and unlock GNOME Keyring or KWallet)"
    : platform === "darwin" ? "the macOS Keychain is locked or unavailable"
    : platform === "win32" ? "Windows Credential Manager is unavailable for this account"
    : `no native secret store on ${platform}`;
  return `${where}: ${detail}`;
}

/** set -> get -> delete of a random entry. Resolves to a failure detail, or undefined when the store works. */
async function probeNative(backend: NativeSecretBackend, timeoutMs: number): Promise<string | undefined> {
  const name = `probe/${randomBytes(8).toString("hex")}`;
  const value = randomBytes(16).toString("hex");
  const run = (async (): Promise<string | undefined> => {
    try {
      await backend.set({ service: SECRET_SERVICE, name, value });
      const back = await backend.get({ service: SECRET_SERVICE, name });
      await backend.delete({ service: SECRET_SERVICE, name }).catch(() => false);
      return back === value ? undefined : "probe read-back did not match";
    } catch (error) {
      return error instanceof Error ? error.message.split("\n")[0]! : "probe failed";
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((done) => {
    timer = setTimeout(() => done(`probe timed out after ${timeoutMs} ms`), timeoutMs);
  });
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// The probe is per process and per backend object: starting several servers in one process (tests,
// embedding) must not pay a possible timeout each time.
const probeCache = new WeakMap<object, Promise<string | undefined>>();

/**
 * The single place the backend is chosen. `COGNATE_SECRET_STORE=file|native` forces one (`native`
 * with an unavailable store is an error: the operator asked for it). Otherwise native when the probe
 * succeeds, else the file with the reason. Never throws because a keychain is locked or missing.
 */
export async function openSecretStore(home: string, env: Readonly<Record<string, string | undefined>> = process.env, options: OpenSecretStoreOptions = {}): Promise<OpenedSecretStore> {
  const platform = options.platform ?? process.platform;
  const filePath = join(home, "secrets.json");
  const fileResult = (reason: string): OpenedSecretStore => ({ store: secretStore(filePath), backend: "file", reason });
  const forced = env.COGNATE_SECRET_STORE?.trim().toLowerCase();
  if (forced !== undefined && forced !== "" && forced !== "native" && forced !== "file") {
    throw new Error(`COGNATE_SECRET_STORE must be 'native' or 'file' (got '${forced}')`);
  }
  if (forced === "file") return fileResult("COGNATE_SECRET_STORE=file");

  const kind = nativeBackendKind(platform);
  const backend = options.backend ?? (typeof Bun !== "undefined" ? (Bun.secrets as NativeSecretBackend | undefined) : undefined);
  let failure: string | undefined;
  if (!kind || !backend) failure = unavailableReason(platform, "this runtime has no native secret API");
  else {
    let probed = probeCache.get(backend);
    if (!probed) {
      probed = probeNative(backend, options.probeTimeoutMs ?? 3000);
      probeCache.set(backend, probed);
    }
    const detail = await probed;
    if (detail !== undefined) failure = unavailableReason(platform, detail);
  }
  if (failure !== undefined || !kind || !backend) {
    if (forced === "native") throw new Error(`COGNATE_SECRET_STORE=native but the native secret store is unavailable: ${failure}`);
    return fileResult(failure ?? "native secret store unavailable");
  }

  const store = nativeSecretStore({ scope: secretScope(home), backend });
  let migration: SecretMigrationResult | undefined;
  try {
    migration = await migrateFileSecrets({ filePath, target: store });
  } catch (error) {
    // Keep the file; the keys remain readable only if we stay on the file backend, so fall back.
    if (forced === "native") throw error;
    return fileResult(`migration to the native store failed (${error instanceof Error ? error.message : "error"}); keys stay in the protected file`);
  }
  if (migration.migrated > 0) (options.log ?? ((line) => console.log(line)))(`secrets: moved ${migration.migrated} key(s) from secrets.json to ${NATIVE_LABEL[kind]}`);
  return { store, backend: kind, ...(migration.migrated > 0 ? { migration } : {}) };
}

// ---- migration ----

export interface SecretMigrationResult {
  readonly migrated: number;
  readonly fileRemoved: boolean;
}

/**
 * Copies every entry of the secrets file into `target`, reads each back to verify, and only then
 * overwrites the file with random bytes of the same length and unlinks it. Any mismatch or error
 * aborts with the file untouched, so a crash or retry at any point is safe (puts are idempotent).
 */
export async function migrateFileSecrets(options: { readonly filePath: string; readonly target: SecretStore }): Promise<SecretMigrationResult> {
  let text: string;
  try {
    text = await readFile(options.filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { migrated: 0, fileRemoved: false };
    throw error;
  }
  let entries: Record<string, unknown>;
  try {
    entries = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("secrets.json is not valid JSON; leaving it in place");
  }
  const keys = Object.keys(entries);
  for (const key of keys) {
    const value = entries[key];
    if (typeof value !== "string") throw new Error(`secrets.json entry '${key}' is not a string; leaving the file in place`);
  }
  for (const key of keys) {
    const value = entries[key] as string;
    await options.target.put(key, value);
    if ((await options.target.get(key)) !== value) {
      throw new Error(`native store read-back mismatch for '${key}'; secrets.json kept`);
    }
  }
  const size = (await stat(options.filePath)).size;
  await writeFile(options.filePath, randomBytes(size), { mode: 0o600 });
  await unlink(options.filePath);
  return { migrated: keys.length, fileRemoved: true };
}

/** Reports the backend `openSecretStore` would pick, without opening the home or migrating anything. */
export async function describeSecretBackend(home: string, env: Readonly<Record<string, string | undefined>> = process.env, options: OpenSecretStoreOptions = {}): Promise<{ readonly backend: SecretBackendKind; readonly label: string; readonly reason?: string }> {
  const scratch = join(home, ".doctor-no-migrate");
  // A distinct non-existent directory has no secrets.json, so selection runs without migrating.
  const opened = await openSecretStore(scratch, env, options);
  return { backend: opened.backend, label: secretBackendLabel(opened.backend), ...(opened.reason ? { reason: opened.reason } : {}) };
}
