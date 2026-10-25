// The phone remote (320-430px). Pairing and passkey sign-in run first; then Home (sessions and the
// decisions waiting on the operator), a session timeline with a composer, decisions, and settings. Every
// change is re-read from the server on a change signal; the page never invents an outcome.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Snapshot = {
  device: { label: string };
  sessions: { sessionId: string; title: string; workspaceId: string | null; archived: boolean; status: string; runId: string | null }[];
  decisions: { id: string; runId: string; sessionId: string | null; type: string; summary: string; detail: string | null; actionable: boolean }[];
  generation: number;
};
type Trace = {
  sessionId: string;
  turns: { index: number; userText: string; startedAt: string; tools: { tool: string; status: string; result: string | null }[]; replies: string[] }[];
};
type Device = { label: string; pairedAt: string; lastSeenAt: string | null };
type View = { name: "home" } | { name: "session"; sessionId: string } | { name: "decisions" } | { name: "settings" };
type Phase = "checking" | "pairing" | "signing-in" | "ready" | "off" | "failed";

class SignedOut extends Error {}

const B64 = /^[A-Za-z0-9_-]+$/;

/** Base64url helpers for WebAuthn option and credential fields. */
function toBuffer(text: string): ArrayBuffer {
  const base = text.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base + "=".repeat((4 - (base.length % 4)) % 4)), (c) => c.charCodeAt(0));
  return bytes.buffer;
}
function toText(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function serialize(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const out: Record<string, unknown> = { id: credential.id, type: credential.type, response: { clientDataJSON: toText(response.clientDataJSON) } };
  const r = out.response as Record<string, string>;
  if ("attestationObject" in response) r.attestationObject = toText(response.attestationObject);
  if ("authenticatorData" in response) {
    r.authenticatorData = toText(response.authenticatorData);
    r.signature = toText(response.signature);
  }
  return out;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) throw new SignedOut(path);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(String(data.error ?? response.status)), { status: response.status, code: data.error });
  return data as T;
}

function deviceLabel(): string {
  return /iPhone|iPad/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android phone" : "Phone";
}

async function signIn(): Promise<void> {
  const { ticket, options } = await call<{ ticket: string; options: { challenge: string; allowCredentials: { id: string }[] } }>("/m/api/auth/options", {});
  const credential = (await navigator.credentials.get({
    publicKey: { ...options, challenge: toBuffer(options.challenge), allowCredentials: options.allowCredentials.map((c) => ({ type: "public-key" as const, id: toBuffer(c.id) })) } as never,
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("passkey cancelled");
  await call("/m/api/auth/finish", { ticket, credential: serialize(credential) });
}

async function pairWith(secret: string): Promise<void> {
  const { ticket, options } = await call<{ ticket: string; options: { challenge: string; user: { id: string } } }>("/m/api/pair/redeem", { secret });
  const credential = (await navigator.credentials.create({
    publicKey: { ...options, challenge: toBuffer(options.challenge), user: { ...options.user, id: toBuffer(options.user.id) } } as never,
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("passkey cancelled");
  await call("/m/api/pair/finish", { ticket, label: deviceLabel(), credential: serialize(credential) });
}

/** Read and strip the pairing fragment before anything else runs, so the secret never sits in the address bar. */
function takePairingSecret(): string | undefined {
  const match = /^#p=([A-Za-z0-9_-]{43})$/.exec(location.hash);
  if (!match) return undefined;
  history.replaceState(null, "", location.pathname + location.search);
  return B64.test(match[1] ?? "") ? match[1] : undefined;
}

const PAIR_FAILURES: Record<string, string> = {
  expired: "This link has expired or was already used. Refresh the QR code on your desktop.",
  used: "This link was already used. Refresh the QR code on your desktop.",
  invalid: "This link is not valid. Refresh the QR code on your desktop.",
  off: "Remote control is off on the desktop.",
  "no-device": "This phone is no longer paired. Scan a new QR code from the desktop.",
  refused: "This phone's passkey is no longer accepted. If this phone was replaced, scan a new QR code from the desktop.",
  passkey: "The passkey could not be verified. Try again with a passkey on this phone.",
  rate: "Too many attempts. Wait a minute and try again.",
};

const STATUS_LABEL: Record<string, string> = { running: "Running", waiting: "Waiting for you", idle: "Idle", completed: "Done", failed: "Failed", cancelled: "Stopped" };

export function MobileApp() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [failure, setFailure] = useState<string>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [device, setDevice] = useState<Device>();
  const [view, setView] = useState<View>({ name: "home" });
  const [notice, setNotice] = useState("");
  const [offline, setOffline] = useState(false);
  const pendingSecret = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await call<Snapshot>("/m/api/snapshot"));
      setOffline(false);
    } catch (error) {
      if (error instanceof SignedOut) throw error;
      setOffline(true);
    }
  }, []);

  /** Pairing first when a fresh link was opened; otherwise the passkey is required for every session. */
  const establish = useCallback(async () => {
    setPhase("checking");
    try {
      if (pendingSecret.current) {
        const secret = pendingSecret.current;
        pendingSecret.current = undefined;
        setPhase("pairing");
        await pairWith(secret);
      }
      try {
        await refresh();
      } catch (error) {
        if (!(error instanceof SignedOut)) throw error;
        setPhase("signing-in");
        await signIn();
        await refresh();
      }
      setDevice(await call<Device>("/m/api/device"));
      setPhase("ready");
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "off") setPhase("off");
      else {
        // A passkey this phone does not hold (or a cancelled prompt) is shown as refused, never as a silent retry.
        const refused = error instanceof Error && error.name === "NotAllowedError";
        setFailure(refused ? PAIR_FAILURES.refused : PAIR_FAILURES[code ?? ""] ?? "Could not connect. Check the link and try again.");
        setPhase("failed");
      }
    }
  }, [refresh]);

  useEffect(() => {
    pendingSecret.current = takePairingSecret();
    void establish();
  }, [establish]);

  // Change signal: every committed event re-reads what the phone shows (debounced). A dropped stream
  // reconnects with EventSource's own backoff, and the snapshot is re-read on every (re)open.
  useEffect(() => {
    if (phase !== "ready") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/m/api/events");
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh().catch(() => void establish()), 250);
    };
    source.addEventListener("changed", changed);
    source.onopen = changed;
    source.onerror = () => setOffline(true);
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [phase, refresh, establish]);

  // Keyboard-aware composer: the visual viewport shrinks when the on-screen keyboard opens.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => document.documentElement.style.setProperty("--kb", `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);

  const signOut = async () => {
    await call("/m/api/sign-out", { commandId: crypto.randomUUID() }).catch(() => undefined);
    setPhase("off");
    setNotice("Signed out on this phone. Pair again from the desktop.");
  };

  if (phase !== "ready") {
    return (
      <main className="m-shell m-connect" role="main">
        <h1>Cognate Workbench</h1>
        {phase === "checking" && <p role="status">Restoring connection…</p>}
        {phase === "pairing" && <p role="status">Pairing this phone. Confirm with your passkey.</p>}
        {phase === "signing-in" && <p role="status">Confirm with your passkey to open remote control.</p>}
        {phase === "off" && <p role="status">{notice || "Remote control is off on the desktop. Turn it on there, then scan the QR code."}</p>}
        {phase === "failed" && (
          <>
            <p role="alert" className="m-error">{failure}</p>
            <button className="m-primary" onClick={() => void establish()}>Try again</button>
          </>
        )}
      </main>
    );
  }

  const decisions = snapshot?.decisions ?? [];
  return (
    <main className="m-shell" role="main">
      <header className="m-top">
        {view.name === "session" ? (
          <button className="m-icon" aria-label="Back to sessions" onClick={() => setView({ name: "home" })}>‹</button>
        ) : (
          <span className="m-brand">Cognate</span>
        )}
        <span className="m-top-title">{view.name === "home" ? "Sessions" : view.name === "decisions" ? "Decisions" : view.name === "settings" ? "This phone" : snapshot?.sessions.find((s) => s.sessionId === view.sessionId)?.title ?? "Session"}</span>
      </header>
      {offline && <p className="m-banner" role="status">Reconnecting… showing the last update.</p>}
      <p className="m-notice" role="status" aria-live="polite">{notice}</p>
      {view.name === "home" && <Home snapshot={snapshot} onOpen={(sessionId) => setView({ name: "session", sessionId })} onDecisions={() => setView({ name: "decisions" })} />}
      {view.name === "session" && <SessionView sessionId={view.sessionId} snapshot={snapshot} refresh={refresh} setNotice={setNotice} />}
      {view.name === "decisions" && <Decisions decisions={decisions} refresh={refresh} setNotice={setNotice} />}
      {view.name === "settings" && <Settings device={device} onSignOut={signOut} />}
      {view.name !== "session" && (
        <nav className="m-tabs" aria-label="Sections">
          <button aria-current={view.name === "home" ? "page" : undefined} onClick={() => setView({ name: "home" })}>Sessions</button>
          <button aria-current={view.name === "decisions" ? "page" : undefined} onClick={() => setView({ name: "decisions" })}>
            Decisions{decisions.length > 0 ? ` (${decisions.length})` : ""}
          </button>
          <button aria-current={view.name === "settings" ? "page" : undefined} onClick={() => setView({ name: "settings" })}>This phone</button>
        </nav>
      )}
    </main>
  );
}

function Home({ snapshot, onOpen, onDecisions }: { snapshot?: Snapshot; onOpen: (id: string) => void; onDecisions: () => void }) {
  const [group, setGroup] = useState<"workspace" | "recent">("workspace");
  const [query, setQuery] = useState("");
  const sessions = useMemo(() => (snapshot?.sessions ?? []).filter((s) => !s.archived && s.title.toLowerCase().includes(query.toLowerCase())), [snapshot, query]);
  const needs = sessions.filter((s) => s.status === "waiting" || snapshot?.decisions.some((d) => d.sessionId === s.sessionId));
  const groups = useMemo(() => {
    const map = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const key = group === "workspace" ? s.workspaceId ?? "No workspace" : "Recent";
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()];
  }, [sessions, group]);
  return (
    <section aria-label="Sessions">
      {(snapshot?.decisions.length ?? 0) > 0 && (
        <button className="m-needs" onClick={onDecisions}>
          {snapshot?.decisions.length} waiting for you
        </button>
      )}
      <div className="m-row">
        <div role="group" aria-label="Group sessions" className="m-seg">
          <button aria-pressed={group === "workspace"} onClick={() => setGroup("workspace")}>Workspaces</button>
          <button aria-pressed={group === "recent"} onClick={() => setGroup("recent")}>Recent</button>
        </div>
      </div>
      <input className="m-search" type="search" placeholder="Search sessions" aria-label="Search sessions" value={query} onChange={(e) => setQuery(e.target.value)} />
      {needs.length > 0 && <h2 className="m-group">Needs you</h2>}
      {needs.map((s) => <SessionRow key={`n-${s.sessionId}`} s={s} onOpen={onOpen} />)}
      {groups.map(([name, rows]) => (
        <div key={name}>
          <h2 className="m-group">{name}</h2>
          {rows.filter((s) => !needs.includes(s)).map((s) => <SessionRow key={s.sessionId} s={s} onOpen={onOpen} />)}
        </div>
      ))}
      {snapshot && sessions.length === 0 && <p className="m-muted">No sessions match.</p>}
    </section>
  );
}

function SessionRow({ s, onOpen }: { s: Snapshot["sessions"][number]; onOpen: (id: string) => void }) {
  return (
    <button className="m-card m-session" onClick={() => onOpen(s.sessionId)}>
      <span className="m-session-title">{s.title}</span>
      <span className={`m-pill m-pill-${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
    </button>
  );
}

function SessionView({ sessionId, snapshot, refresh, setNotice }: { sessionId: string; snapshot?: Snapshot; refresh: () => Promise<void>; setNotice: (text: string) => void }) {
  const [trace, setTrace] = useState<Trace>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const session = snapshot?.sessions.find((s) => s.sessionId === sessionId);
  const running = session?.runId && (session.status === "running" || session.status === "waiting");

  const load = useCallback(async () => {
    try {
      setTrace(await call<Trace>(`/m/api/sessions/${encodeURIComponent(sessionId)}`));
    } catch (error) {
      if (error instanceof SignedOut) throw error;
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load, snapshot]);

  useEffect(() => {
    if (atBottom) endRef.current?.scrollIntoView({ block: "end" });
  }, [trace, atBottom]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const commandId = crypto.randomUUID();
      const reply = await call<{ kind: string }>(`/m/api/sessions/${encodeURIComponent(sessionId)}/turns`, { commandId, text });
      setDraft("");
      setNotice(reply.kind === "steer" ? "Steer sent. It applies at the agent's next step." : "Turn sent.");
      await refresh();
    } catch (error) {
      if (error instanceof SignedOut) throw error;
      setNotice("The turn was not sent. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!session?.runId) return;
    try {
      await call(`/m/api/runs/${encodeURIComponent(session.runId)}/stop`, { commandId: crypto.randomUUID() });
      setNotice("Stop sent. Waiting for the run to end.");
    } catch (error) {
      if (error instanceof SignedOut) throw error;
      setNotice("Stop was not sent. Try again.");
    }
  };

  return (
    <section className="m-session-view" aria-label="Session timeline">
      <div className="m-timeline" onScroll={(e) => {
        const el = e.currentTarget;
        setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
      }}>
        {(trace?.turns ?? []).map((turn) => (
          <div key={turn.index} className="m-turn">
            <div className="m-bubble m-user">{turn.userText}</div>
            {turn.tools.length > 0 && (
              <details className="m-steps">
                <summary>{turn.tools.length} tool step{turn.tools.length === 1 ? "" : "s"}</summary>
                {turn.tools.map((tool, i) => (
                  <div key={i} className="m-step">
                    <strong>{tool.tool}</strong> · {tool.status}
                    {tool.result && <pre>{tool.result}</pre>}
                  </div>
                ))}
              </details>
            )}
            {turn.replies.map((text, i) => <div key={i} className="m-bubble m-agent">{text}</div>)}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {!atBottom && (
        <button className="m-jump" onClick={() => endRef.current?.scrollIntoView({ block: "end" })}>Jump to latest</button>
      )}
      <form className="m-composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea
          aria-label={running ? "Steer the running agent" : "Message"}
          placeholder={running ? "Steer the running agent" : "Message"}
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="m-composer-actions">
          {running && <button type="button" className="m-danger" onClick={() => void stop()}>Stop</button>}
          <button className="m-primary" type="submit" disabled={busy || draft.trim() === ""}>{running ? "Steer" : "Send"}</button>
        </div>
      </form>
    </section>
  );
}

function Decisions({ decisions, refresh, setNotice }: { decisions: Snapshot["decisions"]; refresh: () => Promise<void>; setNotice: (text: string) => void }) {
  const decide = async (id: string, approved: boolean, summary: string) => {
    try {
      await call(`/m/api/continuations/${encodeURIComponent(id)}/resolve`, { commandId: crypto.randomUUID(), approved });
      setNotice(`${approved ? "Approved" : "Denied"}: ${summary}.`);
    } catch (error) {
      if (error instanceof SignedOut) throw error;
      setNotice((error as { status?: number }).status === 409 ? "Already decided on the desktop." : "The decision was not sent. Try again.");
    }
    await refresh();
  };
  if (decisions.length === 0) return <p className="m-muted">Nothing is waiting for you.</p>;
  return (
    <section aria-label="Decisions">
      {decisions.map((d) => (
        <article key={d.id} className="m-card m-decision">
          <h2>{d.summary}</h2>
          {d.detail ? <pre className="m-detail">{d.detail}</pre> : null}
          <p className="m-muted">Never approved automatically.</p>
          {d.actionable ? (
            <div className="m-composer-actions">
              <button className="m-danger" onClick={() => void decide(d.id, false, d.summary)}>Deny</button>
              <button className="m-primary" onClick={() => void decide(d.id, true, d.summary)}>Approve</button>
            </div>
          ) : (
            <p className="m-muted">Decide this one on the desktop.</p>
          )}
        </article>
      ))}
    </section>
  );
}

function Settings({ device, onSignOut }: { device?: Device; onSignOut: () => void }) {
  return (
    <section aria-label="This phone" className="m-card">
      <p><strong>{device?.label ?? "Phone"}</strong></p>
      <p className="m-muted">Paired {device ? new Date(device.pairedAt).toLocaleString() : "-"}</p>
      <p className="m-muted">Last seen {device?.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : "-"}</p>
      <button className="m-danger" onClick={onSignOut}>Sign out on this phone</button>
    </section>
  );
}
