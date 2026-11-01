// HOST-PROCESS RUNNER for harness sessions ONLY.
//
// Framework gap (see .agents/DEBT.md and .agents/reports/ui-production-readiness/framework-gap-
// streaming-process.md): the Cognate execution port (`@godspeedai/cognate-execution`) is buffered
// and argv-only (no stdin, no streaming, no pid), so it cannot host a bidirectional CLI session.
// Until an upstream streaming `process.spawn` port exists, harness sessions on the LOCAL world use
// this explicit runner. It is deliberately named for what it is: it launches a process on the
// machine the server runs on, as the operator's account, OUTSIDE the execution-world registry and
// the contained-posture guard. Nothing else in the app may use it; remote, contained, SSH and WSL
// worlds are refused before reaching it (`assertLocalHarnessWorld`).
//
// Responsibilities: spawn with stdin/stdout/stderr pipes in its own process group (POSIX) or hidden
// window (Windows), expose stdout as bounded JSON-line frames, keep a bounded stderr tail, and kill
// the whole tree (`kill(-pgid)` on POSIX, `taskkill /T /F` on Windows).
import type { Subprocess } from "bun";

/** Largest accepted stdout line; a longer one fails the session rather than buffering without bound. */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const STDERR_LIMIT = 16 * 1024;

export interface HostProcessSpec {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export class HostProcess {
  readonly pid: number;
  private stderr = "";
  private stdinClosed = false;
  private killed = false;
  readonly exited: Promise<number | null>;
  private readonly lineHandlers = new Set<(line: string) => void>();
  private readonly closeHandlers = new Set<() => void>();
  private oversized = false;

  private constructor(private readonly proc: Subprocess<"pipe", "pipe", "pipe">) {
    this.pid = proc.pid;
    this.exited = proc.exited.then(() => proc.exitCode);
    void this.pump(proc.stdout);
    void this.collectStderr(proc.stderr);
  }

  static spawn(spec: HostProcessSpec): HostProcess {
    const proc = Bun.spawn([...spec.argv], {
      cwd: spec.cwd,
      env: { ...spec.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      // Own process group on POSIX so the whole tree can be signalled; hidden console on Windows.
      ...(process.platform === "win32" ? { windowsHide: true } : { detached: true }),
    }) as Subprocess<"pipe", "pipe", "pipe">;
    return new HostProcess(proc);
  }

  /** Subscribe to stdout lines; `onClose` fires once when stdout ends. */
  subscribe(onLine: (line: string) => void, onClose: () => void): void {
    this.lineHandlers.add(onLine);
    this.closeHandlers.add(onClose);
  }

  get stderrTail(): string {
    return this.stderr;
  }

  get frameTooLarge(): boolean {
    return this.oversized;
  }

  /** One JSON value per line on stdin. A closed pipe is not an error here: the exit is reported separately. */
  write(frame: unknown): void {
    if (this.stdinClosed) return;
    try {
      this.proc.stdin.write(`${JSON.stringify(frame)}\n`);
      void this.proc.stdin.flush();
    } catch {
      this.stdinClosed = true;
    }
  }

  closeStdin(): void {
    if (this.stdinClosed) return;
    this.stdinClosed = true;
    try { void this.proc.stdin.end(); } catch { /* already closed */ }
  }

  get isRunning(): boolean {
    return !this.killed && this.proc.exitCode === null && this.proc.signalCode === null;
  }

  /** Signal the whole tree. */
  signal(signal: "SIGTERM" | "SIGKILL"): void {
    this.killed = this.killed || signal === "SIGKILL";
    if (process.platform === "win32") {
      // `taskkill /T` walks the child tree; /F because a console child ignores a polite request.
      try { Bun.spawn(["taskkill", "/PID", String(this.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore", windowsHide: true }); } catch { /* gone */ }
      return;
    }
    try { process.kill(-this.pid, signal); } catch {
      try { process.kill(this.pid, signal); } catch { /* already gone */ }
    }
  }

  /** stdin EOF, a short grace period, SIGTERM to the group, a shorter grace period, then SIGKILL. */
  async terminate(graceMs = 1000): Promise<void> {
    this.closeStdin();
    const settle = (ms: number) => Promise.race([this.exited.then(() => true), Bun.sleep(ms).then(() => false)]);
    if (await settle(graceMs)) { this.reapGroup(); return; }
    this.signal("SIGTERM");
    if (await settle(Math.max(250, graceMs / 2))) { this.reapGroup(); return; }
    this.signal("SIGKILL");
    await this.exited;
  }

  /** The leader exited; make sure no descendant outlives it. */
  private reapGroup(): void {
    if (process.platform === "win32") return;
    try { process.kill(-this.pid, "SIGKILL"); } catch { /* group already empty */ }
  }

  private async pump(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of stream) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (line) for (const handler of this.lineHandlers) handler(line);
          newline = buffer.indexOf("\n");
        }
        if (buffer.length > MAX_FRAME_BYTES) {
          this.oversized = true;
          buffer = "";
          this.signal("SIGKILL");
        }
      }
      const rest = buffer.trim();
      if (rest) for (const handler of this.lineHandlers) handler(rest);
    } catch { /* stream torn down by a kill */ }
    // Let the exit code settle before telling listeners stdout is over.
    await this.exited.catch(() => null);
    for (const handler of this.closeHandlers) handler();
  }

  private async collectStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of stream) {
        this.stderr = (this.stderr + decoder.decode(chunk, { stream: true })).slice(-STDERR_LIMIT);
      }
    } catch { /* torn down */ }
  }
}
