// Journey J-BROWSER-inspect: selecting a real element in the shared browser and turning it into
// structured feedback for the agent. Inspect mode is a human act (refused under agent control);
// a click selects rather than activates; the capture records the full structured context with a
// screenshot; the annotation folds durably with a staleness token; selector candidates re-resolve
// against the live DOM (SPA updates keep them valid, navigation marks the annotation stale); and
// the submitted message reaches the model with the payload intact and labeled as data.
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { bootApp, bootAimock, aimockChatRequests, inv, seedWorkspaceOnly, waitUntil, withTempHome, wbRows } from "./wb-helpers.ts";
import { annotationMessage } from "../src/browser/annotationMessage.ts";
import { annotationIsStale, type BrowserAnnotationRow, type BrowserRow } from "../src/workbench/state.ts";
import type { BrowserSessionView } from "../src/browser/service.ts";

interface Selection {
  readonly tag: string;
  readonly role: string;
  readonly name: string;
  readonly text: string;
  readonly url: string;
  readonly capturedAt: string;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly viewport: { readonly width: number };
  readonly candidates: readonly { readonly kind: string; readonly value: string }[];
  readonly ancestry: readonly { readonly tag: string; readonly class?: string }[];
  readonly styles: { readonly fontSize: string; readonly color: string };
}

interface Capture {
  readonly selection: Selection | null;
  readonly navigations: number;
  readonly url?: string;
  readonly evidencePath?: string;
}

const FIXTURE = (label: string): string => `<!doctype html><html><head><title>${label}</title></head><body style="margin:0">
<div class="container">
  <h1 id="title">${label}</h1>
  <button id="btn" data-testid="press-btn" style="position:absolute; left:40px; top:40px; padding:8px 20px"
    onclick="document.getElementById('title').textContent='Activated'">Press</button>
  <a id="link-2" href="#" style="position:absolute; left:40px; top:120px">Second link</a>
</div>
</body></html>`;

const pageOf = (port: number, label: string): string => `http://127.0.0.1:${port}/${label}.html`;

const serveFixture = (): { readonly port: number; readonly stop: (force?: boolean) => Promise<void> } => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const label = new URL(request.url).pathname === "/other.html" ? "Other" : "Journey";
      return new Response(FIXTURE(label), { headers: { "content-type": "text/html" } });
    },
  });
  return { port: server.port!, stop: (force?: boolean) => server.stop(force ?? true) };
};

interface WsEvent { readonly kind: "text" | "binary" | "open"; readonly text?: string; readonly bytes?: Uint8Array }

function connect(url: string): { socket: WebSocket; events: WsEvent[] } {
  const events: WsEvent[] = [];
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  socket.addEventListener("open", () => events.push({ kind: "open" }));
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") events.push({ kind: "text", text: event.data });
    else events.push({ kind: "binary", bytes: new Uint8Array(event.data) });
  });
  return { socket, events };
}

const awaitEvent = (events: WsEvent[], match: (event: WsEvent) => boolean, what: string, timeoutMs = 15_000): Promise<WsEvent> =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setInterval(() => {
      const hit = events.find(match);
      if (hit) { clearInterval(timer); resolve(hit); }
      else if (Date.now() > deadline) { clearInterval(timer); reject(new Error(`websocket: no ${what} within ${timeoutMs}ms`)); }
    }, 25);
  });

/** Click the absolutely-positioned button (center ≈ (79, 57) for the default 1280-wide viewport). */
const clickButton = (socket: WebSocket): void => {
  for (const frame of [
    { type: "input_mouse", eventType: "mouseMoved", x: 79, y: 57 },
    { type: "input_mouse", eventType: "mousePressed", x: 79, y: 57, button: "left", clickCount: 1 },
    { type: "input_mouse", eventType: "mouseReleased", x: 79, y: 57, button: "left", clickCount: 1 },
  ]) socket.send(JSON.stringify(frame));
};

/** Click, then capture until the page reports a selection (bounded). */
async function clickAndCapture(client: Awaited<ReturnType<typeof bootApp>>["client"], sessionId: string, socket: WebSocket): Promise<Capture> {
  let result!: Capture;
  for (let attempt = 0; attempt < 20 && !result; attempt++) {
    clickButton(socket);
    await Bun.sleep(300);
    const capture = (await inv(client, "browser.inspect", { sessionId, capture: true })) as unknown as Capture;
    if (capture.selection) result = capture;
  }
  expect(result).toBeDefined();
  return result;
}

describe("J-BROWSER-inspect", () => {
  test("select without activating, capture the full context, annotate durably, staleness and re-resolution", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      const fixtureServer = serveFixture();
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const pageA = pageOf(fixtureServer.port, "Journey");

        const view = (await inv(client, "browser.open", { url: pageA, workspaceId })) as unknown as BrowserSessionView;
        const sessionId = view.sessionId;

        // --- inspect mode arms under human control (the operator holds it after open)
        const armed = (await inv(client, "browser.inspect", { sessionId, enable: true })) as unknown as BrowserSessionView;
        expect(armed.status).toBe("running");

        // --- the click selects, never activates: frames over the authenticated proxy
        const wsUrl = `${app.url.replace("http://", "ws://")}/browser/stream?session=${sessionId}`;
        const stream = connect(wsUrl);
        await awaitEvent(stream.events, (e) => e.kind === "open", "open");
        stream.socket.send(JSON.stringify({ type: "auth", token: app.operatorSessionToken }));
        await awaitEvent(stream.events, (e) => e.text?.includes('"state"') === true, "state");
        await awaitEvent(stream.events, (e) => (e.bytes?.byteLength ?? 0) > 1000, "frame", 20_000);

        const capture = await clickAndCapture(client, sessionId, stream.socket);
        const selection = capture.selection!;
        expect(selection.tag).toBe("button");
        expect(selection.role).toBe("button");
        expect(selection.name).toContain("Press");
        expect(isNaN(Date.parse(selection.capturedAt))).toBe(false);
        expect(selection.viewport.width).toBeGreaterThan(0);
        // The button's own rect, and the ancestry up to the fixture's .container div.
        expect(selection.rect.width).toBeGreaterThan(40);
        expect(selection.ancestry.some((entry) => entry.class === "container")).toBe(true);
        expect(selection.styles.fontSize.length).toBeGreaterThan(0);
        // Selector candidates: the resilient trio plus the css path.
        const kinds = selection.candidates.map((candidate) => candidate.kind);
        expect(kinds).toContain("id");
        expect(kinds).toContain("testid");
        expect(kinds).toContain("role+name");
        expect(kinds).toContain("css");
        // Evidence screenshot exists on disk next to the capture.
        expect(capture.evidencePath).toBeDefined();
        expect(existsSync(capture.evidencePath!)).toBe(true);
        // Staleness token: zero navigations so far.
        expect(capture.navigations).toBe(0);

        // --- the click did NOT activate: the fixture heading is unchanged
        const snapshot = (await inv(client, "browser.snapshot", { sessionId })) as unknown as string;
        expect(snapshot).toContain("Press");
        expect(snapshot).not.toContain("Activated");

        // --- annotate: durable, bounded, with the staleness token
        const note = "Make this button blue";
        await inv(client, "browser.annotate", {
          sessionId,
          note,
          url: selection.url,
          capturedAt: selection.capturedAt,
          navigationsAtCapture: capture.navigations,
          element: { tag: selection.tag, role: selection.role, name: selection.name, text: selection.text },
          candidates: selection.candidates,
          evidencePath: capture.evidencePath,
        });
        const folded = await waitUntil("annotation row", async () => {
          const rows = await wbRows(app);
          const browserRow = rows.get(`browser/${sessionId}`) as BrowserRow | undefined;
          const annotation = browserRow?.annotations?.[0] as BrowserAnnotationRow | undefined;
          return annotation?.note === note ? { row: browserRow!, annotation } : undefined;
        });
        expect(folded.annotation.element.tag).toBe("button");
        expect(folded.annotation.element.role).toBe("button");
        expect(folded.annotation.navigationsAtCapture).toBe(0);
        expect(folded.annotation.evidencePath).toBe(capture.evidencePath);
        expect(folded.row.navigations).toBe(0);
        expect(annotationIsStale(folded.annotation, folded.row)).toBe(false);

        // --- re-resolution: the candidates still match the live DOM
        const resolved = (await inv(client, "browser.inspect", { sessionId, verify: { candidates: selection.candidates } })) as unknown as { resolved: boolean; matched: string | null };
        expect(resolved.resolved).toBe(true);

        // --- navigation: the annotation goes stale, the candidates stop resolving
        const pageB = pageOf(fixtureServer.port, "Other");
        await inv(client, "browser.navigate", { sessionId, url: pageB });
        const rowOnB = await waitUntil("navigated row", async () => {
          const rows = await wbRows(app);
          const browserRow = rows.get(`browser/${sessionId}`) as BrowserRow | undefined;
          return browserRow?.url === pageB && (browserRow.navigations ?? 0) >= 1 ? browserRow : undefined;
        });
        expect(annotationIsStale(folded.annotation, rowOnB)).toBe(true);
        const unresolved = (await inv(client, "browser.inspect", { sessionId, verify: { candidates: selection.candidates } })) as unknown as { resolved: boolean };
        expect(unresolved.resolved).toBe(false);

        // --- a SPA-style update (no navigation) keeps candidates valid: activate via a real
        // click with inspect off, then reselect and re-resolve.
        await inv(client, "browser.navigate", { sessionId, url: pageA });
        await inv(client, "browser.inspect", { sessionId, enable: false });
        clickButton(stream.socket);
        let activated = false;
        for (let attempt = 0; attempt < 20 && !activated; attempt++) {
          await Bun.sleep(250);
          const snap = (await inv(client, "browser.snapshot", { sessionId })) as unknown as string;
          activated = snap.includes("Activated");
        }
        expect(activated).toBe(true);
        const rowAfterSpa = await waitUntil("navigations back to A", async () => {
          const rows = await wbRows(app);
          const browserRow = rows.get(`browser/${sessionId}`) as BrowserRow | undefined;
          return browserRow?.url === pageA && (browserRow.navigations ?? 0) >= 2 ? browserRow : undefined;
        });
        // The activation click moved nothing durable: still exactly the two navigations.
        expect(rowAfterSpa.navigations).toBe(2);
        await inv(client, "browser.inspect", { sessionId, enable: true });
        const recapture = await clickAndCapture(client, sessionId, stream.socket);
        const resolvedAfterUpdate = (await inv(client, "browser.inspect", { sessionId, verify: { candidates: recapture.selection!.candidates } })) as unknown as { resolved: boolean };
        expect(resolvedAfterUpdate.resolved).toBe(true);
        stream.socket.close();
      } finally {
        void fixtureServer.stop(true);
        await app.stop();
      }
    });
  }, 150_000);

  test("the submitted annotation reaches the model as data-labeled structured feedback", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      const fixtureServer = serveFixture();
      try {
        const workspaceDir = join(home, "ws-inspect");
        await client.invoke("model.configure", {
          providerId: "mock",
          baseURL: `http://127.0.0.1:${aimock.port}/v1`,
          protocol: "openai-compatible",
          model: "mock-model-1",
          apiKey: "",
        });
        await mkdir(workspaceDir, { recursive: true });
        const selected = (await client.invoke("workspace.select", { path: workspaceDir } as never)) as unknown as { workspaceId: string };
        const workspaceId = selected.workspaceId;

        const view = (await inv(client, "browser.open", { url: pageOf(fixtureServer.port, "Journey"), workspaceId })) as unknown as BrowserSessionView;
        const sessionId = view.sessionId;
        await inv(client, "browser.inspect", { sessionId, enable: true });
        const wsUrl = `${app.url.replace("http://", "ws://")}/browser/stream?session=${sessionId}`;
        const stream = connect(wsUrl);
        await awaitEvent(stream.events, (e) => e.kind === "open", "open");
        stream.socket.send(JSON.stringify({ type: "auth", token: app.operatorSessionToken }));
        await awaitEvent(stream.events, (e) => (e.bytes?.byteLength ?? 0) > 1000, "frame", 20_000);
        const capture = await clickAndCapture(client, sessionId, stream.socket);
        const selection = capture.selection!;

        const note = "The press button should live in the header, not the body";
        const message = annotationMessage({
          note,
          url: selection.url,
          element: { tag: selection.tag, role: selection.role, name: selection.name, text: "" },
          candidates: selection.candidates,
        });

        // The same composition the panel sends goes into the active conversation as a turn.
        const conversationId = randomUUID();
        await client.startRun(
          "agent.coding",
          { sessionId: conversationId, workspaceId, message } as never,
          { idempotencyKey: randomUUID(), correlationId: `session:${conversationId}` },
        );
        // The model's journal is the honest receiver: the payload must arrive intact.
        let received = "";
        for (let attempt = 0; attempt < 60 && !received; attempt++) {
          await Bun.sleep(500);
          const requests = await aimockChatRequests(aimock.port);
          for (const request of requests) {
            const userMessage = request.body.messages?.find((m) => m.role === "user");
            const content = userMessage?.content;
            const text = typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content.map((part) => (typeof part === "object" && part !== null && "text" in part) ? String((part as { text: unknown }).text) : "").join(" ")
                : "";
            if (text.includes("Browser annotation")) received = text;
          }
        }
        expect(received).toContain(note);
        expect(received).toContain("button");
        expect(received).toContain("Press");
        expect(received).toContain("data-testid");
        // Page-derived content is labeled data, never instructions.
        expect(received).toContain("untrusted input");
        stream.socket.close();
      } finally {
        void fixtureServer.stop(true);
        await app.stop();
        await aimock.stop();
      }
    });
  }, 120_000);

  test("inspect mode is refused while the agent holds control", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      const fixtureServer = serveFixture();
      try {
        await seedWorkspaceOnly(client, home);
        const view = (await inv(client, "browser.open", { url: pageOf(fixtureServer.port, "Journey") })) as unknown as BrowserSessionView;
        await inv(client, "browser.control", { sessionId: view.sessionId, controller: "agent" });
        let refused = "";
        try {
          await inv(client, "browser.inspect", { sessionId: view.sessionId, enable: true });
        } catch (error) {
          refused = (error as Error).message;
        }
        expect(refused).toContain("control");
      } finally {
        void fixtureServer.stop(true);
        await app.stop();
      }
    });
  }, 60_000);
});
