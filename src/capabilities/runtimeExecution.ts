import type { Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Json } from "@godspeedai/cognate-events";

export const RUNTIME_EXECUTION_INSPECT = "execution.runtime.inspect";
export type RuntimeRunCapacity = 1 | 2 | 4 | 8;
export type RuntimeAdmissionPolicy = "serial" | "model-only-parallel";

export interface RuntimeExecutionInspection {
  readonly configuredCapacity: RuntimeRunCapacity;
  readonly admissionPolicy: RuntimeAdmissionPolicy;
}

export function runtimeExecutionInspection(capacity: number): RuntimeExecutionInspection {
  if (![1, 2, 4, 8].includes(capacity)) throw new RangeError("COGNATE_RUN_CAPACITY must be one of 1, 2, 4 or 8");
  return {
    configuredCapacity: capacity as RuntimeRunCapacity,
    admissionPolicy: capacity === 1 ? "serial" : "model-only-parallel",
  };
}

/** Read-only host execution inspection; never reports live worker counts or accepts configuration. */
export function runtimeExecutionComponent(options: {
  readonly configuredCapacity: number;
  readonly semanticRef?: SemanticRef;
}): Component {
  const inspection = runtimeExecutionInspection(options.configuredCapacity);
  const contract = { id: RUNTIME_EXECUTION_INSPECT, version: "1.0.0", semanticRef: options.semanticRef };
  return {
    id: "runtime:execution-inspection",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (_input: unknown, context: HandlerContext): Promise<Json> => {
        if (context.actor.kind !== "user" && context.actor.kind !== "system") {
          throw new Error("Runtime execution inspection is limited to user or system callers");
        }
        return inspection as unknown as Json;
      });
    },
  };
}
