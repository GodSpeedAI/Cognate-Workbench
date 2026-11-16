// Local (and WSL) terminal port over Bun's built-in PTY (`Bun.spawn` with the `terminal`
// option, Bun ≥ 1.3.5; Windows ConPTY since 1.3.14). node-pty does not work under Bun
// (oven-sh/bun#25822), so this is the only supported local path.
//
// Termination follows the process-group discipline the J-TERMINAL journey promises:
// SIGTERM to the whole group (interactive shells ignore SIGTERM by POSIX design —
// that is expected), a short grace, then SIGKILL to the group, then the PTY itself
// is closed. Verified empirically against interactive bash on this Bun version.
import type { TerminalExitInfo, TerminalHandle, TerminalPort, TerminalSpawnCallbacks, TerminalSpawnSpec } from "./types.ts";
import { TerminalSpawnError } from "./types.ts";

interface BunTerminalLike {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface BunSubprocessWithTerminal {
  pid: number;
  exited: Promise<number>;
  exitCode: number | null;
  kill(): void;
  terminal: BunTerminalLike;
}

const GRACE_MS = 600;

function signalGroup(pid: number, signal: NodeJS.Signals | number): boolean {
  try {
    // Negative pid targets the process group the PTY session leader created. When the
    // group is already gone this throws (ESRCH) and returns false — that is fine.
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

/** The local PTY port: one `Bun.spawn` per session, interactive from birth. */
export function localTerminalPort(): TerminalPort {
  return {
    kind: "local",
    async spawn(spec: TerminalSpawnSpec, on: TerminalSpawnCallbacks): Promise<TerminalHandle> {
      let proc: BunSubprocessWithTerminal;
      try {
        proc = Bun.spawn([...spec.argv], {
          cwd: spec.cwd,
          ...(spec.env ? { env: { ...spec.env } } : {}),
          terminal: {
            cols: spec.cols,
            rows: spec.rows,
            data: (_terminal: unknown, chunk: Uint8Array) => on.data(chunk),
          },
        }) as unknown as BunSubprocessWithTerminal;
      } catch (error) {
        throw new TerminalSpawnError(`local terminal: failed to spawn ${spec.argv[0]}: ${(error as Error).message}`, error);
      }
      const terminal = proc.terminal;
      let ended = false;
      let exitInfo: TerminalExitInfo | undefined;
      const exited = proc.exited.then(
        (code) => {
          ended = true;
          exitInfo = { exitCode: code, reason: "exited" };
        },
        (error: Error) => {
          ended = true;
          exitInfo = { exitCode: null, reason: "error", message: error.message };
        },
      );
      void exited;
      let terminated = false;
      return {
        write: (data) => {
          if (ended || terminated) return;
          try {
            terminal.write(data);
          } catch {
            /* a PTY that died mid-write reports through its exit callback */
          }
        },
        resize: (cols, rows) => {
          if (ended || terminated) return;
          try {
            terminal.resize(cols, rows);
          } catch {
            /* the process may have exited between the check and the ioctl */
          }
        },
        terminate: async () => {
          if (terminated) return (exitInfo ?? { exitCode: null, reason: "terminated" });
          terminated = true;
          if (!ended) {
            signalGroup(proc.pid, "SIGTERM");
            await Bun.sleep(GRACE_MS);
            if (!ended) signalGroup(proc.pid, "SIGKILL");
            await Promise.race([exited, Bun.sleep(2000)]);
            if (!ended) {
              try {
                proc.kill();
              } catch {
                /* already gone */
              }
              await Promise.race([exited, Bun.sleep(1000)]);
            }
          }
          try {
            terminal.close();
          } catch {
            /* idempotent close */
          }
          ended = true;
          return exitInfo ?? { exitCode: null, reason: "terminated" };
        },
      };
    },
  };
}

/**
 * The WSL port: an interactive default shell inside the distribution, reached through
 * `wsl.exe` under the host's own PTY (Windows hosts only — the established WSL world
 * provider is the authority on the distribution; the terminal only needs its name).
 */
export function wslTerminalPort(options: { readonly wslBin?: string } = {}): TerminalPort {
  const local = localTerminalPort();
  return {
    kind: "wsl",
    async spawn(spec: TerminalSpawnSpec, on: TerminalSpawnCallbacks): Promise<TerminalHandle> {
      if (process.platform !== "win32") {
        throw new TerminalSpawnError("wsl terminal: WSL sessions exist only on Windows hosts");
      }
      const wslBin = options.wslBin ?? "wsl.exe";
      // `--cd <path>` starts the shell in the workspace directory inside the distribution;
      // the path never crosses as a Windows path (the WSL provider owns that invariant).
      const argv = [wslBin, "--cd", spec.cwd, "--exec", ...spec.argv];
      return local.spawn({ ...spec, argv }, on);
    },
  };
}

export type { TerminalExitInfo, TerminalHandle, TerminalPort };
