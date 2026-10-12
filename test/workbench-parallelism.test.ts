import { describe, it, expect } from "bun:test";
import {
  assessPair,
  planParallelism,
  type WorkUnit,
  type PairAssessment,
  type ParallelPlan,
} from "../src/workbench/parallelism.ts";

describe("parallelism", () => {
  describe("assessPair", () => {
    it("V-006: two independent components are parallel-safe", () => {
      const a: WorkUnit = {
        id: "worker-a",
        ownedFiles: ["a.tsx"],
        reads: [],
        tokens: ["tokens-a"],
        rules: [],
        dependsOn: [],
      };

      const b: WorkUnit = {
        id: "worker-b",
        ownedFiles: ["b.tsx"],
        reads: [],
        tokens: ["tokens-b"],
        rules: [],
        dependsOn: [],
      };

      const result = assessPair(a, b);
      expect(result.verdict).toBe("parallel-safe");
      expect(result.reasons.length).toBe(0);
    });

    it("detects file ownership overlap", () => {
      const a: WorkUnit = {
        id: "task-a",
        ownedFiles: ["shared.ts"],
        reads: [],
        tokens: [],
        rules: [],
        dependsOn: [],
      };

      const b: WorkUnit = {
        id: "task-b",
        ownedFiles: ["shared.ts"],
        reads: [],
        tokens: [],
        rules: [],
        dependsOn: [],
      };

      const result = assessPair(a, b);
      expect(result.verdict).toBe("shared-dependency");
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.reasons[0]).toContain("file overlap");
    });

    it("detects write/read overlap (a owns, b reads)", () => {
      const a: WorkUnit = {
        id: "writer",
        ownedFiles: ["data.json"],
        reads: [],
        tokens: [],
        rules: [],
        dependsOn: [],
      };

      const b: WorkUnit = {
        id: "reader",
        ownedFiles: [],
        reads: ["data.json"],
        tokens: [],
        rules: [],
        dependsOn: [],
      };

      const result = assessPair(a, b);
      expect(result.verdict).toBe("shared-dependency");
      expect(result.reasons.some((r) => r.includes("write/read overlap"))).toBe(
        true
      );
    });

    it("detects write/read overlap (b owns, a reads)", () => {
      const a: WorkUnit = {
        id: "reader",
        ownedFiles: [],
        reads: ["schema.ts"],
        tokens: [],
        rules: [],
        dependsOn: [],
      };

      const b: WorkUnit = {
        id: "writer",
        ownedFiles: ["schema.ts"],
        reads: [],
        tokens: [],
        rules: [],
        dependsOn: [],
      };

      const result = assessPair(a, b);
      expect(result.verdict).toBe("shared-dependency");
      expect(result.reasons.some((r) => r.includes("write/read overlap"))).toBe(
        true
      );
    });

    it("V-007: detects shared design tokens", () => {
      const a: WorkUnit = {
        id: "component-a",
        ownedFiles: ["a.tsx"],
        reads: [],
        tokens: ["styles.css"],
        rules: [],
        dependsOn: [],
      };

      const b: WorkUnit = {
        id: "component-b",
        ownedFiles: ["b.tsx"],
        reads: [],
        tokens: ["styles.css"],
        rules: [],
        dependsOn: [],
      };

      const result = assessPair(a, b);
      expect(result.verdict).toBe("shared-dependency");
      expect(result.reasons.some((r) => r.includes("shared design tokens"))).toBe(
        true
      );
    });

    it("detects shared business rules", () => {
      const a: WorkUnit = {
        id: "rule-consumer-a",
        ownedFiles: [],
        reads: [],
        tokens: [],
        rules: ["validation-rule-1"],
        dependsOn: [],
      };

      const b: WorkUnit = {
        id: "rule-consumer-b",
        ownedFiles: [],
        reads: [],
        tokens: [],
        rules: ["validation-rule-1"],
        dependsOn: [],
      };

      const result = assessPair(a, b);
      expect(result.verdict).toBe("shared-dependency");
      expect(result.reasons.some((r) => r.includes("shared business rule"))).toBe(
        true
      );
    });

    it("detects dependency order (a depends on b)", () => {
      const a: WorkUnit = {
        id: "task-a",
        ownedFiles: [],
        reads: [],
        tokens: [],
        rules: [],
        dependsOn: ["task-b"],
      };

      const b: WorkUnit = {
        id: "task-b",
        ownedFiles: [],
        reads: [],
        tokens: [],
        rules: [],
        dependsOn: [],
      };

      const result = assessPair(a, b);
      expect(result.verdict).toBe("shared-dependency");
      expect(result.reasons.some((r) => r.includes("dependency order"))).toBe(
        true
      );
    });

    it("detects dependency order (b depends on a)", () => {
      const a: WorkUnit = {
        id: "task-a",
        ownedFiles: [],
        reads: [],
        tokens: [],
        rules: [],
        dependsOn: [],
      };

      const b: WorkUnit = {
        id: "task-b",
        ownedFiles: [],
        reads: [],
        tokens: [],
        rules: [],
        dependsOn: ["task-a"],
      };

      const result = assessPair(a, b);
      expect(result.verdict).toBe("shared-dependency");
      expect(result.reasons.some((r) => r.includes("dependency order"))).toBe(
        true
      );
    });

    it("returns correct pair order", () => {
      const a: WorkUnit = {
        id: "first",
        ownedFiles: [],
        reads: [],
        tokens: [],
        rules: [],
        dependsOn: [],
      };

      const b: WorkUnit = {
        id: "second",
        ownedFiles: [],
        reads: [],
        tokens: [],
        rules: [],
        dependsOn: [],
      };

      const result = assessPair(a, b);
      expect(result.a).toBe("first");
      expect(result.b).toBe("second");
    });
  });

  describe("planParallelism", () => {
    it("generates pairs for all i<j combinations", () => {
      const units: WorkUnit[] = [
        {
          id: "a",
          ownedFiles: [],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
        {
          id: "b",
          ownedFiles: [],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
        {
          id: "c",
          ownedFiles: [],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units);
      // 3 choose 2 = 3 pairs
      expect(plan.pairs.length).toBe(3);
    });

    it("creates one group for all parallel-safe units", () => {
      const units: WorkUnit[] = [
        {
          id: "a",
          ownedFiles: ["a.ts"],
          reads: [],
          tokens: ["token-a"],
          rules: [],
          dependsOn: [],
        },
        {
          id: "b",
          ownedFiles: ["b.ts"],
          reads: [],
          tokens: ["token-b"],
          rules: [],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units);
      expect(plan.groups.length).toBe(1);
      expect(plan.groups[0]).toContain("a");
      expect(plan.groups[0]).toContain("b");
    });

    it("respects maxConcurrency option", () => {
      const units: WorkUnit[] = [
        {
          id: "a",
          ownedFiles: ["a.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
        {
          id: "b",
          ownedFiles: ["b.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
        {
          id: "c",
          ownedFiles: ["c.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units, { maxConcurrency: 1 });
      // With concurrency 1, each gets its own group
      for (const group of plan.groups) {
        expect(group.length).toBeLessThanOrEqual(1);
      }
    });

    it("respects dependency ordering", () => {
      const units: WorkUnit[] = [
        {
          id: "a",
          ownedFiles: [],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: ["b"],
        },
        {
          id: "b",
          ownedFiles: [],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units);
      // b must come before a
      const bGroupIndex = plan.groups.findIndex((g) => g.includes("b"));
      const aGroupIndex = plan.groups.findIndex((g) => g.includes("a"));
      expect(bGroupIndex).toBeLessThan(aGroupIndex);
    });

    it("collects architect-owned resources from shared-dependency pairs", () => {
      const units: WorkUnit[] = [
        {
          id: "a",
          ownedFiles: ["shared.ts"],
          reads: [],
          tokens: ["styles.css"],
          rules: ["rule-1"],
          dependsOn: [],
        },
        {
          id: "b",
          ownedFiles: ["shared.ts"],
          reads: [],
          tokens: ["styles.css"],
          rules: ["rule-1"],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units);
      expect(plan.architectOwned.length).toBeGreaterThan(0);
      expect(plan.architectOwned.some((r) => r.includes("file:"))).toBe(true);
      expect(plan.architectOwned.some((r) => r.includes("token:"))).toBe(true);
      expect(plan.architectOwned.some((r) => r.includes("rule:"))).toBe(true);
    });

    it("calculates mergeSurface correctly", () => {
      const units: WorkUnit[] = [
        {
          id: "a",
          ownedFiles: ["x.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
        {
          id: "b",
          ownedFiles: ["x.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units);
      expect(plan.mergeSurface).toBe(1);
    });

    it("sets mergeSurface to 0 for fully parallel-safe units", () => {
      const units: WorkUnit[] = [
        {
          id: "a",
          ownedFiles: ["a.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
        {
          id: "b",
          ownedFiles: ["b.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units);
      expect(plan.mergeSurface).toBe(0);
    });

    it("recommends Parallel-safe when mergeSurface is 0", () => {
      const units: WorkUnit[] = [
        {
          id: "a",
          ownedFiles: ["a.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units);
      expect(plan.recommendation).toContain("Parallel-safe");
    });

    it("recommends sequential when mergeSurface > 0", () => {
      const units: WorkUnit[] = [
        {
          id: "a",
          ownedFiles: ["shared.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
        {
          id: "b",
          ownedFiles: ["shared.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units);
      expect(plan.recommendation).toContain("sequential");
    });

    it("identifies sequential units (those with conflicts)", () => {
      const units: WorkUnit[] = [
        {
          id: "conflicting-a",
          ownedFiles: ["x.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
        {
          id: "conflicting-b",
          ownedFiles: ["x.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
        {
          id: "independent",
          ownedFiles: ["y.ts"],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units);
      expect(plan.sequential.length).toBe(2);
      expect(plan.sequential).toContain("conflicting-a");
      expect(plan.sequential).toContain("conflicting-b");
    });

    it("produces immutable frozen groups", () => {
      const units: WorkUnit[] = [
        {
          id: "a",
          ownedFiles: [],
          reads: [],
          tokens: [],
          rules: [],
          dependsOn: [],
        },
      ];

      const plan = planParallelism(units);
      expect(Object.isFrozen(plan.groups[0])).toBe(true);
    });
  });
});
