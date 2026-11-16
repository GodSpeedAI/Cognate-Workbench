import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { registerDom, releaseDom } from "./dom-env.ts";
import React from "react";
import type { RuntimeExecutionInspection } from "../src/ui/experts/RuntimeExecutionStatus.tsx";
import { runtimeExecutionComponent } from "../src/capabilities/runtimeExecution.ts";

// react-dom must load after the DOM globals exist (see ui-contained-workspace.test.tsx).
let act: typeof import("@testing-library/react/pure").act;
let cleanup: typeof import("@testing-library/react/pure").cleanup;
let render: typeof import("@testing-library/react/pure").render;
let waitFor: typeof import("@testing-library/react/pure").waitFor;
let RuntimeExecutionStatus: typeof import("../src/ui/experts/RuntimeExecutionStatus.tsx").RuntimeExecutionStatus;

beforeAll(async () => {
  registerDom();
  ({ act, cleanup, render, waitFor } = await import("@testing-library/react/pure"));
  ({ RuntimeExecutionStatus } = await import("../src/ui/experts/RuntimeExecutionStatus.tsx"));
});
afterEach(async () => {
  await act(async () => {
    cleanup();
    await Promise.resolve();
  });
});
afterAll(async () => {
  await act(async () => {
    cleanup();
    await Promise.resolve();
  });
  await releaseDom();
});

describe("J-EXPERT-MODEL-PARALLEL runtime inspection", () => {
  test("reports host capacity and the limited model-only admission policy without controls or active counts", async () => {
    const inspect = async (): Promise<RuntimeExecutionInspection> => ({ configuredCapacity: 4, admissionPolicy: "model-only-parallel" });
    const ui = render(<RuntimeExecutionStatus inspect={inspect} />);

    await waitFor(() => expect(ui.getByText("Configured capacity: 4 concurrent runs")).toBeTruthy());
    expect(ui.getByText(/Model-only solo Experts and Team Specialists may overlap/)).toBeTruthy();
    expect(ui.getByText(/Tool-bearing work is admitted per canonical workspace/)).toBeTruthy();
    expect(ui.queryByRole("button")).toBeNull();
    expect(ui.queryByText(/active|running now/i)).toBeNull();
  });

  test("describes capacity one as serialized", async () => {
    const ui = render(<RuntimeExecutionStatus inspect={async () => ({ configuredCapacity: 1, admissionPolicy: "serial" })} />);
    await waitFor(() => expect(ui.getByText("Configured capacity: 1 run at a time")).toBeTruthy());
    expect(ui.getByText("Runs are serialized by the host runtime.")).toBeTruthy();
  });

  test("shows unavailable when older server mocks do not provide inspection", async () => {
    const ui = render(<RuntimeExecutionStatus inspect={async () => { throw new Error("Capability unavailable"); }} />);
    await waitFor(() => expect(ui.getByRole("status").textContent).toContain("Runtime capacity unavailable"));
    expect(ui.queryByText(/Configured capacity:/)).toBeNull();
  });

  test("capability reports only configured capacity and refuses agent callers", async () => {
    const handlers = new Map<string, (input: unknown, context: unknown) => Promise<unknown>>();
    runtimeExecutionComponent({ configuredCapacity: 2, semanticRef: { entity: "NativeExecutionSlots" } as never }).activate({
      provide(contract: { id: string }, handler: (input: unknown, context: unknown) => Promise<unknown>) {
        handlers.set(contract.id, handler);
      },
    } as never);

    const inspect = handlers.get("execution.runtime.inspect");
    expect(inspect).toBeDefined();
    await expect(inspect!({}, { actor: { id: "agent", kind: "agent" } })).rejects.toThrow(/user or system/i);
    await expect(inspect!({}, { actor: { id: "operator", kind: "user" } })).resolves.toEqual({
      configuredCapacity: 2,
      admissionPolicy: "model-only-parallel",
    });
  });
});
