// Remote Workspaces UX: the SSH and WSL tabs of the Add-workspace dialog, plus the quiet
// "this world is unreachable" banner. Trust is an explicit human step (the host fingerprint is shown
// and must be confirmed before anything authenticates); secrets are typed into password fields and go
// straight to the server's secret store — they are never kept in component state after submit, never
// shown again, and never part of the durable record the sidebar reads.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCognate, useProjection } from "@godspeedai/cognate-react";

export interface WorldRow {
  readonly worldId: string;
  readonly kind: string;
  readonly label: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export function useExecutionWorlds(): ReadonlyMap<string, WorldRow> {
  const rows = useProjection("execution-worlds");
  return useMemo(() => new Map((rows ?? []).filter((r) => r.key.startsWith("record/")).map((r) => [(r.value as unknown as WorldRow).worldId, r.value as unknown as WorldRow])), [rows]);
}

/** Turn a low-level connection failure into what the person should do next. */
export function friendlyConnectionError(raw: string, context: { readonly host?: string; readonly port?: number } = {}): string {
  const where = context.host ? `${context.host}${context.port && context.port !== 22 ? `:${context.port}` : ""}` : "the host";
  if (/host key|host-key/i.test(raw)) return `The host key presented by ${where} does not match the one you confirmed. Do not continue unless you know it changed; verify the host again.`;
  if (/authentication methods failed|All configured authentication/i.test(raw)) return `${where} rejected these credentials. Check the username and the password or key, then try again.`;
  if (/ECONNREFUSED/i.test(raw)) return `Nothing is listening on ${where}. Check the host and port, and that SSH is running there.`;
  if (/ETIMEDOUT|timed out|Timed out|ENETUNREACH|EHOSTUNREACH/i.test(raw)) return `${where} did not respond in time. Check the address and your network, then try again.`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) return `Could not find ${where}. Check the host name.`;
  if (/ENOENT|no such file/i.test(raw) && /key/i.test(raw)) return `Could not read the private key file. Check the path.`;
  if (/passphrase/i.test(raw)) return "The private key needs a passphrase, or the passphrase is wrong.";
  if (/not a directory/i.test(raw)) return `That folder does not exist on the remote machine, or is not a directory.`;
  if (/stalled|not responding/i.test(raw)) return "The environment stopped responding. Try again; if it keeps happening, restart it.";
  return raw.replace(/^Invocation of [^ ]+ failed: /, "").replace(/\{"kind":"failed","message":"(.*?)".*$/, "$1");
}

type Probe = { readonly fingerprint: string; readonly keyType: string; readonly known: "trusted" | "unknown" | "revoked" };
type Connected = { readonly worldId: string; readonly label: string; readonly home: string };
type AuthKind = "agent" | "key" | "password";

function Field({ label, children, hint }: { readonly label: string; readonly children: React.ReactNode; readonly hint?: string }) {
  return (
    <label className="rw-field">
      <span className="rw-label">{label}</span>
      {children}
      {hint ? <span className="rw-hint">{hint}</span> : null}
    </label>
  );
}

/** Final step shared by SSH and WSL: pick the folder inside the connected world. */
function FolderStep({ world, onAdded, onBack }: { readonly world: Connected; readonly onAdded: () => void; readonly onBack: () => void }) {
  const client = useCognate();
  const [path, setPath] = useState(world.home);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const submit = async () => {
    setBusy(true); setError(undefined);
    try {
      await client.invoke("workspace.select", { path, worldId: world.worldId });
      onAdded();
    } catch (e) {
      setError(friendlyConnectionError(e instanceof Error ? e.message : String(e)));
      setBusy(false);
    }
  };
  return (
    <div className="rw-step">
      <p className="rw-connected" role="status">Connected to <strong>{world.label}</strong>.</p>
      <Field label="Folder on that machine" hint="An absolute path, for example /home/you/project">
        <input aria-label="Remote folder path" value={path} onChange={(e) => setPath(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter" && path.trim() && !busy) void submit(); }} autoFocus />
      </Field>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <div className="modal-actions">
        <button type="button" onClick={onBack}>Back</button>
        <button type="button" className="btn-primary" disabled={busy || !path.trim().startsWith("/")} onClick={() => void submit()}>{busy ? "Opening…" : "Add workspace"}</button>
      </div>
    </div>
  );
}

function SavedConnections({ kind, onPick }: { readonly kind: "ssh" | "wsl"; readonly onPick: (w: Connected) => void }) {
  const client = useCognate();
  const worlds = [...useExecutionWorlds().values()].filter((w) => w.kind === kind);
  const [checking, setChecking] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  if (worlds.length === 0) return null;
  const pick = async (w: WorldRow) => {
    setChecking(w.worldId); setError(undefined);
    try {
      const r = (await client.invoke("execution.world.check", { worldId: w.worldId })) as unknown as { ok: boolean; home?: string; error?: string };
      if (!r.ok) throw new Error(r.error ?? "unreachable");
      onPick({ worldId: w.worldId, label: w.label, home: r.home ?? "/" });
    } catch (e) {
      setError(`${w.label} is not reachable: ${friendlyConnectionError(e instanceof Error ? e.message : String(e), { host: w.metadata.host })}`);
    } finally { setChecking(undefined); }
  };
  return (
    <div className="rw-saved" role="group" aria-label="Saved connections">
      <span className="rw-label">Saved connections</span>
      {worlds.map((w) => (
        <button key={w.worldId} type="button" className="rw-saved-btn" disabled={checking !== undefined} onClick={() => void pick(w)}>
          <strong>{w.label}</strong>
          <span className="rw-hint">{checking === w.worldId ? "Checking…" : kind === "ssh" ? `${w.metadata.username}@${w.metadata.host}` : (w.metadata.distro ?? "")}</span>
        </button>
      ))}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
    </div>
  );
}

export function SshWorkspaceForm({ onAdded }: { readonly onAdded: () => void }) {
  const client = useCognate();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [auth, setAuth] = useState<AuthKind>("agent");
  const [keyPath, setKeyPath] = useState("~/.ssh/id_ed25519");
  const [passphrase, setPassphrase] = useState("");
  const [password, setPassword] = useState("");
  const [probe, setProbe] = useState<Probe | undefined>();
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState<"verify" | "connect" | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [world, setWorld] = useState<Connected | undefined>();
  const portNumber = Number(port);
  const ready = host.trim() !== "" && username.trim() !== "" && Number.isInteger(portNumber) && portNumber > 0 && portNumber < 65536 && (auth === "agent" || (auth === "key" ? keyPath.trim() !== "" : password !== ""));
  const ctx = { host: host.trim(), port: portNumber };

  const verify = async () => {
    setBusy("verify"); setError(undefined); setProbe(undefined); setTrusted(false);
    try {
      setProbe((await client.invoke("execution.world.probe", { host: host.trim(), port: portNumber })) as unknown as Probe);
    } catch (e) {
      setError(friendlyConnectionError(e instanceof Error ? e.message : String(e), ctx));
    } finally { setBusy(undefined); }
  };
  const connect = async () => {
    if (!probe) return;
    setBusy("connect"); setError(undefined);
    try {
      const authInput = auth === "password" ? { kind: "password", password } : auth === "key" ? { kind: "key", privateKeyPath: keyPath.trim(), ...(passphrase ? { passphrase } : {}) } : { kind: "agent" };
      const w = (await client.invoke("execution.world.connect", { kind: "ssh", ssh: { host: host.trim(), port: portNumber, username: username.trim(), auth: authInput, hostKeyFingerprint: probe.fingerprint } } as never)) as unknown as Connected;
      setPassword(""); setPassphrase(""); // the secret has been handed to the server; do not keep it here
      setWorld(w);
    } catch (e) {
      setError(friendlyConnectionError(e instanceof Error ? e.message : String(e), ctx));
    } finally { setBusy(undefined); }
  };

  if (world) return <FolderStep world={world} onAdded={onAdded} onBack={() => setWorld(undefined)} />;
  return (
    <div className="rw-step">
      <SavedConnections kind="ssh" onPick={setWorld} />
      <div className="rw-row">
        <Field label="Host"><input aria-label="SSH host" value={host} placeholder="build.example.com" onChange={(e) => { setHost(e.currentTarget.value); setProbe(undefined); }} autoFocus /></Field>
        <Field label="Port"><input aria-label="SSH port" inputMode="numeric" value={port} onChange={(e) => { setPort(e.currentTarget.value); setProbe(undefined); }} className="rw-port" /></Field>
      </div>
      <Field label="Username"><input aria-label="SSH username" value={username} autoComplete="off" onChange={(e) => setUsername(e.currentTarget.value)} /></Field>
      <fieldset className="rw-auth">
        <legend className="rw-label">Authentication</legend>
        {([["agent", "SSH agent"], ["key", "Private key file"], ["password", "Password"]] as const).map(([k, text]) => (
          <label key={k} className="rw-radio"><input type="radio" name="ssh-auth" checked={auth === k} onChange={() => setAuth(k)} /> {text}</label>
        ))}
      </fieldset>
      {auth === "key" && (
        <>
          <Field label="Key file path" hint="The file stays on this machine; only its path is saved."><input aria-label="Private key path" value={keyPath} onChange={(e) => setKeyPath(e.currentTarget.value)} /></Field>
          <Field label="Key passphrase (optional)"><input aria-label="Key passphrase" type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.currentTarget.value)} /></Field>
        </>
      )}
      {auth === "password" && <Field label="Password" hint="Stored only in this app's private secret file, never in the history."><input aria-label="SSH password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.currentTarget.value)} /></Field>}

      {probe && (
        <div className="rw-fingerprint" role="group" aria-label="Host identity">
          <p className="rw-label">Host identity</p>
          <p><code>{probe.keyType}</code> <code className="rw-fp">{probe.fingerprint}</code></p>
          {probe.known === "trusted" && <p className="rw-ok" role="status">Matches an entry in your known_hosts file.</p>}
          {probe.known === "unknown" && <p className="rw-warn" role="status">This host is not in your known_hosts file. Confirm the fingerprint with whoever runs the machine before trusting it.</p>}
          {probe.known === "revoked" && <p className="form-error" role="alert">This host key is marked revoked in your known_hosts file. Do not connect.</p>}
          {probe.known !== "revoked" && <label className="rw-radio"><input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.currentTarget.checked)} /> I trust this host key</label>}
        </div>
      )}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <div className="modal-actions">
        {!probe ? (
          <button type="button" className="btn-primary" disabled={!ready || busy !== undefined} onClick={() => void verify()}>{busy === "verify" ? "Contacting host…" : "Verify host"}</button>
        ) : (
          <>
            <button type="button" onClick={() => { setProbe(undefined); setTrusted(false); }}>Change host</button>
            <button type="button" className="btn-primary" disabled={!trusted || probe.known === "revoked" || busy !== undefined} onClick={() => void connect()}>{busy === "connect" ? "Connecting…" : "Trust and connect"}</button>
          </>
        )}
      </div>
    </div>
  );
}

export function WslWorkspaceForm({ onAdded }: { readonly onAdded: () => void }) {
  const client = useCognate();
  const [distros, setDistros] = useState<readonly { name: string; isDefault: boolean }[] | undefined>();
  const [reason, setReason] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [distro, setDistro] = useState("");
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [world, setWorld] = useState<Connected | undefined>();
  useEffect(() => {
    let live = true;
    setDistros(undefined);
    void client.invoke("execution.wsl.list", {}).then((r) => {
      if (!live) return;
      const res = r as unknown as { distros: { name: string; isDefault: boolean }[]; reason?: string };
      const list = res.distros;
      setReason(res.reason);
      setDistros(list);
      setDistro((list.find((d) => d.isDefault) ?? list[0])?.name ?? "");
    }).catch(() => live && setDistros([]));
    return () => { live = false; };
  }, [client, attempt]);
  const connect = async () => {
    setBusy(true); setError(undefined);
    try {
      setWorld((await client.invoke("execution.world.connect", { kind: "wsl", wsl: { distro, ...(user.trim() ? { user: user.trim() } : {}) } } as never)) as unknown as Connected);
    } catch (e) {
      setError(friendlyConnectionError(e instanceof Error ? e.message : String(e)));
    } finally { setBusy(false); }
  };
  if (world) return <FolderStep world={world} onAdded={onAdded} onBack={() => setWorld(undefined)} />;
  return (
    <div className="rw-step">
      <SavedConnections kind="wsl" onPick={setWorld} />
      {distros === undefined ? <p role="status" className="rw-hint">Looking for WSL distributions…</p> : distros.length === 0 ? (
        reason === "not-responding" ? (
          <div className="rw-warn" role="status">
            <p>WSL did not respond. This is usually temporary; the Windows WSL service can be slow to start.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        ) : (
          <p className="rw-warn" role="status">WSL isn't available on this machine, or no distribution is installed.</p>
        )
      ) : (
        <>
          <Field label="Distribution">
            <select aria-label="WSL distribution" value={distro} onChange={(e) => setDistro(e.currentTarget.value)}>
              {distros.map((d) => <option key={d.name} value={d.name}>{d.name}{d.isDefault ? " (default)" : ""}</option>)}
            </select>
          </Field>
          <Field label="Linux user (optional)" hint="Leave empty to use the distribution's default user."><input aria-label="WSL user" value={user} onChange={(e) => setUser(e.currentTarget.value)} autoComplete="off" /></Field>
        </>
      )}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <div className="modal-actions">
        <button type="button" className="btn-primary" disabled={busy || !distro} onClick={() => void connect()}>{busy ? "Starting…" : "Connect"}</button>
      </div>
    </div>
  );
}

/** Shown only when a remote workspace's world cannot be reached; silent when healthy. */
export function WorldBanner({ worldId, label }: { readonly worldId: string | undefined; readonly label: string }) {
  const client = useCognate();
  const [problem, setProblem] = useState<string | undefined>();
  const [checking, setChecking] = useState(false);
  const live = useRef(true);
  const check = useCallback(async () => {
    if (!worldId || worldId === "local") { setProblem(undefined); return; }
    setChecking(true);
    try {
      const r = (await client.invoke("execution.world.check", { worldId })) as unknown as { ok: boolean; error?: string };
      if (live.current) setProblem(r.ok ? undefined : friendlyConnectionError(r.error ?? "unreachable"));
    } catch (e) {
      if (live.current) setProblem(friendlyConnectionError(e instanceof Error ? e.message : String(e)));
    } finally { if (live.current) setChecking(false); }
  }, [client, worldId]);
  useEffect(() => {
    live.current = true;
    void check();
    const timer = setInterval(() => void check(), 30_000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { live.current = false; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [check]);
  if (!problem) return null;
  return (
    <div className="world-banner" role="alert">
      <div><strong>{label} is unreachable.</strong> {problem} <span className="rw-hint">The agent cannot read, edit or run anything in this workspace until it's back, and nothing runs on this computer instead.</span></div>
      <button type="button" disabled={checking} onClick={() => void check()}>{checking ? "Checking…" : "Retry"}</button>
    </div>
  );
}
