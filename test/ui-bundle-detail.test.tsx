import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BundleDetails } from "../src/ui/workbench/BundleDetails.tsx";

test("bundle details show registered and activation versions without inventing authority", () => {
  const html = renderToStaticMarkup(<BundleDetails
    bundles={[{ capabilityId: "capability.bundle.demo", name: "Demo", origin: "local", createdBy: "operator", versionHash: "new" }]}
    activations={[{ capabilityId: "capability.bundle.demo", version: "old", level: "user", state: "suspended", suspensionReasons: ["integrity"], ceiling: ["skill.load"] }]}
  />);
  expect(html).toContain("Demo");
  expect(html).toContain("new");
  expect(html).toContain("old");
  expect(html).toContain("suspended");
  expect(html).toContain("integrity");
  expect(html).toContain("skill.load");
  expect(html).not.toContain("Effective grants");
  expect(html).not.toContain("Clear safe mode");
});

test("a bundle without an activation does not assert one", () => {
  const html = renderToStaticMarkup(<BundleDetails bundles={[{ capabilityId: "capability.bundle.empty", versionHash: "v1" }]} activations={[]} />);
  expect(html).toContain("No activation recorded");
  expect(html).not.toContain("Effective grants");
});

test("Workbench capabilities tab reads the live bundle and activation rows", async () => {
  const { registerDom, releaseDom } = await import("./dom-env.ts");
  registerDom();
  const { render, fireEvent, cleanup, act } = await import("@testing-library/react/pure");
  const { CognateProvider } = await import("@godspeedai/cognate-react");
  const { WorkbenchView } = await import("../src/ui/workbench/Workbench.tsx");
  const { reduceWorkbench } = await import("../src/workbench/reducer.ts");
  const state = new Map<string, unknown>();
  for (const [event, payload] of [
    ["capability.bundle.registered", { capabilityId: "capability.bundle.demo", name: "Demo bundle", versionHash: "latest", origin: "local", createdBy: "operator" }],
    ["capability.activated", { capabilityId: "capability.bundle.demo", level: "user", version: "active-version", ceiling: ["skill.load"] }],
  ] as const) {
    for (const row of reduceWorkbench(event, payload, "2026-01-01T00:00:00Z", event, (key) => state.get(key))) state.set(row.key, row.value);
  }
  expect(state.has("activation/capability.bundle.demo/user")).toBe(true);
  const rows = [...state].map(([key, value]) => ({ key, value }));
  const client = { projection: () => ({ get: () => rows, subscribe: () => () => {} }), invoke: async () => ({}) } as unknown as import("@godspeedai/cognate-client").CognateClient;
  try {
    const ui = render(<CognateProvider client={client}><WorkbenchView workspaceId="w" workspaceLabel="Workspace" onWorkOnTask={() => {}} onFocus={() => {}} /></CognateProvider>);
    await act(async () => { fireEvent.click(ui.getByRole("tab", { name: "Capabilities" })); });
    expect(ui.getByText("Demo bundle")).toBeTruthy();
    expect(ui.getByText("latest")).toBeTruthy();
    expect(ui.getByText("active-version")).toBeTruthy();
    expect(ui.getByText("skill.load")).toBeTruthy();
    expect(ui.queryByText("Effective grants")).toBeNull();
  } finally { await act(async () => { cleanup(); }); await releaseDom(); }
});

test("trusted fragment and safe-mode inputs still render through the shared inspector", async () => {
  const { createMemoryStore } = await import("@godspeedai/cognate-store-memory");
  const { SafeModeController } = await import("../src/workbench/safeMode.ts");
  const { SlotRegistry } = await import("../src/ui/FragmentSlot.tsx");
  const { CapabilityDetail } = await import("../src/ui/workbench/CapabilityDetail.tsx");
  const safe = await SafeModeController.boot(createMemoryStore(), "local", []);
  const registry = new SlotRegistry(safe);
  const outcome = await registry.register({ slotId: "capability.panel", schemaVersion: 1, payload: { title: "Live panel", summary: "A fragment", capabilityId: "demo", viewRef: { kind: "list", rows: [] } } });
  expect(outcome.ok).toBe(true);
  const props = { capabilityId: "demo", version: "v1", origin: "local", creatingActor: "operator", fragments: registry.list(), read: safe.read(), safeMode: safe, isOperator: true };
  expect(renderToStaticMarkup(<CapabilityDetail {...props} />)).toContain("Live panel");
  safe.escalateCoreViolation();
  const blocked = renderToStaticMarkup(<CapabilityDetail {...props} read={safe.read()} />);
  expect(blocked).toContain("Safe mode: extensions are suspended");
  expect(blocked).not.toContain("Live panel");
});
