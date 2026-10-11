import { describe, it, expect } from "bun:test";
import {
  seedCatalog,
  seedBindings,
  nextLifecycle,
  advanceLifecycle,
  canInvoke,
  isTrusted,
  checkSubstitution,
  bindingsFor,
  detectConflicts,
  packageProvides,
  creationSteps,
} from "../src/workbench/skillOs.ts";
import { CAPABILITY_LIFECYCLE } from "../src/workbench/types.ts";

describe("skillOs", () => {
  describe("seedCatalog", () => {
    it("returns at least 14 contracts", () => {
      const catalog = seedCatalog();
      expect(catalog.length).toBeGreaterThanOrEqual(14);
    });

    it("has unique ids", () => {
      const catalog = seedCatalog();
      const ids = catalog.map((c) => c.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it("includes required contract ids", () => {
      const catalog = seedCatalog();
      const ids = new Set(catalog.map((c) => c.id));

      const required = [
        "capability.product-briefing",
        "capability.domain-rule-extraction",
        "capability.reference-distillation",
        "capability.structural-sketch",
        "capability.design-initialization",
        "capability.frontend-actualization",
        "capability.code-repair",
        "capability.artifact-generation",
        "capability.runtime-preview",
        "capability.grounded-feedback",
        "capability.independent-verification",
        "capability.accessibility-audit",
        "capability.visual-polish",
        "capability.browser-journey-verification",
      ];

      for (const req of required) {
        expect(ids.has(req)).toBe(true);
      }
    });

    it("has sensible owns and authority", () => {
      const catalog = seedCatalog();
      const polishContract = catalog.find((c) => c.id === "capability.visual-polish");
      expect(polishContract).toBeDefined();
      expect(polishContract!.owns).toContain("visual-implementation");
      expect(polishContract!.authority).toContain("modify");
    });

    it("frontend-actualization owns visual-implementation and product-behavior", () => {
      const catalog = seedCatalog();
      const contract = catalog.find((c) => c.id === "capability.frontend-actualization");
      expect(contract).toBeDefined();
      expect(contract!.owns).toContain("visual-implementation");
      expect(contract!.owns).toContain("product-behavior");
    });

    it("accessibility-audit does not own any surfaces", () => {
      const catalog = seedCatalog();
      const contract = catalog.find((c) => c.id === "capability.accessibility-audit");
      expect(contract).toBeDefined();
      expect(contract!.owns).toEqual([]);
    });

    it("all contracts have category and purpose", () => {
      const catalog = seedCatalog();
      for (const contract of catalog) {
        expect(contract.category).toBeTruthy();
        expect(contract.purpose).toBeTruthy();
      }
    });
  });

  describe("seedBindings", () => {
    it("includes visual-polish binding", () => {
      const bindings = seedBindings();
      const polishBinding = bindings.find(
        (b) => b.capabilityId === "capability.visual-polish"
      );
      expect(polishBinding).toBeDefined();
      expect(polishBinding?.implementationId).toBe("impl.impeccable-polish");
      expect(polishBinding?.provider).toBe("impeccable");
    });

    it("browser-journey-verification has deterministic executor", () => {
      const bindings = seedBindings();
      const binding = bindings.find(
        (b) => b.capabilityId === "capability.browser-journey-verification"
      );
      expect(binding).toBeDefined();
      expect(binding?.executorKind).toBe("deterministic");
      expect(binding?.setup).toEqual({ runner: "playwright" });
    });

    it("structural-sketch uses native-sketch", () => {
      const bindings = seedBindings();
      const binding = bindings.find((b) => b.capabilityId === "capability.structural-sketch");
      expect(binding).toBeDefined();
      expect(binding?.implementationId).toBe("impl.native-sketch");
    });

    it("reference-distillation uses native-moodboard", () => {
      const bindings = seedBindings();
      const binding = bindings.find(
        (b) => b.capabilityId === "capability.reference-distillation"
      );
      expect(binding).toBeDefined();
      expect(binding?.implementationId).toBe("impl.native-moodboard");
    });

    it("capability-creation uses llm executor", () => {
      const bindings = seedBindings();
      const binding = bindings.find(
        (b) => b.capabilityId === "capability.capability-creation"
      );
      expect(binding).toBeDefined();
      expect(binding?.executorKind).toBe("llm");
      expect(binding?.implementationId).toBe("impl.creator-mode");
    });

    it("automation-scheduling uses deterministic executor", () => {
      const bindings = seedBindings();
      const binding = bindings.find(
        (b) => b.capabilityId === "capability.automation-scheduling"
      );
      expect(binding).toBeDefined();
      expect(binding?.executorKind).toBe("deterministic");
      expect(binding?.implementationId).toBe("impl.automation-tasks");
    });
  });

  describe("nextLifecycle", () => {
    it("returns next state", () => {
      expect(nextLifecycle("SPECIFIED")).toBe("IMPLEMENTATION_AVAILABLE");
      expect(nextLifecycle("REVIEWED")).toBe("INSTALLED");
    });

    it("returns undefined at end", () => {
      expect(nextLifecycle("AVAILABLE")).toBeUndefined();
    });

    it("follows the full lifecycle", () => {
      let state: typeof CAPABILITY_LIFECYCLE[number] = CAPABILITY_LIFECYCLE[0];
      for (let i = 0; i < CAPABILITY_LIFECYCLE.length - 1; i++) {
        const next = nextLifecycle(state);
        expect(next).toBe(CAPABILITY_LIFECYCLE[i + 1]);
        state = next!;
      }
      expect(nextLifecycle(state)).toBeUndefined();
    });
  });

  describe("advanceLifecycle", () => {
    it("allows immediate next transition", () => {
      const result = advanceLifecycle("SPECIFIED", "IMPLEMENTATION_AVAILABLE");
      expect(result.ok).toBe(true);
      expect((result as { ok: true; state: any }).state).toBe("IMPLEMENTATION_AVAILABLE");
    });

    it("forbids skipping states (V-011)", () => {
      const result = advanceLifecycle("SPECIFIED", "REVIEWED");
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("cannot go from");
      expect((result as { ok: false; error: string }).error).toContain("SPECIFIED");
      expect((result as { ok: false; error: string }).error).toContain("REVIEWED");
      expect((result as { ok: false; error: string }).error).toContain("must come first");
    });

    it("forbids build to enable (V-011)", () => {
      const result = advanceLifecycle("REVIEWED", "ENABLED");
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("must come first");
    });

    it("forbids install to enable (V-011)", () => {
      const result = advanceLifecycle("INSTALLED", "ENABLED");
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("must come first");
    });

    it("forbids enable to verify (V-011)", () => {
      const result = advanceLifecycle("ENABLED", "VERIFIED");
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("must come first");
    });

    it("forbids backward transitions", () => {
      const result = advanceLifecycle("VERIFIED", "SPECIFIED");
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("must come first");
    });

    it("forbids unknown to states", () => {
      const result = advanceLifecycle("SPECIFIED", "UNKNOWN" as any);
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("unknown to state");
    });

    it("forbids unknown from states", () => {
      const result = advanceLifecycle("UNKNOWN" as any, "SPECIFIED");
      expect(result.ok).toBe(false);
      expect((result as { ok: false; error: string }).error).toContain("unknown from state");
    });
  });

  describe("canInvoke", () => {
    it("returns true for ENABLED", () => {
      expect(canInvoke("ENABLED")).toBe(true);
    });

    it("returns true for EXERCISED", () => {
      expect(canInvoke("EXERCISED")).toBe(true);
    });

    it("returns true for VERIFIED", () => {
      expect(canInvoke("VERIFIED")).toBe(true);
    });

    it("returns true for AVAILABLE", () => {
      expect(canInvoke("AVAILABLE")).toBe(true);
    });

    it("returns false for other states", () => {
      expect(canInvoke("SPECIFIED")).toBe(false);
      expect(canInvoke("IMPLEMENTATION_AVAILABLE")).toBe(false);
      expect(canInvoke("REVIEWED")).toBe(false);
      expect(canInvoke("INSTALLED")).toBe(false);
      expect(canInvoke("AUTHORITY_GRANTED")).toBe(false);
    });
  });

  describe("isTrusted", () => {
    it("returns true for VERIFIED", () => {
      expect(isTrusted("VERIFIED")).toBe(true);
    });

    it("returns true for AVAILABLE", () => {
      expect(isTrusted("AVAILABLE")).toBe(true);
    });

    it("returns false for other states", () => {
      expect(isTrusted("SPECIFIED")).toBe(false);
      expect(isTrusted("IMPLEMENTATION_AVAILABLE")).toBe(false);
      expect(isTrusted("REVIEWED")).toBe(false);
      expect(isTrusted("INSTALLED")).toBe(false);
      expect(isTrusted("AUTHORITY_GRANTED")).toBe(false);
      expect(isTrusted("ENABLED")).toBe(false);
      expect(isTrusted("EXERCISED")).toBe(false);
    });
  });

  describe("checkSubstitution", () => {
    it("returns compatible=true for different deterministic bindings", () => {
      const catalog = seedCatalog();
      const contract = catalog.find((c) => c.id === "capability.browser-journey-verification")!;

      const oldBinding = {
        capabilityId: "capability.browser-journey-verification",
        implementationId: "impl.playwright",
        provider: "playwright",
        executorKind: "deterministic" as const,
        setup: { runner: "playwright" },
      };

      const newBinding = {
        capabilityId: "capability.browser-journey-verification",
        implementationId: "impl.other-runner",
        provider: "other",
        executorKind: "deterministic" as const,
        setup: { runner: "other" },
      };

      const result = checkSubstitution(contract, oldBinding, newBinding);
      expect(result.compatible).toBe(true);
    });

    it("keeps journey-contract and acceptance-criteria unchanged (V-002)", () => {
      const catalog = seedCatalog();
      const contract = catalog.find((c) => c.id === "capability.browser-journey-verification")!;

      const oldBinding = {
        capabilityId: "capability.browser-journey-verification",
        implementationId: "impl.playwright",
        provider: "playwright",
        executorKind: "deterministic" as const,
        setup: { runner: "playwright" },
      };

      const newBinding = {
        capabilityId: "capability.browser-journey-verification",
        implementationId: "impl.other",
        provider: "other",
        executorKind: "deterministic" as const,
        setup: { runner: "other" },
      };

      const result = checkSubstitution(contract, oldBinding, newBinding);
      expect(result.unchanged).toContain("journey-contract");
      expect(result.unchanged).toContain("acceptance-criteria");
    });

    it("lists changed fields correctly", () => {
      const catalog = seedCatalog();
      const contract = catalog.find((c) => c.id === "capability.browser-journey-verification")!;

      const oldBinding = {
        capabilityId: "capability.browser-journey-verification",
        implementationId: "impl.playwright",
        provider: "playwright",
        executorKind: "deterministic" as const,
        setup: { runner: "playwright" },
      };

      const newBinding = {
        capabilityId: "capability.browser-journey-verification",
        implementationId: "impl.other",
        provider: "other",
        executorKind: "deterministic" as const,
        setup: { runner: "other" },
      };

      const result = checkSubstitution(contract, oldBinding, newBinding);
      expect(result.changed).toContain("implementation");
      expect(result.changed).toContain("setup");
      expect(result.changed).toContain("provider");
    });

    it("detects verifier-as-LLM problem (V-002)", () => {
      const catalog = seedCatalog();
      const contract = catalog.find((c) => c.id === "capability.browser-journey-verification")!;
      expect(contract.authority).toContain("verify");

      const oldBinding = {
        capabilityId: "capability.browser-journey-verification",
        implementationId: "impl.playwright",
        provider: "playwright",
        executorKind: "deterministic" as const,
        setup: { runner: "playwright" },
      };

      const newBinding = {
        capabilityId: "capability.browser-journey-verification",
        implementationId: "impl.llm-runner",
        provider: "llm",
        executorKind: "llm" as const,
        setup: {},
      };

      const result = checkSubstitution(contract, oldBinding, newBinding);
      expect(result.compatible).toBe(false);
      expect(result.problems.length).toBeGreaterThan(0);
      expect(result.problems[0]).toContain("verifier");
      expect(result.problems[0]).toContain("deterministic");
      expect(result.problems[0]).toContain("llm");
    });

    it("detects same implementation id problem", () => {
      const catalog = seedCatalog();
      const contract = catalog.find((c) => c.id === "capability.browser-journey-verification")!;

      const oldBinding = {
        capabilityId: "capability.browser-journey-verification",
        implementationId: "impl.same",
        provider: "playwright",
        executorKind: "deterministic" as const,
        setup: { runner: "playwright" },
      };

      const newBinding = {
        capabilityId: "capability.browser-journey-verification",
        implementationId: "impl.same",
        provider: "playwright",
        executorKind: "deterministic" as const,
        setup: { runner: "playwright" },
      };

      const result = checkSubstitution(contract, oldBinding, newBinding);
      expect(result.compatible).toBe(false);
      expect(result.problems.some((p) => p.includes("same implementationId"))).toBe(true);
    });
  });

  describe("bindingsFor", () => {
    it("returns bindings for a capability", () => {
      const bindings = seedBindings();
      const polishBindings = bindingsFor(bindings, "capability.visual-polish");
      expect(polishBindings.length).toBeGreaterThan(0);
      expect(polishBindings[0]!.capabilityId).toBe("capability.visual-polish");
    });

    it("returns empty array for unknown capability", () => {
      const bindings = seedBindings();
      const result = bindingsFor(bindings, "capability.unknown");
      expect(result).toEqual([]);
    });

    it("filters correctly", () => {
      const bindings = seedBindings();
      const polishBindings = bindingsFor(bindings, "capability.visual-polish");
      const othersBindings = bindingsFor(bindings, "capability.browser-journey-verification");

      expect(polishBindings.every((b) => b.capabilityId === "capability.visual-polish")).toBe(true);
      expect(othersBindings.every((b) => b.capabilityId === "capability.browser-journey-verification")).toBe(true);
    });
  });

  describe("detectConflicts", () => {
    it("finds visual-implementation overlap", () => {
      const catalog = seedCatalog();
      const active = ["capability.visual-polish", "capability.frontend-actualization"];
      const conflicts = detectConflicts(catalog, active);

      const visualConflict = conflicts.find((c) => c.surface === "visual-implementation");
      expect(visualConflict).toBeDefined();
      expect(visualConflict!.capabilities).toContain("capability.visual-polish");
      expect(visualConflict!.capabilities).toContain("capability.frontend-actualization");
    });

    it("no conflict for accessibility-audit and visual-polish", () => {
      const catalog = seedCatalog();
      const active = ["capability.accessibility-audit", "capability.visual-polish"];
      const conflicts = detectConflicts(catalog, active);

      const visualConflict = conflicts.find((c) => c.surface === "visual-implementation");
      expect(visualConflict).toBeUndefined();
    });

    it("returns empty for non-conflicting capabilities", () => {
      const catalog = seedCatalog();
      const active = ["capability.product-briefing", "capability.domain-rule-extraction"];
      const conflicts = detectConflicts(catalog, active);

      expect(conflicts.length).toBe(0);
    });

    it("ignores inactive capabilities", () => {
      const catalog = seedCatalog();
      const active = ["capability.visual-polish"];
      const conflicts = detectConflicts(catalog, active);

      const visualConflict = conflicts.find((c) => c.surface === "visual-implementation");
      expect(visualConflict).toBeUndefined();
    });

    it("sorts conflicts by surface", () => {
      const catalog = seedCatalog();
      const active = ["capability.visual-polish", "capability.frontend-actualization"];
      const conflicts = detectConflicts(catalog, active);

      if (conflicts.length > 1) {
        for (let i = 0; i < conflicts.length - 1; i++) {
          expect(conflicts[i]!.surface.localeCompare(conflicts[i + 1]!.surface)).toBeLessThanOrEqual(0);
        }
      }
    });
  });

  describe("packageProvides", () => {
    it("returns capability ids for a provider", () => {
      const bindings = seedBindings();
      const playwrightCaps = packageProvides("playwright", bindings);
      expect(playwrightCaps).toContain("capability.browser-journey-verification");
    });

    it("returns empty array for unknown provider", () => {
      const bindings = seedBindings();
      const result = packageProvides("unknown", bindings);
      expect(result).toEqual([]);
    });

    it("returns sorted unique capabilities", () => {
      const bindings = seedBindings();
      const nativeCaps = packageProvides("native", bindings);
      expect(nativeCaps).toBeDefined();

      // Check sorted
      for (let i = 0; i < nativeCaps.length - 1; i++) {
        expect(nativeCaps[i]!.localeCompare(nativeCaps[i + 1]!)).toBeLessThanOrEqual(0);
      }

      // Check unique
      const unique = new Set(nativeCaps);
      expect(unique.size).toBe(nativeCaps.length);
    });

    it("impeccable provider includes visual-polish", () => {
      const bindings = seedBindings();
      const impeccableCaps = packageProvides("impeccable", bindings);
      expect(impeccableCaps).toContain("capability.visual-polish");
    });
  });

  describe("creationSteps", () => {
    it("returns 13 steps", () => {
      const steps = creationSteps();
      expect(steps.length).toBe(13);
    });

    it("includes all required steps in order", () => {
      const steps = creationSteps();
      const expected = [
        "describe",
        "define-surface",
        "define-io",
        "define-authority",
        "define-verification",
        "build",
        "inspect-provenance",
        "install",
        "grant",
        "enable",
        "exercise",
        "verify",
        "register",
      ];
      expect(Array.from(steps)).toEqual(expected);
    });
  });
});
