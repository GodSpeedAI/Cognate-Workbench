import { describe, it, expect } from "bun:test";
import {
  tokenize,
  splitCommands,
  isDestructiveCommand,
  mutationTargets,
  commandKey,
  usesNetwork,
  installsPackages,
  type MutationTarget,
} from "../src/workbench/shellSafety";

describe("tokenize", () => {
  it("splits simple tokens on whitespace", () => {
    expect(tokenize("ls -la /tmp")).toEqual(["ls", "-la", "/tmp"]);
  });

  it("preserves single-quoted strings", () => {
    expect(tokenize("echo 'hello world'")).toEqual(["echo", "hello world"]);
  });

  it("preserves double-quoted strings", () => {
    expect(tokenize('echo "hello world"')).toEqual(["echo", "hello world"]);
  });

  it("handles backslash escapes outside quotes", () => {
    expect(tokenize("echo hello\\ world")).toEqual(["echo", "hello world"]);
  });

  it("handles backslash escapes in double quotes", () => {
    expect(tokenize('echo "hello\\"world"')).toEqual([
      "echo",
      'hello"world',
    ]);
  });

  it("treats quoted text as single token", () => {
    expect(tokenize('command "arg with spaces"')).toEqual([
      "command",
      "arg with spaces",
    ]);
  });

  it("empty input returns empty array", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("handles only whitespace", () => {
    expect(tokenize("   \t  ")).toEqual([]);
  });

  it("preserves backslashes in single quotes", () => {
    expect(tokenize("echo 'a\\b'")).toEqual(["echo", "a\\b"]);
  });
});

describe("splitCommands", () => {
  it("splits on semicolon", () => {
    const result = splitCommands("ls; pwd");
    expect(result.length).toBe(2);
    expect(result[0]![0]).toBe("ls");
    expect(result[1]![0]).toBe("pwd");
  });

  it("splits on &&", () => {
    const result = splitCommands("ls && echo done");
    expect(result.length).toBe(2);
    expect(result[0]![0]).toBe("ls");
    expect(result[1]![0]).toBe("echo");
  });

  it("splits on ||", () => {
    const result = splitCommands("test -f file || echo missing");
    expect(result.length).toBe(2);
  });

  it("splits on pipe", () => {
    const result = splitCommands("cat file | grep pattern");
    expect(result.length).toBe(2);
    expect(result[0]![0]).toBe("cat");
    expect(result[1]![0]).toBe("grep");
  });

  it("splits on newline", () => {
    const result = splitCommands("echo one\necho two");
    expect(result.length).toBe(2);
  });

  it("unwraps sudo", () => {
    const result = splitCommands("sudo rm -rf /tmp");
    expect(result.length).toBe(1);
    expect(result[0]![0]).toBe("rm");
  });

  it("unwraps sudo with flags", () => {
    const result = splitCommands("sudo -u root rm -rf /tmp");
    expect(result.length).toBe(1);
    expect(result[0]![0]).toBe("rm");
  });

  it("unwraps bash -c", () => {
    const result = splitCommands('bash -c "rm -rf /tmp"');
    expect(result.some((tokens) => tokens[0] === "rm")).toBe(true);
  });

  it("unwraps env VAR=value", () => {
    const result = splitCommands("env PATH=/bin rm -rf /");
    expect(result.some((tokens) => tokens[0] === "rm")).toBe(true);
  });

  it("unwraps nohup", () => {
    const result = splitCommands("nohup long_running_command");
    expect(result.some((tokens) => tokens[0] === "long_running_command")).toBe(
      true
    );
  });

  it("handles multiple separators in chain", () => {
    const result = splitCommands("a && b; c | d");
    expect(result.length).toBeGreaterThan(2);
  });

  it("ignores quoted separators", () => {
    const result = splitCommands("echo 'a && b'");
    expect(result.length).toBe(1);
    expect(result[0]![0]).toBe("echo");
  });

  it("extracts commands from bash -lc", () => {
    const result = splitCommands("bash -lc 'echo test'");
    expect(result.some((tokens) => tokens[0]! === "echo")).toBe(true);
  });
});

describe("isDestructiveCommand", () => {
  // rm variations
  it("flags rm -f as destructive", () => {
    expect(isDestructiveCommand("rm -f file")).toBe(true);
  });

  it("flags rm -rf as destructive", () => {
    expect(isDestructiveCommand("rm -rf /tmp")).toBe(true);
  });

  it("flags rm -r -f as destructive", () => {
    expect(isDestructiveCommand("rm -r -f /tmp")).toBe(true);
  });

  it("flags rm --force as destructive", () => {
    expect(isDestructiveCommand("rm --force file")).toBe(true);
  });

  it("flags rm --recursive as destructive", () => {
    expect(isDestructiveCommand("rm --recursive dir")).toBe(true);
  });

  it("does not flag plain rm", () => {
    expect(isDestructiveCommand("rm file")).toBe(false);
  });

  it("does not flag rm -v", () => {
    expect(isDestructiveCommand("rm -v file")).toBe(false);
  });

  // git variations
  it("flags git reset --hard", () => {
    expect(isDestructiveCommand("git reset --hard")).toBe(true);
  });

  it("flags git clean -f", () => {
    expect(isDestructiveCommand("git clean -f")).toBe(true);
  });

  it("flags git push --force", () => {
    expect(isDestructiveCommand("git push --force")).toBe(true);
  });

  it("flags git push -f", () => {
    expect(isDestructiveCommand("git push -f")).toBe(true);
  });

  it("flags git push --force-with-lease", () => {
    expect(isDestructiveCommand("git push --force-with-lease")).toBe(true);
  });

  it("flags git checkout -- .", () => {
    expect(isDestructiveCommand("git checkout -- .")).toBe(true);
  });

  it("flags git restore", () => {
    expect(isDestructiveCommand("git restore file.txt")).toBe(true);
  });

  it("flags git branch -D", () => {
    expect(isDestructiveCommand("git branch -D main")).toBe(true);
  });

  it("does not flag git status", () => {
    expect(isDestructiveCommand("git status")).toBe(false);
  });

  // Other destructive commands
  it("flags mkfs", () => {
    expect(isDestructiveCommand("mkfs.ext4 /dev/sda1")).toBe(true);
  });

  it("flags dd with of=", () => {
    expect(isDestructiveCommand("dd if=src of=dst")).toBe(true);
  });

  it("flags chmod -R", () => {
    expect(isDestructiveCommand("chmod -R 777 /tmp")).toBe(true);
  });

  it("flags chown -R", () => {
    expect(isDestructiveCommand("chown -R user:group /tmp")).toBe(true);
  });

  it("flags shred", () => {
    expect(isDestructiveCommand("shred secret.txt")).toBe(true);
  });

  it("flags truncate", () => {
    expect(isDestructiveCommand("truncate -s 0 file")).toBe(true);
  });

  it("flags find -delete", () => {
    expect(isDestructiveCommand("find /tmp -name '*.log' -delete")).toBe(true);
  });

  it("flags find -exec rm", () => {
    expect(
      isDestructiveCommand("find /tmp -name '*.log' -exec rm {} \\;")
    ).toBe(true);
  });

  it("flags DROP TABLE in psql", () => {
    expect(isDestructiveCommand("psql -c 'DROP TABLE users'")).toBe(true);
  });

  // Safe commands that look dangerous
  it("does not flag echo with rm text", () => {
    expect(isDestructiveCommand('echo "rm -rf /"')).toBe(false);
  });

  it("does not flag cat", () => {
    expect(isDestructiveCommand("cat file")).toBe(false);
  });

  it("does not flag less", () => {
    expect(isDestructiveCommand("less file")).toBe(false);
  });

  it("does not flag grep", () => {
    expect(isDestructiveCommand("grep pattern file")).toBe(false);
  });

  it("does not flag git status", () => {
    expect(isDestructiveCommand("git status")).toBe(false);
  });

  it("does not flag git log", () => {
    expect(isDestructiveCommand("git log")).toBe(false);
  });

  // Chain detection
  it("detects destructive command in chain", () => {
    expect(isDestructiveCommand("ls && rm -rf /tmp")).toBe(true);
  });

  it("detects destructive command in pipe chain", () => {
    expect(isDestructiveCommand("find . | xargs rm -f")).toBe(true);
  });
});

describe("mutationTargets", () => {
  it("extracts rm targets", () => {
    const targets = mutationTargets("rm file1 file2");
    expect(targets).toEqual([
      { verb: "rm", target: "file1" },
      { verb: "rm", target: "file2" },
    ]);
  });

  it("extracts mv targets", () => {
    const targets = mutationTargets("mv src dst");
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.target)).toContain("src");
    expect(targets.map((t) => t.target)).toContain("dst");
  });

  it("extracts cp destination", () => {
    const targets = mutationTargets("cp src dest");
    expect(targets.some((t) => t.target === "dest")).toBe(true);
  });

  it("extracts touch targets", () => {
    const targets = mutationTargets("touch file1 file2");
    expect(targets.length).toBe(2);
    expect(targets.every((t) => t.verb === "touch")).toBe(true);
  });

  it("extracts tee targets", () => {
    const targets = mutationTargets("echo test | tee output.txt");
    expect(targets.some((t) => t.target === "output.txt")).toBe(true);
  });

  it("extracts shred targets", () => {
    const targets = mutationTargets("shred secret.txt");
    expect(targets[0]).toEqual({ verb: "shred", target: "secret.txt" });
  });

  it("extracts dd output file", () => {
    const targets = mutationTargets("dd if=src of=/dev/sdb");
    expect(targets.some((t) => t.target === "/dev/sdb")).toBe(true);
  });

  it("extracts sed -i targets", () => {
    const targets = mutationTargets("sed -i 's/old/new/g' file.txt");
    expect(targets.some((t) => t.target === "file.txt")).toBe(true);
  });

  it("ignores /dev/null in redirections", () => {
    const targets = mutationTargets("cmd > /dev/null");
    expect(targets.every((t) => t.target !== "/dev/null")).toBe(true);
  });

  it("extracts redirection targets", () => {
    const targets = mutationTargets("echo test > output.txt");
    expect(targets.some((t) => t.target === "output.txt")).toBe(true);
  });

  it("extracts append redirection targets", () => {
    const targets = mutationTargets("echo test >> log.txt");
    expect(targets.some((t) => t.target === "log.txt")).toBe(true);
  });

  it("extracts stderr redirection targets", () => {
    const targets = mutationTargets("cmd 2> error.txt");
    expect(targets.some((t) => t.target === "error.txt")).toBe(true);
  });

  it("extracts combined redirection targets", () => {
    const targets = mutationTargets("cmd &> all.log");
    expect(targets.some((t) => t.target === "all.log")).toBe(true);
  });

  it("extracts git checkout targets", () => {
    const targets = mutationTargets("git checkout -- src/main.ts");
    expect(targets.some((t) => t.target === "src/main.ts")).toBe(true);
  });

  it("extracts git restore targets", () => {
    const targets = mutationTargets("git restore src/");
    expect(targets.some((t) => t.target === "src/")).toBe(true);
  });

  it("ignores flags in mutation targets", () => {
    const targets = mutationTargets("rm -rf --verbose file.txt");
    expect(targets.every((t) => !t.target.startsWith("-"))).toBe(true);
  });

  it("returns empty for read-only commands", () => {
    const targets = mutationTargets("cat file");
    expect(targets).toEqual([]);
  });

  it("returns empty for grep", () => {
    const targets = mutationTargets("grep pattern file");
    expect(targets).toEqual([]);
  });

  it("handles complex command chains", () => {
    const targets = mutationTargets("ls > out.txt && rm -f temp");
    expect(targets.some((t) => t.target === "out.txt")).toBe(true);
    expect(targets.some((t) => t.target === "temp")).toBe(true);
  });
});

describe("commandKey", () => {
  it("returns 'git status' for git status", () => {
    expect(commandKey(["git", "status"])).toBe("git status");
  });

  it("returns 'git push' for git push origin", () => {
    expect(commandKey(["git", "push", "origin"])).toBe("git push");
  });

  it("returns 'npm run' for npm run dev", () => {
    expect(commandKey(["npm", "run", "dev"])).toBe("npm run dev");
  });

  it("returns npm for npm install", () => {
    expect(commandKey(["npm", "install"])).toBe("npm install");
  });

  it("returns 'bun run' for bun run dev", () => {
    expect(commandKey(["bun", "run", "dev"])).toBe("bun run dev");
  });

  it("returns docker for docker run", () => {
    expect(commandKey(["docker", "run"])).toBe("docker run");
  });

  it("returns 'pnpm run' for pnpm run test", () => {
    expect(commandKey(["pnpm", "run", "test"])).toBe("pnpm run test");
  });

  it("returns kubectl for kubectl get pods", () => {
    expect(commandKey(["kubectl", "get", "pods"])).toBe("kubectl get");
  });

  it("returns rm for rm with args and flags", () => {
    expect(commandKey(["rm", "-rf", "/tmp"])).toBe("rm");
  });

  it("handles unknown commands with default arity", () => {
    expect(commandKey(["unknowncommand", "arg1", "arg2"])).toBe(
      "unknowncommand"
    );
  });

  it("returns empty string for empty input", () => {
    expect(commandKey([])).toBe("");
  });

  it("returns single token for single token input", () => {
    expect(commandKey(["cat"])).toBe("cat");
  });

  it("returns 'cargo build' for cargo build --release", () => {
    expect(commandKey(["cargo", "build", "--release"])).toBe("cargo build");
  });
});

describe("usesNetwork", () => {
  it("detects curl", () => {
    expect(usesNetwork("curl https://example.com")).toBe(true);
  });

  it("detects wget", () => {
    expect(usesNetwork("wget https://example.com")).toBe(true);
  });

  it("detects ssh", () => {
    expect(usesNetwork("ssh user@host")).toBe(true);
  });

  it("detects scp", () => {
    expect(usesNetwork("scp file user@host:path")).toBe(true);
  });

  it("detects nc/ncat", () => {
    expect(usesNetwork("nc localhost 8080")).toBe(true);
  });

  it("detects git clone", () => {
    expect(usesNetwork("git clone https://github.com/user/repo")).toBe(true);
  });

  it("detects git fetch with remote", () => {
    expect(usesNetwork("git fetch origin")).toBe(true);
  });

  it("detects git push with remote", () => {
    expect(usesNetwork("git push origin main")).toBe(true);
  });

  it("detects npm install", () => {
    expect(usesNetwork("npm install")).toBe(true);
  });

  it("detects npm add package", () => {
    expect(usesNetwork("npm add lodash")).toBe(true);
  });

  it("detects bun install", () => {
    expect(usesNetwork("bun install")).toBe(true);
  });

  it("detects pnpm install", () => {
    expect(usesNetwork("pnpm install")).toBe(true);
  });

  it("detects pip install", () => {
    expect(usesNetwork("pip install numpy")).toBe(true);
  });

  it("detects apt install", () => {
    expect(usesNetwork("apt install curl")).toBe(true);
  });

  it("detects brew install", () => {
    expect(usesNetwork("brew install git")).toBe(true);
  });

  it("detects rsync with @ syntax", () => {
    expect(usesNetwork("rsync -av src/ user@host::dest")).toBe(true);
  });

  it("detects rsync with colon syntax", () => {
    expect(usesNetwork("rsync -av src/ user@host:path")).toBe(true);
  });

  it("does not flag local rsync", () => {
    expect(usesNetwork("rsync -av src/ dest")).toBe(false);
  });

  it("does not flag local commands", () => {
    expect(usesNetwork("ls")).toBe(false);
    expect(usesNetwork("cat file")).toBe(false);
  });

  it("does not flag git status", () => {
    expect(usesNetwork("git status")).toBe(false);
  });

  it("detects in command chains", () => {
    expect(usesNetwork("echo start && npm install")).toBe(true);
  });
});

describe("installsPackages", () => {
  it("detects npm install", () => {
    expect(installsPackages("npm install")).toBe(true);
  });

  it("detects npm add", () => {
    expect(installsPackages("npm add lodash")).toBe(true);
  });

  it("detects npm i", () => {
    expect(installsPackages("npm i")).toBe(true);
  });

  it("detects npm ci", () => {
    expect(installsPackages("npm ci")).toBe(true);
  });

  it("detects pnpm install", () => {
    expect(installsPackages("pnpm install")).toBe(true);
  });

  it("detects pnpm add", () => {
    expect(installsPackages("pnpm add vue")).toBe(true);
  });

  it("detects yarn install", () => {
    expect(installsPackages("yarn install")).toBe(true);
  });

  it("detects bun install", () => {
    expect(installsPackages("bun install")).toBe(true);
  });

  it("detects pip install", () => {
    expect(installsPackages("pip install django")).toBe(true);
  });

  it("detects pip3 install", () => {
    expect(installsPackages("pip3 install numpy")).toBe(true);
  });

  it("detects cargo install", () => {
    expect(installsPackages("cargo install rustc")).toBe(true);
  });

  it("detects cargo add", () => {
    expect(installsPackages("cargo add serde")).toBe(true);
  });

  it("detects apt install", () => {
    expect(installsPackages("apt install curl")).toBe(true);
  });

  it("detects apt-get install", () => {
    expect(installsPackages("apt-get install gcc")).toBe(true);
  });

  it("detects brew install", () => {
    expect(installsPackages("brew install node")).toBe(true);
  });

  it("detects apk install", () => {
    expect(installsPackages("apk install git")).toBe(true);
  });

  it("detects gem install", () => {
    expect(installsPackages("gem install rails")).toBe(true);
  });

  it("detects go get", () => {
    expect(installsPackages("go get github.com/lib/pq")).toBe(true);
  });

  it("detects npm create-app", () => {
    expect(installsPackages("npm create vite@latest")).toBe(true);
  });

  it("does not flag npm run", () => {
    expect(installsPackages("npm run build")).toBe(false);
  });

  it("does not flag npm list", () => {
    expect(installsPackages("npm list")).toBe(false);
  });

  it("does not flag git", () => {
    expect(installsPackages("git clone repo")).toBe(false);
  });

  it("detects in command chains", () => {
    expect(installsPackages("cd project && npm install")).toBe(true);
  });
});

describe("integration tests", () => {
  it("handles complex sudo rm -rf chain", () => {
    const cmd = "sudo rm -rf /tmp/cache && echo done";
    expect(isDestructiveCommand(cmd)).toBe(true);
    expect(mutationTargets(cmd).length).toBeGreaterThan(0);
  });

  it("handles bash -c with quoted dangerous command", () => {
    const cmd = 'bash -c "rm -rf $TMPDIR"';
    expect(isDestructiveCommand(cmd)).toBe(true);
  });

  it("detects network in complex chain", () => {
    const cmd = "npm install && npm run build";
    expect(usesNetwork(cmd)).toBe(true);
    expect(installsPackages(cmd)).toBe(true);
  });

  it("differentiates between read-only and destructive operations", () => {
    expect(isDestructiveCommand("cat file")).toBe(false);
    expect(isDestructiveCommand("grep pattern file")).toBe(false);
    expect(isDestructiveCommand("ls -la")).toBe(false);
  });

  it("command key works with filtered tokens", () => {
    const fullCmd = "git push -u origin main";
    const tokens = tokenize(fullCmd);
    expect(commandKey(tokens)).toBe("git push");
  });

  it("tokenizes then extracts command key from complex command", () => {
    const cmd = "npm run build -- --prod";
    const tokens = tokenize(cmd);
    expect(commandKey(tokens)).toBe("npm run build");
  });

  it("handles sudo wrapping with network detection", () => {
    const cmd = "sudo npm install";
    expect(installsPackages(cmd)).toBe(true);
  });

  it("handles env var wrapping with destructive detection", () => {
    const cmd = "env PATH=/bin rm -rf /tmp";
    expect(isDestructiveCommand(cmd)).toBe(true);
  });
});
