// Mobile remote control (passkey-paired). The desktop enables it from the cockpit; the phone pairs with a
// single-use five-minute link (secret in the URL fragment, verifier only in memory), registers a passkey
// with user verification, and then opens durable identity sessions bound to that device. Commands call the
// governed service with the session's caller, exactly as the desktop does. Nothing is auto-approved, and
// nothing here claims end-to-end encryption: TLS terminates at the operator's tunnel or proxy.
import { randomBytes, randomUUID } from "node:crypto";
import type { Server } from "bun";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import type { Json } from "@godspeedai/cognate-events";
import { authenticateSessionToken, issueSession, revokeSession } from "../auth/identity.ts";
import { Pairing } from "./pairing.ts";
import { assertionOptions, newChallenge, registrationOptions, verifyAssertion, verifyRegistration, WebAuthnError } from "./webauthn.ts";
import { mutateRemoteState, readRemoteState, type RemoteDevice } from "./state.ts";
import { qrSvg } from "./qr.ts";
import { phoneShell } from "./shell.ts";
import { DEFAULT_AGENT_PRESET, DEFAULT_PERMISSION_MODE } from "../settings.ts";

export const REMOTE_COOKIE = "__Host-wb_remote";
export const REMOTE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_TEXT = 4000;
const SSE_HEARTBEAT_MS = 5000;

export interface RemoteSettings {
  readonly port: number;
  /** Public HTTPS base for an operator-run tunnel; undefined = this machine only. */
  readonly publicUrl?: string;
}

export function remoteSettingsFromEnv(env: Record<string, string | undefined>): RemoteSettings {
  const rawPort = env.COGNATE_REMOTE_PORT?.trim();
  const port = rawPort === undefined || rawPort === "" ? 3181 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("COGNATE_REMOTE_PORT must be an integer port");
  const rawUrl = env.COGNATE_REMOTE_PUBLIC_URL?.trim();
  if (!rawUrl) return { port };
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("COGNATE_REMOTE_PUBLIC_URL must be an absolute URL"); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("COGNATE_REMOTE_PUBLIC_URL must be https (http is allowed for localhost only)");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("COGNATE_REMOTE_PUBLIC_URL must be an origin with no path, query or fragment");
  return { port, publicUrl: url.origin };
}

export interface RemoteHost {
  readonly service: RuntimeService;
  readonly system: Caller;
  readonly operatorIdentityId: string;
  /** The phone bundle and its stylesheet, built once per process. */
  readonly assets: () => Promise<{ readonly js: string; readonly css: string }>;
}

export interface RemoteStatus {
  readonly state: "off" | "waiting" | "connected";
  readonly link?: string;
  readonly qrSvg?: string;
  readonly expiresAt?: number;
  readonly generation: number;
  readonly device?: { readonly id: string; readonly label: string; readonly pairedAt: string; readonly lastSeenAt: string | null };
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), { status, headers: hardened({ "content-type": "application/json", ...headers }) });

export function hardened(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "cache-control": "no-store",
    ...extra,
  };
}

function cookieOf(request: Request): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === REMOTE_COOKIE) return rest.join("=");
  }
  return undefined;
}

function sessionCookie(token: string): string {
  return `${REMOTE_COOKIE}=${token}; Path=/; Max-Age=${REMOTE_SESSION_TTL_MS / 1000}; Secure; HttpOnly; SameSite=Strict`;
}

function clearedCookie(): string {
  return `${REMOTE_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

/** Fixed-window rate limit per route; a small cap is enough for one operator and one phone. */
class Limiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  allow(key: string, max: number, windowMs = 60_000): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= max;
  }
}

export class MobileRemote {
  readonly pairing = new Pairing();
  private server: Server<unknown> | undefined;
  private port = 0;
  private readonly limiter = new Limiter();
  private readonly replies = new Map<string, Response>();
  private readonly streams = new Set<AbortController>();

  constructor(private readonly host: RemoteHost, private readonly settings: RemoteSettings) {}

  get publicBase(): string {
    return this.settings.publicUrl ?? `http://localhost:${this.port}`;
  }

  private get rpId(): string {
    return new URL(this.publicBase).hostname;
  }

  private get origin(): string {
    return new URL(this.publicBase).origin;
  }

  private allowedHosts(): Set<string> {
    const hosts = new Set([`localhost:${this.port}`, `127.0.0.1:${this.port}`]);
    if (this.settings.publicUrl) hosts.add(new URL(this.settings.publicUrl).host);
    return hosts;
  }

  /** Turn remote on (idempotent while on): listener up, a fresh pairing link. */
  async start(): Promise<RemoteStatus> {
    if (!this.server) this.listen();
    this.pairing.start(Date.now());
    return this.status();
  }

  /** New link and generation: every prior link, device credential and session stops working. */
  async refresh(): Promise<RemoteStatus> {
    if (!this.server) return this.start();
    this.pairing.refresh(Date.now());
    await this.revokeAll("remote: refresh");
    return this.status();
  }

  /** Stop: generation moves on, sessions revoked, live streams closed, listener closed. */
  async stop(): Promise<RemoteStatus> {
    this.pairing.stop();
    await this.revokeAll("remote: stop");
    for (const controller of this.streams) controller.abort();
    this.streams.clear();
    this.server?.stop(true);
    this.server = undefined;
    return this.status();
  }

  async close(): Promise<void> {
    if (this.server) await this.stop();
  }

  private listen(): void {
    this.server = Bun.serve({
      port: this.settings.port,
      hostname: "127.0.0.1",
      idleTimeout: 30,
      maxRequestBodySize: 256 * 1024,
      fetch: (request) => this.handle(request).catch(() => json({ error: "internal" }, 500)),
    });
    this.port = this.server.port ?? this.settings.port;
  }

  async status(): Promise<RemoteStatus> {
    const enabled = this.server !== undefined && this.pairing.isEnabled;
    const generation = this.pairing.generation;
    if (!enabled) return { state: "off", generation };
    const { state } = await readRemoteState(this.host.service, this.host.system);
    const device = Object.values(state.devices).find((d) => d.revokedAt === null && d.generation === generation);
    if (device) {
      return { state: "connected", generation, device: { id: device.id, label: device.label, pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt } };
    }
    const current = this.pairing.current(Date.now());
    if (!current) return { state: "waiting", generation };
    const link = `${this.publicBase}/m#p=${current.secret}`;
    return { state: "waiting", generation, link, qrSvg: qrSvg(link), expiresAt: current.expiresAt };
  }

  private async revokeAll(cause: string): Promise<void> {
    await this.revokeDevices(cause);
  }

  /** Revoke every active device: its identity session first, then the ledger record. */
  private async revokeDevices(cause: string): Promise<void> {
    // Live change streams belong to the sessions being revoked; close them so no stale phone keeps listening.
    for (const controller of this.streams) controller.abort();
    this.streams.clear();
    const { state } = await readRemoteState(this.host.service, this.host.system);
    for (const device of Object.values(state.devices)) {
      if (device.sid) await revokeSession(this.host.service, this.host.system, device.sid, cause).catch(() => undefined);
    }
    if (!Object.values(state.devices).some((d) => d.revokedAt === null)) return;
    const now = new Date().toISOString();
    await mutateRemoteState(this.host.service, this.host.system, (draft) => {
      for (const device of Object.values(draft.devices)) {
        if (device.revokedAt === null) draft.devices[device.id] = { ...device, revokedAt: now, sid: null };
      }
    });
  }

  // ---- request boundary -------------------------------------------------------------------------

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!this.allowedHosts().has(request.headers.get("host") ?? "")) return new Response("misdirected request", { status: 421, headers: hardened() });
    if (url.pathname === "/m" || url.pathname === "/m/") {
      const nonce = randomBytes(16).toString("base64url");
      return new Response(phoneShell(nonce), { headers: hardened({ "content-type": "text/html; charset=utf-8", "content-security-policy": phoneCsp(nonce) }) });
    }
    if (url.pathname === "/m/app.js" || url.pathname === "/m/mobile.css") {
      const assets = await this.host.assets();
      const isJs = url.pathname === "/m/app.js";
      return new Response(isJs ? assets.js : assets.css, { headers: hardened({ "content-type": isJs ? "text/javascript" : "text/css", "content-security-policy": phoneCsp("") }) });
    }
    if (!url.pathname.startsWith("/m/api/")) return new Response("not found", { status: 404, headers: hardened() });
    if (request.method === "POST") {
      if (request.headers.get("origin") !== this.origin) return json({ error: "forbidden" }, 403);
      if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return json({ error: "unsupported" }, 415);
    }
    const route = url.pathname.slice("/m/api/".length);
    if (!this.pairing.isEnabled || this.server === undefined) return json({ error: "off" }, 404);
    try {
      if (request.method === "POST" && route === "pair/redeem") return await this.redeem(request);
      if (request.method === "POST" && route === "pair/finish") return await this.finishPairing(request);
      if (request.method === "POST" && route === "auth/options") return await this.authOptions();
      if (request.method === "POST" && route === "auth/finish") return await this.finishAuth(request);
      const resolved = await this.sessionOf(request);
      if (!resolved) return json({ error: "unauthenticated" }, 401, { "set-cookie": clearedCookie() });
      const { device, caller } = resolved;
      if (request.method === "GET" && route === "snapshot") return json(await this.snapshot(device, caller));
      if (request.method === "GET" && route === "events") return this.events(request, caller);
      if (request.method === "GET" && route === "device") return json({ label: device.label, pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt });
      if (request.method === "GET" && route.startsWith("sessions/")) return json(await this.trace(decodeURIComponent(route.slice("sessions/".length)), caller));
      if (request.method === "POST" && route === "sign-out") return await this.signOut(device);
      if (request.method === "POST") return await this.command(request, device, caller, route);
      return json({ error: "not found" }, 404);
    } catch (error) {
      if (error instanceof WebAuthnError) return json({ error: "passkey" }, 400);
      return json({ error: "failed" }, 500);
    }
  }

  private async body(request: Request): Promise<Record<string, unknown> | undefined> {
    try {
      const value = (await request.json()) as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }

  // ---- pairing and passkeys ---------------------------------------------------------------------

  private async redeem(request: Request): Promise<Response> {
    if (!this.limiter.allow("redeem", 10)) return json({ error: "rate" }, 429);
    const body = await this.body(request);
    const result = this.pairing.redeem(body?.secret, Date.now());
    if (!result.ok) return json({ error: result.reason }, 400);
    const userId = randomBytes(16);
    return json({ ticket: result.ticket, options: registrationOptions({ challenge: result.challenge, rpId: this.rpId, userId, userName: "operator" }) });
  }

  private async finishPairing(request: Request): Promise<Response> {
    if (!this.limiter.allow("finish", 10)) return json({ error: "rate" }, 429);
    const body = await this.body(request);
    const challenge = this.pairing.takeChallenge(body?.ticket, "register", Date.now());
    if (!challenge) return json({ error: "expired" }, 400);
    const verified = verifyRegistration(body?.credential as never, { challenge, origin: this.origin, rpId: this.rpId });
    const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : "Phone";
    // Replacing the phone: every previous device's identity session is revoked before the new one exists.
    await this.revokeDevices("remote: phone replaced");
    const issued = await issueSession(this.host.service, this.host.system, { identityId: this.host.operatorIdentityId, ttlMs: REMOTE_SESSION_TTL_MS, cause: "mobile remote: pairing" });
    const now = new Date().toISOString();
    await mutateRemoteState(this.host.service, this.host.system, (draft) => {
      const id = `device-${randomUUID().slice(0, 8)}`;
      const device: RemoteDevice = { id, label, credentialId: verified.credentialId, publicKey: verified.publicKey, signCount: verified.signCount, generation: this.pairing.generation, sid: issued.session.sid, pairedAt: now, lastSeenAt: now, revokedAt: null };
      draft.devices[id] = device;
      draft.audit.push({ at: now, deviceId: id, command: "pair", commandId: "pairing", outcome: "paired" });
    });
    return json({ ok: true, device: { label } }, 200, { "set-cookie": sessionCookie(issued.token) });
  }

  private async authOptions(): Promise<Response> {
    if (!this.limiter.allow("auth", 30)) return json({ error: "rate" }, 429);
    const { state } = await readRemoteState(this.host.service, this.host.system);
    const devices = Object.values(state.devices).filter((d) => d.revokedAt === null && d.generation === this.pairing.generation);
    if (devices.length === 0) return json({ error: "no-device" }, 404);
    const challenge = newChallenge();
    const ticket = this.pairing.issueChallenge(challenge, "auth", Date.now());
    return json({ ticket, options: assertionOptions({ challenge, rpId: this.rpId, credentialIds: devices.map((d) => d.credentialId) }) });
  }

  private async finishAuth(request: Request): Promise<Response> {
    if (!this.limiter.allow("auth-finish", 30)) return json({ error: "rate" }, 429);
    const body = await this.body(request);
    const challenge = this.pairing.takeChallenge(body?.ticket, "auth", Date.now());
    if (!challenge) return json({ error: "expired" }, 400);
    const credential = body?.credential as { id?: unknown; response?: unknown } | undefined;
    const { state } = await readRemoteState(this.host.service, this.host.system);
    const device = Object.values(state.devices).find((d) => d.credentialId === credential?.id && d.revokedAt === null && d.generation === this.pairing.generation);
    if (!device) return json({ error: "passkey" }, 401);
    const result = await verifyAssertion(credential as never, { challenge, origin: this.origin, rpId: this.rpId, publicKey: device.publicKey, signCount: device.signCount });
    if (device.sid) await revokeSession(this.host.service, this.host.system, device.sid, "remote: re-authenticated").catch(() => undefined);
    const issued = await issueSession(this.host.service, this.host.system, { identityId: this.host.operatorIdentityId, ttlMs: REMOTE_SESSION_TTL_MS, cause: `mobile remote: ${device.id}` });
    const now = new Date().toISOString();
    await mutateRemoteState(this.host.service, this.host.system, (draft) => {
      const current = draft.devices[device.id];
      if (current) draft.devices[device.id] = { ...current, signCount: result.signCount, sid: issued.session.sid, lastSeenAt: now };
    });
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(issued.token) });
  }

  /** The device and the operator caller the cookie resolves to, if the session is still live. Service
   *  calls made for the phone use this caller, so the governance boundary sees the paired human. */
  private async sessionOf(request: Request): Promise<{ device: RemoteDevice; caller: Caller } | undefined> {
    const token = cookieOf(request);
    if (!token) return undefined;
    const resolved = await authenticateSessionToken(this.host.service, this.host.system, token);
    if (!resolved) return undefined;
    const { state } = await readRemoteState(this.host.service, this.host.system);
    const device = Object.values(state.devices).find((d) => d.sid === resolved.session.sid && d.revokedAt === null && d.generation === this.pairing.generation);
    return device ? { device, caller: resolved.caller } : undefined;
  }

  private async signOut(device: RemoteDevice): Promise<Response> {
    if (device.sid) await revokeSession(this.host.service, this.host.system, device.sid, "remote: signed out on phone").catch(() => undefined);
    await mutateRemoteState(this.host.service, this.host.system, (draft) => {
      const current = draft.devices[device.id];
      if (current) draft.devices[device.id] = { ...current, sid: null };
    });
    return json({ ok: true }, 200, { "set-cookie": clearedCookie() });
  }

  // ---- reads ------------------------------------------------------------------------------------

  private async rows(name: string, caller: Caller): Promise<{ key: string; value: Json }[]> {
    return [...(await this.host.service.readProjection(caller, { name })).rows];
  }

  /** Session list plus the decisions waiting on the human. Only what the phone shows is copied. */
  private async snapshot(device: RemoteDevice, caller: Caller) {
    const service = this.host.service;
    const runs = await service.listRuns(caller, { agent: "agent.coding" });
    // Runs come oldest first: the last one per session is its latest; a live one wins for status.
    const latest = new Map<string, { runId: string; status: string }>();
    for (const run of runs) {
      if (!run.correlationId.startsWith("session:")) continue;
      latest.set(run.correlationId.slice("session:".length), { runId: run.runId, status: run.status });
    }
    const active = new Map([...latest].filter(([, run]) => run.status === "running" || run.status === "waiting"));
    const sessions = (await this.rows("sessions", caller)).map((row) => {
      const value = row.value as Record<string, Json>;
      const sessionId = sessionIdOf(row);
      const live = active.get(sessionId);
      const last = latest.get(sessionId);
      const status = live?.status ?? (last ? { completed: "completed", failed: "failed", cancelled: "cancelled" }[last.status] ?? "idle" : "idle");
      return { sessionId, title: typeof value.title === "string" ? value.title : "Session", workspaceId: typeof value.workspaceId === "string" ? value.workspaceId : null, archived: value.archived === true, status, runId: live?.runId ?? null };
    });
    const runSession = new Map(runs.map((run) => [run.runId, run.correlationId.startsWith("session:") ? run.correlationId.slice(8) : null]));
    const decisions = (await service.listContinuations(caller, { status: "OPEN" })).map((c) => ({
      id: c.id,
      runId: c.runId,
      sessionId: runSession.get(c.runId) ?? null,
      type: c.type,
      summary: summaryOf(c.type, c.payload),
      actionable: PHONE_DECISIONS.has(c.type),
    }));
    return { device: { label: device.label }, sessions, decisions, generation: this.pairing.generation };
  }

  private async trace(sessionId: string, caller: Caller) {
    const row = (await this.rows("session-trace", caller)).find((r) => sessionIdOf(r) === sessionId);
    const turns = ((row?.value as { turns?: unknown[] } | undefined)?.turns ?? []) as Array<Record<string, unknown>>;
    // Tool steps keep name, status and a bounded result; the phone collapses them by default.
    return {
      sessionId,
      turns: turns.map((turn) => ({
        index: turn.index,
        userText: turn.userText,
        startedAt: turn.startedAt,
        tools: ((turn.tools as Array<Record<string, unknown>>) ?? []).map((tool) => ({ tool: tool.tool, status: tool.status, startedAt: tool.startedAt, completedAt: tool.completedAt ?? null, result: typeof tool.result === "string" ? tool.result.slice(0, 800) : null })),
        replies: ((turn.requests as Array<Record<string, unknown>>) ?? []).filter((r) => typeof r.responseText === "string" && r.responseText.length > 0).map((r) => String(r.responseText).slice(0, 4000)),
      })),
    };
  }

  private events(request: Request, caller: Caller): Response {
    const last = Number(request.headers.get("last-event-id") ?? "0");
    const afterPosition = Number.isSafeInteger(last) && last >= 0 ? last : 0;
    const encoder = new TextEncoder();
    const abort = new AbortController();
    this.streams.add(abort);
    let ping: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const send = (chunk: string) => {
          try { controller.enqueue(encoder.encode(chunk)); } catch { /* closed */ }
        };
        send("retry: 2000\n\n");
        // Heartbeat well under Bun's default 10s idle timeout; idleTimeout is also set on the listener.
        ping = setInterval(() => send(": ping\n\n"), SSE_HEARTBEAT_MS);
        void (async () => {
          try {
            // Every committed event is a change signal: the phone refetches what it shows, so no
            // change reaches the screen only through a reload. Payloads are never forwarded.
            for await (const event of this.host.service.events(caller, { afterPosition, follow: true, signal: abort.signal })) {
              send(`id: ${event.position}\nevent: changed\ndata: {}\n\n`);
            }
          } catch { /* aborted or store closed */ } finally {
            if (ping) clearInterval(ping);
            this.streams.delete(abort);
            try { controller.close(); } catch { /* already closed */ }
          }
        })();
      },
      cancel: () => {
        if (ping) clearInterval(ping);
        abort.abort();
        this.streams.delete(abort);
      },
    });
    return new Response(stream, { headers: hardened({ "content-type": "text/event-stream", "content-security-policy": phoneCsp("") }) });
  }

  // ---- commands ---------------------------------------------------------------------------------

  /** Commands are deduplicated by (device, commandId): a replay returns the first answer. Acks keep the
   *  claims apart: `accepted` means the service call returned; the outcome arrives as events. */
  private async command(request: Request, device: RemoteDevice, caller: Caller, route: string): Promise<Response> {
    const body = await this.body(request);
    const commandId = typeof body?.commandId === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(body.commandId) ? body.commandId : undefined;
    if (!commandId) return json({ error: "invalid" }, 400);
    const key = `${device.id}:${commandId}`;
    const replay = this.replies.get(key);
    if (replay) return replay.clone();
    if (!this.limiter.allow(`cmd:${device.id}`, 60)) return json({ error: "rate" }, 429);
    const service = this.host.service;
    const parts = route.split("/").map((part) => decodeURIComponent(part));
    let name = "";
    let outcome: Record<string, unknown>;
    if (parts.length === 3 && parts[0] === "sessions" && parts[2] === "turns") {
      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (!text || text.length > MAX_TEXT) return json({ error: "invalid" }, 400);
      name = "turn";
      const sessionId = parts[1] as string;
      const live = (await service.listRuns(caller, { agent: "agent.coding" })).find((r) => r.correlationId === `session:${sessionId}` && (r.status === "running" || r.status === "waiting"));
      if (live) {
        await service.updateState(caller, { runId: live.runId, update: { patch: [{ op: "add", path: "/steer/-", value: { id: commandId, text } }] } as never, idempotencyKey: commandId });
        outcome = { kind: "steer", runId: live.runId };
      } else {
        const rows = await this.rows("sessions", caller);
        const row = rows.find((r) => sessionIdOf(r) === sessionId);
        if (!row) return json({ error: "not-found" }, 404);
        const workspaceId = (row.value as { workspaceId?: string }).workspaceId;
        const settings = ((await this.rows("settings", caller))[0]?.value ?? {}) as Record<string, Json>;
        const run = await service.startRun(caller, {
          agent: "agent.coding",
          input: { sessionId, workspaceId, message: text, mode: settings.permission ?? DEFAULT_PERMISSION_MODE, preset: settings.preset ?? DEFAULT_AGENT_PRESET } as Json,
          idempotencyKey: commandId,
          correlationId: `session:${sessionId}`,
          state: { steer: [] } as Json,
        });
        outcome = { kind: "run", runId: run.runId };
      }
    } else if (parts.length === 3 && parts[0] === "runs" && parts[2] === "stop") {
      name = "stop";
      const run = await service.cancelRun(caller, { runId: parts[1] as string, reason: "user-cancelled", idempotencyKey: commandId });
      outcome = { kind: "cancel", runId: run.runId, status: run.status };
    } else if (parts.length === 3 && parts[0] === "continuations" && parts[2] === "resolve") {
      name = "decision";
      const approved = body?.approved;
      if (typeof approved !== "boolean") return json({ error: "invalid" }, 400);
      const open = (await service.listContinuations(caller, { status: "OPEN" })).find((c) => c.id === parts[1]);
      if (!open) return json({ error: "not-open" }, 409);
      // Reconciling an interrupted effect is a desktop-only decision: never resumed from a phone.
      if (!PHONE_DECISIONS.has(open.type)) return json({ error: "desktop-only" }, 409);
      if (open.type === "governance-approval") {
        const approvalId = (open.condition as { approvalId?: string } | null)?.approvalId;
        if (typeof approvalId !== "string") return json({ error: "invalid" }, 409);
        await service.invoke(caller, { capability: "governance.approval.resolve", input: { approvalId, resolution: approved ? "approved" : "rejected" } as Json, idempotencyKey: commandId });
        outcome = { kind: "governance", approved };
      } else {
        const resolved = await service.resolveContinuation(caller, { continuationId: open.id, action: "resume", input: { approved } as Json, idempotencyKey: commandId });
        outcome = { kind: "continuation", outcome: resolved.outcome };
      }
    } else {
      return json({ error: "not found" }, 404);
    }
    await mutateRemoteState(service, this.host.system, (draft) => {
      draft.audit.push({ at: new Date().toISOString(), deviceId: device.id, command: name, commandId, outcome: String(outcome.kind) });
    });
    const reply = json({ received: true, accepted: true, ...outcome });
    this.replies.set(key, reply.clone());
    return reply;
  }
}

/** A session row's id: the projection's own `id` (or `sessionId`), else the key's tail after the tenant. */
function sessionIdOf(row: { readonly key: string; readonly value: Json }): string {
  const value = row.value as { readonly id?: unknown; readonly sessionId?: unknown };
  if (typeof value.id === "string") return value.id;
  if (typeof value.sessionId === "string") return value.sessionId;
  return row.key.split("/").slice(1).join("/");
}

/** Decision types the phone may answer; the rest are shown but decided on the desktop. */
const PHONE_DECISIONS = new Set(["tool-approval", "plan-review", "governance-approval"]);

/** Short, bounded text for a decision card: what will run, never a file's contents. */
function summaryOf(type: string, payload: Json): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const tool = typeof p.tool === "string" ? p.tool : typeof p.name === "string" ? p.name : undefined;
  if (type === "tool-approval" && tool) return `Run tool ${tool}`;
  if (type === "plan-review") return "Review the proposed plan";
  if (type === "governance-approval") return "SEA-Forge approval requested";
  if (type === "ambiguous-invocation") return "A previous step may have run; reconcile it on the desktop";
  return `Decision: ${type}`;
}

/** Strict CSP for the phone: same-origin script only (the shell's module script carries the nonce),
 *  no inline script, no framing, no outbound connections beyond this origin. */
export function phoneCsp(nonce: string): string {
  const scripts = nonce ? `'self' 'nonce-${nonce}'` : "'self'";
  return `default-src 'none'; script-src ${scripts}; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

