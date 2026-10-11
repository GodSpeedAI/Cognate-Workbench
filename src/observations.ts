// Usage pass U6 — RealityTrace enrichment, Option A (operator decision 2026-09-29): the execution
// trace is Cognate's own (the `session-trace` projection folds the authoritative event log);
// RealityTrace adds the per-step EVIDENCE layer on top. Trace-worthy events are committed to the
// outbox in the same decision as the event itself (the runtime's generic `outboxFor` hook — no
// runtime dependency on RealityTrace), and an `ObservationDelivery` drains them at-least-once in
// the background to the pinned SXR CLI. SXR-down never blocks or breaks the app: deliveries retry
// with backoff, then poison for reconciliation (the adapter's own contract, ADR-0007 / spec §20).
//
// The read side is two client-invoke capabilities (unrecorded, like `model.configure` — receipts
// live in the DurableStore's `observations` collection, NOT the event log, so they must not be
// folded by a projection):
//   - `observation.status`: per-event delivery status (observationId, state, targetRef = SXR
//     ledger position, attempts) for a session's observed events;
//   - `observation.record`: the SXR record's CEP `extensions.cognate` correlation payload for one
//     delivered observation (the inspector's "view record" drill-down, via the port's
//     `readCorrelation`).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { StoredEvent, Json, DurableStore, OutboxIntent } from "@godspeedai/cognate-events";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { ObservationDelivery, observationIntent, createSxrCliPort, type ObservationPort } from "@godspeedai/cognate-realitytrace";
import type { SxrWorkflow } from "@godspeedai/cognate-realitytrace";

/** The events worth an evidence record: a step's start, completion, failure, the turn's final
 *  answer, and a failed run. Kept deliberately small — every observation is an SXR ingest
 *  subprocess; the tool-call/failure family is what the inspector enriches. */
const OBSERVED_EVENT_TYPES = new Set([
  "tool.call.started", "tool.call.completed", "tool.call.failed", "message.completed", "run.failed",
  // Cognitive-navigation evidence that affects settlement rides the same outbox (no second evidence system).
  "verification.observed", "world.baseline.frozen", "world.candidate.frozen", "world.candidate.rejected", "world.settled",
  "sentinel.finding", "experiment.round.completed", "method.recommended", "method.accepted",
]);

/** Which capability an observation is about — `tool.<name>` for tool events (payload.tool), else
 *  omitted (the turn-level events are app events, not capability invocations). */
function capabilityIdOf(event: StoredEvent): string | undefined {
  if (!event.eventType.startsWith("tool.call.")) return undefined;
  const tool = (event.payload as { readonly tool?: unknown }).tool;
  return typeof tool === "string" ? `tool.${tool}` : undefined;
}

/** The runtime's `outboxFor` hook: committed atomically with each observed event. The hook
 *  receives the runtime's `PendingEvent` (a `StoredEvent` minus the stream-position fields
 *  `observationIntent` never reads). */
export function observationOutboxFor(
  event: Omit<StoredEvent, "streamSequence" | "position">,
): readonly OutboxIntent[] {
  if (!OBSERVED_EVENT_TYPES.has(event.eventType)) return [];
  return [observationIntent(event as StoredEvent, { classification: "durable_fact", capabilityId: capabilityIdOf(event as StoredEvent) })];
}

/** The pinned SXR CLI (v0.3.0, `just setup-realitytrace`), or null when absent — dev machines
 *  without the binary boot fine and the dev tools still work (observations stay queued). */
export function defaultSxrBin(): string | undefined {
  const configured = process.env.SXR_BIN;
  if (configured) return existsSync(configured) ? configured : undefined;
  const candidate = fileURLToPath(new URL("../../../../../.tmp/realitytrace/bin/realitytrace", import.meta.url));
  return existsSync(candidate) ? candidate : undefined;
}

export interface ObservationWiring {
  readonly delivery: ObservationDelivery;
  /** The SXR CLI port (drill-down reads go through `readCorrelation`). */
  readonly port: ReturnType<typeof createSxrCliPort>;
  stop(): void;
}

/** Builds the SXR port (prerequisite workflow: enroll → question → threshold → run), the
 *  at-least-once background drain loop, and returns the handle the capabilities read through.
 *  `env` isolates SXR's XDG state per home (tests use the boot home; the phase-0 contract). */
export async function wireObservations(options: {
  readonly store: DurableStore;
  readonly bin: string;
  readonly repoDir: string;
  readonly env?: Record<string, string>;
  readonly drainIntervalMs?: number;
  /** Usage pass U7: the durable RealityTrace plugin gate (`settings.changed` → `plugins`
   *  fold, read per drain cycle). When it returns false the drain cycle is skipped and
   *  observations stay queued — at-least-once semantics mean nothing is lost, and enabling
   *  the plugin drains the backlog. Absent gate = always drain (the pre-U7 behavior). */
  readonly enabled?: () => boolean | Promise<boolean>;
}): Promise<ObservationWiring> {
  const port = createSxrCliPort({ bin: options.bin, repoDir: options.repoDir, env: options.env });
  let workflow: SxrWorkflow | undefined;
  try {
    workflow = await port.prepare({ title: "Cognate Console runtime execution" });
  } catch (error) {
    throw new Error(`realitytrace: SXR prerequisite workflow failed (${error instanceof Error ? error.message : String(error)})`);
  }
  void workflow;
  const delivery = new ObservationDelivery(options.store, { port, backoff: { baseMs: 250, maxMs: 4_000, maxAttempts: 5 } });
  const drainIntervalMs = options.drainIntervalMs ?? 1_000;
  const drainOnce = async () => {
    if (options.enabled && !(await options.enabled())) return;
    await delivery.drain();
  };
  const timer = setInterval(() => {
    void drainOnce().catch(() => {
      // Drain failures never touch committed events; the dispatcher's own retry/backoff/poison
      // bookkeeping records the states (the adapter's contract).
    });
  }, drainIntervalMs);
  // Drain immediately too, so short-lived boots (tests) deliver without waiting a full interval.
  void drainOnce().catch(() => {});
  return {
    delivery,
    port,
    stop() {
      clearInterval(timer);
    },
  };
}

/** Read-side capability component (see the module doc): `observation.status` + `observation.record`.
 *  Unbound in `.sea` deliberately — same precedent as `onboarding.dismiss`: a diagnostic read over
 *  the adapter's receipt store, not a domain capability (see BINDINGS.md). */
export function observationCapabilityComponent(options: {
  readonly getService: () => RuntimeService;
  /** Absent when no SXR target is configured (dev machines without the pinned binary): the read
   *  side stays mounted and reports honest `queued` states instead of erroring the inspector. */
  readonly delivery?: ObservationDelivery;
  readonly port?: { readCorrelation?: (targetRef: string) => Promise<Json | null> };
  readonly operatorCaller: Caller;
}): Component {
  return {
    id: "observation:read",
    provides: [
      { id: "observation.status", version: "1.0.0" },
      { id: "observation.record", version: "1.0.0" },
    ],
    activate(fiber) {
      fiber.provide({ id: "observation.status", version: "1.0.0" }, async (rawInput, ctx) => {
        const input = rawInput as { readonly sessionId?: string; readonly eventIds?: readonly string[] };
        const caller: Caller = { actor: ctx.actor, tenant: ctx.tenant ?? "local" };
        let eventIds: string[];
        if (Array.isArray(input.eventIds)) {
          eventIds = input.eventIds.filter((id): id is string => typeof id === "string");
        } else if (typeof input.sessionId === "string") {
          eventIds = [];
          for await (const event of options.getService().events(caller, { correlationId: `session:${input.sessionId}` })) {
            if (OBSERVED_EVENT_TYPES.has(event.eventType)) eventIds.push(event.eventId);
          }
        } else {
          throw new Error("observation.status: sessionId or eventIds is required");
        }
        const statuses = [];
        for (const eventId of eventIds) {
          const status = options.delivery ? await options.delivery.status(eventId) : undefined;
          statuses.push({ eventId, ...(status ?? { state: "queued" }) });
        }
        return { statuses };
      });
      fiber.provide({ id: "observation.record", version: "1.0.0" }, async (rawInput) => {
        const input = rawInput as { readonly targetRef?: string };
        if (typeof input.targetRef !== "string") throw new Error("observation.record: targetRef is required");
        if (!options.port?.readCorrelation) throw new Error("observation.record: no SXR target is configured on this deployment");
        return { correlation: await options.port.readCorrelation(input.targetRef) };
      });
    },
  };
}

