import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react/pure";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React from "react";
import { LocalWorkspaceForm, selectWorkspaceForExecution } from "../src/ui/App.tsx";

beforeAll(() => GlobalRegistrator.register());
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
  await GlobalRegistrator.unregister();
});

describe("contained workspace picker", () => {
  test("defaults to local uncontained and selects it through workspace.select", async () => {
    const calls: Array<[string, unknown]> = [];
    const invoke = async (capability: string, input: unknown) => {
      calls.push([capability, input]);
      return capability === "execution.containment.inspect"
        ? { configured: true, platformSupported: true, limits: { timeoutMs: 30_000, maxOutputBytes: 1_048_576 } }
        : {};
    };
    const ui = render(<LocalWorkspaceForm invoke={invoke} onClose={() => {}} />);

    expect((ui.getByLabelText("Local · uncontained (default)") as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(ui.getByLabelText("Linux child containment").hasAttribute("disabled")).toBe(false));
    expect(calls).toContainEqual(["execution.containment.inspect", {}]);

    await selectWorkspaceForExecution(invoke, "/work/project", "local", { configured: true, platformSupported: true });
    expect(calls).toContainEqual(["workspace.select", { path: "/work/project" }]);
    expect(calls.some(([capability]) => capability === "workspace.contained.select")).toBe(false);
  });

  test("shows safe availability facts and disables containment with the host reason", async () => {
    const invoke = async (capability: string) => capability === "execution.containment.inspect"
      ? { configured: false, platformSupported: true, reason: "Host containment setup is missing." }
      : {};
    const ui = render(<LocalWorkspaceForm invoke={invoke} onClose={() => {}} />);

    await waitFor(() => expect((ui.getByLabelText("Linux child containment") as HTMLInputElement).disabled).toBe(true));
    expect(ui.getByRole("status").textContent).toContain("Host containment setup is missing.");
  });

  test("uses only the path-only contained capability and never falls back on preflight failure", async () => {
    const calls: Array<[string, unknown]> = [];
    const invoke = async (capability: string, input: unknown) => {
      calls.push([capability, input]);
      if (capability === "workspace.contained.select") throw new Error("Contained workspace preflight failed.");
      return {};
    };

    await expect(selectWorkspaceForExecution(invoke, "/work/contained", "contained", {
      configured: true,
      platformSupported: true,
    })).rejects.toThrow("Contained workspace preflight failed.");
    expect(calls).toEqual([["workspace.contained.select", { path: "/work/contained" }]]);
  });

  test("describes child-only containment and its limits without claiming host isolation", async () => {
    const invoke = async (capability: string) => capability === "execution.containment.inspect"
      ? { configured: true, platformSupported: true, limits: { timeoutMs: 30_000, maxOutputBytes: 1_048_576 } }
      : {};
    const ui = render(<LocalWorkspaceForm invoke={invoke} onClose={() => {}} />);

    await waitFor(() => expect(ui.getByRole("status").textContent).toContain("preflighted when opened"));
    expect(ui.getByRole("status").textContent).toContain("network access is denied");
    expect(ui.getByRole("status").textContent).toContain("Wall-time limit: 30 seconds; output limit: 1.0 MiB.");
    expect(ui.getByRole("status").textContent).toContain("Workbench host application is not isolated");
  });
});
