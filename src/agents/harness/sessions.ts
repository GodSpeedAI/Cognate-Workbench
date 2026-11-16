// HarnessSessionHost: the live-process side of a harness turn, keyed by run id.
//
// Why a host object and a recorded "advance" capability (see capabilities/harness.ts): Cognate agent
// code must be deterministic and all I/O recorded. The CLI process itself is live state that cannot
// be replayed, so the agent drives it through ONE recorded capability, `harness.turn.advance`,
// invoked repeatedly: each invocation runs the CLI until the next point the agent must act on (a
// batch of tool events, a permission request, or the end of the turn) and returns the normalized
// events. On replay the recorded results are returned and NO process is spawned. If a run resumes
// after the server restarted mid-turn there is no live process to continue: the next advance fails
// with a readable "session lost" error and the turn fails (an interrupted `start` is additionally
// held for operator reconciliation by the runtime's `ambiguousSteps: "wait"`).
import { findHarness, type HarnessCatalogEntry, type HarnessPermissionMode } from "./catalog.ts";
import { buildHarnessEnv, type HarnessDetector } from "./detect.ts";
import { HostProcess } from "./hostProcess.ts";
import { AcpDriver } from "./adapters/acp.ts";
import { ClaudeDriver } from "./adapters/claude.ts";
import { CodexDriver } from "./adapters/codex.ts";
import type { DriverIo, HarnessDriver, HarnessEvent, TurnConfig } from "./types.ts";

export type AdvanceInput =
  | {
      readonly runId: string;
      readonly op: "start";
      readonly harnessId: string;
      readonly cwd: string;
      readonly message: string;
      readonly mode: HarnessPermissionMode;
      readonly model?: string;
      readonly resumeId?: string;
      readonly instructions?: string;
    }
  | { readonly runId: string; readonly op: "respond"; readonly responses: readonly { readonly requestId: string; readonly approved: boolean }[] }
  | { readonly runId: string; readonly op: "continue" };

export type AdvanceStop = "yield" | "permission" | "completed" | "failed" | "cancelled";

export interface AdvanceResult {
  readonly events: readonly HarnessEvent[];
  readonly stop: AdvanceStop;
  readonly stopReason?: string;
  readonly error?: { readonly code: "AUTH_REQUIRED" | "RATE_LIMITED" | "CRASHED" | "FAILED" | "SESSION_LOST"; readonly message: string };
}

export interface AdvanceHooks {
  readonly signal?: AbortSignal;
  /** Live text for the transcript (`run.invocation.progress`, kind "text"). */
  readonly progress?: (payload: { kind: "text"; text: string }) => Promise<void>;
}

interface Live {
  readonly runId: string;
  readonly entry: HarnessCatalogEntry;
  readonly proc: HostProcess;
  readonly driver: HarnessDriver;
  queue: HarnessEvent[];
  terminal: { kind: "completed"; stopReason: string } | { kind: "failed"; message: string } | undefined;
  wake: (() => void) | undefined;
  busy: boolean;
  awaiting: Set<string>;
  lastActivity: number;
  gotFrame: boolean;
}

const YIELD_DEBOUNCE_MS = 30;
const PROGRESS_FLUSH_MS = 40;
const STARTUP_TIMEOUT_MS = 60_000;
const APPROVAL_TTL_MS = 30 * 60_000;
const CANCEL_GRACE_MS = 3000;
const RATE_LIMIT = /rate.?limit|usage limit|quota|too many requests|\b429\b|overloaded|credit balance/i;

function createDriver(config: TurnConfig, io: DriverIo): HarnessDriver {
  switch (config.entry.protocol) {
    case "claude-stream-json": return new ClaudeDriver(config, io);
    case "codex-app-server": return new CodexDriver(config, io);
    case "acp": return new AcpDriver(config, io);
  }
}

export function classifyFailure(entry: HarnessCatalogEntry, message: string, stderr: string): NonNullable<AdvanceResult["error"]> {
  const haystack = `${message}\n${stderr}`;
  if (entry.authPatterns.some((p) => p.test(haystack))) {
    return { code: "AUTH_REQUIRED", message: `${entry.label} is not signed in. ${entry.signInHint}` };
  }
  if (RATE_LIMIT.test(haystack)) return { code: "RATE_LIMITED", message: `${entry.label} reported a rate or usage limit: ${message || stderr.trim().slice(-300)}`.slice(0, 600) };
  return { code: "FAILED", message: (message || `${entry.label} failed`).slice(0, 800) };
}

export class HarnessSessionHost {
  private readonly live = new Map<string, Live>();
  private reaper: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly detector: HarnessDetector) {}

  /** Start the idle reaper. `statusOf` returns a run's status; a finished run's process is killed. */
  startReaper(statusOf: (runId: string) => Promise<string | undefined>, intervalMs = 3000): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => void this.reap(statusOf), intervalMs);
    this.reaper.unref?.();
  }

  private async reap(statusOf: (runId: string) => Promise<string | undefined>): Promise<void> {
    for (const live of [...this.live.values()]) {
      if (live.busy) continue; // an advance is watching its own signal
      let status: string | undefined;
      try { status = await statusOf(live.runId); } catch { continue; }
      const finished = status === "cancelled" || status === "failed" || status === "completed";
      if (finished || Date.now() - live.lastActivity > APPROVAL_TTL_MS) await this.discard(live);
    }
  }

  async shutdown(): Promise<void> {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = undefined;
    await Promise.all([...this.live.values()].map((l) => this.discard(l)));
  }

  /** Number of live harness processes (tests and diagnostics). */
  get liveCount(): number {
    return this.live.size;
  }

  pidFor(runId: string): number | undefined {
    return this.live.get(runId)?.proc.pid;
  }

  private async discard(live: Live): Promise<void> {
    this.live.delete(live.runId);
    await live.proc.terminate(500);
  }

  async advance(input: AdvanceInput, hooks: AdvanceHooks = {}): Promise<AdvanceResult> {
    let live: Live;
    if (input.op === "start") {
      const existing = this.live.get(input.runId);
      if (existing) await this.discard(existing);
      live = await this.spawn(input);
    } else {
      const found = this.live.get(input.runId);
      if (!found) {
        return { events: [], stop: "failed", error: { code: "SESSION_LOST", message: "The external CLI session is no longer running (the Workbench restarted or the process exited). Send the message again to start a new turn." } };
      }
      live = found;
      if (input.op === "respond") {
        for (const r of input.responses) {
          live.awaiting.delete(r.requestId);
          live.driver.respond(r.requestId, r.approved);
        }
      }
    }
    live.busy = true;
    live.lastActivity = Date.now();
    try {
      return await this.collect(live, hooks);
    } finally {
      live.busy = false;
      live.lastActivity = Date.now();
    }
  }

  private async spawn(input: Extract<AdvanceInput, { op: "start" }>): Promise<Live> {
    const entry = findHarness(input.harnessId);
    if (!entry) throw new Error(`unknown harness ${input.harnessId}`);
    const launch = await this.detector.launchFor(entry.id);
    if (!launch) throw new Error(`${entry.label} is not installed on this machine. Install: ${entry.installHint.command ?? entry.installHint.url}`);
    const ctx = { mode: input.mode, ...(input.model ? { model: input.model } : {}), ...(input.resumeId ? { resumeId: input.resumeId } : {}), ...(input.instructions ? { instructions: input.instructions } : {}), ...(launch.acpFlag ? { acpFlag: launch.acpFlag } : {}) };
    const env = buildHarnessEnv(entry, this.detector.hostEnv, entry.buildEnv?.(ctx) ?? {});
    const proc = HostProcess.spawn({ argv: [...launch.prefix, ...entry.buildArgv(ctx)], cwd: input.cwd, env });
    const turn: TurnConfig = { entry, cwd: input.cwd, message: input.message, mode: input.mode, ...(input.model ? { model: input.model } : {}), ...(input.resumeId ? { resumeId: input.resumeId } : {}), ...(input.instructions ? { instructions: input.instructions } : {}) };
    // `live` is assigned right after the driver exists; IO callbacks close over it.
    const state: { live?: Live } = {};
    const wake = (): void => { const w = state.live?.wake; if (w) { state.live!.wake = undefined; w(); } };
    const io: DriverIo = {
      write: (frame) => proc.write(frame),
      push: (event) => { state.live?.queue.push(event); wake(); },
      finish: (stopReason) => { if (state.live && !state.live.terminal) { state.live.terminal = { kind: "completed", stopReason }; wake(); } },
      fail: (message) => { if (state.live && !state.live.terminal) { state.live.terminal = { kind: "failed", message }; wake(); } },
    };
    const driver = createDriver(turn, io);
    const live: Live = { runId: input.runId, entry, proc, driver, queue: [], terminal: undefined, wake: undefined, busy: false, awaiting: new Set(), lastActivity: Date.now(), gotFrame: false };
    state.live = live;
    this.live.set(input.runId, live);
    proc.subscribe(
      (line) => {
        live.gotFrame = true;
        let frame: unknown;
        try { frame = JSON.parse(line); } catch { return; } // non-JSON chatter (banners, logs) is ignored
        if (frame && typeof frame === "object" && !Array.isArray(frame)) {
          try { driver.onFrame(frame as Record<string, unknown>); } catch (error) { io.fail(`adapter error: ${error instanceof Error ? error.message : String(error)}`); }
        }
      },
      () => {
        if (live.terminal) return;
        const tail = proc.stderrTail.trim();
        void proc.exited.then((exit) => {
          if (live.terminal) return;
          const reason = proc.frameTooLarge ? "sent a frame larger than the 4 MiB limit" : exit === 0 ? "ended without finishing the turn" : `exited with code ${exit ?? "signal"}`;
          live.terminal = { kind: "failed", message: `${entry.label} ${reason}.${tail ? ` ${tail.slice(-400)}` : ""}` };
          wake();
        });
      },
    );
    driver.begin();
    // A CLI that never answers its opening frames must not hold the run forever.
    setTimeout(() => {
      if (!live.gotFrame && !live.terminal && this.live.get(live.runId) === live) {
        live.terminal = { kind: "failed", message: `${entry.label} did not respond within ${STARTUP_TIMEOUT_MS / 1000} seconds. Check its installation and sign-in.` };
        wake();
      }
    }, STARTUP_TIMEOUT_MS).unref?.();
    return live;
  }

  private async collect(live: Live, hooks: AdvanceHooks): Promise<AdvanceResult> {
    const out: HarnessEvent[] = [];
    let textPending = "";
    let lastFlush = 0;
    let firstNonText = 0;
    let aborted = false;
    let escalating: Promise<void> | undefined;

    const flushText = async (force: boolean): Promise<void> => {
      if (!textPending) return;
      if (!force && Date.now() - lastFlush < PROGRESS_FLUSH_MS) return;
      const text = textPending;
      textPending = "";
      lastFlush = Date.now();
      try { await hooks.progress?.({ kind: "text", text }); } catch { /* progress is best-effort */ }
    };
    const drain = (): void => {
      for (const event of live.queue.splice(0)) {
        if (event.kind === "text") {
          textPending += event.text;
          const last = out[out.length - 1];
          if (last?.kind === "text") out[out.length - 1] = { kind: "text", text: last.text + event.text };
          else out.push(event);
        } else {
          if (!firstNonText) firstNonText = Date.now();
          if (event.kind === "approval") live.awaiting.add(event.requestId);
          out.push(event);
        }
      }
    };
    const onAbort = (): void => {
      if (aborted) return;
      aborted = true;
      live.driver.interrupt();
      escalating = (async () => {
        await Promise.race([Bun.sleep(CANCEL_GRACE_MS), new Promise<void>((resolve) => { const t = setInterval(() => { if (live.terminal) { clearInterval(t); resolve(); } }, 25); })]);
        await this.discard(live);
        live.terminal ??= { kind: "failed", message: "cancelled" };
        live.wake?.();
      })();
    };
    if (hooks.signal?.aborted) onAbort();
    hooks.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        drain();
        await flushText(false);
        if (live.terminal) break;
        if (aborted) { await escalating; break; }
        if (live.awaiting.size > 0 && out.some((e) => e.kind === "approval")) {
          await flushText(true);
          return { events: out, stop: "permission" };
        }
        if (firstNonText && Date.now() - firstNonText >= YIELD_DEBOUNCE_MS) {
          await flushText(true);
          return { events: out, stop: "yield" };
        }
        await new Promise<void>((resolve) => {
          live.wake = resolve;
          const timer = setTimeout(resolve, firstNonText ? YIELD_DEBOUNCE_MS : PROGRESS_FLUSH_MS);
          timer.unref?.();
        });
        live.wake = undefined;
      }
      drain();
      await flushText(true);
      const terminal = live.terminal!;
      if (aborted) {
        await escalating;
        return { events: out, stop: "cancelled" };
      }
      const stderr = live.proc.stderrTail;
      // The turn is over either way; the one-shot process is not reused.
      void this.discard(live);
      if (terminal.kind === "completed") return terminal.stopReason === "cancelled" ? { events: out, stop: "cancelled", stopReason: terminal.stopReason } : { events: out, stop: "completed", stopReason: terminal.stopReason };
      return { events: out, stop: "failed", error: classifyFailure(live.entry, terminal.message, stderr) };
    } finally {
      hooks.signal?.removeEventListener("abort", onAbort);
    }
  }
}
