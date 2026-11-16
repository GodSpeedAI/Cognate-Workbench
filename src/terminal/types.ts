// J-TERMINAL-session: the interactive terminal surface. A `TerminalPort` turns a spawn
// specification into one PTY-backed interactive session in a specific execution world; the
// world kinds the Cognate SDK already models (local, SSH, WSL) are providers of this port,
// not new kinds of contract. The one-shot `ProcessPort.exec` is untouched: an agent's
// `tool.bash` keeps its own governance, and a PTY never becomes an agent authorization
// bypass — terminal creation is a human act, enforced by the capabilities in
// `src/capabilities/terminal.ts`.
//
// Stream bytes are ephemeral by design: they live in the service's bounded scrollback ring
// and in attached websockets, never in the durable event log.

/** Information about how a terminal session's process ended. */
export interface TerminalExitInfo {
  readonly exitCode: number | null;
  readonly signal?: string;
  readonly reason: "exited" | "terminated" | "error";
  /** Human-readable detail when the exit was unexpected (adapter failure, not process exit). */
  readonly message?: string;
}

export interface TerminalSpawnSpec {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly cols: number;
  readonly rows: number;
  /** Adapter-specific connection facts (e.g. the SSH world's durable descriptor), opaque to the service. */
  readonly worldFacts?: unknown;
}

export interface TerminalSpawnCallbacks {
  /** Raw PTY output. Called with byte chunks; may interleave with exit(). */
  data(chunk: Uint8Array): void;
  /** Called exactly once when the process (or the adapter connection) is gone. */
  exit(info: TerminalExitInfo): void;
}

/** One live interactive session in one execution world. */
export interface TerminalHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Terminate the whole process tree, then close the PTY. Idempotent. */
  terminate(): Promise<TerminalExitInfo>;
}

export interface TerminalPort {
  /** Mirrors the execution-world kind this port serves ("local" | "ssh" | "wsl"). */
  readonly kind: string;
  spawn(spec: TerminalSpawnSpec, on: TerminalSpawnCallbacks): Promise<TerminalHandle>;
}

export class TerminalSpawnError extends Error {
  override readonly name = "TerminalSpawnError";
  constructor(message: string, readonly detail?: unknown) {
    super(message);
  }
}
