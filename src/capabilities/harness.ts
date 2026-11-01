// External agent-harness capabilities (J-HARNESS-detect / -session / -approval / -cancel / -unavailable).
//
//   agent.harness.list       {refresh?}  -> detected CLIs on the SERVER HOST (+ host platform)
//   session.harness.bind     {sessionId, harnessId|null, permissionMode?, model?} -> durable binding
//   session.harness.resolve  {sessionId} -> the binding the agent reads (recorded step)
//   harness.turn.advance     internal step the `agent.harness` run invokes repeatedly
//
// Local world only: harness sessions use the explicit host-process runner (src/agents/harness/
// hostProcess.ts) because the Cognate execution port cannot stream or accept stdin. Workspaces in
// remote, contained, SSH or WSL worlds are refused with a reason. See
// .agents/reports/ui-production-readiness/framework-gap-streaming-process.md.
import { randomUUID } from "node:crypto";
import type { ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import type { Json } from "@godspeedai/cognate-events";
import type { CapabilityContract, Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_CONFIG } from "../agents/agentConfig.ts";
import { findHarness, isPermissionMode, postureFor, type HarnessPermissionMode } from "../agents/harness/catalog.ts";
import type { HarnessDetector } from "../agents/harness/detect.ts";
import type { HarnessSessionHost, AdvanceInput } from "../agents/harness/sessions.ts";
import type { SessionHarnessBindingRow } from "../projections/sessionHarnessBindings.ts";


export interface HarnessBindInput {
  readonly sessionId: string;
  readonly harnessId: string | null;
  readonly permissionMode?: string;
  readonly model?: string;
}

export interface HarnessAdvanceInput {
  readonly op: "start" | "respond" | "continue";
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly message?: string;
  readonly responses?: readonly { readonly requestId: string; readonly approved: boolean }[];
}

export interface HarnessResolved {
  readonly harnessId: string | null;
  readonly label?: string;
  readonly permissionMode?: string;
  readonly model?: string;
  readonly posture?: string;
  readonly resumeId?: string;
}

interface WorkspaceValue { readonly root: string; readonly executionWorldId: string; readonly title: string }

export function harnessComponent(options: {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly registry: ExecutionWorldRegistry;
  readonly detector: HarnessDetector;
  readonly host: HarnessSessionHost;
  /** SEA-Forge governance on: harness sessions cannot be governed, so they are refused. */
  readonly governanceActive: boolean;
  readonly semanticRefs: Readonly<Record<string, SemanticRef | undefined>>;
}): Component {
  const contract = (id: string): CapabilityContract => ({ id, version: "1.0.0", semanticRef: options.semanticRefs[id] });
  const contracts = ["agent.harness.list", "session.harness.bind", "session.harness.resolve", "harness.turn.advance"].map(contract);

  const sessionRow = async (sessionId: string): Promise<{ readonly workspaceId: string } | undefined> => {
    const rows = (await options.getService().readProjection(options.systemCaller, { name: "sessions" })).rows;
    return rows.find((r) => r.key === sessionId || r.key.endsWith(`/${sessionId}`))?.value as { readonly workspaceId: string } | undefined;
  };
  const bindingRow = async (sessionId: string): Promise<SessionHarnessBindingRow | undefined> => {
    const rows = (await options.getService().readProjection(options.systemCaller, { name: "session-harness-bindings" })).rows;
    return rows.find((r) => r.key === sessionId || r.key.endsWith(`/${sessionId}`))?.value as unknown as SessionHarnessBindingRow | undefined;
  };
  const workspaceOf = async (workspaceId: string): Promise<WorkspaceValue> => {
    const rows = (await options.getService().readProjection(options.systemCaller, { name: "workspaces" })).rows;
    const row = rows.find((r) => r.key === `record/${workspaceId}`);
    if (!row) throw new Error(`harness: unknown workspace ${workspaceId}`);
    return row.value as unknown as WorkspaceValue;
  };
  /** Refuses anything but a workspace in a world of kind `local`, with the reason. */
  const assertLocalWorld = (workspace: WorkspaceValue): void => {
    const world = options.registry.list().find((w) => w.worldId === workspace.executionWorldId);
    if (!world || world.kind !== "local") {
      throw new Error(
        `harness sessions run only on workspaces in this machine's local world. "${workspace.title}" lives in ${world ? `a ${world.kind} world ("${world.worldId}")` : `an unavailable world ("${workspace.executionWorldId}")`}. ` +
          `Use the native agent here, or open the folder on the machine running the Workbench. (Remote, contained, SSH and WSL harness sessions wait for a streaming process port in the Cognate execution layer.)`,
      );
    }
  };
  const assertGovernanceOff = (): void => {
    if (options.governanceActive) throw new Error("harness sessions are unavailable while SEA-Forge governance is on: an external CLI's tool calls cannot be governed or settled");
  };
  const activeRun = async (sessionId: string): Promise<boolean> => {
    const runs = await options.getService().listRuns(options.systemCaller, { correlationId: `session:${sessionId}` });
    return runs.some((r) => r.status === "running" || r.status === "waiting");
  };

  return {
    id: "harness",
    provides: contracts,
    activate(fiber) {
      fiber.provide(contract("agent.harness.list"), async (raw) => {
        const input = (raw ?? {}) as { readonly refresh?: boolean };
        return (await options.detector.list({ refresh: input.refresh === true })) as unknown as Json;
      });

      fiber.provide(contract("session.harness.resolve"), async (raw) => {
        const { sessionId } = raw as { readonly sessionId: string };
        const row = await bindingRow(sessionId);
        const entry = row?.harnessId ? findHarness(row.harnessId) : undefined;
        const out: HarnessResolved = row?.harnessId && entry
          ? { harnessId: row.harnessId, label: entry.label, ...(row.permissionMode ? { permissionMode: row.permissionMode } : {}), ...(row.model ? { model: row.model } : {}), ...(row.posture ? { posture: row.posture } : {}), ...(row.resumeId ? { resumeId: row.resumeId } : {}) }
          : { harnessId: null };
        return out as unknown as Json;
      });

      fiber.provide(contract("session.harness.bind"), async (raw) => {
        const input = raw as HarnessBindInput;
        if (typeof input.sessionId !== "string" || !input.sessionId.trim()) throw new Error("session.harness.bind: a sessionId is required");
        const session = await sessionRow(input.sessionId);
        if (!session) throw new Error(`session.harness.bind: unknown session ${input.sessionId}`);
        if (await activeRun(input.sessionId)) throw new Error("session.harness.bind: a run is active in this session — stop it or wait for it to finish before changing the agent");
        const record = async (payload: Record<string, Json>): Promise<void> => {
          await options.getService().startRun(options.systemCaller, {
            agent: AGENT_CONFIG,
            input: { kind: "session.recorded", events: [{ type: "session.harness.bound", payload: { sessionId: input.sessionId, workspaceId: session.workspaceId, ...payload } }] },
            idempotencyKey: randomUUID(),
            correlationId: `session:${input.sessionId}`,
          });
        };
        if (input.harnessId === null || input.harnessId === undefined) {
          await record({ harnessId: null });
          return { sessionId: input.sessionId, workspaceId: session.workspaceId, harnessId: null };
        }
        const entry = typeof input.harnessId === "string" ? findHarness(input.harnessId) : undefined;
        if (!entry) throw new Error(`session.harness.bind: unknown harness ${String(input.harnessId)}`);
        assertGovernanceOff();
        const mode = (input.permissionMode ?? "ask") as string;
        if (!isPermissionMode(entry, mode)) throw new Error(`session.harness.bind: ${entry.label} does not offer the "${mode}" permission mode (offers: ${entry.permissionModes.join(", ")})`);
        const model = typeof input.model === "string" ? input.model.trim() : undefined;
        if (model !== undefined && model !== "" && (model.length > 200 || /^-|[\u0000-\u001f\s]/.test(model))) throw new Error("session.harness.bind: the model must be a plain identifier (no spaces, control characters or a leading dash)");
        assertLocalWorld(await workspaceOf(session.workspaceId));
        const launch = await options.detector.launchFor(entry.id);
        if (!launch) throw new Error(`session.harness.bind: ${entry.label} is not installed on this machine. Install it (${entry.installHint.command ?? entry.installHint.url}), then refresh the list. ${entry.signInHint}`);
        const posture = postureFor(entry, mode as HarnessPermissionMode);
        await record({ harnessId: entry.id, permissionMode: mode, ...(model ? { model } : {}), posture });
        return { sessionId: input.sessionId, workspaceId: session.workspaceId, harnessId: entry.id, label: entry.label, permissionMode: mode, ...(model ? { model } : {}), posture };
      });

      fiber.provide(contract("harness.turn.advance"), async (raw, ctx) => {
        const input = raw as HarnessAdvanceInput;
        if (!ctx.runId) throw new Error("harness.turn.advance: only an agent run may drive a harness session");
        let step: AdvanceInput;
        if (input.op === "start") {
          if (typeof input.message !== "string" || !input.message.trim()) throw new Error("harness.turn.advance: a message is required");
          const binding = await bindingRow(input.sessionId);
          const entry = binding?.harnessId ? findHarness(binding.harnessId) : undefined;
          if (!binding || !entry) throw new Error("harness.turn.advance: this session is not bound to a harness");
          if (binding.workspaceId !== input.workspaceId) throw new Error("harness.turn.advance: the session is bound in a different workspace");
          assertGovernanceOff();
          const workspace = await workspaceOf(input.workspaceId);
          assertLocalWorld(workspace);
          step = {
            runId: ctx.runId,
            op: "start",
            harnessId: entry.id,
            cwd: workspace.root,
            message: input.message,
            mode: (binding.permissionMode ?? "ask") as HarnessPermissionMode,
            ...(binding.model ? { model: binding.model } : {}),
            ...(binding.resumeId ? { resumeId: binding.resumeId } : {}),
          };
        } else if (input.op === "respond") {
          step = { runId: ctx.runId, op: "respond", responses: input.responses ?? [] };
        } else {
          step = { runId: ctx.runId, op: "continue" };
        }
        const progress = ctx.progress ? (p: { kind: "text"; text: string }) => ctx.progress!(p as unknown as Json) : undefined;
        const result = await options.host.advance(step, { ...(ctx.signal ? { signal: ctx.signal } : {}), ...(progress ? { progress } : {}) });
        return result as unknown as Json;
      });
    },
  };
}
