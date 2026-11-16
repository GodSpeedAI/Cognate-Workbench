// J-PREVIEW-register: governed development-server previews. A registration is explicit — URL,
// world, ownership — never scraped out of stdout. Readiness is probed before the preview is
// ready; an unreachable port is refused with the reason. An SSH world is reached by a local
// forward (see sshForward.ts); a WSL world relies on WSL2's loopback forwarding (Windows-host
// feature, documented); a local world is the host's own loopback. When the Workbench owns the
// server process (a pid from governed execution), stopping the preview ends that process with
// the terminal's process-group discipline; stopping the owning session or task ends the preview.
import { randomUUID } from "node:crypto";
import type { SshConnectionFacts } from "../terminal/ssh.ts";
import { openSshForward, type SshForward } from "./sshForward.ts";

export interface PreviewView {
  readonly previewId: string;
  readonly worldId: string;
  readonly worldKind: string;
  readonly workspaceId?: string;
  /** The URL the browser opens (the forwarded loopback URL for SSH worlds). */
  readonly viewUrl: string;
  /** The URL as registered — inside an SSH world this names the world's own loopback. */
  readonly originUrl: string;
  readonly status: "ready" | "stopped";
  readonly ownerSessionId?: string;
  readonly ownerTaskId?: string;
  readonly ownerRunId?: string;
  readonly pid?: number;
  readonly registeredAt: number;
}

interface PreviewRecord {
  readonly previewId: string;
  readonly worldId: string;
  readonly worldKind: string;
  readonly workspaceId?: string;
  readonly originUrl: string;
  readonly viewUrl: string;
  status: "ready" | "stopped";
  readonly ownerSessionId?: string;
  readonly ownerTaskId?: string;
  readonly ownerRunId?: string;
  readonly pid?: number;
  readonly registeredAt: number;
  forward?: SshForward;
}

export interface PreviewRegistration {
  readonly worldId: string;
  readonly worldKind: string;
  readonly originUrl: string;
  readonly workspaceId?: string;
  readonly ownerSessionId?: string;
  readonly ownerTaskId?: string;
  readonly ownerRunId?: string;
  /** A server process the Workbench governs (spawned through governed execution). */
  readonly pid?: number;
  /** SSH connection facts, when the world is SSH — everything else needs no facts. */
  readonly worldFacts?: SshConnectionFacts;
}

const READINESS_WINDOW_MS = 10_000;
const READINESS_INTERVAL_MS = 300;
const MAX_PREVIEWS = 16;

const TERMINATE_GRACE_MS = 1_500;

async function probeReadiness(url: string): Promise<void> {
  const deadline = Date.now() + READINESS_WINDOW_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return; // any committed HTTP response counts as serving
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, READINESS_INTERVAL_MS));
  }
  throw new Error(`preview.register: the registered URL never answered — ${lastError || "no response"} (${url})`);
}

/** Process-group termination, the terminal's discipline: group SIGTERM, grace, group SIGKILL. */
async function killOwnedProcess(pid: number): Promise<boolean> {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return false; // already gone
  }
  const deadline = Date.now() + TERMINATE_GRACE_MS;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0); // liveness probe
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      return true;
    }
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* won the race */
  }
  return true;
}

export interface PreviewServiceOptions {
  /**
   * The durable stop recorder — every stop path (operator, agent, owner-ended) folds the same
   * `workbench.preview.stopped` event through it, so projection and memory agree.
   */
  readonly recordStopped?: (view: PreviewView, reason: string) => Promise<void>;
}

export class PreviewService {
  private readonly previews = new Map<string, PreviewRecord>();
  private readonly recordStopped: (view: PreviewView, reason: string) => Promise<void>;

  constructor(options: PreviewServiceOptions = {}) {
    this.recordStopped = options.recordStopped ?? (async () => {});
  }

  /** Register, probe readiness (through the view URL), and report. Throws when unreachable. */
  async register(input: PreviewRegistration): Promise<PreviewView> {
    if (this.previews.size >= MAX_PREVIEWS) {
      throw new Error(`preview.register: at most ${MAX_PREVIEWS} live previews are supported — stop one first`);
    }
    let parsed: URL;
    try {
      parsed = new URL(input.originUrl);
    } catch {
      throw new Error(`preview.register: ${input.originUrl} is not a URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`preview.register: only http(s) previews are registered (got ${parsed.protocol})`);
    }
    const remotePort = Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);

    let viewUrl = input.originUrl;
    let forward: SshForward | undefined;
    try {
      if (input.worldKind === "ssh") {
        if (!input.worldFacts) throw new Error("preview.register: an SSH world needs its connection facts");
        forward = await openSshForward(input.worldFacts, remotePort);
        viewUrl = forward.viewUrl;
      } else if (input.worldKind === "wsl") {
        // WSL2 forwards localhost into the distro (a Windows-host feature); the view URL is the
        // same loopback. Documented limitation: verified only on Windows hosts.
        viewUrl = input.originUrl;
      } else {
        viewUrl = input.originUrl;
      }
      await probeReadiness(viewUrl);
    } catch (error) {
      if (forward) await forward.close();
      throw error;
    }

    const record: PreviewRecord = {
      previewId: randomUUID(),
      worldId: input.worldId,
      worldKind: input.worldKind,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      originUrl: input.originUrl,
      viewUrl,
      status: "ready",
      ...(input.ownerSessionId ? { ownerSessionId: input.ownerSessionId } : {}),
      ...(input.ownerTaskId ? { ownerTaskId: input.ownerTaskId } : {}),
      ...(input.ownerRunId ? { ownerRunId: input.ownerRunId } : {}),
      ...(input.pid ? { pid: input.pid } : {}),
      registeredAt: Date.now(),
      ...(forward ? { forward } : {}),
    };
    this.previews.set(record.previewId, record);
    return this.view(record);
  }

  view(record: PreviewRecord): PreviewView {
    return {
      previewId: record.previewId,
      worldId: record.worldId,
      worldKind: record.worldKind,
      ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      viewUrl: record.viewUrl,
      originUrl: record.originUrl,
      status: record.status,
      ...(record.ownerSessionId ? { ownerSessionId: record.ownerSessionId } : {}),
      ...(record.ownerTaskId ? { ownerTaskId: record.ownerTaskId } : {}),
      ...(record.ownerRunId ? { ownerRunId: record.ownerRunId } : {}),
      ...(record.pid ? { pid: record.pid } : {}),
      registeredAt: record.registeredAt,
    };
  }

  list(): readonly PreviewView[] {
    return [...this.previews.values()].map((record) => this.view(record));
  }

  /** Stop one preview: closes any forward and ends the Workbench-owned process, if any. */
  async stop(previewId: string, reason: string): Promise<PreviewView> {
    const record = this.previews.get(previewId);
    if (!record) throw new Error(`preview.stop: unknown preview ${previewId}`);
    if (record.forward) {
      await record.forward.close();
      record.forward = undefined;
    }
    let killed = false;
    if (record.pid && record.status === "ready") killed = await killOwnedProcess(record.pid);
    record.status = "stopped";
    void killed;
    await this.recordStopped(this.view(record), reason);
    return this.view(record);
  }

  /** The owning session or task ended: every preview it owns stops with it. */
  async stopForOwner(owner: { readonly sessionId?: string; readonly taskId?: string }): Promise<readonly PreviewView[]> {
    const owned = this.list().filter(
      (entry) => (owner.sessionId && entry.ownerSessionId === owner.sessionId) || (owner.taskId && entry.ownerTaskId === owner.taskId),
    );
    const stopped: PreviewView[] = [];
    for (const entry of owned) stopped.push(await this.stop(entry.previewId, "owner ended"));
    return stopped;
  }

  /** Whether an agent run may stop this preview: it must own it (same registration run). */
  mayStopByRun(previewId: string, runId: string): boolean {
    return this.previews.get(previewId)?.ownerRunId === runId;
  }

  async dispose(): Promise<void> {
    for (const record of this.previews.values()) {
      if (record.forward) await record.forward.close().catch(() => { /* already closed */ });
    }
    this.previews.clear();
  }
}
