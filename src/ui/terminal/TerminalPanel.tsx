// J-TERMINAL-session, surface half: the docked terminal. One panel, many sessions — each tab is
// one PTY-backed session of the current workspace's execution world, attached over the
// authenticated websocket (`/terminal/stream`). The xterm.js renderer owns presentation only:
// all state lives server-side, so switching tabs or closing the dock detaches the view without
// touching the process, and reattaching replays the server's bounded scrollback. Sessions that
// ended — here or before this server run — render as what they are.
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useCognate, useProjection } from "@godspeedai/cognate-react";
import { bootToken } from "../bootToken.ts";
import { PlusIcon, XIcon } from "../icons.tsx";
import type { TerminalRow } from "../../workbench/state.ts";

interface TerminalTabProps {
  readonly workspaceId: string;
  readonly workspaceLabel: string;
  readonly worldId: string;
  readonly worldLabel: string;
  readonly onClose?: () => void;
  readonly maximized?: boolean;
  readonly onToggleMaximize?: () => void;
}

interface AttachedSession {
  term: Terminal;
  fit: FitAddon;
  ws: WebSocket;
}

/** Colors read from the app's own tokens so the terminal follows the theme. */
function themeFromTokens(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: token("--cg-surface", "#101418"),
    foreground: token("--cg-text", "#e8eaed"),
    cursor: token("--cg-accent", "#4d9fff"),
    selectionBackground: token("--cg-accent", "#4d9fff") + "55",
  };
}

export function TerminalPanel({ workspaceId, workspaceLabel, worldId, worldLabel, onClose, maximized, onToggleMaximize }: TerminalTabProps) {
  const client = useCognate();
  const workbench = useProjection("workbench");
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const hostRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef<AttachedSession | null>(null);
  const [themeEpoch, setThemeEpoch] = useState(0);

  const rows = (workbench ?? [])
    .map((row) => row.value as unknown as TerminalRow)
    .filter((row) => row.workspaceId === workspaceId);
  const running = rows.filter((row) => row.status === "running");

  // The dock opening is an explicit act: reattach to the session this workspace already has,
  // or open one without a click when there is none.
  useEffect(() => {
    if (opening || activeId) return;
    const firstRunning = running.find((row) => row.status === "running");
    if (firstRunning) {
      setActiveId(firstRunning.sessionId);
      return;
    }
    setOpening(true);
    client.invoke("terminal.open", { workspaceId } as never)
      .then((view) => setActiveId((view as unknown as { sessionId: string }).sessionId))
      .catch((error: Error) => setNotice(error.message))
      .finally(() => setOpening(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, running.length, opening, activeId]);

  // Follow the theme: rebuild the renderer when the token epoch changes.
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeEpoch((epoch) => epoch + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    observer.observe(document.querySelector(".app-shell") ?? document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const openAnother = useCallback(() => {
    if (opening) return;
    setOpening(true);
    client.invoke("terminal.open", { workspaceId } as never)
      .then((view) => setActiveId((view as unknown as { sessionId: string }).sessionId))
      .catch((error: Error) => setNotice(error.message))
      .finally(() => setOpening(false));
  }, [client, workspaceId, opening]);

  // Attach/detach: exactly one session renders at a time; teardown only closes the view
  // (server-side sessions keep running — reattach replays their scrollback).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !activeId) return;
    const term = new Terminal({
      theme: themeFromTokens(),
      fontFamily: "var(--cg-mono, 'JetBrains Mono', monospace)",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 2000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* the host may be measured only after the next layout pass */
    }
    const token = bootToken();
    const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/terminal/stream?session=${activeId}`);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => {
      if (token) ws.send(JSON.stringify({ type: "auth", token }));
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        const message = JSON.parse(event.data) as { type: string; reason?: string; message?: string };
        if (message.type === "closed") {
          term.write(`\r\n\x1b[2m[session ended${message.reason ? ` (${message.reason})` : ""}]\x1b[0m\r\n`);
        } else if (message.type === "error") {
          term.write(`\r\n\x1b[31m${message.message ?? "error"}\x1b[0m\r\n`);
        } else if (message.type === "dead") {
          term.write("\r\n\x1b[2m[this session is not live on the server]\x1b[0m\r\n");
        }
        return;
      }
      term.write(new Uint8Array(event.data));
    });
    ws.addEventListener("close", () => {
      term.write("\r\n\x1b[2m[detached — the session keeps running]\x1b[0m\r\n");
    });
    const dataListener = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
    });
    const resizeListener = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });
    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* transient zero-size layouts */
      }
    });
    resizeObserver.observe(host);
    attachedRef.current = { term, fit, ws };
    return () => {
      resizeObserver.disconnect();
      dataListener.dispose();
      resizeListener.dispose();
      ws.close();
      term.dispose();
      attachedRef.current = null;
    };
    // `running` is read only to decide attachability; the session identity drives the lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, themeEpoch, workspaceId]);

  const activeRow = rows.find((row) => row.sessionId === activeId);
  const closeSession = useCallback(async (sessionId: string) => {
    try {
      await client.invoke("terminal.close", { sessionId } as never);
      setActiveId((current) => (current === sessionId ? running.find((row) => row.sessionId !== sessionId && row.status === "running")?.sessionId : current));
    } catch (error) {
      setNotice((error as Error).message);
    }
  }, [client, running]);

  return (
    <div className="term-panel">
      <div className="term-panel-header">
        <span className="term-panel-title">Terminal</span>
        <span className="term-panel-context" title={`${workspaceLabel} — ${worldLabel}`}>
          {workspaceLabel} · {worldLabel}
        </span>
        <span className="term-panel-spring" />
        <button type="button" className="term-tab-add" aria-label="Open another terminal" onClick={openAnother} disabled={opening}>
          <PlusIcon />
        </button>
        {onToggleMaximize && (
          <button type="button" className="term-tab-btn" aria-pressed={maximized === true} onClick={onToggleMaximize}>
            {maximized ? "Restore" : "Maximize"}
          </button>
        )}
        {onClose && (
          <button type="button" className="term-tab-btn" aria-label="Close terminal panel" onClick={onClose}>
            <XIcon />
          </button>
        )}
      </div>
      <div className="term-tabs" role="tablist" aria-label="Terminal sessions">
        {rows.map((row) => (
          <button
            key={row.sessionId}
            type="button"
            role="tab"
            aria-selected={row.sessionId === activeId}
            className={`term-tab${row.sessionId === activeId ? " active" : ""}${row.status !== "running" ? " ended" : ""}`}
            onClick={() => setActiveId(row.sessionId)}
            title={`${row.worldLabel ?? row.worldId} · ${row.cwd}`}
          >
            <span className="term-tab-kind">{row.worldKind}</span>
            <span className="term-tab-name">{row.shell}</span>
            {row.status === "running" && running.length > 1 && (
              <span
                className="term-tab-close"
                role="button"
                aria-label={`End terminal session ${row.shell}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeSession(row.sessionId);
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
      </div>
      {notice && (
        <p role="alert" className="term-panel-error">
          {notice}{" "}
          <button type="button" className="term-tab-btn" onClick={() => setNotice(undefined)}>Dismiss</button>
        </p>
      )}
      <div className="term-hosts">
        {activeRow && activeRow.status !== "running" ? (
          <div className="term-empty" role="status">
            <p>This session ended ({activeRow.reason ?? "exit"}{activeRow.exitCode !== undefined ? `, code ${activeRow.exitCode}` : ""}).</p>
            <button type="button" className="wb-btn" onClick={openAnother}>Open a new terminal</button>
          </div>
        ) : (
          <div ref={hostRef} className="term-host" data-terminal-active={activeId ? "true" : "false"} />
        )}
      </div>
    </div>
  );
}
