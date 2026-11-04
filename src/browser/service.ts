// J-BROWSER-session: the shared browser service. One managed browser per session (one
// agent-browser session), one controller at a time, one live-viewport proxy per session.
//
// Ephemeral/ephemeral/ephemeral: the browser process, the frames and the daemon live here and
// die with the process; the durable truth is `workbench.browser.*` events (metadata, control
// handoffs, closes) folded into the workbench projection. After a restart, stale rows render
// as sessions of an earlier run and cannot be reattached to.
//
// The stream proxy exists because the panel must never touch the daemon's own websocket: the
// daemon binds an unauthenticated localhost port, and the Workbench's CSP (correctly) allows
// same-origin connections only. The backend is the authenticated broker — and the place where
// control ownership is enforced, so a human cannot type into a page the agent is driving.
import { randomUUID } from "node:crypto";
import type { BrowserProvider, PageState, ViewportSpec } from "./provider.ts";
import { BrowserProviderError } from "./provider.ts";

export type Controller = "human" | "agent";

export interface BrowserOwner {
  readonly tenant: string;
  readonly actorId: string;
}

export interface BrowserSessionView {
  readonly sessionId: string;
  readonly providerId: string;
  readonly url: string | undefined;
  readonly title: string | undefined;
  readonly controller: Controller;
  readonly status: "running" | "closed";
  readonly workspaceId?: string;
  readonly createdAt: number;
  readonly attachedClients: number;
}

interface StreamSocket {
  sendText(payload: string): void;
  sendBinary(data: Uint8Array): void;
  close(code: number, reason: string): void;
}

interface BrowserSession {
  readonly id: string;
  readonly name: string;
  readonly provider: BrowserProvider;
  readonly owner: BrowserOwner;
  controller: Controller;
  status: "running" | "closed";
  page?: PageState;
  workspaceId?: string;
  readonly createdAt: number;
  readonly clients: Set<StreamSocket>;
  stream?: { port: number; ws: WebSocket };
  /** Frames flow only when someone is attached (the daemon also caps per-client). */
  readonly createdAtName: string;
}

const MAX_SESSIONS = 8;

export interface BrowserServiceOptions {
  readonly provider: BrowserProvider;
  /** Session names are prefixed so closeAll (and a human's own agent-browser use) never collide. */
  readonly sessionPrefix?: string;
  readonly now?: () => number;
}

export class BrowserAccessError extends Error {
  override readonly name = "BrowserAccessError";
}

export class BrowserUnknownError extends Error {
  override readonly name = "BrowserUnknownError";
  constructor(sessionId: string) {
    super(`browser: session ${sessionId} is not live on this server (it may have been closed, or belonged to an earlier run)`);
  }
}

export class BrowserService {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly provider: BrowserProvider;
  private readonly prefix: string;
  private readonly now: () => number;

  constructor(options: BrowserServiceOptions) {
    this.provider = options.provider;
    this.prefix = options.sessionPrefix ?? "cognate-wb-";
    this.now = options.now ?? Date.now;
  }

  private require(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new BrowserUnknownError(sessionId);
    return session;
  }

  view(session: BrowserSession): BrowserSessionView {
    return {
      sessionId: session.id,
      providerId: session.provider.id,
      url: session.page?.url,
      title: session.page?.title,
      controller: session.controller,
      status: session.status,
      ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
      createdAt: session.createdAt,
      attachedClients: session.clients.size,
    };
  }

  list(owner: BrowserOwner): readonly BrowserSessionView[] {
    return [...this.sessions.values()]
      .filter((session) => session.owner.tenant === owner.tenant && session.owner.actorId === owner.actorId)
      .map((session) => this.view(session));
  }

  async open(input: {
    owner: BrowserOwner;
    url?: string;
    viewport?: ViewportSpec;
    workspaceId?: string;
  }): Promise<BrowserSessionView> {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new BrowserProviderError(`browser: at most ${MAX_SESSIONS} live sessions are supported — close one first`);
    }
    const id = randomUUID();
    const name = `${this.prefix}${id.slice(0, 8)}`;
    const session: BrowserSession = {
      id,
      name,
      provider: this.provider,
      owner: input.owner,
      controller: "human",
      status: "running",
      workspaceId: input.workspaceId,
      createdAt: this.now(),
      clients: new Set(),
      createdAtName: name,
    };
    this.sessions.set(id, session);
    try {
      session.page = await this.provider.open(name, { ...(input.url ? { url: input.url } : {}), ...(input.viewport ? { viewport: input.viewport } : {}) });
    } catch (error) {
      this.sessions.delete(id);
      throw error;
    }
    return this.view(session);
  }

  private assertController(session: BrowserSession, controller: Controller): void {
    if (session.controller !== controller) {
      throw new BrowserAccessError(`browser: ${session.controller} control holds this session — take control first (browser.control)`);
    }
  }

  async navigate(sessionId: string, controller: Controller, url: string): Promise<BrowserSessionView> {
    const session = this.require(sessionId);
    if (session.status !== "running") throw new BrowserUnknownError(sessionId);
    this.assertController(session, controller);
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new BrowserAccessError(`browser: only http(s) navigation is offered (got ${parsed.protocol})`);
    }
    session.page = await this.provider.navigate(session.name, url);
    this.broadcastState(session);
    return this.view(session);
  }

  async snapshot(sessionId: string): Promise<string> {
    const session = this.require(sessionId);
    if (session.status !== "running") throw new BrowserUnknownError(sessionId);
    // Reads are available to either controller: observation never conflicts with input.
    return this.provider.snapshot(session.name);
  }

  async screenshot(sessionId: string, outputPath: string): Promise<string> {
    const session = this.require(sessionId);
    if (session.status !== "running") throw new BrowserUnknownError(sessionId);
    await this.provider.screenshot(session.name, outputPath);
    return outputPath;
  }

  async evaluate(sessionId: string, controller: Controller, expression: string): Promise<unknown> {
    const session = this.require(sessionId);
    if (session.status !== "running") throw new BrowserUnknownError(sessionId);
    // Evaluation mutates pages arbitrarily: it is a controlled write, not an observation.
    this.assertController(session, controller);
    return this.provider.evaluate(session.name, expression);
  }

  async setViewport(sessionId: string, controller: Controller, viewport: ViewportSpec): Promise<BrowserSessionView> {
    const session = this.require(sessionId);
    if (session.status !== "running") throw new BrowserUnknownError(sessionId);
    this.assertController(session, controller);
    await this.provider.setViewport(session.name, viewport);
    return this.view(session);
  }

  async errors(sessionId: string): Promise<readonly string[]> {
    const session = this.require(sessionId);
    if (session.status !== "running") throw new BrowserUnknownError(sessionId);
    return this.provider.errors(session.name);
  }

  /** Explicit handoff. Recorded as an event by the capability layer. */
  setController(sessionId: string, controller: Controller, actorId: string): BrowserSessionView {
    const session = this.require(sessionId);
    if (session.status !== "running") throw new BrowserUnknownError(sessionId);
    if (session.controller !== controller) {
      session.controller = controller;
      this.broadcast(session, { type: "control", controller, actorId });
    }
    return this.view(session);
  }

  async close(sessionId: string): Promise<void> {
    const session = this.require(sessionId);
    if (session.status === "running") {
      session.status = "closed";
      await session.provider.close(session.name);
    }
    this.teardownStream(session);
    for (const client of session.clients) {
      try {
        client.sendText(JSON.stringify({ type: "closed", sessionId }));
        client.close(1000, "browser session closed");
      } catch {
        /* already gone */
      }
    }
    session.clients.clear();
    this.sessions.delete(sessionId);
  }

  /** Attach one UI socket. Frames are proxied from the daemon; input is ownership-checked. */
  attach(sessionId: string, owner: BrowserOwner, socket: StreamSocket): BrowserSessionView {
    const session = this.require(sessionId);
    if (session.status !== "running") throw new BrowserUnknownError(sessionId);
    if (session.owner.tenant !== owner.tenant || session.owner.actorId !== owner.actorId) {
      throw new BrowserAccessError(`browser: session ${sessionId} belongs to another operator`);
    }
    session.clients.add(socket);
    void this.ensureStream(session);
    socket.sendText(JSON.stringify({ type: "state", session: this.view(session) }));
    return this.view(session);
  }

  detach(sessionId: string, socket: StreamSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.clients.delete(socket);
  }

  /** Human input over the stream. Refused while the agent holds control. */
  streamInput(sessionId: string, owner: BrowserOwner, message: Record<string, unknown>): void {
    const session = this.require(sessionId);
    if (session.status !== "running") throw new BrowserUnknownError(sessionId);
    if (session.owner.tenant !== owner.tenant || session.owner.actorId !== owner.actorId) {
      throw new BrowserAccessError("browser: not your session");
    }
    this.assertController(session, "human");
    const stream = session.stream;
    if (!stream || stream.ws.readyState !== WebSocket.OPEN) {
      throw new BrowserAccessError("browser: the viewport stream is not connected");
    }
    const kind = String(message.type ?? "");
    if (kind !== "input_mouse" && kind !== "input_keyboard" && kind !== "input_touch") {
      throw new BrowserAccessError(`browser: unsupported input ${kind}`);
    }
    stream.ws.send(JSON.stringify(message));
  }

  private broadcast(session: BrowserSession, message: Record<string, unknown>): void {
    const payload = JSON.stringify(message);
    for (const client of session.clients) {
      try {
        client.sendText(payload);
      } catch {
        session.clients.delete(client);
      }
    }
  }

  private broadcastState(session: BrowserSession): void {
    this.broadcast(session, { type: "state", session: this.view(session) });
  }

  private async ensureStream(session: BrowserSession): Promise<void> {
    if (session.stream && session.stream.ws.readyState === WebSocket.OPEN) return;
    if (session.stream) {
      try {
        session.stream.ws.close();
      } catch {
        /* replacing */
      }
      session.stream = undefined;
    }
    let port: number;
    try {
      port = await this.provider.streamPort(session.name);
    } catch (error) {
      this.broadcast(session, { type: "stream-error", message: (error as Error).message });
      return;
    }
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?maxFps=30`);
    const stream = { port, ws };
    session.stream = stream;
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data) as { type?: string; data?: string; url?: string; text?: string; level?: string };
          if (message.type === "status" || message.type === "tabs" || message.type === "command") {
            // Internal daemon plumbing stays internal; the panel gets our own state messages.
            return;
          }
          if (message.type === "frame" && typeof message.data === "string") {
            // Frames travel as base64 JPEG inside JSON; the panel gets raw bytes.
            const bytes = Uint8Array.from(atob(message.data), (character) => character.charCodeAt(0));
            for (const client of session.clients) {
              try {
                client.sendBinary(bytes);
              } catch {
                session.clients.delete(client);
              }
            }
            return;
          }
          // url (navigations) and console (page errors) are the live feed the panel shows.
          if (message.type === "url" || message.type === "console") {
            this.broadcast(session, message);
          }
        } catch {
          /* malformed daemon message: ignore */
        }
        return;
      }
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      for (const client of session.clients) {
        try {
          client.sendBinary(bytes);
        } catch {
          session.clients.delete(client);
        }
      }
    });
    ws.addEventListener("close", () => {
      if (session.stream === stream) session.stream = undefined;
      // The next attach re-establishes the stream; attached clients see it via state messages.
    });
    ws.addEventListener("error", () => {
      this.broadcast(session, { type: "stream-error", message: "the browser viewport stream dropped" });
    });
  }

  private teardownStream(session: BrowserSession): void {
    if (session.stream) {
      try {
        session.stream.ws.close();
      } catch {
        /* already closed */
      }
      session.stream = undefined;
    }
  }

  /** Server shutdown: every managed browser closes with it. */
  async dispose(): Promise<void> {
    const running = [...this.sessions.values()].filter((session) => session.status === "running");
    await Promise.allSettled(running.map((session) => this.provider.close(session.name)));
    for (const session of this.sessions.values()) {
      this.teardownStream(session);
      for (const client of session.clients) {
        try {
          client.close(1000, "server stopping");
        } catch {
          /* already gone */
        }
      }
      session.clients.clear();
    }
    this.sessions.clear();
  }
}

export type { StreamSocket };
