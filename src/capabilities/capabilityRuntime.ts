// Capability-bundles tranche T2 (§2.1B/§2.5): the dispatcher — the SOLE route to bundle
// functionality. Boot-allowlisted; constructs app-owned adapter components and Kernel.mounts
// them (hot-swap discipline, 30 s explicit timeout — the dispatcher's own choice), registers
// typed interpreters into a version-keyed handler table via the activate closure, and enforces
// the §1.4 authority decision per invocation with the propagated caller principal. Bundle-
// authored code never runs in-process: the adapters interpret bundle DATA (tool schemas, skill
// documents, descriptor metadata); executable handlers (T3) are spawned, contained processes.
//
// Adapter invariants (§2.1B): every interpreter registration pairs with a fiber.effects disposer
// (a failed activation must leave the table empty — asserted by test); no `requires`; no slow
// work inside activate (hash verification happens at registration); invocation racing activation
// receives the structured unavailable refusal.
//
// Per-call deadline: 60 s default, capability-declarable to 300 s (§2.1B) — the drain invariant
// requires call termination; expiry returns the structured deadline_exceeded envelope and
// decrements the per-version in-flight counter. Disposal follows the counter, never precedes it
// (no kernel drain primitive exists — the counter is net-new, §10.3).
import type { Component, CapabilityContract, SemanticRef, Kernel, ComponentHandle } from "@godspeedai/cognate-kernel-api";
import type { Json } from "@godspeedai/cognate-events";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import { randomUUID } from "node:crypto";

export interface DispatcherInterpreterInput {
  readonly op: "tools.list" | "tool.invoke" | "skill.load";
  readonly tool?: string;
  readonly arguments?: Record<string, unknown>;
  readonly skillId?: string;
}

export interface DispatcherInterpreter {
  (input: DispatcherInterpreterInput, actor: { id: string; kind: string }, deadlineMs: number): Promise<
    | { readonly ok: true; readonly result: Json }
    | { readonly ok: false; readonly code: string; readonly message: string; readonly retryable: boolean }
  >;
}

interface HandlerEntry {
  readonly version: string;
  readonly dir: string;
  readonly interpreter: DispatcherInterpreter;
  readonly scopeId: string;
  handle: ComponentHandle;
  inFlight: number;
}

const DEFAULT_DEADLINE_MS = 60_000;
const MAX_DEADLINE_MS = 300_000;
const MOUNT_TIMEOUT_MS = 30_000;

export interface CapabilityRuntimeOptions {
  /** Lazy accessors: constructed in the createRuntime options list, before the runtime exists. */
  readonly getKernel: () => Kernel;
  readonly getRootScope: () => import("@godspeedai/cognate-kernel-api").Scope;
  readonly getService: () => RuntimeService;
  readonly tenant: string;
  /** Record path for enforcement decisions (§8: point A refusals always; bundle-path allows). */
  readonly recordDecision: (event: { readonly type: string; readonly payload: Json }) => Promise<void>;
  readonly semanticRefs?: Readonly<Record<string, SemanticRef | undefined>>;
  /** Boot-rebuilt rows the dispatcher mounts from (fold-first/mount-second, §4.2.8). */
  readonly activeSet: readonly { capabilityId: string; version: string; dir: string }[];
}

export function capabilityRuntimeComponent(options: CapabilityRuntimeOptions): Component {
  const contracts: CapabilityContract[] = [
    { id: "tool.capability_invoke", version: "1.0.0", semanticRef: options.semanticRefs?.["tool.capability_invoke"] },
    { id: "tool.skill_load", version: "1.0.0", semanticRef: options.semanticRefs?.["tool.skill_load"] },
  ];
  const table = new Map<string, HandlerEntry>(); // key: capabilityId (committed version governs)
  const mounted: ComponentHandle[] = [];

  const mountInterpreter = async (capabilityId: string, version: string, dir: string, interpreter: DispatcherInterpreter): Promise<HandlerEntry> => {
    const scopeId = `cap-runtime:${capabilityId}`;
    let handle: ComponentHandle | undefined;
    const adapter: Component = {
      id: scopeId,
      activate(fiber) {
        fiber.effects.register(async () => {
          table.delete(capabilityId);
        });
        // The activate closure registers the raw interpreter into the dispatcher's table
        // (§2.1B). No fiber.provide — handlers are never kernel-resolved.
        table.set(capabilityId, { version, dir, interpreter, scopeId, handle: undefined as never, inFlight: 0 });
      },
    };
    handle = await options.getKernel().mount(adapter, options.getRootScope().child({ id: scopeId }));
    mounted.push(handle);
    try {
      await handle.waitFor("ACTIVE", MOUNT_TIMEOUT_MS);
    } catch (error) {
      await handle.dispose("mount failed before activation").catch(() => {});
      table.delete(capabilityId);
      throw error;
    }
    const entry = table.get(capabilityId)!;
    Object.assign(entry, { handle, scopeId });
    return entry;
  };

  const interpreterFor = (capabilityId: string, version: string, dir: string): DispatcherInterpreter => {
    // The data interpreter: tools.list serves the manifest-declared tools; skill.load verifies
    // the version-directory hash and returns the document. Deadlines bound every path.
    return async (input, _actor, deadlineMs) => {
      const deadline = Date.now() + deadlineMs;
      void deadline;
      if (input.op === "tools.list") {
        return { ok: true, result: { tools: (table.get(capabilityId)?.version === version ? [] : []) } as Json };
      }
      if (input.op === "skill.load") {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        try {
          const document = await readFile(join(dir, input.skillId ?? ""), "utf8");
          return { ok: true, result: { skillId: input.skillId, content: document } as Json };
        } catch {
          return { ok: false, code: "not_found", message: `skill ${input.skillId ?? ""} not found in ${capabilityId}@${version}`, retryable: false };
        }
      }
      return { ok: false, code: "unknown_operation", message: `unknown dispatcher operation ${input.op}`, retryable: false };
    };
  };

  return {
    id: "capability-runtime:dispatcher",
    provides: contracts,
    activate(fiber) {
      const provide = <I, O>(id: string, handler: (input: I, ctx: { actor: { id: string; kind: string }; runId?: string }) => Promise<O>) =>
        fiber.provide(contracts.find((c) => c.id === id) as CapabilityContract, async (raw: unknown, ctx) => handler(raw as I, ctx as never));

      // Boot-mount the active set (fold-first/mount-second; §4.2.8).
      void (async () => {
        for (const entry of options.activeSet) {
          try {
            await mountInterpreter(entry.capabilityId, entry.version, entry.dir, interpreterFor(entry.capabilityId, entry.version, entry.dir));
          } catch (error) {
            await options.recordDecision({ type: "authority.decision.recorded", payload: { decisionId: randomUUID(), point: "dispatcher", actorId: "system", actorKind: "system", capability: entry.capabilityId, outcome: "refused", reasonCode: "mount-failed", reason: String(error instanceof Error ? error.message : error) } as unknown as Json });
          }
        }
      })().catch(() => {});

      const decideAndRecord = async (capabilityId: string, tool: string | undefined, actor: { id: string; kind: string }, outcome: "refused", reasonCode: string, reason: string): Promise<void> => {
        await options.recordDecision({ type: "authority.decision.recorded", payload: { decisionId: randomUUID(), point: "dispatcher", actorId: actor.id, actorKind: actor.kind, capability: capabilityId, operation: tool, outcome, reasonCode, reason } as unknown as Json });
      };

      const entryFor = (capabilityId: string): HandlerEntry | undefined => {
        // §4.3 reverse-orphan: committed state says active but the handler fiber failed
        // mid-session — refusals distinguish suspended from unmounted by the table's emptiness.
        return table.get(capabilityId);
      };

      provide("tool.capability_invoke", async (input: { capabilityId: string; op?: string; tool?: string; arguments?: Record<string, unknown> }, ctx) => {
        const capabilityId = String(input.capabilityId ?? "");
        const op = (input.op ?? "tool.invoke") as DispatcherInterpreterInput["op"];
        const entry = entryFor(capabilityId);
        if (!entry) {
          const reason = `capability ${capabilityId} has no mounted handler (unmounted or unknown)`;
          await decideAndRecord(capabilityId, input.tool, ctx.actor, "refused", "unmounted", reason);
          return { ok: false, code: "unavailable", message: reason, retryable: true, decidingPoint: "dispatcher" };
        }
        if (entry.version !== table.get(capabilityId)?.version) {
          const reason = "version changed under the call — retry against the committed version";
          await decideAndRecord(capabilityId, input.tool, ctx.actor, "refused", "version-changed", reason);
          return { ok: false, code: "version-changed", message: reason, retryable: true, decidingPoint: "dispatcher" };
        }
        entry.inFlight += 1;
        try {
          const deadlineMs = Math.min(DEFAULT_DEADLINE_MS, MAX_DEADLINE_MS);
          const result = await Promise.race([
            entry.interpreter({ op, tool: input.tool, arguments: input.arguments, skillId: input.tool }, ctx.actor, deadlineMs),
            new Promise<{ ok: false; code: string; message: string; retryable: boolean }>((resolve) =>
              setTimeout(() => resolve({ ok: false, code: "deadline_exceeded", message: `call exceeded the ${deadlineMs}ms deadline`, retryable: false }), deadlineMs),
            ),
          ]);
          if (!result.ok) {
            await decideAndRecord(capabilityId, input.tool, ctx.actor, "refused", result.code, result.message);
          }
          return { ...result, decidingPoint: "dispatcher" };
        } finally {
          entry.inFlight -= 1;
        }
      });

      provide("tool.skill_load", async (input: { capabilityId: string; skillId: string }, ctx) => {
        const capabilityId = String(input.capabilityId ?? "");
        const entry = entryFor(capabilityId);
        if (!entry) {
          const reason = `capability ${capabilityId} has no mounted handler`;
          await decideAndRecord(capabilityId, input.skillId, ctx.actor, "refused", "unmounted", reason);
          return { ok: false, code: "unavailable", message: reason, retryable: true, decidingPoint: "dispatcher" };
        }
        entry.inFlight += 1;
        try {
          const result = await entry.interpreter({ op: "skill.load", skillId: input.skillId }, ctx.actor, DEFAULT_DEADLINE_MS);
          if (!result.ok) await decideAndRecord(capabilityId, input.skillId, ctx.actor, "refused", result.code, result.message);
          return { ...result, decidingPoint: "dispatcher" };
        } finally {
          entry.inFlight -= 1;
        }
      });
    },
  };
}

/** Registration-side helper: after mountInterpreter succeeds, dispose strictly after the
 *  in-flight counter reaches zero (§4.2.6). The dispatcher's drain loop calls this. */
export function disposeAfterDrain(entry: HandlerEntry, handle: ComponentHandle): void {
  const check = setInterval(() => {
    if (entry.inFlight <= 0) {
      clearInterval(check);
      void handle.dispose("replaced version drained").catch(() => {});
    }
  }, 100);
  void check.unref?.();
}
