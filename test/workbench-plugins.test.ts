// T11 (J-PLG-install): pure plugin lifecycle logic — the three lifecycles, the view merge, the
// install refusals, and the verification that decides whether an install activates or is inert.
import { describe, expect, test } from "bun:test";
import { PLUGIN_CATALOG, catalogEntry, installablePluginIds, installRefusal, optionalPluginEnabled, pluginViews, type PluginRecord } from "../src/plugins.ts";
import { PluginRegistry, verifyImplementation, type PluginSource } from "../src/components/pluginRegistry.ts";

const record = (pluginId: string, implementation = "active"): PluginRecord => ({ pluginId, installedAt: "2026-01-01T00:00:00.000Z", implementation });

describe("catalog shape", () => {
  test("every entry has a name, description and implementation", () => {
    for (const entry of PLUGIN_CATALOG) {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.implementation).toBeTruthy();
    }
  });

  test("ids are unique", () => {
    const ids = PLUGIN_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("tool entries declare which presets compose them", () => {
    for (const entry of PLUGIN_CATALOG.filter((e) => e.lifecycle === "tool")) {
      expect(entry.presets?.length).toBeGreaterThan(0);
      expect(entry.implementation.kind).toBe("tool");
    }
  });

  test("the shipped catalog is entirely implementable — no fake inert entries", () => {
    for (const entry of PLUGIN_CATALOG) {
      expect(entry.implementation.kind).not.toBe("none");
    }
  });
});

describe("pluginViews", () => {
  test("core plugins are always-on and never toggleable", () => {
    const views = pluginViews([]);
    const core = views.filter((v) => v.lifecycle === "core");
    expect(core.length).toBeGreaterThan(0);
    for (const v of core) {
      expect(v.status).toBe("always-on");
      expect(v.toggleable).toBe(false);
      expect(v.reason).toContain("part of the application");
    }
  });

  test("tool plugins report preset membership, not a switch", () => {
    const views = pluginViews([]);
    const tool = views.find((v) => v.id === "tool-bash");
    expect(tool?.status).toBe("composes-tools");
    expect(tool?.toggleable).toBe(false);
    expect(tool?.reason).toContain("standard");
    expect(tool?.reason).toContain("minimal");
  });

  test("an optional plugin with no record is 'available' and explains it is not installed", () => {
    const views = pluginViews([]);
    const rt = views.find((v) => v.id === "realitytrace");
    expect(rt?.status).toBe("available");
    expect(rt?.toggleable).toBe(false);
    expect(rt?.reason).toContain("Not installed");
  });

  test("an optional plugin with a record becomes toggleable", () => {
    const views = pluginViews([record("realitytrace")]);
    const rt = views.find((v) => v.id === "realitytrace");
    expect(rt?.status).toBe("installed");
    expect(rt?.toggleable).toBe(true);
    expect(rt?.reason).toBeUndefined();
  });

  test("every view has a stated reason whenever it is not toggleable", () => {
    for (const view of pluginViews([])) {
      if (!view.toggleable) expect(view.reason && view.reason.length > 0).toBe(true);
    }
  });
});

describe("optionalPluginEnabled", () => {
  const rt = catalogEntry("realitytrace")!;
  test("reads the durable settings key set", () => {
    expect(optionalPluginEnabled(new Set(["realitytrace"]), rt)).toBe(true);
    expect(optionalPluginEnabled(new Set(), rt)).toBe(false);
    expect(optionalPluginEnabled(new Set(["other"]), rt)).toBe(false);
  });
  test("a non-settings-toggle plugin is never reported enabled", () => {
    const bash = catalogEntry("tool-bash")!;
    expect(optionalPluginEnabled(new Set(["realitytrace"]), bash)).toBe(false);
  });
});

describe("installRefusal", () => {
  test("refuses an unknown id", () => {
    const out = installRefusal(undefined, []);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("not in this deployment's catalog");
  });
  test("refuses core infrastructure", () => {
    const out = installRefusal(catalogEntry("model-provider")!, []);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("part of the application");
  });
  test("refuses an already-installed plugin", () => {
    const out = installRefusal(catalogEntry("realitytrace")!, [record("realitytrace")]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain("already installed");
  });
  test("allows a not-yet-installed optional plugin", () => {
    expect(installRefusal(catalogEntry("realitytrace")!, []).ok).toBe(true);
  });
  test("installablePluginIds lists only optional entries", () => {
    expect(installablePluginIds()).toEqual(["realitytrace"]);
  });
});

describe("verifyImplementation", () => {
  test("a real tool verifies", () => {
    const out = verifyImplementation({ kind: "tool", tool: "bash" });
    expect(out.activated).toBe(true);
    if (out.activated) expect(out.via).toContain("bash");
  });

  test("a tool that does not exist in this build is inert with a stated reason", () => {
    const out = verifyImplementation({ kind: "tool", tool: "does_not_exist" });
    expect(out.activated).toBe(false);
    if (!out.activated) {
      expect(out.reason).toContain("does_not_exist");
      expect(out.reason).toContain("would do nothing");
    }
  });

  test("a recognised settings-toggle verifies", () => {
    expect(verifyImplementation({ kind: "settings-toggle", key: "realitytrace" }).activated).toBe(true);
  });

  test("an unrecognised settings-toggle key is inert", () => {
    const out = verifyImplementation({ kind: "settings-toggle", key: "not-a-plugin" });
    expect(out.activated).toBe(false);
    if (!out.activated) expect(out.reason).toContain("does not recognise");
  });

  test("a declared-none implementation is always inert with its own reason", () => {
    const out = verifyImplementation({ kind: "none", reason: "No runner ships in this build." });
    expect(out.activated).toBe(false);
    if (!out.activated) expect(out.reason).toBe("No runner ships in this build.");
  });

  test("core verifies as always-on infrastructure", () => {
    expect(verifyImplementation({ kind: "core" }).activated).toBe(true);
  });
});

describe("PluginRegistry", () => {
  test("resolves entries from the builtin source", () => {
    const registry = new PluginRegistry();
    expect(registry.entry("realitytrace")?.name).toBe("RealityTrace observations");
    expect(registry.catalog().length).toBe(PLUGIN_CATALOG.length);
    expect(registry.sourceIds).toEqual(["builtin"]);
  });

  test("an additional source is additive and first-source-wins on duplicate ids", () => {
    const registry = new PluginRegistry();
    const shadow: PluginSource = {
      id: "workspace-plugins",
      list: () => [
        { id: "tool-bash", name: "Shadowed", description: "Must not win", lifecycle: "optional", implementation: { kind: "core" } },
        { id: "extra", name: "Extra", description: "From the second source", lifecycle: "optional", implementation: { kind: "settings-toggle", key: "realitytrace" } },
      ],
    };
    registry.addSource(shadow);
    expect(registry.sourceIds).toEqual(["builtin", "workspace-plugins"]);
    expect(registry.entry("tool-bash")?.name).toBe("Terminal");
    expect(registry.entry("extra")?.name).toBe("Extra");
  });

  test("registering the same source id twice is refused", () => {
    const registry = new PluginRegistry();
    registry.addSource({ id: "x", list: () => [] });
    expect(() => registry.addSource({ id: "x", list: () => [] })).toThrow(/already registered/);
  });

  test("planInstall refuses an unknown id, core, and an already-installed plugin", () => {
    const registry = new PluginRegistry();
    expect("refused" in registry.planInstall("nope", [])).toBe(true);
    expect("refused" in registry.planInstall("model-provider", [])).toBe(true);
    expect("refused" in registry.planInstall("realitytrace", ["realitytrace"])).toBe(true);
  });

  test("planInstall of a fresh optional plugin activates and names what it drives", () => {
    const registry = new PluginRegistry();
    const plan = registry.planInstall("realitytrace", []);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.pluginId).toBe("realitytrace");
    expect(plan.activated).toBe(true);
    expect(plan.reason).toContain("realitytrace");
  });

  test("a catalog entry whose implementation does not verify installs inert, not as working", () => {
    const registry = new PluginRegistry([
      {
        id: "hollow",
        list: () => [{ id: "ghost", name: "Ghost", description: "Declares a tool this build does not have.", lifecycle: "optional", implementation: { kind: "tool", tool: "missing_tool" } }],
      },
    ]);
    const plan = registry.planInstall("ghost", []);
    if ("refused" in plan) throw new Error(plan.refused);
    expect(plan.activated).toBe(false);
    expect(plan.reason).toContain("missing_tool");
    expect(plan.reason).toContain("would do nothing");
  });

  test("activate() is verification only — it never evaluates downloaded code", () => {
    const registry = new PluginRegistry();
    // The registry holds descriptions; activating an entry with a verified implementation is the
    // only success path, and it does not execute anything.
    const rt = registry.entry("realitytrace")!;
    expect(registry.activate(rt).activated).toBe(true);
  });
});
