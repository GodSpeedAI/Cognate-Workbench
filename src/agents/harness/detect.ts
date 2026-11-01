// Host-side detection of harness CLIs (J-HARNESS-detect) and the minimal child environment.
//
// Detection runs on the HOST the Workbench server runs on (PATH plus the catalog's known install
// directories), never in a workspace's execution world: an SSH or WSL workspace does not change
// what is detected here. It only reads the file system and runs `<bin> --version` / `<bin> --help`
// with a 2 s timeout. It starts no model and performs no login. Results are cached for 60 s.
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { HARNESS_CATALOG, PERMISSION_MODE_LABELS, type HarnessCatalogEntry, type HarnessPermissionMode, type HarnessProtocol } from "./catalog.ts";
import { HostProcess } from "./hostProcess.ts";

export interface HarnessHostEnv {
  /** Environment used for PATH lookup and as the source of the child allowlist. Default process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
  readonly platform?: NodeJS.Platform;
}

export interface HarnessInfo {
  readonly id: string;
  readonly label: string;
  readonly installed: boolean;
  readonly path?: string;
  readonly version?: string;
  readonly protocol: HarnessProtocol;
  readonly supportsApprovals: boolean;
  readonly permissionModes: readonly { readonly id: HarnessPermissionMode; readonly label: string; readonly description: string }[];
  readonly models?: readonly string[];
  readonly modelMechanism: HarnessCatalogEntry["modelMechanism"];
  readonly installHint: { readonly url: string; readonly command?: string };
  readonly signInHint: string;
  readonly reasonUnavailable?: string;
  readonly verification: "verified" | "unverified";
}

export interface HarnessListResult {
  readonly harnesses: readonly HarnessInfo[];
  readonly host: { readonly platform: string; readonly arch: string; readonly detectedOn: "server-host"; readonly cached: boolean };
}

/** How to launch a resolved binary: the argv prefix (a Windows npm shim becomes `node <entry.js>`). */
export interface ResolvedLaunch {
  readonly path: string;
  readonly prefix: readonly string[];
  readonly acpFlag?: string;
}

const WIN_EXTS = [".exe", ".com", ".cmd", ".bat", ""];
const CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 2000;

function isFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch { return false; }
}

export function searchDirs(entry: HarnessCatalogEntry, host: Required<Pick<HarnessHostEnv, "env" | "homeDir" | "platform">>): string[] {
  const pathVar = host.env.PATH ?? host.env.Path ?? "";
  const dirs = pathVar.split(delimiter).filter(Boolean);
  for (const dir of entry.detectDirs) dirs.push(dir.startsWith("~") ? join(host.homeDir, dir.slice(1)) : dir);
  // Common user-level install roots (npm global, bun, volta, cargo) and Homebrew/system dirs.
  for (const extra of [".local/bin", ".bun/bin", ".cargo/bin", ".volta/bin", ".npm-global/bin"]) dirs.push(join(host.homeDir, extra));
  if (host.platform === "win32") {
    if (host.env.APPDATA) dirs.push(join(host.env.APPDATA, "npm"));
    if (host.env.LOCALAPPDATA) dirs.push(join(host.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"));
  } else {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
  }
  return [...new Set(dirs)];
}

/** Parses an npm/pnpm `.cmd` shim to the JS entry it runs; the shim itself is never run via cmd.exe. */
export function resolveWindowsShim(shimPath: string): ResolvedLaunch | undefined {
  try {
    const text = readFileSync(shimPath, "utf8");
    const match = /"%(?:dp0|~dp0)%\\(node_modules\\[^"]+?\.(?:c|m)?js)"/i.exec(text) ?? /%dp0%\\(node_modules\\[^\s"]+?\.(?:c|m)?js)/i.exec(text);
    if (!match?.[1]) return undefined;
    const entryJs = join(dirname(shimPath), match[1].replaceAll("\\", "/"));
    if (!existsSync(entryJs)) return undefined;
    const node = join(dirname(shimPath), "node.exe");
    return { path: shimPath, prefix: [existsSync(node) ? node : "node", entryJs] };
  } catch { return undefined; }
}

export function resolveBinary(entry: HarnessCatalogEntry, host: Required<Pick<HarnessHostEnv, "env" | "homeDir" | "platform">>): ResolvedLaunch | undefined {
  const base = host.platform === "win32" ? entry.binaries.win32 : entry.binaries.posix;
  for (const dir of searchDirs(entry, host)) {
    for (const ext of host.platform === "win32" ? WIN_EXTS : [""]) {
      const candidate = join(dir, base + ext);
      if (!isFile(candidate, host.platform)) continue;
      if (host.platform === "win32" && /\.(cmd|bat)$/i.test(candidate)) {
        const shim = resolveWindowsShim(candidate);
        if (shim) return shim;
        continue; // a shim we cannot read is not launchable without cmd.exe, which we never use
      }
      return { path: candidate, prefix: [candidate] };
    }
  }
  return undefined;
}

/**
 * The environment a harness CLI receives. NOT `process.env`: the Workbench's own provider API keys,
 * tokens and cloud credentials must not reach a third-party CLI, so only an allowlist is copied —
 * what the CLI needs to find itself, its config and its own login (home, locale, temp, proxy and CA
 * settings, the CLI's own config-dir pointers). `COGNATE_HARNESS_ENV_PASSTHROUGH` (host config, a
 * comma-separated name list) lets the operator opt specific variables in, e.g. `ANTHROPIC_API_KEY`
 * for a CLI the operator authenticates by key.
 */
const ALLOWED_ENV = [
  "PATH", "Path", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "USER", "USERNAME", "LOGNAME", "SHELL", "TERM",
  "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "TZ",
  "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "SystemRoot", "COMSPEC", "PATHEXT", "WINDIR", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMDATA", "ProgramFiles",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  "NVM_DIR", "VOLTA_HOME", "BUN_INSTALL",
];

export function buildHarnessEnv(
  entry: HarnessCatalogEntry,
  host: HarnessHostEnv = {},
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const source = host.env ?? process.env;
  const out: Record<string, string> = {};
  const extraNames = (source.COGNATE_HARNESS_ENV_PASSTHROUGH ?? "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
  for (const name of [...ALLOWED_ENV, ...entry.ownEnv, ...extraNames]) {
    const value = source[name];
    if (typeof value === "string") out[name] = value;
  }
  for (const [name, value] of Object.entries(extra)) out[name] = value;
  return out;
}

async function probe(launch: ResolvedLaunch, args: readonly string[], env: Record<string, string>, cwd: string): Promise<{ readonly out: string; readonly ok: boolean }> {
  let proc: HostProcess;
  try { proc = HostProcess.spawn({ argv: [...launch.prefix, ...args], cwd, env }); } catch { return { out: "", ok: false }; }
  let out = "";
  let closed!: () => void;
  const drained = new Promise<void>((resolve) => { closed = resolve; });
  proc.subscribe((line) => { if (out.length < 8192) out += `${line}\n`; }, () => closed());
  // Done when stdout has been fully read (which follows the exit), or the timeout kills it.
  const finished = await Promise.race([drained.then(() => true), Bun.sleep(PROBE_TIMEOUT_MS).then(() => false)]);
  if (!finished) await proc.terminate(100);
  out += proc.stderrTail.slice(0, 4096);
  return { out, ok: finished };
}

export class HarnessDetector {
  private cache: { readonly at: number; readonly infos: readonly HarnessInfo[]; readonly launches: ReadonlyMap<string, ResolvedLaunch> } | undefined;
  private readonly host: Required<Pick<HarnessHostEnv, "env" | "homeDir" | "platform">>;

  constructor(host: HarnessHostEnv = {}) {
    this.host = { env: host.env ?? process.env, homeDir: host.homeDir ?? homedir(), platform: host.platform ?? process.platform };
  }

  get hostEnv(): HarnessHostEnv { return this.host; }

  async list(options: { readonly refresh?: boolean } = {}): Promise<HarnessListResult> {
    const now = Date.now();
    const hit = this.cache && !options.refresh && now - this.cache.at < CACHE_MS;
    if (!hit) {
      const results = await Promise.all(HARNESS_CATALOG.map((entry) => this.detectOne(entry)));
      const launches = new Map<string, ResolvedLaunch>();
      const infos: HarnessInfo[] = [];
      for (const r of results) {
        if (!r) continue;
        infos.push(r.info);
        if (r.launch) launches.set(r.info.id, r.launch);
      }
      this.cache = { at: now, infos, launches };
    }
    return { harnesses: this.cache!.infos, host: { platform: this.host.platform, arch: process.arch, detectedOn: "server-host", cached: Boolean(hit) } };
  }

  /** The launch for a detected, installed harness (detects if the cache is cold). */
  async launchFor(id: string): Promise<ResolvedLaunch | undefined> {
    await this.list();
    return this.cache!.launches.get(id);
  }

  private async detectOne(entry: HarnessCatalogEntry): Promise<{ readonly info: HarnessInfo; readonly launch?: ResolvedLaunch } | undefined> {
    const base = {
      id: entry.id,
      label: entry.label,
      protocol: entry.protocol,
      supportsApprovals: entry.supportsApprovals,
      permissionModes: entry.permissionModes.map((id) => ({ id, ...PERMISSION_MODE_LABELS[id] })),
      modelMechanism: entry.modelMechanism,
      installHint: entry.installHint,
      signInHint: entry.signInHint,
      verification: entry.verification,
    } satisfies Partial<HarnessInfo>;
    const resolved = resolveBinary(entry, this.host);
    if (!resolved) {
      // Unverified entries stay hidden until proven present.
      if (entry.verification === "unverified") return undefined;
      return { info: { ...base, installed: false, reasonUnavailable: `\`${entry.binaries[this.host.platform === "win32" ? "win32" : "posix"]}\` was not found on this machine's PATH or in its usual install folders.` } };
    }
    const env = buildHarnessEnv(entry, this.host);
    const cwd = existsSync(this.host.homeDir) ? this.host.homeDir : tmpdir();
    let launch: ResolvedLaunch = resolved;
    if (entry.verification === "unverified") {
      const help = await probe(resolved, ["--help"], env, cwd);
      const flag = entry.acpHelpFlags?.find((f) => new RegExp(`(^|[\\s,|])${f.replace(/-/g, "\\-")}(\\b|=|\\s|$)`, "m").test(help.out));
      if (!flag) return undefined;
      launch = { ...resolved, acpFlag: flag };
    }
    const v = await probe(resolved, entry.versionArgs, env, cwd);
    const version = v.ok ? v.out.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 150) : undefined;
    return { info: { ...base, installed: true, path: resolved.path, ...(version ? { version } : {}) }, launch };
  }
}
