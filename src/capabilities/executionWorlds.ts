// Remote Workspaces (T4): connecting, checking and disconnecting execution worlds at runtime.
//
//   execution.world.probe       read a server's host key and STOP (nothing authenticated or sent)
//   execution.wsl.list          the WSL distributions on this machine
//   execution.world.connect     register an SSH/WSL world after verifying it can actually be used
//   execution.world.check       is this world reachable right now (reconnects lazily)
//   execution.world.disconnect  release it, delete its secrets, record the fact
//
// Trust is a human act: `connect` requires the host-key fingerprint the human confirmed, and the
// provider refuses any other key. Secrets (passwords, key passphrases) live only in the 0600 secret
// store; events, projections and metadata carry safe facts. Providers are rebuilt from the durable
// records at boot, connecting lazily on first use; nothing ever falls back to local execution.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExecutionWorldProvider, ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import { probeHostKey, sshExecutionWorld } from "@godspeedai/cognate-execution-ssh";
import { wslExecutionWorld } from "@godspeedai/cognate-execution-wsl";
import type { Json } from "@godspeedai/cognate-events";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import type { WorldRecord } from "../projections/executionWorlds.ts";
import type { SecretStore } from "../secrets.ts";

export type WorldConnection =
  | { readonly kind: "ssh"; readonly host: string; readonly port: number; readonly username: string; readonly auth: { readonly kind: "password" } | { readonly kind: "key"; readonly privateKeyPath: string; readonly passphrase?: true } | { readonly kind: "agent" }; readonly hostKeyFingerprint: string }
  | { readonly kind: "wsl"; readonly distro: string; readonly user?: string };

export interface ConnectInput {
  readonly kind: "ssh" | "wsl";
  readonly label?: string;
  readonly ssh?: {
    readonly host: string; readonly port?: number; readonly username: string;
    readonly auth: { readonly kind: "password"; readonly password: string } | { readonly kind: "key"; readonly privateKeyPath: string; readonly passphrase?: string } | { readonly kind: "agent" };
    /** The fingerprint the human confirmed (from `execution.world.probe`). Required. */
    readonly hostKeyFingerprint: string;
  };
  readonly wsl?: { readonly distro: string; readonly user?: string };
}

const secretKey = (worldId: string, name: "password" | "passphrase") => `execution-world:${worldId}:${name}`;
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;
const HOST = /^[A-Za-z0-9._:-]+$/;
const SAFE_NAME = /^[A-Za-z0-9._ -]{1,64}$/;

function need(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`execution.world: ${message}`);
}

/** Validate untrusted capability input into a connection descriptor + the secrets to store. */
export function parseConnect(input: ConnectInput): { readonly connection: WorldConnection; readonly secrets: Partial<Record<"password" | "passphrase", string>>; readonly label: string } {
  if (input.kind === "wsl") {
    const w = input.wsl;
    need(w && typeof w.distro === "string" && SAFE_NAME.test(w.distro), "a WSL distribution name is required");
    need(w.user === undefined || (typeof w.user === "string" && /^[a-z_][a-z0-9_-]{0,31}$/.test(w.user)), "invalid WSL user");
    return { connection: { kind: "wsl", distro: w.distro, ...(w.user ? { user: w.user } : {}) }, secrets: {}, label: input.label?.trim() || `WSL: ${w.distro}` };
  }
  need(input.kind === "ssh", "kind must be ssh or wsl");
  const s = input.ssh;
  need(s, "ssh settings are required");
  need(typeof s.host === "string" && HOST.test(s.host), "a valid host is required");
  need(typeof s.username === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(s.username), "a valid username is required");
  const port = s.port ?? 22;
  need(Number.isInteger(port) && port > 0 && port < 65536, "invalid port");
  need(typeof s.hostKeyFingerprint === "string" && FINGERPRINT.test(s.hostKeyFingerprint), "the confirmed host-key fingerprint (SHA256:…) is required");
  const label = input.label?.trim() || `${s.username}@${s.host}${port === 22 ? "" : `:${port}`}`;
  const base = { kind: "ssh" as const, host: s.host, port, username: s.username, hostKeyFingerprint: s.hostKeyFingerprint };
  switch (s.auth.kind) {
    case "password":
      need(typeof s.auth.password === "string" && s.auth.password.length > 0, "a password is required");
      return { connection: { ...base, auth: { kind: "password" } }, secrets: { password: s.auth.password }, label };
    case "key":
      need(typeof s.auth.privateKeyPath === "string" && s.auth.privateKeyPath.length > 0, "a private key path is required");
      return { connection: { ...base, auth: { kind: "key", privateKeyPath: s.auth.privateKeyPath, ...(s.auth.passphrase ? { passphrase: true as const } : {}) } }, secrets: s.auth.passphrase ? { passphrase: s.auth.passphrase } : {}, label };
    case "agent":
      return { connection: { ...base, auth: { kind: "agent" } }, secrets: {}, label };
    default:
      throw new Error("execution.world: auth kind must be password, key or agent");
  }
}

export class CredentialsMissingError extends Error {
  override readonly name = "CredentialsMissingError";
}

/** Build a live provider from a durable descriptor + the secret store. Never reads anything else. */
export async function buildProvider(worldId: string, connection: WorldConnection, secrets: SecretStore): Promise<ExecutionWorldProvider> {
  if (connection.kind === "wsl") return wslExecutionWorld({ worldId, distro: connection.distro, ...(connection.user ? { user: connection.user } : {}) });
  const auth = connection.auth;
  const base = { worldId, host: connection.host, port: connection.port, username: connection.username, hostKeys: { fingerprints: [connection.hostKeyFingerprint] } };
  if (auth.kind === "password") {
    const password = await secrets.get(secretKey(worldId, "password"));
    if (!password) throw new CredentialsMissingError(`the saved password for ${worldId} is missing; reconnect the world`);
    return sshExecutionWorld({ ...base, auth: { kind: "password", password } });
  }
  if (auth.kind === "key") {
    const passphrase = auth.passphrase ? await secrets.get(secretKey(worldId, "passphrase")) : undefined;
    if (auth.passphrase && !passphrase) throw new CredentialsMissingError(`the saved key passphrase for ${worldId} is missing; reconnect the world`);
    return sshExecutionWorld({ ...base, auth: { kind: "key", privateKeyPath: auth.privateKeyPath, ...(passphrase ? { passphrase } : {}) } });
  }
  return sshExecutionWorld({ ...base, auth: { kind: "agent" } });
}

/** Decode `wsl.exe` list output (UTF-16LE on Windows interop). */
export function parseWslList(raw: Uint8Array): { readonly name: string; readonly isDefault: boolean }[] {
  // wsl.exe writes UTF-16LE (every other byte is NUL); some builds/pipes give UTF-8.
  const utf16 = raw.includes(0);
  const text = new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(raw).replace(/\0/g, "").replace(/^\uFEFF/, "");
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => ({ name: l.replace(/\s*\(.*\)\s*$/, ""), isDefault: /\(.*default.*\)/i.test(l) })).filter((d) => d.name.length > 0);
}

export interface ExecutionWorldsOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly registry: ExecutionWorldRegistry;
  readonly secrets: SecretStore;
  readonly knownHostsPath?: string;
  readonly wslBin?: string;
  readonly semanticRefs?: { readonly connect?: SemanticRef; readonly disconnect?: SemanticRef; readonly probe?: SemanticRef; readonly check?: SemanticRef };
}

const MAX_WORLD_FAIL = new Map<string, string>();

/** Why a restored world is not usable (credentials missing, …). Cleared when it is rebuilt. */
export const unavailableReason = (worldId: string): string | undefined => MAX_WORLD_FAIL.get(worldId);

/** Re-register every durable world at boot (lazy: no connection is opened here). */
export async function restoreExecutionWorlds(options: Pick<ExecutionWorldsOptions, "getService" | "systemCaller" | "registry" | "secrets">): Promise<void> {
  const rows = (await options.getService().readProjection(options.systemCaller, { name: "execution-worlds" })).rows;
  for (const row of rows) {
    if (!row.key.startsWith("record/")) continue;
    const record = row.value as unknown as WorldRecord;
    if (options.registry.has(record.worldId)) continue;
    try {
      options.registry.register(await buildProvider(record.worldId, record.connection as unknown as WorldConnection, options.secrets));
      MAX_WORLD_FAIL.delete(record.worldId);
    } catch (e) {
      MAX_WORLD_FAIL.set(record.worldId, e instanceof Error ? e.message : String(e));
    }
  }
}

export function executionWorldsManageComponent(options: ExecutionWorldsOptions): Component {
  const ref = (name: keyof NonNullable<ExecutionWorldsOptions["semanticRefs"]>) => options.semanticRefs?.[name];
  const contract = (id: string, name: keyof NonNullable<ExecutionWorldsOptions["semanticRefs"]>) => ({ id, version: "1.0.0", semanticRef: ref(name) });
  const knownHostsPath = options.knownHostsPath ?? join(homedir(), ".ssh", "known_hosts");

  async function record(input: Record<string, unknown>): Promise<void> {
    const service = options.getService();
    const { runId } = await service.startRun(options.systemCaller, { agent: AGENT_CONFIG, input: input as unknown as Json, idempotencyKey: randomUUID() });
    for (let i = 0; i < 400; i++) {
      const run = await service.getRun(options.systemCaller, { runId });
      if (run.status === "completed") return;
      if (run.status === "failed" || run.status === "cancelled") throw new Error(`execution.world: recording failed (${run.status})`);
      await new Promise((r) => setTimeout(r, 15));
    }
    throw new Error("execution.world: recording timed out");
  }

  const home = async (provider: ExecutionWorldProvider): Promise<string> => {
    const r = await provider.process.exec({ argv: ["sh", "-c", 'printf %s "$HOME"'], cwd: "/", timeoutMs: 20_000 });
    if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `the world did not run a command (exit ${r.exitCode})`);
    return r.stdout.trim() || "/";
  };

  const probe = contract("execution.world.probe", "probe");
  const wslList = contract("execution.wsl.list", "probe");
  const connect = contract("execution.world.connect", "connect");
  const check = contract("execution.world.check", "check");
  const disconnect = contract("execution.world.disconnect", "disconnect");

  return {
    id: "execution:world-manage",
    provides: [probe, wslList, connect, check, disconnect],
    activate(fiber) {
      fiber.provide(probe, async (raw) => {
        const i = raw as { host: string; port?: number };
        need(typeof i.host === "string" && HOST.test(i.host), "a valid host is required");
        const known = await readFile(knownHostsPath, "utf8").catch(() => "");
        const p = await probeHostKey({ host: i.host, port: i.port ?? 22, knownHosts: known });
        return { fingerprint: p.fingerprint, keyType: p.keyType, known: p.known ?? "unknown", knownHostsPath: "~/.ssh/known_hosts" };
      });

      fiber.provide(wslList, async () => {
        // `wsl.exe` can stall or fail intermittently at the Windows level, so every call is bounded and
        // retried; "not responding" is reported differently from "not installed", with wsl.exe's own message.
        let notFound = false; // the binary itself could not be started
        let lastDetail = "";
        const run = async (args: string[], timeoutMs: number): Promise<Uint8Array | undefined> => {
          let proc: ReturnType<typeof Bun.spawn>;
          try { proc = Bun.spawn([options.wslBin ?? "wsl.exe", ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" }); } catch { notFound = true; return undefined; }
          const timer = setTimeout(() => proc.kill(), timeoutMs);
          try {
            const [out, err] = await Promise.all([new Response(proc.stdout as ReadableStream<Uint8Array>).arrayBuffer(), new Response(proc.stderr as ReadableStream<Uint8Array>).arrayBuffer()]);
            const code = await proc.exited;
            if (code === 0) return new Uint8Array(out);
            lastDetail = `${args.join(" ")} exited ${code}: ${new TextDecoder(Buffer.from(err).includes(0) ? "utf-16le" : "utf-8").decode(err).replace(/\0/g, "").trim().slice(0, 200)}`;
            return undefined;
          } finally { clearTimeout(timer); }
        };
        for (let attempt = 1; attempt <= 3 && !notFound; attempt++) {
          const quiet = await run(["-l", "-q"], 30_000); // a cold WSL service can take a while to answer
          if (quiet === undefined) { await new Promise((r) => setTimeout(r, 1500)); continue; } // failed or stalled: try again
          const distros = parseWslList(quiet);
          const verbose = await run(["-l"], 10_000);
          const text = verbose ? new TextDecoder("utf-8").decode(verbose).replace(/\0/g, "") : "";
          const def = /^\s*(.+?)\s*\(.*default.*\)/im.exec(text)?.[1]?.trim();
          return { available: distros.length > 0, distros: distros.map((d) => ({ name: d.name, isDefault: d.name === def || d.isDefault })) };
        }
        return notFound
          ? { available: false, distros: [], reason: "not-installed" }
          : { available: false, distros: [], reason: "not-responding", detail: lastDetail };
      });

      fiber.provide(connect, async (raw) => {
        const parsed = parseConnect(raw as ConnectInput);
        const worldId = parsed.connection.kind === "wsl"
          ? `wsl-${createHash("sha256").update(`${parsed.connection.distro}\0${parsed.connection.user ?? ""}`).digest("hex").slice(0, 8)}`
          : `ssh-${createHash("sha256").update(`${parsed.connection.host}\0${parsed.connection.port}\0${parsed.connection.username}`).digest("hex").slice(0, 8)}`;
        if (options.registry.has(worldId)) await options.registry.unregister(worldId);
        for (const name of ["password", "passphrase"] as const) {
          const value = parsed.secrets[name];
          if (value) await options.secrets.put(secretKey(worldId, name), value); else await options.secrets.delete(secretKey(worldId, name));
        }
        let provider: ExecutionWorldProvider | undefined;
        try {
          provider = await buildProvider(worldId, parsed.connection, options.secrets);
          const homeDir = await home(provider); // proves the world is usable BEFORE it is recorded
          options.registry.register(provider);
          MAX_WORLD_FAIL.delete(worldId);
          await record({ kind: "execution.world.connected", worldId, worldKind: parsed.connection.kind, label: parsed.label, metadata: provider.metadata, connection: parsed.connection as unknown as Json });
          return { worldId, label: parsed.label, kind: parsed.connection.kind, metadata: provider.metadata as unknown as Json, home: homeDir };
        } catch (e) {
          await provider?.dispose().catch(() => {});
          for (const name of ["password", "passphrase"] as const) await options.secrets.delete(secretKey(worldId, name)).catch(() => {});
          throw e;
        }
      });

      fiber.provide(check, async (raw) => {
        const { worldId } = raw as { worldId: string };
        if (!options.registry.has(worldId)) return { ok: false, error: unavailableReason(worldId) ?? "this world is not connected" };
        try {
          return { ok: true, home: await home(options.registry.get(worldId)) };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      });

      fiber.provide(disconnect, async (raw) => {
        const { worldId } = raw as { worldId: string };
        need(typeof worldId === "string" && worldId !== "local", "cannot disconnect the local world");
        const service = options.getService();
        const rows = (await service.readProjection(options.systemCaller, { name: "workspaces" })).rows;
        const using = rows.filter((r) => r.key.startsWith("record/") && (r.value as { executionWorldId?: string }).executionWorldId === worldId).length;
        need(using === 0, `${using} workspace(s) still use this world; remove them first`);
        await options.registry.unregister(worldId);
        for (const name of ["password", "passphrase"] as const) await options.secrets.delete(secretKey(worldId, name));
        MAX_WORLD_FAIL.delete(worldId);
        await record({ kind: "execution.world.disconnected", worldId });
        return { ok: true };
      });
    },
  };
}
