import { describe, test, expect } from "bun:test";
import type { TaskContract } from "../src/workbench/types";
import { contractChips, contractMissing, defaultAuthority } from "../src/workbench/contract";

describe("ContractBar component specifications", () => {
  test("contractChips returns 8 chips", () => {
    const contract: Partial<TaskContract> = {
      context: { workspaceId: "my-workspace", files: [] },
      goal: { outcome: "Build feature", nonGoals: [] },
      skills: ["cap-1"],
      authority: undefined,
      executors: [],
      budget: undefined,
      invariants: [],
      acceptance: [],
    };

    const chips = contractChips(contract);
    expect(chips.length).toBe(8);
    expect(chips.map(c => c.field)).toEqual([
      "context", "goal", "skills", "authority",
      "executors", "budget", "invariants", "acceptance"
    ]);
  });

  test("contractChips marks missing fields correctly", () => {
    const contract: Partial<TaskContract> = {
      context: { workspaceId: "", files: [] },
      goal: { outcome: "", nonGoals: [] },
      skills: [],
      authority: undefined,
      executors: [],
      budget: undefined,
      invariants: [],
      acceptance: [],
    };

    const chips = contractChips(contract);
    const missingChips = chips.filter(c => c.state === "missing");
    expect(missingChips.length).toBeGreaterThan(0);
  });

  test("contractMissing returns correct missing fields", () => {
    const contract: Partial<TaskContract> = {
      context: { workspaceId: "my-workspace", files: [] },
      goal: { outcome: "", nonGoals: [] },
      skills: [],
      authority: undefined,
      executors: [],
      budget: undefined,
      invariants: [],
      acceptance: [],
    };

    const missing = contractMissing(contract);
    expect(missing).toContain("goal");
    expect(missing).not.toContain("context");
  });

  test("contract is complete when all required fields are set", () => {
    const contract: Partial<TaskContract> = {
      context: { workspaceId: "my-workspace", files: [] },
      goal: { outcome: "Build feature", nonGoals: [] },
      skills: ["cap-1"],
      authority: defaultAuthority(),
      executors: [{ role: "primary", executor: "model:test", kind: "llm" }],
      budget: { maxTokens: 1000 },
      invariants: [{ id: "inv-1", kind: "domain", statement: "No bugs" }],
      acceptance: [{ id: "ac-1", kind: "test", description: "All tests pass", required: true }],
    };

    const missing = contractMissing(contract);
    expect(missing.length).toBe(0);
  });
});

describe("ContractEditor component specifications", () => {
  test("defaultAuthority returns correct initial authority scopes", () => {
    const auth = defaultAuthority();
    expect(auth.filesystem.read).toBe("yes");
    expect(auth.filesystem.write).toBe("no");
    expect(auth.filesystem.outsideWorkspace).toBe("no");
    expect(auth.shell.run).toBe("no");
    expect(auth.shell.destructive).toBe("no");
    expect(auth.network.outbound).toBe("no");
    expect(auth.packages.install).toBe("no");
    expect(auth.extensions.install).toBe("no");
    expect(auth.extensions.enable).toBe("no");
    expect(auth.protectedPaths).toEqual([]);
  });

  test("contractChips formats budget correctly", () => {
    const contract: Partial<TaskContract> = {
      context: { workspaceId: "", files: [] },
      goal: { outcome: "", nonGoals: [] },
      skills: [],
      executors: [],
      invariants: [],
      acceptance: [],
      budget: { maxMs: 300000, maxTokens: 50000, maxCostUsd: 10.50, maxConcurrency: 4 },
    };

    const chips = contractChips(contract);
    const budgetChip = chips.find(c => c.field === "budget");
    expect(budgetChip?.state).toBe("set");
    expect(budgetChip?.value).toContain("50k tok");
    expect(budgetChip?.value).toContain("$10.50");
    expect(budgetChip?.value).toContain("4×");
    expect(budgetChip?.value).toContain("300s");
  });

  test("contractChips formats skills count correctly", () => {
    const contract: Partial<TaskContract> = {
      context: { workspaceId: "", files: [] },
      goal: { outcome: "", nonGoals: [] },
      skills: ["cap-1", "cap-2", "cap-3"],
      executors: [],
      invariants: [],
      acceptance: [],
    };

    const chips = contractChips(contract);
    const skillsChip = chips.find(c => c.field === "skills");
    expect(skillsChip?.value).toBe("3 skills");
    expect(skillsChip?.state).toBe("set");
  });

  test("contractChips formats executors count correctly", () => {
    const contract: Partial<TaskContract> = {
      context: { workspaceId: "", files: [] },
      goal: { outcome: "", nonGoals: [] },
      skills: [],
      executors: [
        { role: "primary", executor: "model:test1", kind: "llm" },
        { role: "worker", executor: "model:test2", kind: "deterministic" },
      ],
      invariants: [],
      acceptance: [],
    };

    const chips = contractChips(contract);
    const executorsChip = chips.find(c => c.field === "executors");
    expect(executorsChip?.value).toBe("2 executors");
    expect(executorsChip?.state).toBe("set");
  });

  test("contractChips formats acceptance criteria count correctly", () => {
    const contract: Partial<TaskContract> = {
      context: { workspaceId: "", files: [] },
      goal: { outcome: "", nonGoals: [] },
      skills: [],
      executors: [],
      invariants: [],
      acceptance: [
        { id: "ac-1", kind: "test", description: "Tests pass", required: true },
        { id: "ac-2", kind: "independent-check", description: "Manual check", required: false },
      ],
    };

    const chips = contractChips(contract);
    const acceptanceChip = chips.find(c => c.field === "acceptance");
    expect(acceptanceChip?.value).toBe("2 criteria");
    expect(acceptanceChip?.state).toBe("set");
  });

  test("acceptance requires at least one required criterion", () => {
    const contract: Partial<TaskContract> = {
      context: { workspaceId: "ws", files: [] },
      goal: { outcome: "test", nonGoals: [] },
      skills: [],
      executors: [],
      invariants: [{ id: "inv-1", kind: "domain", statement: "test" }],
      acceptance: [
        { id: "ac-1", kind: "test", description: "Tests pass", required: false },
      ],
    };

    const missing = contractMissing(contract);
    expect(missing).toContain("acceptance");
  });

  test("acceptance is complete with one required criterion", () => {
    const contract: Partial<TaskContract> = {
      context: { workspaceId: "ws", files: [] },
      goal: { outcome: "test", nonGoals: [] },
      skills: [],
      executors: [],
      invariants: [{ id: "inv-1", kind: "domain", statement: "test" }],
      acceptance: [
        { id: "ac-1", kind: "test", description: "Tests pass", required: true },
        { id: "ac-2", kind: "independent-check", description: "Manual check", required: false },
      ],
    };

    const missing = contractMissing(contract);
    expect(missing).not.toContain("acceptance");
  });

  test("goal outcome is required and must be non-empty", () => {
    const blankContract: Partial<TaskContract> = {
      context: { workspaceId: "ws", files: [] },
      goal: { outcome: "   ", nonGoals: [] },
      skills: [],
      executors: [],
      invariants: [],
      acceptance: [],
    };

    const missing = contractMissing(blankContract);
    expect(missing).toContain("goal");

    const validContract: Partial<TaskContract> = {
      context: { workspaceId: "ws", files: [] },
      goal: { outcome: "Do something", nonGoals: [] },
      skills: [],
      executors: [],
      invariants: [],
      acceptance: [],
    };

    const missing2 = contractMissing(validContract);
    expect(missing2).not.toContain("goal");
  });
});
