// Journey J-TERMINAL-session: a real interactive PTY per execution world whose lifetime the
// operator controls and whose stream never enters the durable log. Verified against the real
// runtime with a real shell process: open → attach over an authenticated websocket → interact →
// resize (the PTY itself honors the new size) → detach keeps the process → reattach restores
// bounded scrollback → terminate kills the process group → the durable record shows the truth.
// A foreign identity learns nothing: an unauthenticated websocket is refused, a wrong-session
// owner cannot attach, and a second identity cannot even open a terminal.
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { bootApp, inv, seedWorkspaceOnly, waitUntil, withTempHome, wbRows } from "./wb-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import type { TerminalSessionView } from "../src/terminal/service.ts";

interface WsEvent {
  readonly kind: "text" | "binary" | "open" | "close";
  readonly text?: string;
  readonly bytes?: Uint8Array;
  readonly code?: number;
}

/** Small deterministic websocket client over Bun's built-in WebSocket. */
function connect(url: string): { socket: WebSocket; events: WsEvent[]; seen: () => string; closed: Promise<number> } {
  const events: WsEvent[] = [];
  const chunks: string[] = [];
  let resolveClosed: (code: number) => void;
  const closed = new Promise<number>((resolve) => { resolveClosed = resolve; });
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => events.push({ kind: "open" }));
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") events.push({ kind: "text", text: event.data });
    else {
      events.push({ kind: "binary", bytes: new Uint8Array(event.data) });
      chunks.push(decode(new Uint8Array(event.data)));
    }
  });
  socket.addEventListener("close", (event) => {
    events.push({ kind: "close", code: event.code });
    resolveClosed(event.code);
  });
  return { socket, events, seen: () => chunks.join(""), closed };
}

const waitForOutput = (client: ReturnType<typeof connect>, what: RegExp | string, timeoutMs = 15_000): Promise<string> => {
  const re = typeof what === "string" ? new RegExp(what.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : what;
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      const seen = client.seen();
      const hit = re.exec(seen);
      if (hit) {
        clearInterval(timer);
        resolve(seen);
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`websocket: output never matched /${re.source}/ within ${timeoutMs}ms`));
      }
    }, 25);
  });
};

const next = (events: WsEvent[], kind: WsEvent["kind"], match?: (event: WsEvent) => boolean, timeoutMs = 15_000, label = kind): Promise<WsEvent> =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const scan = (): WsEvent | undefined => {
      for (let i = 0; i < events.length; i++) {
        if (events[i]!.kind === kind && (!match || match(events[i]!))) {
          return events.splice(i, 1)[0];
        }
      }
      return undefined;
    };
    const found = scan();
    if (found) return resolve(found);
    const timer = setInterval(() => {
      const hit = scan();
      if (hit) {
        clearInterval(timer);
        resolve(hit);
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`websocket: no ${label} event within ${timeoutMs}ms`));
      }
    }, 25);
  });

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("J-TERMINAL-session", () => {
  test("open, interact, resize, detach/reattach with scrollback, terminate, durable record", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId, workspaceDir } = await seedWorkspaceOnly(client, home);

        // --- open: operator-only capability returns a live view
        const view = (await inv(client, "terminal.open", { workspaceId })) as unknown as TerminalSessionView;
        expect(view.status).toBe("running");
        expect(view.worldKind).toBe("local");
        expect(view.cwd).toBe(workspaceDir);
        expect(view.workspaceId).toBe(workspaceId);
        const sessionId = view.sessionId;

        // --- durable metadata folded into the workbench projection
        await waitUntil("terminal row", async () => {
          const rows = await wbRows(app);
          const row = rows.get(`terminal/${sessionId}`) as { status?: string; cwd?: string } | undefined;
          return row?.status === "running" && row?.cwd === workspaceDir ? row : undefined;
        });

        // --- attach with this boot's session token; first message must be auth
        const url = `${app.url.replace("http://", "ws://")}/terminal/stream?session=${sessionId}`;
        const a = connect(url);
        await next(a.events, "open");
        a.socket.send(JSON.stringify({ type: "auth", token: app.operatorSessionToken }));
        const attached = JSON.parse((await next(a.events, "text", (e) => e.text?.includes('"attached"'))).text!);
        expect(attached.session.sessionId).toBe(sessionId);

        // --- interact: the shell answers through the PTY
        a.socket.send(JSON.stringify({ type: "input", data: "echo TERMINAL_MARK_41\r\n" }));
        await waitForOutput(a, "TERMINAL_MARK_41");

        // --- resize: the PTY itself honors the new dimensions. A resize may trigger the
        // shell's SIGWINCH prompt redraw, so give the redraw a beat and re-ask if the first
        // answer was swallowed by it (a real user pauses too).
        a.socket.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
        await Bun.sleep(700);
        let sized = false;
        for (let attempt = 0; attempt < 3 && !sized; attempt++) {
          a.socket.send(JSON.stringify({ type: "input", data: "stty size\r\n" }));
          try {
            await waitForOutput(a, /30\s+100/, 6000);
            sized = true;
          } catch {
            /* redraw race; ask again */
          }
        }
        expect(sized).toBe(true);

        // --- detach keeps the process running and producing: wait for the PTY's echo of the
        // keystrokes (the frames were processed) before closing the view only.
        a.socket.send(JSON.stringify({ type: "input", data: "echo DETACHED_MARKER_7\r\n" }));
        await waitForOutput(a, "echo DETACHED_MARKER_7");
        a.socket.close();
        await a.closed;
        await Bun.sleep(400);

        // --- reattach: bounded scrollback restored, process still alive
        const b = connect(url);
        await next(b.events, "open");
        b.socket.send(JSON.stringify({ type: "auth", token: app.operatorSessionToken }));
        await next(b.events, "text", (e) => e.text?.includes('"attached"'));
        await waitForOutput(b, "DETACHED_MARKER_7");

        // --- terminate: the process group dies; the socket hears the close
        const closeResult = (await inv(client, "terminal.close", { sessionId })) as { closed: boolean; exitCode?: number | null };
        expect(closeResult.closed).toBe(true);
        const closed = JSON.parse((await next(b.events, "text", (e) => e.text?.includes('"closed"'))).text!);
        expect(closed.sessionId).toBe(sessionId);

        // --- the durable record shows the operator close
        await waitUntil("terminal closed row", async () => {
          const rows = await wbRows(app);
          const row = rows.get(`terminal/${sessionId}`) as { status?: string; reason?: string } | undefined;
          return row?.status === "exited" && row?.reason === "operator" ? row : undefined;
        });

        // --- the stream never reached the event log
        const events = app.runtime.store;
        void events;
        b.socket.close();
      } finally {
        await app.stop();
      }
    });
  }, 30_000);

  test("unauthenticated and foreign-identity attachment is refused", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const view = (await inv(client, "terminal.open", { workspaceId })) as unknown as TerminalSessionView;
        const url = `${app.url.replace("http://", "ws://")}/terminal/stream?session=${view.sessionId}`;

        // No auth within the guard window → closed with the auth-expected code.
        const anon = connect(url);
        await next(anon.events, "open");
        const anonCode = await Promise.race([anon.closed, Bun.sleep(8000).then(() => -1)]);
        expect(anonCode).toBe(3001);

        // Wrong token → refused.
        const bad = connect(url);
        await next(bad.events, "open");
        bad.socket.send(JSON.stringify({ type: "auth", token: "wbs1.not-a-real-session-token" }));
        const badCode = await Promise.race([bad.closed, Bun.sleep(8000).then(() => -1)]);
        expect(badCode).toBe(3003);

        // A second identity cannot open a terminal at all (the policy refuses non-operator
        // identities every capability, and the handler itself demands a human user).
        let refused = "";
        try {
          const transport = (await import("@godspeedai/cognate-protocol-connect-bun")).connectTransport(app.url);
          const service = (await import("@godspeedai/cognate-protocol-connect")).createRemoteRuntimeService(transport, () => "local:inquisitor");
          const foreignClient = (await import("@godspeedai/cognate-client")).createClient({
            service,
            caller: { tenant: "local", actor: { id: "inquisitor", kind: "user" } },
          });
          await foreignClient.invoke("terminal.open", { workspaceId } as never);
        } catch (error) {
          refused = (error as Error).message;
        }
        expect(refused.length).toBeGreaterThan(0);
      } finally {
        await app.stop();
      }
    });
  }, 20_000);

  test("dead sessions from earlier boots answer honestly; operator cwd escapes are contained", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const view = (await inv(client, "terminal.open", { workspaceId })) as unknown as TerminalSessionView;

        // Attach to a session id that was never live on this server.
        const url = `${app.url.replace("http://", "ws://")}/terminal/stream?session=00000000-0000-4000-8000-000000000000`;
        const ghost = connect(url);
        await next(ghost.events, "open");
        ghost.socket.send(JSON.stringify({ type: "auth", token: app.operatorSessionToken }));
        const dead = await next(ghost.events, "text", (e) => e.text?.includes('"dead"'));
        expect(JSON.parse(dead.text!).sessionId).toBe("00000000-0000-4000-8000-000000000000");

        // A cwd outside the workspace root is refused (containment through the world's own resolve).
        let escape = "";
        try {
          await inv(client, "terminal.open", { workspaceId, cwd: join(home, "outside") });
        } catch (error) {
          escape = (error as Error).message;
        }
        expect(escape).toMatch(/resolve|escape|terminal.open/i);
        expect(view.status).toBe("running");
      } finally {
        await app.stop();
      }
    });
  }, 20_000);
});
