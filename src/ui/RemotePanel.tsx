// Mobile remote control on the desktop: a sidebar button, a dialog with the pairing link and QR, and a
// persistent indicator while remote is on. Closing the dialog never stops remote; Stop does.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { remoteFetch } from "./remoteFetch.ts";
import { PhoneIcon } from "./icons.tsx";
import { DialogHeader } from "./shell/DialogHeader.tsx";

type RemoteStatus = {
  readonly state: "off" | "waiting" | "connected";
  readonly link?: string;
  readonly qrSvg?: string;
  readonly expiresAt?: number;
  readonly generation: number;
  readonly device?: { readonly label: string; readonly pairedAt: string; readonly lastSeenAt: string | null };
};

type Phase = { readonly kind: "loading" } | { readonly kind: "preparing" } | { readonly kind: "restoring" } | { readonly kind: "unreachable" } | { readonly kind: "ready"; readonly status: RemoteStatus };

async function readStatus(path: string, method: "GET" | "POST"): Promise<RemoteStatus> {
  const response = await remoteFetch(path, { method });
  if (!response.ok) throw new Error(`remote ${response.status}`);
  return (await response.json()) as RemoteStatus;
}

/** Polls the remote status while mounted; the sidebar indicator and the dialog share this shape. */
function useRemoteStatus(intervalMs: number): { readonly status?: RemoteStatus; readonly failed: boolean } {
  const [status, setStatus] = useState<RemoteStatus>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = () => {
      readStatus("/remote/status", "GET")
        .then((next) => {
          if (!alive) return;
          setStatus(next);
          setFailed(false);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [intervalMs]);
  return { status, failed };
}

/** Shown in the sidebar while remote control is enabled: text and glyph, never colour alone. */
export function RemoteIndicator() {
  const { status } = useRemoteStatus(5000);
  if (!status || status.state === "off") return null;
  const label = status.state === "connected" ? "Phone connected" : "Waiting for phone";
  return (
    <div className="remote-indicator" role="status">
      <span aria-hidden="true">{status.state === "connected" ? "●" : "◌"}</span> {label}
    </div>
  );
}

export function RemoteButton({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <button type="button" className="global-panel-btn" aria-label="Mobile remote control" title="Mobile remote control" onClick={onOpen}>
      <PhoneIcon />
      Remote
    </button>
  );
}

type DiagEvent = { readonly at: number; readonly text: string };

/** The origin of the pairing link (never its secret): the route a phone is told to use. */
export function routeOf(link: string | undefined): string | undefined {
  if (!link) return undefined;
  try {
    return new URL(link).origin;
  } catch {
    return undefined;
  }
}

/** A plain-text report an operator can paste into a bug report. Contains no pairing secret. */
export function buildRemoteReport(input: {
  readonly status: RemoteStatus | undefined;
  readonly route: string | undefined;
  readonly lastError: string | undefined;
  readonly events: readonly DiagEvent[];
  readonly reachable: boolean;
  readonly at: Date;
}): string {
  const { status } = input;
  return [
    `Cognate remote access report (${input.at.toISOString()})`,
    `Connection: ${status ? status.state : "unknown"}${input.reachable ? "" : " (control endpoint unreachable)"}`,
    `Route: ${input.route ?? "not published"}`,
    `Generation: ${status ? status.generation : "unknown"}`,
    `Device: ${status?.device ? `${status.device.label}, paired ${status.device.pairedAt}, last seen ${status.device.lastSeenAt ?? "never"}` : "none"}`,
    `Last error: ${input.lastError ?? "none"}`,
    "Recent events:",
    ...(input.events.length ? input.events.map((e) => `  ${new Date(e.at).toISOString()} ${e.text}`) : ["  none"]),
  ].join("\n");
}

export function RemoteDialog({ onClose }: { readonly onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [events, setEvents] = useState<readonly DiagEvent[]>([]);
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  const [reportCopied, setReportCopied] = useState(false);
  const routeRef = useRef<string | undefined>(undefined);
  const lastStateRef = useRef<string | undefined>(undefined);
  const note = useCallback((text: string) => setEvents((prev) => [...prev.slice(-7), { at: Date.now(), text }]), []);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  useModal(dialogRef, onClose);

  const load = useCallback(async (path: "/remote/status" | "/remote/start" | "/remote/refresh" | "/remote/stop", method: "GET" | "POST") => {
    if (method === "POST") {
      setPhase({ kind: "preparing" });
      note(`Requested ${path.replace("/remote/", "")}`);
    }
    try {
      const next = await readStatus(path, method);
      const origin = routeOf(next.link);
      if (origin) routeRef.current = origin;
      if (next.state === "off") routeRef.current = undefined;
      if (lastStateRef.current !== next.state) {
        note(`Connection ${lastStateRef.current ? `${lastStateRef.current} to ` : ""}${next.state}`);
        lastStateRef.current = next.state;
      }
      setLastError(undefined);
      setPhase({ kind: "ready", status: next });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLastError((prev) => {
        if (prev !== message) note(`Error: ${message}`);
        return message;
      });
      setPhase((prev) => (prev.kind === "ready" ? { kind: "restoring" } : { kind: "unreachable" }));
    }
  }, [note]);

  useEffect(() => {
    void load("/remote/status", "GET");
    const poll = setInterval(() => void load("/remote/status", "GET"), 2000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  const status = phase.kind === "ready" ? phase.status : undefined;
  const secondsLeft = status?.expiresAt ? Math.max(0, Math.ceil((status.expiresAt - now) / 1000)) : 0;
  const copy = async () => {
    if (!status?.link) return;
    try {
      await navigator.clipboard.writeText(status.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal remote-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-heading" tabIndex={-1} ref={dialogRef}>
        <DialogHeader title="Control from your phone" titleId="remote-heading" closeLabel="remote control" onClose={onClose} />
        {phase.kind === "loading" && <p role="status">Checking remote control…</p>}
        {phase.kind === "preparing" && <p role="status">Preparing remote access…</p>}
        {phase.kind === "restoring" && <p role="status">Restoring connection…</p>}
        {phase.kind === "unreachable" && <p role="alert">Unable to reach relay. Check the connection and try again.</p>}
        {status?.state === "off" && (
          <>
            <p>Remote control is off. Turn it on, then scan the code with your phone. Your phone must confirm with a passkey.</p>
            <div className="remote-actions">
              <button type="button" className="primary-action" onClick={() => void load("/remote/start", "POST")}>Turn on remote control</button>
            </div>
          </>
        )}
        {status?.state === "waiting" && (
          <>
            <p>Waiting for phone. Scan this code, or copy the link to your phone. The link works once and expires in five minutes.</p>
            {status.qrSvg && <div className="remote-qr" dangerouslySetInnerHTML={{ __html: status.qrSvg }} />}
            {status.link && (
              <div className="remote-link">
                <input readOnly aria-label="Pairing link" value={status.link} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
              </div>
            )}
            <p className="remote-muted" role="status">{secondsLeft > 0 ? `Link expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "Link expired. Refresh the QR code."}</p>
            <div className="remote-actions">
              <button type="button" onClick={() => void load("/remote/refresh", "POST")}>Refresh QR</button>
              <button type="button" className="danger-action" onClick={() => void load("/remote/stop", "POST")}>Stop</button>
            </div>
          </>
        )}
        {status?.state === "connected" && status.device && (
          <>
            <p>Phone connected: {status.device.label}.</p>
            <p className="remote-muted">Paired {new Date(status.device.pairedAt).toLocaleString()}. Last seen {status.device.lastSeenAt ? new Date(status.device.lastSeenAt).toLocaleString() : "never"}.</p>
            <div className="remote-actions">
              <button type="button" onClick={() => void load("/remote/refresh", "POST")}>Replace phone</button>
              <button type="button" className="danger-action" onClick={() => void load("/remote/stop", "POST")}>Stop</button>
            </div>
          </>
        )}
        <section className="remote-diag" aria-label="Diagnostics">
          <h3>Diagnostics</h3>
          <dl>
            <dt>Connection</dt>
            <dd>{phase.kind === "unreachable" || phase.kind === "restoring" ? "Control endpoint unreachable" : status ? status.state : "Checking"}</dd>
            <dt>Route</dt>
            <dd>{routeRef.current ?? "Not published"}</dd>
            <dt>Last error</dt>
            <dd>{lastError ?? "None"}</dd>
          </dl>
          <p className="remote-diag-events-title">Recent events</p>
          <ul className="remote-diag-events" aria-label="Recent events">
            {events.length === 0 && <li>No events yet</li>}
            {[...events].reverse().map((e) => (
              <li key={`${e.at}-${e.text}`}>
                <time>{new Date(e.at).toLocaleTimeString()}</time> {e.text}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              const report = buildRemoteReport({ status, route: routeRef.current, lastError, events, reachable: phase.kind === "ready", at: new Date() });
              void navigator.clipboard.writeText(report).then(() => setReportCopied(true), () => setReportCopied(false));
            }}
          >
            {reportCopied ? "Report copied" : "Copy report"}
          </button>
        </section>
      </div>
    </div>
  );
}

/** Focus trap and Escape for this dialog (same contract as the app's modals). */
/** The latest onClose is read through a ref, so a parent's new inline callback never re-runs the focus effect. */
function useModal(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [ref]);
}
