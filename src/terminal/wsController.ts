// The terminal stream endpoint: one same-origin websocket per attached terminal view
// (`/terminal/stream?session=<id>`), authenticated by the first message. The browser cannot
// set an Authorization header on a websocket, and the token must never travel in the URL, so
// the client sends `{type:"auth", token}` before anything else; the server resolves it through
// the same durable-session authenticator every other request uses and only then binds the
// socket to the session — whose owner must match the token's identity.
import type { Caller } from "@godspeedai/cognate-runtime-api";
import type { TerminalService, AttachedSocket } from "./service.ts";
import { TerminalAccessError, TerminalUnknownError } from "./service.ts";

export interface TerminalWsDeps {
  readonly service: TerminalService;
  /** The server's session-token authenticator: token string → Caller, or undefined when unauthenticated. */
  readonly authenticate: (token: string) => Promise<Caller | undefined>;
}

export interface TerminalSocketData {
  authed: boolean;
  tenant?: string;
  actorId?: string;
  sessionId?: string;
  /** Which endpoint upgraded this socket — the two stream controllers share one Bun websocket. */
  surface?: "terminal" | "browser";
}

const MAX_PAYLOAD = 64_000;

// Minimal AttachedSocket adapter over Bun's ServerWebSocket lives in server.ts; this module
// stays runtime-agnostic by accepting the three primitives the service needs.

export function terminalWsController(deps: TerminalWsDeps) {
  const { service, authenticate } = deps;

  function socketOf(ws: { send(data: string | Uint8Array): void; close(code: number, reason: string): void }): AttachedSocket {
    return {
      sendText: (payload) => ws.send(payload),
      sendBinary: (data) => ws.send(data),
      close: (code, reason) => ws.close(code, reason),
    };
  }

  return {
    async open(ws: { send(data: string | Uint8Array): void; close(code: number, reason: string): void; data: TerminalSocketData }): Promise<void> {
      // Unauthenticated sockets get 5 seconds to present their token.
      const guard = setTimeout(() => {
        if (!ws.data.authed) ws.close(3001, "terminal: authentication expected");
      }, 5000);
      guard.unref?.();
    },

    async message(ws: { send(data: string | Uint8Array): void; close(code: number, reason: string): void; data: TerminalSocketData }, raw: string | Buffer): Promise<void> {
      if (typeof raw !== "string" || raw.length > MAX_PAYLOAD) {
        ws.close(3002, "terminal: oversized or binary client frame");
        return;
      }
      let message: { type?: string; token?: string; data?: string; cols?: number; rows?: number };
      try {
        message = JSON.parse(raw);
      } catch {
        ws.close(3002, "terminal: malformed control frame");
        return;
      }
      if (!ws.data.authed) {
        if (message.type !== "auth" || typeof message.token !== "string") {
          ws.close(3001, "terminal: authentication expected");
          return;
        }
        const caller = await authenticate(message.token);
        if (!caller) {
          ws.close(3003, "terminal: authentication refused");
          return;
        }
        ws.data.authed = true;
        ws.data.tenant = caller.tenant;
        ws.data.actorId = caller.actor.id;
        const sessionId = ws.data.sessionId;
        if (!sessionId) {
          ws.close(3004, "terminal: no session requested");
          return;
        }
        try {
          const view = service.attach(sessionId, { tenant: caller.tenant, actorId: caller.actor.id }, socketOf(ws));
          ws.send(JSON.stringify({ type: "attached", session: view }));
        } catch (error) {
          if (error instanceof TerminalAccessError) {
            ws.close(3005, "terminal: not your session");
          } else if (error instanceof TerminalUnknownError) {
            ws.send(JSON.stringify({ type: "dead", sessionId }));
            ws.close(1000, "terminal: session not live");
          } else {
            ws.close(1011, "terminal: attach failed");
          }
        }
        return;
      }
      const owner = { tenant: ws.data.tenant!, actorId: ws.data.actorId! };
      const sessionId = ws.data.sessionId!;
      try {
        switch (message.type) {
          case "input":
            if (typeof message.data !== "string") throw new TerminalAccessError("terminal: input must be a string");
            service.input(sessionId, owner, message.data);
            break;
          case "resize":
            service.resize(sessionId, owner, Number(message.cols), Number(message.rows));
            break;
          case "ping":
            ws.send(JSON.stringify({ type: "pong" }));
            break;
          case "detach":
            service.detach(sessionId, owner, socketOf(ws));
            ws.close(1000, "terminal: detached");
            break;
          default:
            ws.close(3002, "terminal: unknown control frame");
        }
      } catch (error) {
        if (error instanceof TerminalAccessError || error instanceof TerminalUnknownError) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        } else {
          ws.close(1011, "terminal: control failed");
        }
      }
    },

    close(ws: { data: TerminalSocketData }): void {
      if (ws.data.authed && ws.data.sessionId && ws.data.tenant && ws.data.actorId) {
        service.detach(ws.data.sessionId, { tenant: ws.data.tenant, actorId: ws.data.actorId }, {
          sendText: () => {},
          sendBinary: () => {},
          close: () => {},
        });
      }
    },
  };
}
