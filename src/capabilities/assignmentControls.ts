// `assignment.view`, `assignment.interrupt`, `assignment.resume` and `assignment.spend` (WP-23,
// J-CASE-ASSIGNMENT-handoff): the operator's controls over the case assignment a run is bound to.
//
// Each acts as the invoking caller, so the runtime's own action policy decides who may drive an
// assignment (`authorizeAssignmentAction`: the local operator, and the system lineage for spend
// alone). The run's own agent can never interrupt, resume or re-budget its assignment, and this
// module adds no identity of its own: nothing here calls the runtime as the system caller.
import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import { CURRENCIES, type AssignmentService, type Caller, type Currency } from "@godspeedai/cognate-runtime-api";
import { assignmentControls } from "../assignments/assignmentBinding.ts";

interface ControlInput {
  readonly runId?: unknown;
  readonly reason?: unknown;
  readonly currency?: unknown;
  readonly amount?: unknown;
  /** The click's retry identity: a retried click is not a second event. */
  readonly token?: unknown;
}

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function assignmentControlsComponent(options: {
  readonly getAssignments: () => AssignmentService;
  /** Each control's semantic reference, keyed by capability id. */
  readonly refs: Readonly<Record<string, SemanticRef | undefined>>;
}): Component {
  const contract = (id: string) => ({ id, version: "1.0.0", semanticRef: options.refs[id] });
  /** The controls are a human decision, made as the human: the invoking caller, never the system. */
  const controls = (ctx: HandlerContext) => assignmentControls(options.getAssignments(), { actor: ctx.actor, tenant: ctx.tenant } as Caller);
  const runId = (capability: string, input: ControlInput): string => {
    if (!text(input.runId)) throw new Error(`${capability}: a runId is required`);
    return input.runId;
  };
  const token = (capability: string, input: ControlInput): string => {
    if (!text(input.token)) throw new Error(`${capability}: a token is required (the click's retry identity)`);
    return input.token;
  };
  return {
    id: "assignment:controls",
    provides: [
      contract("assignment.view"),
      contract("assignment.interrupt"),
      contract("assignment.resume"),
      contract("assignment.spend"),
    ],
    activate(fiber) {
      fiber.provide(contract("assignment.view"), async (rawInput, ctx) => {
        const input = (rawInput ?? {}) as ControlInput;
        return await controls(ctx).view(runId("assignment.view", input));
      });
      fiber.provide(contract("assignment.interrupt"), async (rawInput, ctx) => {
        const input = (rawInput ?? {}) as ControlInput;
        const capability = "assignment.interrupt";
        if (!text(input.reason)) throw new Error(`${capability}: a reason is required`);
        return await controls(ctx).interrupt(runId(capability, input), input.reason, token(capability, input));
      });
      fiber.provide(contract("assignment.resume"), async (rawInput, ctx) => {
        const input = (rawInput ?? {}) as ControlInput;
        const capability = "assignment.resume";
        return await controls(ctx).resume(runId(capability, input), token(capability, input));
      });
      fiber.provide(contract("assignment.spend"), async (rawInput, ctx) => {
        const input = (rawInput ?? {}) as ControlInput;
        const capability = "assignment.spend";
        if (!CURRENCIES.includes(input.currency as Currency)) throw new Error(`${capability}: currency must be one of ${CURRENCIES.join(", ")}`);
        const amount = input.amount;
        if (amount !== "unknown" && !(typeof amount === "number" && Number.isFinite(amount) && amount >= 0)) {
          throw new Error(`${capability}: amount must be a non-negative number or "unknown"`);
        }
        return await controls(ctx).spend(runId(capability, input), input.currency as Currency, amount, token(capability, input));
      });
    },
  };
}
