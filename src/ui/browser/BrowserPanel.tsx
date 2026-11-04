// J-BROWSER-session, surface half: the shared browser panel. The canvas renders the managed
// browser's live viewport (JPEG frames from the backend's authenticated proxy — never the
// daemon's own port); pointer and keyboard events go back as stream input and are refused
// server-side while the agent holds control. The address bar navigates through the
// capability, so every navigation is attributed and recorded. What this panel is NOT: a
// general iframe. Untrusted page content never enters the Workbench's own document.
import { useCallback, useEffect, useRef, useState } from "react";
import { useCognate, useProjection } from "@godspeedai/cognate-react";
import { bootToken } from "../bootToken.ts";
import { ExternalLinkIcon, XIcon } from "../icons.tsx";
import type { BrowserRow } from "../../workbench/state.ts";

export interface BrowserPanelProps {
  readonly workspaceId: string;
  readonly workspaceLabel: string;
  readonly onClose?: () => void;
  readonly maximized?: boolean;
  readonly onToggleMaximize?: () => void;
}

interface BrowserSessionView {
  readonly sessionId: string;
  readonly url?: string;
  readonly title?: string;
  readonly controller: "human" | "agent";
  readonly status: "running" | "closed";
  readonly workspaceId?: string;
}

const CONTROLLER_HINT: Record<"human" | "agent", string> = {
  human: "You are driving. The agent can still read the page, but its input is refused.",
  agent: "The agent is driving. Your input on the page is refused until you take control back.",
};

export function BrowserPanel({ workspaceId, workspaceLabel, onClose, maximized, onToggleMaximize }: BrowserPanelProps) {
  const client = useCognate();
  const workbench = useProjection("workbench");
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [address, setAddress] = useState("");
  const [pageErrors, setPageErrors] = useState<readonly string[]>([]);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [streamLive, setStreamLive] = useState(false);

  const rows = (workbench ?? [])
    .map((row) => row.value as unknown as BrowserRow)
    .filter((row) => row.workspaceId === workspaceId);
  const running = rows.filter((row) => row.status === "running");
  const active = rows.find((row) => row.sessionId === activeId);

  // Attach (or open) the workspace's session — one per workspace keeps the mental model simple.
  useEffect(() => {
    if (opening || activeId) return;
    const firstRunning = running.find((row) => row.status === "running");
    if (firstRunning) {
      setActiveId(firstRunning.sessionId);
      return;
    }
    setOpening(true);
    client.invoke("browser.open", { workspaceId } as never)
      .then((view) => setActiveId((view as unknown as { sessionId: string }).sessionId))
      .catch((error: Error) => setNotice(error.message))
      .finally(() => setOpening(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, running.length, opening, activeId]);

  // Stream lifecycle: exactly one websocket per active session; frames paint the canvas.
  useEffect(() => {
    if (!activeId || !active || active.status !== "running") return;
    const canvas = canvasRef.current;
    const token = bootToken();
    if (!canvas || !token) return;
    const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/browser/stream?session=${activeId}`);
    ws.binaryType = "arraybuffer";
    const context = canvas.getContext("2d");
    ws.addEventListener("open", () => {
      setStreamLive(true);
      ws.send(JSON.stringify({ type: "auth", token }));
    });
    ws.addEventListener("close", () => setStreamLive(false));
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        // A JPEG frame: the newest frame replaces whatever is on the canvas.
        const blob = new Blob([event.data as ArrayBuffer], { type: "image/jpeg" });
        createImageBitmap(blob).then((bitmap) => {
          if (context) {
            context.canvas.width = bitmap.width;
            context.canvas.height = bitmap.height;
            context.drawImage(bitmap, 0, 0);
          }
          bitmap.close();
        }).catch(() => {
          /* a torn frame: the next one replaces it */
        });
        return;
      }
      const message = JSON.parse(event.data) as { type: string; session?: BrowserSessionView; controller?: string; message?: string; url?: string; text?: string; level?: string };
      if (message.type === "state" && message.session) {
        setAddress(message.session.url ?? "");
        if (message.session.status !== "running") markClosed();
      } else if (message.type === "url" && typeof message.url === "string") {
        // The daemon reports full-document navigations; keep the address bar honest.
        setAddress(message.url);
      } else if (message.type === "console" && (message.level === "error" || message.level === "warning")) {
        setPageErrors((current) => [...current.slice(-40), message.text ?? String(message)]);
      } else if (message.type === "error") {
        setNotice(message.message ?? "the browser refused that");
      } else if (message.type === "stream-error") {
        setStreamLive(false);
      } else if (message.type === "closed") {
        markClosed();
      }
    });
    function markClosed(): void {
      setStreamLive(false);
    }
    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
      setStreamLive(false);
    };
    // `active` narrows attachability; the identity drives the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, active?.status]);

  const controller = active?.controller ?? "human";

  const pointEvent = useCallback((kind: "mouse", event: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const ws = wsRef.current;
    if (!canvas || !ws || ws.readyState !== WebSocket.OPEN) return;
    const rect = canvas.getBoundingClientRect();
    // The bitmap is painted with object-fit: contain, so the drawn image can be smaller than the
    // element box and centered in it; map through the contained image rect, not the element box.
    const bitmapWidth = canvas.width || rect.width;
    const bitmapHeight = canvas.height || rect.height;
    const scale = Math.min(rect.width / bitmapWidth, rect.height / bitmapHeight);
    const offsetX = (rect.width - bitmapWidth * scale) / 2;
    const offsetY = (rect.height - bitmapHeight * scale) / 2;
    const x = Math.round((event.clientX - rect.left - offsetX) / scale);
    const y = Math.round((event.clientY - rect.top - offsetY) / scale);
    const eventType = event.type === "pointerdown" ? "mousePressed" : event.type === "pointerup" ? "mouseReleased" : "mouseMoved";
    ws.send(JSON.stringify({
      type: "input_mouse",
      eventType,
      x, y,
      ...(eventType !== "mouseMoved" ? { button: event.button === 2 ? "right" : "left", clickCount: event.type === "pointerdown" || event.type === "pointerup" ? 1 : undefined } : {}),
    }));
  }, []);

  const keyEvent = useCallback((event: React.KeyboardEvent) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Typed characters and control keys: text arrives via keyDown's text field, as CDP expects.
    const key = event.key;
    if (key.length === 1) {
      ws.send(JSON.stringify({ type: "input_keyboard", eventType: "keyDown", key, text: key }));
      ws.send(JSON.stringify({ type: "input_keyboard", eventType: "keyUp", key }));
    } else {
      const code = key === "Enter" ? "Enter" : key === "Backspace" ? "Backspace" : key === "Tab" ? "Tab" : key === "Escape" ? "Escape" : key;
      ws.send(JSON.stringify({ type: "input_keyboard", eventType: event.type === "keydown" ? "rawKeyDown" : "keyUp", key: code, ...(key === "Enter" ? { text: "\r" } : {}) }));
    }
    event.preventDefault();
  }, []);

  const navigate = useCallback(async (rawUrl: string) => {
    if (!activeId) return;
    const url = /^https?:\/\//.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
    setNotice(undefined);
    setPageErrors([]);
    try {
      const view = await client.invoke("browser.navigate", { sessionId: activeId, url } as never) as unknown as BrowserSessionView;
      setAddress(view.url ?? url);
    } catch (error) {
      setNotice((error as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, client]);

  const takeControl = useCallback((next: "human" | "agent") => {
    if (!activeId) return;
    client.invoke("browser.control", { sessionId: activeId, controller: next } as never).catch((error: Error) => setNotice(error.message));
  }, [activeId, client]);

  const closeSession = useCallback(() => {
    if (!activeId) return;
    client.invoke("browser.close", { sessionId: activeId } as never)
      .then(() => setActiveId(undefined))
      .catch((error: Error) => setNotice(error.message));
  }, [activeId, client]);

  return (
    <div className="browser-panel">
      <div className="browser-panel-header">
        <span className="term-panel-title">Browser</span>
        <span className="term-panel-context" title={workspaceLabel}>{workspaceLabel}</span>
        <span
          className={`browser-controller browser-controller-${controller}`}
          role="status"
          aria-live="polite"
          title={CONTROLLER_HINT[controller]}
        >
          {controller === "human" ? "Your control" : "Agent control"}
        </span>
        {controller === "agent" && (
          <button type="button" className="term-tab-btn" onClick={() => takeControl("human")}>Take control</button>
        )}
        {controller === "human" && running.length > 0 && (
          <button type="button" className="term-tab-btn" onClick={() => takeControl("agent")} title="Hand control to the agent">Give to agent</button>
        )}
        <span className="term-panel-spring" />
        <span className={`browser-stream${streamLive ? " live" : ""}`} role="status">{streamLive ? "live" : "offline"}</span>
        {onToggleMaximize && (
          <button type="button" className="term-tab-btn" aria-pressed={maximized === true} onClick={onToggleMaximize}>
            {maximized ? "Restore" : "Maximize"}
          </button>
        )}
        {onClose && (
          <button type="button" className="term-tab-btn" aria-label="Close browser panel" onClick={onClose}><XIcon /></button>
        )}
      </div>
      <div className="browser-panel-bar">
        <button type="button" className="term-tab-btn" aria-label="Reload" onClick={() => address && void navigate(address)}><span aria-hidden="true">⟳</span></button>
        <form
          className="browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate(address);
          }}
        >
          <input
            type="text"
            value={address}
            placeholder="Open a page — http://localhost:5173 for example"
            aria-label="Browser address"
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </form>
        <button type="button" className="term-tab-btn" aria-label="Close this browser session" onClick={closeSession}><ExternalLinkIcon aria-hidden="true" /></button>
      </div>
      {notice && (
        <p role="alert" className="term-panel-error">
          {notice}{" "}
          <button type="button" className="term-tab-btn" onClick={() => setNotice(undefined)}>Dismiss</button>
        </p>
      )}
      <div className="browser-viewport">
        {active && active.status !== "running" ? (
          <div className="term-empty" role="status">
            <p>This browser session was closed ({active.reason ?? "operator"}).</p>
            <p className="term-empty-hint">Opening the panel again starts a new session.</p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="browser-canvas"
            tabIndex={0}
            aria-label="Live browser viewport — click and type to interact when you hold control"
            onPointerDown={(e) => pointEvent("mouse", e)}
            onPointerUp={(e) => pointEvent("mouse", e)}
            onPointerMove={(e) => pointEvent("mouse", e)}
            onKeyDown={keyEvent}
          />
        )}
        {errorsOpen && (
          <div className="browser-errors" role="log" aria-label="Page errors">
            {pageErrors.length === 0 ? <p>No page errors reported.</p> : pageErrors.map((line, index) => <p key={index}>{line}</p>)}
          </div>
        )}
      </div>
      <div className="browser-panel-footer">
        <span className="term-panel-context">Frames come from the managed browser; page content never runs inside this app.</span>
        <span className="term-panel-spring" />
        <button type="button" className="term-tab-btn" aria-expanded={errorsOpen} onClick={() => setErrorsOpen((open) => !open)}>Errors</button>
      </div>
    </div>
  );
}
