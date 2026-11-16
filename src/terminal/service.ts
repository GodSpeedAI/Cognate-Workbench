// J-TERMINAL-session: the terminal session service. Owns live PTY-backed sessions — an
// emphatically ephemeral registry: process handles, streams and the bounded scrollback ring
// live in memory only. The durable truth is the event log (`workbench.terminal.*` events
// recorded through the capabilities in `src/capabilities/terminal.ts`); after a restart this
// registry is empty and stale rows render as what they are: sessions from an earlier run.
//
// Authority: every mutating or observing entry point checks the session's owner (the caller
// that opened it). An identity without ownership learns nothing about the stream — no
// cross-session data exposure.
import { randomUUID } from "node:crypto";
import type { TerminalHandle, TerminalExitInfo, TerminalPort } from "./types.ts";
import { TerminalSpawnError } from "./types.ts";

export interface TerminalOwner {
  readonly tenant: string;
  readonly actorId: string;
}

export interface TerminalSessionView {
  readonly sessionId: string;
  readonly worldId: string;
  readonly worldKind: string;
  readonly workspaceId: string | undefined;
  readonly workspaceLabel: string | undefined;
  readonly cwd: string;
  readonly shell: string;
  readonly cols: number;
  readonly rows: number;
  readonly status: "running" | "exited";
  readonly exit?: TerminalExitInfo;
  readonly attachedClients: number;
}

export interface TerminalOpenInput {
  readonly owner: TerminalOwner;
  readonly worldId: string;
  readonly worldKind: string;
  readonly workspaceId?: string;
  readonly workspaceLabel?: string;
  readonly cwd: string;
  /** The command to run as the session (e.g. ["bash","-l"] or ["bash"]); argv[0] is the display name. */
  readonly argv: readonly string[];
  readonly cols: number;
  readonly rows: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly worldFacts?: unknown;
}

const MAX_SCROLLBACK_BYTES = 1_000_000;
const MAX_MESSAGE_BYTES = 32_000;

interface AttachedSocket {
  sendText(payload: string): void;
  sendBinary(data: Uint8Array): void;
  close(code: number, reason: string): void;
}

interface TerminalSession {
  readonly id: string;
  readonly worldId: string;
  readonly worldKind: string;
  readonly workspaceId: string | undefined;
  readonly workspaceLabel: string | undefined;
  readonly cwd: string;
  readonly shell: string;
  readonly argv: readonly string[];
  readonly owner: TerminalOwner;
  handle: TerminalHandle;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exit?: TerminalExitInfo;
  /** True while a deliberate termination is in flight, so the process-exit callback does not double-record. */
  operatorTerminating: boolean;
  readonly sockets: Set<AttachedSocket>;
  /** Bounded scrollback for reattach, newest last. Raw bytes — never persisted. */
  readonly scrollback: Uint8Array[];
  scrollbackBytes: number;
  lastActivityAt: number;
  readonly createdAt: number;
}

export interface TerminalServiceOptions {
  readonly ports: Readonly<Record<string, TerminalPort>>;
  /** Terminated (not exited) sessions older than this with no attached client are reaped. */
  readonly idleTimeoutMs?: number;
  readonly now?: () => number;
}

export class TerminalAccessError extends Error {
  override readonly name = "TerminalAccessError";
}

export class TerminalUnknownError extends Error {
  override readonly name = "TerminalUnknownError";
  constructor(sessionId: string) {
    super(`terminal: session ${sessionId} is not live on this server (it may have ended, or belonged to an earlier run)`);
  }
}

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly ports: Readonly<Record<string, TerminalPort>>;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;
  private reaper: ReturnType<typeof setInterval> | undefined;
  private disposing = false;
  private onClosedHook: ((sessionId: string, info: TerminalExitInfo) => void) | undefined;

  constructor(options: TerminalServiceOptions) {
    this.ports = options.ports;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60_000;
    this.now = options.now ?? Date.now;
  }

  /** The capabilities register this to record durable transitions when a process ends on its own. */
  set onClosed(hook: (sessionId: string, info: TerminalExitInfo) => void) {
    this.onClosedHook = hook;
  }

  start(): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => this.reap(), 60_000);
    this.reaper.unref?.();
  }

  private reap(): void {
    if (this.disposing) return;
    const cutoff = this.now() - this.idleTimeoutMs;
    for (const session of this.sessions.values()) {
      if (session.sockets.size === 0 && session.status === "running" && session.lastActivityAt < cutoff) {
        void this.reapSession(session);
      }
    }
  }

  private async reapSession(session: TerminalSession): Promise<void> {
    session.operatorTerminating = true;
    const info = await session.handle.terminate();
    if (session.status !== "exited") this.onExit(session, info, false);
    this.onClosedHook?.(session.id, { ...info, reason: "terminated", message: "idle timeout with no attached client" });
  }

  async open(input: TerminalOpenInput): Promise<{ sessionId: string; view: TerminalSessionView }> {
    const port = this.ports[input.worldKind];
    if (!port) throw new TerminalSpawnError(`terminal: no port for world kind '${input.worldKind}'`);
    const id = randomUUID();
    const session: TerminalSession = {
      id,
      worldId: input.worldId,
      worldKind: input.worldKind,
      workspaceId: input.workspaceId,
      workspaceLabel: input.workspaceLabel,
      cwd: input.cwd,
      shell: input.argv[0] ?? "sh",
      argv: [...input.argv],
      owner: input.owner,
      // Filled by the awaited spawn below; data/exit callbacks only touch the session itself.
      handle: undefined as unknown as TerminalHandle,
      cols: input.cols,
      rows: input.rows,
      status: "running",
      operatorTerminating: false,
      sockets: new Set(),
      scrollback: [],
      scrollbackBytes: 0,
      lastActivityAt: this.now(),
      createdAt: this.now(),
    };
    // Reserve before spawn so a fast exit callback can never race a missing entry.
    this.sessions.set(id, session);
    try {
      session.handle = await port.spawn(
        {
          argv: input.argv,
          cwd: input.cwd,
          env: input.env,
          cols: input.cols,
          rows: input.rows,
          worldFacts: input.worldFacts,
        },
        {
          data: (chunk) => this.onData(session, chunk),
          exit: (info) => this.onExit(session, info, !session.operatorTerminating),
        },
      );
    } catch (error) {
      this.sessions.delete(id);
      throw error;
    }
    return { sessionId: id, view: this.view(session) };
  }

  private onData(session: TerminalSession, chunk: Uint8Array): void {
    session.lastActivityAt = this.now();
    if (session.status !== "running") return;
    // Bounded scrollback: drop oldest chunks until the new chunk fits.
    if (chunk.byteLength > MAX_SCROLLBACK_BYTES) {
      session.scrollback.length = 0;
      session.scrollbackBytes = 0;
      session.scrollback.push(chunk.slice(chunk.byteLength - MAX_SCROLLBACK_BYTES));
      session.scrollbackBytes = MAX_SCROLLBACK_BYTES;
    } else {
      session.scrollback.push(chunk);
      session.scrollbackBytes += chunk.byteLength;
      while (session.scrollbackBytes > MAX_SCROLLBACK_BYTES && session.scrollback.length > 1) {
        const dropped = session.scrollback.shift()!;
        session.scrollbackBytes -= dropped.byteLength;
      }
    }
    for (const socket of session.sockets) {
      try {
        socket.sendBinary(chunk);
      } catch {
        session.sockets.delete(socket);
      }
    }
  }

  private onExit(session: TerminalSession, info: TerminalExitInfo, notify: boolean): void {
    if (session.status === "exited") return;
    session.status = "exited";
    session.exit = info;
    for (const socket of session.sockets) {
      try {
        socket.sendText(JSON.stringify({ type: "closed", sessionId: session.id, ...info }));
        socket.close(1000, "terminal closed");
      } catch {
        /* already gone */
      }
    }
    session.sockets.clear();
    if (notify && !this.disposing) this.onClosedHook?.(session.id, info);
  }

  private require(sessionId: string, owner: TerminalOwner): TerminalSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new TerminalUnknownError(sessionId);
    if (session.owner.tenant !== owner.tenant || session.owner.actorId !== owner.actorId) {
      throw new TerminalAccessError(`terminal: session ${sessionId} belongs to another operator`);
    }
    return session;
  }

  view(session: TerminalSession): TerminalSessionView {
    return {
      sessionId: session.id,
      worldId: session.worldId,
      worldKind: session.worldKind,
      workspaceId: session.workspaceId,
      workspaceLabel: session.workspaceLabel,
      cwd: session.cwd,
      shell: session.shell,
      cols: session.cols,
      rows: session.rows,
      status: session.status,
      ...(session.exit ? { exit: session.exit } : {}),
      attachedClients: session.sockets.size,
    };
  }

  list(owner: TerminalOwner): readonly TerminalSessionView[] {
    return [...this.sessions.values()]
      .filter((session) => session.owner.tenant === owner.tenant && session.owner.actorId === owner.actorId)
      .map((session) => this.view(session));
  }

  /** Liveness probe for the UI: dead sessions from earlier boots simply answer false. */
  isLive(sessionId: string, owner: TerminalOwner): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && session.owner.tenant === owner.tenant && session.owner.actorId === owner.actorId && session.status === "running";
  }

  attach(sessionId: string, owner: TerminalOwner, socket: AttachedSocket): TerminalSessionView {
    const session = this.require(sessionId, owner);
    if (session.status !== "running") {
      socket.sendText(JSON.stringify({ type: "closed", sessionId, ...(session.exit ?? { exitCode: null, reason: "exited" }) }));
      socket.close(1000, "terminal closed");
      throw new TerminalUnknownError(sessionId);
    }
    session.sockets.add(socket);
    // Reattach experience: bounded scrollback, newest last, before any new data flows.
    for (const chunk of session.scrollback) socket.sendBinary(chunk);
    return this.view(session);
  }

  detach(sessionId: string, owner: TerminalOwner, socket: AttachedSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.owner.actorId !== owner.actorId || session.owner.tenant !== owner.tenant) return;
    session.sockets.delete(socket);
  }

  input(sessionId: string, owner: TerminalOwner, data: string): void {
    const session = this.require(sessionId, owner);
    if (session.status !== "running") throw new TerminalUnknownError(sessionId);
    if (data.length > MAX_MESSAGE_BYTES) throw new TerminalAccessError("terminal: input chunk exceeds the message limit");
    session.lastActivityAt = this.now();
    session.handle.write(data);
  }

  resize(sessionId: string, owner: TerminalOwner, cols: number, rows: number): void {
    const session = this.require(sessionId, owner);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 500 || rows > 300) {
      throw new TerminalAccessError("terminal: resize dimensions are out of range");
    }
    session.cols = cols;
    session.rows = rows;
    session.lastActivityAt = this.now();
    session.handle.resize(cols, rows);
  }

  /** Operator-initiated termination. The caller (capability) records the durable transition. */
  async terminate(sessionId: string, owner: TerminalOwner): Promise<TerminalExitInfo> {
    const session = this.require(sessionId, owner);
    if (session.status === "exited") return session.exit!;
    session.operatorTerminating = true;
    const info = await session.handle.terminate();
    // The port's own exit callback may have recorded the real exit status during the await.
    if ((session.status as string) !== "exited") this.onExit(session, info, false);
    return session.exit ?? info;
  }

  /** Server shutdown: terminate every live session without recording closes (the process is ending). */
  async dispose(): Promise<void> {
    this.disposing = true;
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = undefined;
    const running = [...this.sessions.values()].filter((session) => session.status === "running");
    await Promise.allSettled(running.map((session) => this.reapSession(session)));
    this.sessions.clear();
  }
}

export type { AttachedSocket };
