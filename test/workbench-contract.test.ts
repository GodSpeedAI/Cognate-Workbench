import { describe, expect, test } from "bun:test";
import type { TaskContract } from "../src/workbench/types.ts";
import {
  contractMissing,
  isContractComplete,
  defaultAuthority,
  contractChips,
} from "../src/workbench/contract.ts";

describe("contractMissing", () => {
  test("empty contract reports all fields missing", () => {
    const c: Partial<TaskContract> = {};
    const missing = contractMissing(c);
    expect(missing).toEqual([
      "context",
      "goal",
      "skills",
      "authority",
      "executors",
      "budget",
      "invariants",
      "acceptance",
    ]);
  });

  test("context missing when workspaceId is empty", () => {
    const c: Partial<TaskContract> = {
      context: { workspaceId: "", files: [] },
      goal: { outcome: "test", nonGoals: [] },
      skills: ["skill1"],
      authority: defaultAuthority(),
      executors: [{ role: "primary", executor: "model:test", kind: "llm" }],
      budget: { maxTokens: 1000 },
      invariants: [{ id: "i1", kind: "domain", statement: "test" }],
      acceptance: [{ id: "a1", kind: "test", description: "test", required: true }],
    };
    expect(contractMissing(c)).toContain("context");
  });

  test("context present when workspaceId is non-empty", () => {
    const c: Partial<TaskContract> = {
      context: { workspaceId: "ws-123", files: [] },
      goal: { outcome: "test", nonGoals: [] },
      skills: ["skill1"],
      authority: defaultAuthority(),
      executors: [{ role: "primary", executor: "model:test", kind: "llm" }],
      budget: { maxTokens: 1000 },
      invariants: [{ id: "i1", kind: "domain", statement: "test" }],
      acceptance: [{ id: "a1", kind: "test", description: "test", required: true }],
    };
    expect(contractMissing(c)).not.toContain("context");
  });

  test("goal missing when outcome is blank", () => {
    const c: Partial<TaskContract> = {
      context: { workspaceId: "ws", files: [] },
      goal: { outcome: "", nonGoals: [] },
      skills: ["skill1"],
      authority: defaultAuthority(),
      executors: [{ role: "primary", executor: "model:test", kind: "llm" }],
      budget: { maxTokens: 1000 },
      invariants: [{ id: "i1", kind: "domain", statement: "test" }],
      acceptance: [{ id: "a1", kind: "test", description: "test", required: true }],
    };
    expect(contractMissing(c)).toContain("goal");
  });

  test("skills missing when empty array", () => {
    const c: Partial<TaskContract> = {
      context: { workspaceId: "ws", files: [] },
      goal: { outcome: "test", nonGoals: [] },
      skills: [],
      authority: defaultAuthority(),
      executors: [{ role: "primary", executor: "model:test", kind: "llm" }],
      budget: { maxTokens: 1000 },
      invariants: [{ id: "i1", kind: "domain", statement: "test" }],
      acceptance: [{ id: "a1", kind: "test", description: "test", required: true }],
    };
    expect(contractMissing(c)).toContain("skills");
  });

  test("acceptance missing when no required criteria", () => {
    const c: Partial<TaskContract> = {
      context: { workspaceId: "ws", files: [] },
      goal: { outcome: "test", nonGoals: [] },
      skills: ["skill1"],
      authority: defaultAuthority(),
      executors: [{ role: "primary", executor: "model:test", kind: "llm" }],
      budget: { maxTokens: 1000 },
      invariants: [{ id: "i1", kind: "domain", statement: "test" }],
      acceptance: [{ id: "a1", kind: "test", description: "test", required: false }],
    };
    expect(contractMissing(c)).toContain("acceptance");
  });

  test("complete contract has no missing fields", () => {
    const c: Partial<TaskContract> = {
      context: { workspaceId: "ws", files: [] },
      goal: { outcome: "test", nonGoals: [] },
      skills: ["skill1"],
      authority: defaultAuthority(),
      executors: [{ role: "primary", executor: "model:test", kind: "llm" }],
      budget: { maxTokens: 1000 },
      invariants: [{ id: "i1", kind: "domain", statement: "test" }],
      acceptance: [{ id: "a1", kind: "test", description: "test", required: true }],
    };
    expect(contractMissing(c)).toEqual([]);
  });
});

describe("isContractComplete", () => {
  test("returns true when all fields present", () => {
    const c: Partial<TaskContract> = {
      context: { workspaceId: "ws", files: [] },
      goal: { outcome: "test", nonGoals: [] },
      skills: ["skill1"],
      authority: defaultAuthority(),
      executors: [{ role: "primary", executor: "model:test", kind: "llm" }],
      budget: { maxTokens: 1000 },
      invariants: [{ id: "i1", kind: "domain", statement: "test" }],
      acceptance: [{ id: "a1", kind: "test", description: "test", required: true }],
    };
    expect(isContractComplete(c)).toBe(true);
  });

  test("returns false when missing fields", () => {
    const c: Partial<TaskContract> = {
      context: { workspaceId: "ws", files: [] },
      goal: { outcome: "test", nonGoals: [] },
      skills: ["skill1"],
    };
    expect(isContractComplete(c)).toBe(false);
  });
});

describe("defaultAuthority", () => {
  test("returns authority with filesystem.read yes and everything else no", () => {
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
});

describe("contractChips", () => {
  test("renders complete contract", () => {
    const c: Partial<TaskContract> = {
      context: { workspaceId: "my-workspace", files: [] },
      goal: { outcome: "Build a feature", nonGoals: [] },
      skills: ["typescript", "react"],
      authority: {
        filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
        shell: { run: "approval", destructive: "no" },
        network: { outbound: "no" },
        packages: { install: "no" },
        extensions: { install: "no", enable: "no" },
        protectedPaths: [],
      },
      executors: [{ role: "primary", executor: "model:test", kind: "llm" }],
      budget: { maxTokens: 50000, maxCostUsd: 1.5, maxConcurrency: 2, maxMs: 30000 },
      invariants: [{ id: "i1", kind: "domain", statement: "test" }],
      acceptance: [{ id: "a1", kind: "test", description: "test", required: true }],
    };
    const chips = contractChips(c);

    const contextChip = chips.find(ch => ch.field === "context");
    expect(contextChip?.value).toBe("my-workspace");
    expect(contextChip?.state).toBe("set");

    const goalChip = chips.find(ch => ch.field === "goal");
    expect(goalChip?.value).toBe("Build a feature");
    expect(goalChip?.state).toBe("set");

    const skillsChip = chips.find(ch => ch.field === "skills");
    expect(skillsChip?.value).toBe("2 skills");
    expect(skillsChip?.state).toBe("set");

    const authChip = chips.find(ch => ch.field === "authority");
    expect(authChip?.value).toBe("read+write+shell");
    expect(authChip?.state).toBe("set");

    const executorsChip = chips.find(ch => ch.field === "executors");
    expect(executorsChip?.value).toBe("1 executors");
    expect(executorsChip?.state).toBe("set");

    const budgetChip = chips.find(ch => ch.field === "budget");
    expect(budgetChip?.value).toContain("50k tok");
    expect(budgetChip?.value).toContain("$1.50");
    expect(budgetChip?.value).toContain("2×");
    expect(budgetChip?.value).toContain("30s");
    expect(budgetChip?.state).toBe("set");

    const invariantsChip = chips.find(ch => ch.field === "invariants");
    expect(invariantsChip?.value).toBe("1 invariants");
    expect(invariantsChip?.state).toBe("set");

    const acceptanceChip = chips.find(ch => ch.field === "acceptance");
    expect(acceptanceChip?.value).toBe("1 criteria");
    expect(acceptanceChip?.state).toBe("set");
  });

  test("truncates long goals to 48 chars with ellipsis", () => {
    const longGoal = "a".repeat(60);
    const c: Partial<TaskContract> = {
      goal: { outcome: longGoal, nonGoals: [] },
    };
    const chips = contractChips(c);
    const goalChip = chips.find(ch => ch.field === "goal");
    expect(goalChip?.value.length).toBeLessThanOrEqual(49); // 48 + "…"
    expect(goalChip?.value).toContain("…");
  });

  test("shows missing for empty fields", () => {
    const c: Partial<TaskContract> = {};
    const chips = contractChips(c);

    expect(chips.every(ch => ch.state === "missing" || ch.value === "—")).toBe(true);
  });

  test("formats budget with only defined fields", () => {
    const c: Partial<TaskContract> = {
      budget: { maxTokens: 1000 },
    };
    const chips = contractChips(c);
    const budgetChip = chips.find(ch => ch.field === "budget");
    expect(budgetChip?.value).toBe("1k tok");
  });

  test("authority with only read is read-only", () => {
    const c: Partial<TaskContract> = {
      authority: defaultAuthority(),
    };
    const chips = contractChips(c);
    const authChip = chips.find(ch => ch.field === "authority");
    expect(authChip?.value).toBe("read");
  });

  test("authority with write and read shows read+write", () => {
    const c: Partial<TaskContract> = {
      authority: {
        filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
        shell: { run: "no", destructive: "no" },
        network: { outbound: "no" },
        packages: { install: "no" },
        extensions: { install: "no", enable: "no" },
        protectedPaths: [],
      },
    };
    const chips = contractChips(c);
    const authChip = chips.find(ch => ch.field === "authority");
    expect(authChip?.value).toBe("read+write");
  });
});
