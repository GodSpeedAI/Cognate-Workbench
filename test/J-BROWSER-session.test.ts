// Journey J-BROWSER-session: one managed browser session that a person and an agent operate in
// turn — verified against the real agent-browser backend. Open → navigate → streamed viewport →
// human input over the proxy → control handoff refuses the other side's writes → snapshot reads
// stay available → screenshots as evidence → close. Navigation policy (http/https only) and the
// durable record are asserted; the stream's frames and page contents never touch the event log.
import { describe, expect, test } from "bun:test";
import { bootApp, inv, seedWorkspaceOnly, waitUntil, withTempHome, wbRows } from "./wb-helpers.ts";
import type { BrowserSessionView } from "../src/browser/service.ts";

const FIXTURE = `<!doctype html><html><head><title>Journey Fixture</title></head><body>
<h1 id="title">Journey</h1>
<button id="btn" onclick="document.getElementById('title').textContent='Activated'">Press</button>
</body></html>`;

interface WsEvent {
  readonly kind: "text" | "binary" | "open" | "close";
  readonly text?: string;
  readonly bytes?: Uint8Array;
  readonly code?: number;
}

function connect(url: string): { socket: WebSocket; events: WsEvent[]; closed: Promise<number> } {
  const events: WsEvent[] = [];
  let resolveClosed: (code: number) => void;
  const closed = new Promise<number>((resolve) => { resolveClosed = resolve; });
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => events.push({ kind: "open" }));
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") events.push({ kind: "text", text: event.data });
    else events.push({ kind: "binary", bytes: new Uint8Array(event.data) });
  });
  socket.addEventListener("close", (event) => {
    events.push({ kind: "close", code: event.code });
    resolveClosed(event.code);
  });
  return { socket, events, closed };
}

const next = (events: WsEvent[], kind: WsEvent["kind"], match?: (event: WsEvent) => boolean, timeoutMs = 15_000): Promise<WsEvent> =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const scan = (): WsEvent | undefined => {
      for (let i = 0; i < events.length; i++) {
        if (events[i]!.kind === kind && (!match || match(events[i]!) === true)) return events.splice(i, 1)[0];
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
        reject(new Error(`websocket: no ${kind} event within ${timeoutMs}ms`));
      }
    }, 25);
  });

describe("J-BROWSER-session", () => {
  test("open, navigate, stream, human input, control handoff, close — one durable record", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      const fixtureServer = Bun.serve({ port: 0, fetch: () => new Response(FIXTURE, { headers: { "content-type": "text/html" } }) });
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const pageUrl = `http://127.0.0.1:${fixtureServer.port}/`;

        // --- open through the capability: a managed session with the operator as controller
        const view = (await inv(client, "browser.open", { url: pageUrl, workspaceId })) as unknown as BrowserSessionView;
        expect(view.status).toBe("running");
        expect(view.controller).toBe("human");
        expect(view.url).toBe(pageUrl);
        const sessionId = view.sessionId;

        // --- durable row folded
        await waitUntil("browser row", async () => {
          const rows = await wbRows(app);
          const row = rows.get(`browser/${sessionId}`) as { status?: string; controller?: string; url?: string } | undefined;
          return row?.status === "running" && row?.controller === "human" && row?.url === pageUrl ? row : undefined;
        });

        // --- stream: frames arrive over the authenticated proxy
        const wsUrl = `${app.url.replace("http://", "ws://")}/browser/stream?session=${sessionId}`;
        const stream = connect(wsUrl);
        await next(stream.events, "open");
        stream.socket.send(JSON.stringify({ type: "auth", token: app.operatorSessionToken }));
        await next(stream.events, "text", (e) => e.text?.includes('"state"') === true);
        await next(stream.events, "binary", (e) => (e.bytes?.byteLength ?? 0) > 1000, 20_000);

        // --- navigate through the capability (recorded); the frame stream follows
        const navigated = (await inv(client, "browser.navigate", { sessionId, url: pageUrl })) as unknown as BrowserSessionView;
        expect(navigated.url).toBe(pageUrl);

        // --- human input over the stream: click the button by its coordinates
        const box = await inv(client, "browser.snapshot", { sessionId }) as unknown as string;
        expect(box).toContain("Press");
        // The button sits under the heading in the fixture; click center-ish where the button renders.
        // Coordinates come from the provider's own page model in the UI; here the fixture's
        // button is at a known place for a 1280x720 viewport (~44,90 by the spike measurement).
        // CDP-style input frames, forwarded verbatim by the proxy while human control holds.
        stream.socket.send(JSON.stringify({ type: "input_mouse", eventType: "mouseMoved", x: 44, y: 90 }));
        stream.socket.send(JSON.stringify({ type: "input_mouse", eventType: "mousePressed", x: 44, y: 90, button: "left", clickCount: 1 }));
        stream.socket.send(JSON.stringify({ type: "input_mouse", eventType: "mouseReleased", x: 44, y: 90, button: "left", clickCount: 1 }));

        // Wait for the click to land, then read the page through the snapshot (a read either way).
        let activated = false;
        for (let attempt = 0; attempt < 20 && !activated; attempt++) {
          await Bun.sleep(250);
          const snap = (await inv(client, "browser.snapshot", { sessionId })) as unknown as string;
          activated = snap.includes("Activated");
        }
        expect(activated).toBe(true);

        // --- control handoff: agent takes control; human input is refused, reads stay available
        const handed = (await inv(client, "browser.control", { sessionId, controller: "agent" })) as unknown as BrowserSessionView;
        expect(handed.controller).toBe("agent");
        stream.socket.send(JSON.stringify({ type: "input_mouse", eventType: "mousePressed", x: 5, y: 5, button: "left", clickCount: 1 }));
        const refusal = await next(stream.events, "text", (e) => e.text?.includes('"error"') === true, 6000);
        expect(refusal.text).toContain("control");
        const agentSnapshot = (await inv(client, "browser.snapshot", { sessionId })) as unknown as string;
        expect(agentSnapshot.length).toBeGreaterThan(0);

        // ...and back
        const taken = (await inv(client, "browser.control", { sessionId, controller: "human" })) as unknown as BrowserSessionView;
        expect(taken.controller).toBe("human");

        // --- navigation policy: non-http(s) is refused with a reason
        let refusedNavigation = "";
        try {
          await inv(client, "browser.navigate", { sessionId, url: "file:///etc/passwd" });
        } catch (error) {
          refusedNavigation = (error as Error).message;
        }
        expect(refusedNavigation).toContain("http(s)");

        // --- screenshot evidence: a file on disk and a durable reference
        const shot = (await inv(client, "browser.screenshot", { sessionId })) as unknown as { path: string };
        expect(shot.path.length).toBeGreaterThan(0);
        await waitUntil("screenshot row", async () => {
          const rows = await wbRows(app);
          const row = rows.get(`browser/${sessionId}`) as { screenshots?: readonly { path: string }[] } | undefined;
          return row?.screenshots && row.screenshots.length > 0 ? row.screenshots : undefined;
        });

        // --- close: the browser process is disposed; the record says so
        await inv(client, "browser.close", { sessionId });
        await waitUntil("browser closed row", async () => {
          const rows = await wbRows(app);
          const row = rows.get(`browser/${sessionId}`) as { status?: string; reason?: string } | undefined;
          return row?.status === "closed" && row?.reason === "operator" ? row : undefined;
        });
        const closed = await next(stream.events, "text", (e) => e.text?.includes('"closed"') === true, 6000);
        expect(closed.text).toContain(sessionId);
        stream.socket.close();

        // --- the durable record never contains frame or page content
        const rows = await wbRows(app);
        const row = JSON.stringify(rows.get(`browser/${sessionId}`) ?? {});
        expect(row).not.toContain("Activated");
        expect(row).not.toContain("/9j/");
      } finally {
        void fixtureServer.stop(true);
        await app.stop();
      }
    });
  }, 90_000);

  test("foreign-identity attach and non-live sessions behave honestly", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await seedWorkspaceOnly(client, home);
        const view = (await inv(client, "browser.open", {})) as unknown as BrowserSessionView;

        // A made-up session id answers dead, not live.
        const wsUrl = `${app.url.replace("http://", "ws://")}/browser/stream?session=00000000-0000-4000-8000-000000000009`;
        const ghost = connect(wsUrl);
        await next(ghost.events, "open");
        ghost.socket.send(JSON.stringify({ type: "auth", token: app.operatorSessionToken }));
        const dead = await next(ghost.events, "text", (e) => e.text?.includes('"dead"') === true, 8000);
        expect(JSON.parse(dead.text!).sessionId).toBe("00000000-0000-4000-8000-000000000009");

        // Second identity: the policy refuses the capability before any browser exists.
        let refused = "";
        try {
          const transport = (await import("@godspeedai/cognate-protocol-connect-bun")).connectTransport(app.url);
          const service = (await import("@godspeedai/cognate-protocol-connect")).createRemoteRuntimeService(transport, () => "local:looker");
          const foreignClient = (await import("@godspeedai/cognate-client")).createClient({
            service,
            caller: { tenant: "local", actor: { id: "looker", kind: "user" } },
          });
          await foreignClient.invoke("browser.open", {} as never);
        } catch (error) {
          refused = (error as Error).message;
        }
        expect(refused.length).toBeGreaterThan(0);
        void view;
      } finally {
        await app.stop();
      }
    });
  }, 45_000);
});
