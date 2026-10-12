// Shell command safety analysis. Logic ported to TypeScript from openai/codex (Apache-2.0) codex-rs/shell-command/src/command_safety/is_dangerous_command.rs @ 7aa8f51 and anomalyco/opencode (MIT) packages/opencode/src/permission/arity.ts @ 7723920. Re-implemented, not vendored; neither donor is a dependency.

/** Safe array access with empty string fallback for indexed access in noUncheckedIndexedAccess mode */
const at = (a: readonly string[], i: number): string => a[i] ?? "";

/** Tokenize a shell command into words, respecting single/double quotes and backslash escapes. */
export function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  while (i < cmd.length) {
    const ch = cmd[i]!;

    if (inSingleQuote) {
      if (ch === "'") {
        inSingleQuote = false;
        i++;
      } else {
        current += ch;
        i++;
      }
    } else if (inDoubleQuote) {
      if (ch === '"') {
        inDoubleQuote = false;
        i++;
      } else if (ch === "\\" && i + 1 < cmd.length) {
        // In double quotes, backslash escapes special chars
        const next = cmd[i + 1]!;
        if (['"', "\\", "$", "`", "\n"].includes(next)) {
          current += next;
          i += 2;
        } else {
          current += ch;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === "'") {
        inSingleQuote = true;
        i++;
      } else if (ch === '"') {
        inDoubleQuote = true;
        i++;
      } else if (ch === "\\" && i + 1 < cmd.length) {
        // Backslash escape outside quotes
        const next = cmd[i + 1]!;
        current += next;
        i += 2;
      } else if (/\s/.test(ch)) {
        // Whitespace separates tokens
        if (current) {
          tokens.push(current);
          current = "";
        }
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/** Split a command string into simple commands on &&, ||, ;, |, newline, &.
 *  Also unwraps sudo, env, nohup, time, command, xargs, and bash|sh|zsh -c|-lc "..." */
export function splitCommands(cmd: string): string[][] {
  // First, split on command separators: &&, ||, ;, |, newline, &
  const commands = splitOnSeparators(cmd);
  const result: string[][] = [];

  for (const cmdStr of commands) {
    const trimmed = cmdStr.trim();
    if (!trimmed) continue;

    const tokens = tokenize(trimmed);
    const unwrapped = unwrapCommand(tokens);
    result.push(...unwrapped);
  }

  return result;
}

/** Split command string on unquoted separators: &&, ||, ;, |, newline, & */
function splitOnSeparators(cmd: string): string[] {
  const result: string[] = [];
  let current = "";
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  while (i < cmd.length) {
    const ch = cmd[i];

    if (inSingleQuote) {
      current += ch;
      if (ch === "'") inSingleQuote = false;
      i++;
    } else if (inDoubleQuote) {
      current += ch;
      if (ch === '"' && (i === 0 || cmd[i - 1] !== "\\")) {
        inDoubleQuote = false;
      }
      i++;
    } else {
      if (ch === "'") {
        inSingleQuote = true;
        current += ch;
        i++;
      } else if (ch === '"') {
        inDoubleQuote = true;
        current += ch;
        i++;
      } else if (ch === "&" && i + 1 < cmd.length && cmd[i + 1] === "&") {
        // &&
        if (current) result.push(current);
        current = "";
        i += 2;
      } else if (ch === "|" && i + 1 < cmd.length && cmd[i + 1] === "|") {
        // ||
        if (current) result.push(current);
        current = "";
        i += 2;
      } else if (ch === ";" || ch === "|") {
        // ; or |
        if (current) result.push(current);
        current = "";
        i++;
      } else if (ch === "&") {
        // & (background)
        if (current) result.push(current);
        current = "";
        i++;
      } else if (ch === "\n") {
        // newline
        if (current) result.push(current);
        current = "";
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }

  if (current) result.push(current);
  return result;
}

/** Unwrap command wrappers recursively (sudo, env, bash -c, etc.) */
function unwrapCommand(
  tokens: string[],
  depth = 0
): string[][] {
  const MAX_DEPTH = 4;
  if (depth > MAX_DEPTH || tokens.length === 0) {
    return [tokens];
  }

  const cmd = tokens[0]!.toLowerCase();

  // Unwrap sudo: sudo [-flags] <rest>
  if (cmd === "sudo") {
    let i = 1;
    while (i < tokens.length && (tokens[i]?.startsWith("-") ?? false)) {
      const flag = tokens[i]!;
      // Skip the flag, and also skip its argument if needed
      if (["-u", "-g", "-U", "-C"].includes(flag) && i + 1 < tokens.length) {
        i += 2;
      } else {
        i++;
      }
    }
    if (i < tokens.length) {
      return unwrapCommand(tokens.slice(i), depth + 1);
    }
  }

  // Unwrap env VAR=x <rest>
  if (cmd === "env") {
    let i = 1;
    while (i < tokens.length) {
      const token = tokens[i]!;
      if (token === "--") {
        i++;
        break;
      }
      if (token.includes("=") && !token.startsWith("-")) {
        i++;
      } else {
        break;
      }
    }
    if (i < tokens.length) {
      return unwrapCommand(tokens.slice(i), depth + 1);
    }
  }

  // Unwrap nohup, time, command, xargs
  if (["nohup", "time", "command", "xargs"].includes(cmd)) {
    if (tokens.length > 1) {
      return unwrapCommand(tokens.slice(1), depth + 1);
    }
  }

  // Unwrap bash|sh|zsh -c|-lc "script"
  if (["bash", "sh", "zsh"].includes(cmd)) {
    let i = 1;
    let withLogin = false;
    while (i < tokens.length) {
      const token = tokens[i]!;
      if (token === "-c") {
        i++;
        break;
      } else if (token === "-lc" || token === "-l") {
        withLogin = true;
        i++;
        if (tokens[i] === "-c") {
          i++;
          break;
        }
      } else if (token.startsWith("-")) {
        i++;
      } else {
        break;
      }
    }
    if (i < tokens.length && tokens[i]) {
      const script = tokens[i]!;
      const scriptTokens = tokenize(script);
      return splitOnSeparators(script).flatMap((s) =>
        unwrapCommand(tokenize(s.trim()), depth + 1)
      );
    }
  }

  // Unwrap $(...) and backticks by recursing on their content
  const result: string[][] = [tokens];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const cmdSubMatches = token.match(/\$\(([^)]+)\)/g);
    const backtickMatches = token.match(/`([^`]+)`/g);

    if (cmdSubMatches) {
      for (const match of cmdSubMatches) {
        const script = match.slice(2, -1);
        result.push(
          ...splitOnSeparators(script).flatMap((s) =>
            unwrapCommand(tokenize(s.trim()), depth + 1)
          )
        );
      }
    }

    if (backtickMatches) {
      for (const match of backtickMatches) {
        const script = match.slice(1, -1);
        result.push(
          ...splitOnSeparators(script).flatMap((s) =>
            unwrapCommand(tokenize(s.trim()), depth + 1)
          )
        );
      }
    }
  }

  return result;
}

/** Check if a command is destructive (rm -rf, git reset --hard, etc.) */
export function isDestructiveCommand(cmd: string): boolean {
  // Conservative whole-string fallbacks the token walk cannot see (SQL text, device redirects).
  // A false positive here only escalates a command to approval, so failing safe is the right bias.
  if (/\bdrop\s+(?:table|database|schema)\b/i.test(cmd)) return true;
  if (/>\s*\/dev\/(?!null\b|stdout\b|stderr\b|tty\b)/.test(cmd)) return true;
  const commands = splitCommands(cmd);
  return commands.some((tokens) => isDestructiveTokens(tokens));
}

/** Check if a token array represents a destructive command */
function isDestructiveTokens(tokens: string[]): boolean {
  if (tokens.length === 0) return false;

  const cmd = tokens[0]!.toLowerCase();

  // rm with -r/-R/--recursive or -f/--force
  if (cmd === "rm" || cmd.endsWith("/rm")) {
    const flags = tokens.slice(1).join(" ");
    if (
      /\s-[rfR]*[rfR]/.test(" " + flags) ||
      /\s--force/.test(" " + flags) ||
      /\s--recursive/.test(" " + flags)
    ) {
      return true;
    }
  }

  // git reset --hard
  if (cmd === "git" && tokens.length >= 2) {
    if (
      tokens[1] === "reset" &&
      tokens.slice(2).some((t) => t === "--hard")
    ) {
      return true;
    }
    // git clean -f
    if (
      tokens[1] === "clean" &&
      tokens.slice(2).some((t) => t === "-f" || t === "--force")
    ) {
      return true;
    }
    // git push --force
    if (
      tokens[1] === "push" &&
      tokens.slice(2).some(
        (t) => t === "--force" || t === "-f" || t === "--force-with-lease"
      )
    ) {
      return true;
    }
    // git checkout -- . or git restore
    if (
      tokens[1] === "checkout" &&
      tokens.includes("--") &&
      tokens.includes(".")
    ) {
      return true;
    }
    if (tokens[1] === "restore") {
      return true;
    }
    // git branch -D
    if (
      tokens[1] === "branch" &&
      tokens.slice(2).some((t) => t === "-D")
    ) {
      return true;
    }
  }

  // mkfs*
  if (cmd.startsWith("mkfs")) {
    return true;
  }

  // dd with of=
  if (cmd === "dd" && tokens.some((t) => t.startsWith("of="))) {
    return true;
  }

  // chmod/chown -R
  if (
    (cmd === "chmod" || cmd === "chown") &&
    tokens.some((t) => t === "-R" || t === "-r")
  ) {
    return true;
  }

  // shred, truncate
  if (cmd === "shred" || cmd === "truncate") {
    return true;
  }

  // find with -delete or -exec rm
  if (cmd === "find") {
    if (tokens.some((t) => t === "-delete")) {
      return true;
    }
    const execIdx = tokens.indexOf("-exec");
    if (execIdx !== -1 && tokens.length > execIdx + 1) {
      const execCmd = tokens[execIdx + 1]!;
      if (execCmd === "rm" || execCmd.endsWith("/rm")) {
        return true;
      }
    }
  }

  // SQL drop commands
  if (["psql", "mysql", "sqlite3"].some((c) => cmd.endsWith(c))) {
    const argsStr = tokens.slice(1).join(" ");
    if (/DROP\s+(TABLE|DATABASE)/i.test(argsStr)) {
      return true;
    }
  }

  // dd or redirection to /dev/sd* (dangerous device)
  if (tokens.some((t) => />.*\/dev\/sd/.test(t))) {
    return true;
  }

  // kill -9 -1
  if (cmd === "kill" && tokens.includes("-9") && tokens.includes("-1")) {
    return true;
  }

  // Fork bomb
  if (tokens.join(" ").includes(":(){") || tokens.join(" ").includes(": ()")) {
    return true;
  }

  // curl/wget piped to sh/bash
  if (
    (cmd === "curl" || cmd === "wget") &&
    tokens.some((t) => t === "|" || t.endsWith("| bash") || t.endsWith("| sh"))
  ) {
    return true;
  }

  return false;
}

/** Interface for mutation target information */
export interface MutationTarget {
  readonly verb: string;
  readonly target: string;
}

/** Find paths that a command may write/delete */
export function mutationTargets(cmd: string): MutationTarget[] {
  const commands = splitCommands(cmd);
  const targets: MutationTarget[] = [];

  for (const tokens of commands) {
    targets.push(...mutationTargetsFromTokens(tokens));
  }

  return targets;
}

/** Extract mutation targets from a token array */
function mutationTargetsFromTokens(tokens: string[]): MutationTarget[] {
  if (tokens.length === 0) return [];

  const targets: MutationTarget[] = [];
  const cmd = tokens[0]!.toLowerCase();

  // rm <args>
  if (cmd === "rm" || cmd.endsWith("/rm")) {
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!token.startsWith("-")) {
        targets.push({ verb: "rm", target: token });
      }
    }
    return targets;
  }

  // mv <src> <dest>
  if (cmd === "mv" || cmd.endsWith("/mv")) {
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!token.startsWith("-")) {
        targets.push({ verb: "mv", target: token });
      }
    }
    return targets;
  }

  // cp <args> <dest> (last arg is destination)
  if (cmd === "cp" || cmd.endsWith("/cp")) {
    const args = [];
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!token.startsWith("-")) {
        args.push(token);
      }
    }
    if (args.length > 0) {
      targets.push({ verb: "cp", target: args[args.length - 1]! });
    }
    return targets;
  }

  // touch, truncate <files>
  if (
    cmd === "touch" ||
    cmd === "truncate" ||
    cmd.endsWith("/touch") ||
    cmd.endsWith("/truncate")
  ) {
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!token.startsWith("-")) {
        targets.push({
          verb: cmd === "touch" ? "touch" : "truncate",
          target: token,
        });
      }
    }
    return targets;
  }

  // tee <files>
  if (cmd === "tee" || cmd.endsWith("/tee")) {
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!token.startsWith("-")) {
        targets.push({ verb: "tee", target: token });
      }
    }
    return targets;
  }

  // shred <files>
  if (cmd === "shred" || cmd.endsWith("/shred")) {
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!token.startsWith("-")) {
        targets.push({ verb: "shred", target: token });
      }
    }
    return targets;
  }

  // dd of=<file>
  if (cmd === "dd" || cmd.endsWith("/dd")) {
    for (const token of tokens.slice(1)) {
      if (token.startsWith("of=")) {
        const target = token.slice(3);
        if (target && !isDevNull(target)) {
          targets.push({ verb: "dd", target });
        }
      }
    }
    return targets;
  }

  // sed/perl/ruby -i (in-place edit)
  if (["sed", "perl", "ruby"].some((c) => cmd.endsWith(c))) {
    let inPlaceIdx = tokens.findIndex((t) => t === "-i");
    if (inPlaceIdx === -1) {
      inPlaceIdx = tokens.findIndex((t) => t.startsWith("-i"));
    }
    if (inPlaceIdx !== -1) {
      for (let i = inPlaceIdx + 1; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (!token.startsWith("-")) {
          targets.push({ verb: "edit", target: token });
        }
      }
    }
    return targets;
  }

  // git checkout -- <paths>
  if (cmd === "git" && tokens.length >= 2 && tokens[1] === "checkout") {
    const dashIdx = tokens.indexOf("--");
    if (dashIdx !== -1) {
      for (let i = dashIdx + 1; i < tokens.length; i++) {
        const token = tokens[i]!;
        targets.push({ verb: "checkout", target: token });
      }
    }
    return targets;
  }

  // git restore <paths>
  if (cmd === "git" && tokens.length >= 2 && tokens[1] === "restore") {
    for (let i = 2; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!token.startsWith("-")) {
        targets.push({ verb: "restore", target: token });
      }
    }
    return targets;
  }

  // install <args> <dest>
  if (cmd === "install" || cmd.endsWith("/install")) {
    const args = [];
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!token.startsWith("-")) {
        args.push(token);
      }
    }
    if (args.length > 0) {
      targets.push({ verb: "install", target: args[args.length - 1]! });
    }
    return targets;
  }

  // ln <src> <dest>
  if (cmd === "ln" || cmd.endsWith("/ln")) {
    const args = [];
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!token.startsWith("-")) {
        args.push(token);
      }
    }
    if (args.length > 0) {
      targets.push({ verb: "ln", target: args[args.length - 1]! });
    }
    return targets;
  }

  // Redirection targets: >, >>, 1>, 2>, &>
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (
      token === ">" ||
      token === ">>" ||
      token === "1>" ||
      token === "2>" ||
      token === "&>"
    ) {
      if (i + 1 < tokens.length) {
        const target = tokens[i + 1]!;
        if (!isDevNull(target) && !target.startsWith("-")) {
          const verb = token.includes(">>") ? "append" : "redirect";
          targets.push({ verb, target });
        }
      }
    }
  }

  return targets;
}

function isDevNull(path: string): boolean {
  return path === "/dev/null" || path === "NUL";
}

/** Arity table: map command prefix strings to number of tokens that define the command */
const ARITY: Record<string, number> = {
  git: 2,
  "git push": 2,
  "git pull": 2,
  "git fetch": 2,
  "git clone": 2,
  "git checkout": 2,
  "git reset": 2,
  "git clean": 2,
  "git restore": 2,
  "git branch": 2,
  npm: 2,
  "npm run": 3,
  "npm install": 2,
  "npm add": 2,
  "npm exec": 3,
  "npm init": 3,
  "npm view": 3,
  bun: 2,
  "bun run": 3,
  "bun install": 2,
  "bun add": 2,
  docker: 2,
  "docker run": 2,
  "docker build": 2,
  "docker exec": 3,
  cargo: 2,
  "cargo build": 2,
  "cargo run": 2,
  "cargo install": 2,
  kubectl: 2,
  "kubectl apply": 2,
  "kubectl delete": 2,
  "kubectl get": 2,
  "kubectl exec": 3,
  pnpm: 2,
  "pnpm run": 3,
  "pnpm install": 2,
  "pnpm add": 2,
  "pnpm exec": 3,
};

/** Generate a command key using arity-based rules.
 *  E.g., ["git", "push", "origin"] -> "git push"
 *  ["npm", "run", "dev"] -> "npm run dev"
 *  ["rm", "-rf", "x"] -> "rm" */
export function commandKey(tokens: readonly string[]): string {
  if (tokens.length === 0) return "";

  // Find longest matching prefix
  for (let len = Math.min(tokens.length, 3); len > 0; len--) {
    const prefix = tokens.slice(0, len).join(" ");
    const arity = ARITY[prefix];
    if (arity !== undefined) {
      return tokens.slice(0, arity).join(" ");
    }
  }

  // Default: just the command (first token)
  return tokens[0]!;
}

/** Check if a command uses network (curl, wget, git clone, npm install, etc.) */
export function usesNetwork(cmd: string): boolean {
  const commands = splitCommands(cmd);
  return commands.some((tokens) => usesNetworkTokens(tokens));
}

function usesNetworkTokens(tokens: string[]): boolean {
  if (tokens.length === 0) return false;

  const cmd = tokens[0]!.toLowerCase();

  // Direct network tools - check exact match or /path format to avoid false positives like rsync matching nc
  if (
    cmd === "curl" ||
    cmd === "wget" ||
    cmd === "nc" ||
    cmd === "ncat" ||
    cmd === "ssh" ||
    cmd === "scp" ||
    cmd === "ftp" ||
    cmd === "telnet" ||
    cmd.endsWith("/curl") ||
    cmd.endsWith("/wget") ||
    cmd.endsWith("/nc") ||
    cmd.endsWith("/ncat") ||
    cmd.endsWith("/ssh") ||
    cmd.endsWith("/scp") ||
    cmd.endsWith("/ftp") ||
    cmd.endsWith("/telnet")
  ) {
    return true;
  }

  // rsync with remote syntax (has :: or : with letter, or @)
  if (cmd === "rsync" || cmd.endsWith("/rsync")) {
    const argsStr = tokens.join(" ");
    // Only return true if it has remote syntax indicators
    if (argsStr.includes("::") || /:\w/.test(argsStr) || /@/.test(argsStr)) {
      return true;
    }
    // Local rsync, not network usage
    return false;
  }

  // git clone/fetch/pull/push with url or remote
  if (cmd === "git" && tokens.length >= 2) {
    const subcmd = tokens[1]!;
    if (["clone", "fetch", "pull", "push"].includes(subcmd)) {
      const args = tokens.slice(2).join(" ");
      if (
        args.includes("://") ||
        args.includes("@") ||
        args.includes("origin") ||
        args.includes("upstream")
      ) {
        return true;
      }
    }
    return false;  // git without network usage
  }

  // npm/pnpm/bun install/add
  if (["npm", "pnpm", "bun", "yarn"].some((c) => cmd.endsWith(c))) {
    if (tokens.length >= 2) {
      const subcmd = tokens[1]!;
      if (
        ["install", "add", "i", "ci", "init", "create-app"].includes(subcmd)
      ) {
        return true;
      }
    }
    return false;  // other npm command
  }

  // pip install
  if (cmd === "pip" || cmd === "pip3" || cmd.endsWith("/pip")) {
    if (tokens.length >= 2 && tokens[1]! === "install") {
      return true;
    }
    return false;  // pip without install
  }

  // apt/brew/apk install
  if (
    ["apt", "apt-get", "brew", "apk", "yum", "dnf"].some((c) =>
      cmd.endsWith(c)
    )
  ) {
    if (tokens.length >= 2 && tokens[1]! === "install") {
      return true;
    }
    return false;  // apt without install
  }

  return false;
}

/** Check if a command installs packages (npm install, pip install, cargo install, etc.) */
export function installsPackages(cmd: string): boolean {
  const commands = splitCommands(cmd);
  return commands.some((tokens) => installsPackagesTokens(tokens));
}

function installsPackagesTokens(tokens: string[]): boolean {
  if (tokens.length === 0) return false;

  const cmd = tokens[0]!.toLowerCase();

  if (["npm", "pnpm", "yarn", "bun"].some((c) => cmd.endsWith(c))) {
    if (tokens.length >= 2) {
      const subcmd = tokens[1]!;
      return (
        ["install", "add", "i", "ci", "init", "create"].includes(subcmd) ||
        subcmd.startsWith("create-")
      );
    }
  }

  if (cmd === "pip" || cmd === "pip3" || cmd.endsWith("/pip")) {
    if (tokens.length >= 2) {
      return tokens[1]! === "install";
    }
  }

  if (cmd === "cargo" || cmd.endsWith("/cargo")) {
    if (tokens.length >= 2) {
      return ["install", "add"].includes(tokens[1]!);
    }
  }

  if (
    ["apt", "apt-get", "brew", "apk", "yum", "dnf", "pacman"].some((c) =>
      cmd.endsWith(c)
    )
  ) {
    if (tokens.length >= 2) {
      return tokens[1]! === "install";
    }
  }

  if (cmd === "gem" || cmd.endsWith("/gem")) {
    if (tokens.length >= 2) {
      return tokens[1]! === "install";
    }
  }

  if (cmd === "go" || cmd.endsWith("/go")) {
    if (tokens.length >= 2) {
      return ["install", "get"].includes(tokens[1]!);
    }
  }

  return false;
}
