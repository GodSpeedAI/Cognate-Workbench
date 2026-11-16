// Data-driven catalog of external agent-harness CLIs (J-HARNESS-detect / J-HARNESS-session).
//
// Modelled on the design of PandaCode's provider registry (protocol family per CLI, per-platform
// binary names, extra search directories, version probe, permission-mode mapping, resume and model
// flags). Only argv/event shapes were taken as a reference; no code was copied. Every entry is
// either `verified` (its argv is read from the donor source or confirmed locally) or `unverified`
// (argv taken from the CLI's published conventions, never trusted: such an entry stays hidden unless
// the binary is installed AND its own `--help` prints the ACP flag we would pass).
//
// Not included (no adapter here): pi / omp (a different `--mode rpc` protocol), muse, antigravity,
// deepseek `dsh`, and the `glm` / `mimo` variants (they are the `claude` binary with a vendor
// endpoint and credentials, which this app deliberately does not inject).

export type HarnessProtocol = "claude-stream-json" | "codex-app-server" | "acp";

/** The shared permission vocabulary shown to the operator; each protocol maps it to the CLI's own. */
export type HarnessPermissionMode = "ask" | "auto" | "review" | "plan" | "full";

export const PERMISSION_MODE_LABELS: Readonly<Record<HarnessPermissionMode, { readonly label: string; readonly description: string }>> = {
  ask: { label: "Standard", description: "The CLI asks before edits and commands; each request is shown here." },
  auto: { label: "Accept edits", description: "File edits inside the workspace are accepted; other requests ask." },
  review: { label: "Auto review", description: "The CLI's own safety reviewer decides routine requests." },
  plan: { label: "Plan mode", description: "Read-only investigation; no edits or commands that change state." },
  full: { label: "Full access", description: "The CLI runs without asking. It acts as your account with no Workbench approval." },
};

export interface HarnessLaunchContext {
  readonly mode: HarnessPermissionMode;
  readonly model?: string;
  readonly resumeId?: string;
  readonly instructions?: string;
  /** For catalog entries whose ACP flag is resolved from `--help` (unverified entries). */
  readonly acpFlag?: string;
}

export interface HarnessCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly protocol: HarnessProtocol;
  /** Executable base names (no extension) per platform; Windows tries .exe .com .cmd .bat. */
  readonly binaries: { readonly posix: string; readonly win32: string };
  /** Extra directories searched after PATH; `~` is the home directory. */
  readonly detectDirs: readonly string[];
  readonly versionArgs: readonly string[];
  readonly verification: "verified" | "unverified";
  /** Unverified entries: candidate ACP flags; one must appear in `--help` or the entry stays hidden. */
  readonly acpHelpFlags?: readonly string[];
  readonly supportsApprovals: boolean;
  readonly permissionModes: readonly HarnessPermissionMode[];
  /** How the model is chosen, shown to the UI so it can offer a free-text model field. */
  readonly modelMechanism: "flag" | "protocol" | "env" | "none";
  readonly resumeMechanism: "flag" | "protocol" | "none";
  readonly installHint: { readonly url: string; readonly command?: string };
  readonly signInHint: string;
  /** Environment variables this CLI reads for its OWN config location (never secrets). */
  readonly ownEnv: readonly string[];
  /** Case-insensitive patterns in stderr/error text that mean "not signed in". */
  readonly authPatterns: readonly RegExp[];
  buildArgv(ctx: HarnessLaunchContext): readonly string[];
  /** Extra environment for the spawned process (e.g. a per-mode inline config). */
  buildEnv?(ctx: HarnessLaunchContext): Readonly<Record<string, string>>;
}

const COMMON_AUTH = [/not (signed|logged) in/i, /please (run|log ?in|sign ?in)/i, /authentication (is )?required/i, /requires? (sign-?in|authentication)/i, /invalid (api key|credentials)/i, /\b(login|auth) required/i, /unauthori[sz]ed/i];

const CLAUDE_MODES: Readonly<Record<HarnessPermissionMode, string>> = { ask: "default", auto: "acceptEdits", review: "auto", plan: "plan", full: "bypassPermissions" };

function opencodeConfig(mode: HarnessPermissionMode): string {
  const permission =
    mode === "full" ? { "*": "allow" }
    : mode === "auto" ? { "*": "ask", read: "allow", glob: "allow", grep: "allow", edit: "allow" }
    : mode === "plan" ? { "*": "deny", read: "allow", glob: "allow", grep: "allow", list: "allow", external_directory: "ask" }
    : { "*": "ask", read: "allow", glob: "allow", grep: "allow" };
  return JSON.stringify({ permission, agent: { build: { permission }, plan: { permission } } });
}

function acp(
  id: string,
  label: string,
  fields: Pick<HarnessCatalogEntry, "installHint" | "signInHint"> & Partial<Pick<HarnessCatalogEntry, "binaries" | "detectDirs" | "verification" | "acpHelpFlags" | "permissionModes" | "modelMechanism" | "resumeMechanism" | "ownEnv" | "buildEnv">> & { readonly argv: (ctx: HarnessLaunchContext) => readonly string[] },
): HarnessCatalogEntry {
  return {
    id,
    label,
    protocol: "acp",
    binaries: fields.binaries ?? { posix: id, win32: id },
    detectDirs: fields.detectDirs ?? [],
    versionArgs: ["--version"],
    verification: fields.verification ?? "verified",
    ...(fields.acpHelpFlags ? { acpHelpFlags: fields.acpHelpFlags } : {}),
    supportsApprovals: true,
    permissionModes: fields.permissionModes ?? ["ask", "plan"],
    modelMechanism: fields.modelMechanism ?? "protocol",
    resumeMechanism: fields.resumeMechanism ?? "protocol",
    installHint: fields.installHint,
    signInHint: fields.signInHint,
    ownEnv: fields.ownEnv ?? [],
    authPatterns: COMMON_AUTH,
    buildArgv: fields.argv,
    ...(fields.buildEnv ? { buildEnv: fields.buildEnv } : {}),
  };
}

export const HARNESS_CATALOG: readonly HarnessCatalogEntry[] = [
  {
    id: "claude",
    label: "Claude Code",
    protocol: "claude-stream-json",
    binaries: { posix: "claude", win32: "claude" },
    detectDirs: ["~/.local/bin", "~/.claude/local"],
    versionArgs: ["--version"],
    verification: "verified",
    supportsApprovals: true,
    permissionModes: ["ask", "auto", "review", "plan", "full"],
    modelMechanism: "flag",
    resumeMechanism: "flag",
    installHint: { url: "https://code.claude.com/docs/en/setup" },
    signInHint: "Run `claude` once in a terminal and complete `/login`, then retry.",
    ownEnv: ["CLAUDE_CONFIG_DIR"],
    authPatterns: [...COMMON_AUTH, /\/login/i, /credit balance is too low/i],
    buildArgv: ({ mode, model, resumeId, instructions }) => [
      "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--include-partial-messages", "--verbose",
      "--permission-prompt-tool", "stdio", "--permission-mode", CLAUDE_MODES[mode],
      "--disallowedTools=ScheduleWakeup,Monitor,CronCreate",
      ...(mode === "full" ? ["--allow-dangerously-skip-permissions"] : []),
      ...(model && model !== "default" ? ["--model", model] : []),
      ...(resumeId ? [`--resume=${resumeId}`] : []),
      ...(instructions ? ["--append-system-prompt", instructions] : []),
    ],
  },
  {
    id: "codex",
    label: "Codex",
    protocol: "codex-app-server",
    binaries: { posix: "codex", win32: "codex" },
    detectDirs: ["~/.local/bin"],
    versionArgs: ["--version"],
    verification: "verified",
    supportsApprovals: true,
    permissionModes: ["ask", "auto", "plan", "full"],
    modelMechanism: "protocol",
    resumeMechanism: "protocol",
    installHint: { url: "https://developers.openai.com/codex/cli/", command: "npm i -g @openai/codex" },
    signInHint: "Run `codex login` in a terminal, then retry.",
    ownEnv: ["CODEX_HOME"],
    authPatterns: [...COMMON_AUTH, /codex login/i],
    // Per-process override; the user's Codex config is never altered.
    buildArgv: () => ["app-server"],
  },
  acp("opencode", "OpenCode", {
    detectDirs: ["~/.opencode/bin"],
    installHint: { url: "https://opencode.ai/docs/" },
    signInHint: "Run `opencode auth login` in a terminal, then retry.",
    permissionModes: ["ask", "auto", "plan", "full"],
    ownEnv: ["OPENCODE_CONFIG", "OPENCODE_CONFIG_DIR"],
    argv: () => ["acp"],
    buildEnv: ({ mode }) => ({ OPENCODE_CONFIG_CONTENT: opencodeConfig(mode) }),
  }),
  acp("kimi", "Kimi Code", {
    detectDirs: ["~/.kimi-code/bin", "~/.kimi-code/Scripts"],
    installHint: { url: "https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html" },
    signInHint: "Run `kimi` in a terminal and complete `/login`, then retry.",
    argv: ({ model }) => [...(model && model !== "default" ? ["--model", model] : []), "acp"],
    modelMechanism: "flag",
  }),
  acp("github-copilot", "GitHub Copilot CLI", {
    binaries: { posix: "copilot", win32: "copilot" },
    installHint: { url: "https://github.com/github/copilot-cli", command: "npm install -g @github/copilot" },
    signInHint: "Run `copilot login` in a terminal, then retry.",
    argv: () => ["--no-auto-update", "--acp", "--stdio"],
  }),
  acp("grok", "Grok Build", {
    detectDirs: ["~/.grok/bin"],
    installHint: { url: "https://docs.x.ai/build", command: "curl -fsSL https://x.ai/cli/install.sh | sh" },
    signInHint: "Run `grok login` in a terminal, then retry.",
    permissionModes: ["ask", "auto", "plan", "full"],
    modelMechanism: "flag",
    argv: ({ mode, model }) => [
      "--no-auto-update", "--permission-mode", mode === "full" ? "bypassPermissions" : mode === "auto" ? "acceptEdits" : "default", "agent",
      ...(mode === "full" ? ["--always-approve"] : []),
      ...(model && model !== "default" ? ["--model", model] : []),
      "stdio",
    ],
  }),
  acp("cline", "Cline", {
    detectDirs: ["~/.local/bin"],
    installHint: { url: "https://docs.cline.bot/usage/cli-overview", command: "npm i -g cline" },
    signInHint: "Run `cline auth` in a terminal, then retry.",
    permissionModes: ["ask", "plan", "full"],
    modelMechanism: "env",
    argv: ({ mode }) => ["--acp", "--auto-approve", mode === "full" ? "true" : "false"],
    buildEnv: ({ model }): Record<string, string> => {
      const env: Record<string, string> = {};
      if (model && model !== "default") env.CLINE_MODEL = model;
      return env;
    },
  }),
  acp("kilo", "Kilo Code", {
    detectDirs: ["~/.kilo/bin"],
    installHint: { url: "https://kilo.ai", command: "npm i -g @kilocode/cli" },
    signInHint: "Run `kilo auth login` in a terminal, then retry.",
    argv: () => ["acp"],
    buildEnv: ({ mode }) => {
      const policy = { "*": mode === "full" ? "allow" : "ask" };
      return { KILO_CONFIG_CONTENT: JSON.stringify({ permission: policy }) };
    },
    permissionModes: ["ask", "plan", "full"],
  }),
  acp("devin", "Devin CLI", {
    installHint: { url: "https://docs.devin.ai/cli", command: "curl -fsSL https://cli.devin.ai/install.sh | bash" },
    signInHint: "Run `devin auth login` in a terminal, then retry.",
    permissionModes: ["ask", "plan", "full"],
    argv: () => ["acp"],
  }),
  acp("commandcode", "Command Code", {
    binaries: { posix: "command-code", win32: "command-code" },
    installHint: { url: "https://commandcode.ai", command: "npm i -g command-code" },
    signInHint: "Run `command-code login` in a terminal, then retry.",
    argv: () => ["acp"],
  }),
  // Unverified: no donor adapter. Shown only if installed AND `--help` prints one of these flags.
  acp("gemini", "Gemini CLI", {
    verification: "unverified",
    acpHelpFlags: ["--acp", "--experimental-acp"],
    installHint: { url: "https://github.com/google-gemini/gemini-cli", command: "npm i -g @google/gemini-cli" },
    signInHint: "Run `gemini` once in a terminal and choose a sign-in method, then retry.",
    argv: ({ acpFlag }) => [acpFlag ?? "--experimental-acp"],
  }),
  acp("qwen", "Qwen Code", {
    verification: "unverified",
    acpHelpFlags: ["--acp", "--experimental-acp"],
    installHint: { url: "https://github.com/QwenLM/qwen-code", command: "npm i -g @qwen-code/qwen-code" },
    signInHint: "Run `qwen` once in a terminal and complete sign-in, then retry.",
    argv: ({ acpFlag }) => [acpFlag ?? "--acp"],
  }),
];

export function findHarness(id: string): HarnessCatalogEntry | undefined {
  return HARNESS_CATALOG.find((entry) => entry.id === id);
}

export function isPermissionMode(entry: HarnessCatalogEntry, value: unknown): value is HarnessPermissionMode {
  return typeof value === "string" && (entry.permissionModes as readonly string[]).includes(value);
}

/** The honest posture label for a (harness, mode) pair. */
export type HarnessPostureLabel = "harness-own-sandbox" | "harness-bridged-approvals" | "harness-uncontained";

export function postureFor(entry: HarnessCatalogEntry, mode: HarnessPermissionMode): HarnessPostureLabel {
  if (mode === "full") return "harness-uncontained";
  return entry.supportsApprovals ? "harness-bridged-approvals" : "harness-own-sandbox";
}
