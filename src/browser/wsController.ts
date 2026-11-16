// The shared browser's stream endpoint: one same-origin websocket per attached browser panel
// (`/browser/stream?session=<id>`), first-message authenticated exactly like the terminal
// stream. Frames flow backend→panel; mouse/keyboard/touch flow panel→backend and are refused
// while the agent holds control — the ownership rule lives in the service, not in the client.
import type { Caller } from "@godspeedai/cognate-runtime-api";
import type { BrowserService } from "./service.ts";
import { BrowserAccessError, BrowserUnknownError } from "./service.ts";

export interface BrowserSocketData {
  authed: boolean;
  tenant?: string;
  actorId?: string;
  sessionId?: string;
}

const MAX_PAYLOAD = 64_000;

export function browserWsController(deps: { readonly service: BrowserService; readonly authenticate: (token: string) => Promise<Caller | undefined> }) {
  const { service, authenticate } = deps;

  const socketOf = (ws: { send(data: string | Uint8Array): void; close(code: number, reason: string): void }) => ({
    sendText: (payload: string) => ws.send(payload),
    sendBinary: (data: Uint8Array) => ws.send(data),
    close: (code: number, reason: string) => ws.close(code, reason),
  });

  return {
    async open(ws: { send(data: string | Uint8Array): void; close(code: number, reason: string): void; data: BrowserSocketData }): Promise<void> {
      const guard = setTimeout(() => {
        if (!ws.data.authed) ws.close(3001, "browser: authentication expected");
      }, 5000);
      guard.unref?.();
    },

    async message(ws: { send(data: string | Uint8Array): void; close(code: number, reason: string): void; data: BrowserSocketData }, raw: string | Buffer): Promise<void> {
      if (typeof raw !== "string" || raw.length > MAX_PAYLOAD) {
        ws.close(3002, "browser: oversized or binary client frame");
        return;
      }
      let message: { type?: string; token?: string } & Record<string, unknown>;
      try {
        message = JSON.parse(raw);
      } catch {
        ws.close(3002, "browser: malformed control frame");
        return;
      }
      if (!ws.data.authed) {
        if (message.type !== "auth" || typeof message.token !== "string") {
          ws.close(3001, "browser: authentication expected");
          return;
        }
        const caller = await authenticate(message.token);
        if (!caller) {
          ws.close(3003, "browser: authentication refused");
          return;
        }
        ws.data.authed = true;
        ws.data.tenant = caller.tenant;
        ws.data.actorId = caller.actor.id;
        const sessionId = ws.data.sessionId;
        if (!sessionId) {
          ws.close(3004, "browser: no session requested");
          return;
        }
        try {
          service.attach(sessionId, { tenant: caller.tenant, actorId: caller.actor.id }, socketOf(ws));
        } catch (error) {
          if (error instanceof BrowserAccessError) {
            ws.close(3005, "browser: not your session");
          } else if (error instanceof BrowserUnknownError) {
            ws.send(JSON.stringify({ type: "dead", sessionId }));
            ws.close(1000, "browser: session not live");
          } else {
            ws.close(1011, "browser: attach failed");
          }
        }
        return;
      }
      const owner = { tenant: ws.data.tenant!, actorId: ws.data.actorId! };
      const sessionId = ws.data.sessionId!;
      try {
        switch (message.type) {
          // CDP-style input frames arrive as their own message type; the service re-validates.
          case "input_mouse":
          case "input_keyboard":
          case "input_touch":
            service.streamInput(sessionId, owner, message as Record<string, unknown>);
            break;
          case "ping":
            ws.send(JSON.stringify({ type: "pong" }));
            break;
          case "detach":
            service.detach(sessionId, socketOf(ws));
            ws.close(1000, "browser: detached");
            break;
          default:
            ws.close(3002, "browser: unknown control frame");
        }
      } catch (error) {
        if (error instanceof BrowserAccessError || error instanceof BrowserUnknownError) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        } else {
          ws.close(1011, "browser: control failed");
        }
      }
    },

    close(ws: { data: BrowserSocketData }): void {
      if (ws.data.authed && ws.data.sessionId) {
        service.detach(ws.data.sessionId, {
          sendText: () => {},
          sendBinary: () => {},
          close: () => {},
        });
      }
    },
  };
}
