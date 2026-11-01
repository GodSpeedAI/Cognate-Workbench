import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { registerDom, releaseDom } from "./dom-env.ts";
import React from "react";

// react-dom probes `window` when first imported; importing it before the DOM exists disables its input
// events for every ui-* file that later shares this process. So everything DOM-bound loads after register().
let act: typeof import("@testing-library/react/pure").act;
let cleanup: typeof import("@testing-library/react/pure").cleanup;
let fireEvent: typeof import("@testing-library/react/pure").fireEvent;
let render: typeof import("@testing-library/react/pure").render;
let waitFor: typeof import("@testing-library/react/pure").waitFor;
let LocalWorkspaceForm: typeof import("../src/ui/App.tsx").LocalWorkspaceForm;
let selectWorkspaceForExecution: typeof import("../src/ui/App.tsx").selectWorkspaceForExecution;

beforeAll(async () => {
  registerDom();
  ({ act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react/pure"));
  ({ LocalWorkspaceForm, selectWorkspaceForExecution } = await import("../src/ui/App.tsx"));
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

describe("contained workspace picker", () => {
  test("contained posture preselects Linux child containment once the host reports it available", async () => {
    const calls: Array<[string, unknown]> = [];
    const invoke = async (capability: string, input: unknown) => {
      calls.push([capability, input]);
      return capability === "execution.containment.inspect"
        ? { executionPosture: "contained", configured: true, platformSupported: true, limits: { timeoutMs: 30_000, maxOutputBytes: 1_048_576 } }
        : {};
    };
    const ui = render(<LocalWorkspaceForm invoke={invoke} onClose={() => {}} />);

    await waitFor(() => expect((ui.getByLabelText("Linux child containment") as HTMLInputElement).checked).toBe(true));
    expect(calls).toContainEqual(["execution.containment.inspect", {}]);
    const local = ui.getByLabelText("Local · read-only to agents — commands and writes need a contained workspace") as HTMLInputElement;
    expect(local.checked).toBe(false);

    // The operator's explicit choice wins and is not overridden.
    await act(async () => { fireEvent.click(local); });
    expect(local.checked).toBe(true);
    expect((ui.getByLabelText("Linux child containment") as HTMLInputElement).checked).toBe(false);
  });

  test("uncontained-local posture keeps local preselected, says so plainly, and selects through workspace.select", async () => {
    const calls: Array<[string, unknown]> = [];
    const invoke = async (capability: string, input: unknown) => {
      calls.push([capability, input]);
      return capability === "execution.containment.inspect"
        ? { executionPosture: "uncontained-local", configured: true, platformSupported: true }
        : {};
    };
    const ui = render(<LocalWorkspaceForm invoke={invoke} onClose={() => {}} />);

    await waitFor(() => expect(ui.getByLabelText("Linux child containment").hasAttribute("disabled")).toBe(false));
    const local = ui.getByLabelText("Local · uncontained — agents run commands and write files on this computer as you") as HTMLInputElement;
    expect(local.checked).toBe(true);

    await selectWorkspaceForExecution(invoke, "/work/project", "local", { configured: true, platformSupported: true });
    expect(calls).toContainEqual(["workspace.select", { path: "/work/project" }]);
    expect(calls.some(([capability]) => capability === "workspace.contained.select")).toBe(false);
  });

  test("without host containment the picker stays on local, labelled read-only to agents", async () => {
    const invoke = async (capability: string) => capability === "execution.containment.inspect"
      ? { executionPosture: "contained", configured: false, platformSupported: true, reason: "Host containment setup is missing." }
      : {};
    const ui = render(<LocalWorkspaceForm invoke={invoke} onClose={() => {}} />);

    await waitFor(() => expect((ui.getByLabelText("Linux child containment") as HTMLInputElement).disabled).toBe(true));
    expect((ui.getByLabelText("Local · read-only to agents — commands and writes need a contained workspace") as HTMLInputElement).checked).toBe(true);
  });

  test("shows safe availability facts and disables containment with the host reason", async () => {
    const invoke = async (capability: string) => capability === "execution.containment.inspect"
      ? { configured: false, platformSupported: true, reason: "Host containment setup is missing." }
      : {};
    const ui = render(<LocalWorkspaceForm invoke={invoke} onClose={() => {}} />);

    await waitFor(() => expect((ui.getByLabelText("Linux child containment") as HTMLInputElement).disabled).toBe(true));
    // Plain words in the form; the host's own reason stays available on hover.
    expect(ui.getByRole("status").textContent).toContain("Contained mode isn't set up on this computer.");
    expect(ui.getByLabelText("Linux child containment").closest("label")?.getAttribute("title")).toBe("Host containment setup is missing.");
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
