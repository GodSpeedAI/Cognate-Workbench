import { describe, it, expect } from "bun:test";
import type { WorkflowDefinition, NodeStatus } from "../src/workbench/types.ts";
import {
  validateWorkflow,
  nodeDone,
  readyNodes,
  parallelLayers,
  nextTransitions,
  failureRoute,
  retryable,
  workflowView,
  frontendProductActualization,
  documentWorkflow,
  type EvidenceClosure,
  type Transition,
} from "../src/workbench/workflow.ts";

describe("validateWorkflow", () => {
  it("should accept a valid simple workflow", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test outcome",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: ["x"],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: ["x"],
          outputs: ["y"],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    expect(validateWorkflow(def)).toEqual([]);
  });

  it("should detect duplicate node ids", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test outcome",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "a",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [],
    };

    const errors = validateWorkflow(def);
    expect(errors.some((e) => e.includes("Duplicate node id"))).toBe(true);
  });

  it("should detect edges referencing unknown nodes", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test outcome",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "unknown",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const errors = validateWorkflow(def);
    expect(errors.some((e) => e.includes("unknown target node"))).toBe(true);
  });

  it("should detect self-edges", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test outcome",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "a",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const errors = validateWorkflow(def);
    expect(errors.some((e) => e.includes("Self-edge"))).toBe(true);
  });

  it("should detect cycles", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test outcome",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "c",
          capability: "cap.c",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
        {
          from: "b",
          to: "c",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
        {
          from: "c",
          to: "a",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const errors = validateWorkflow(def);
    expect(errors.some((e) => e.includes("Cycle"))).toBe(true);
  });

  it("should reject no nodes", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test outcome",
      nodes: [],
      edges: [],
    };

    const errors = validateWorkflow(def);
    expect(errors.some((e) => e.includes("no nodes"))).toBe(true);
  });

  it("should detect after edges with evidence required", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test outcome",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "after",
          evidenceRequired: ["test"],
          auto: true,
        },
      ],
    };

    const errors = validateWorkflow(def);
    expect(
      errors.some((e) => e.includes("after") && e.includes("evidence"))
    ).toBe(true);
  });

  it("should require review nodes to have incoming edges (unless only node)", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test outcome",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "review",
          capability: "cap.review",
          inputs: [],
          outputs: [],
          authority: "approve",
          executorRole: "primary",
          acceptance: [],
          review: true,
        },
      ],
      edges: [],
    };

    const errors = validateWorkflow(def);
    expect(
      errors.some((e) => e.includes("Review node") && e.includes("incoming"))
    ).toBe(true);
  });

  it("should allow onFailure node references", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test outcome",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "fallback",
          capability: "cap.fallback",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          onFailure: "fallback",
          auto: true,
        },
      ],
    };

    expect(validateWorkflow(def)).toEqual([]);
  });
});

describe("nodeDone", () => {
  it("should return false if status is not 'done'", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: ["test"],
        },
      ],
      edges: [],
    };

    const status: Record<string, NodeStatus> = { a: "running" };
    const closed: EvidenceClosure = { a: [] };

    expect(nodeDone(def, "a", status, closed)).toBe(false);
  });

  it("should return false if acceptance evidence is not closed", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: ["test", "audit"],
        },
      ],
      edges: [],
    };

    const status: Record<string, NodeStatus> = { a: "done" };
    const closed: EvidenceClosure = { a: ["test"] };

    expect(nodeDone(def, "a", status, closed)).toBe(false);
  });

  it("should return true when status is done and all evidence is closed", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: ["test", "audit"],
        },
      ],
      edges: [],
    };

    const status: Record<string, NodeStatus> = { a: "done" };
    const closed: EvidenceClosure = { a: ["test", "audit"] };

    expect(nodeDone(def, "a", status, closed)).toBe(true);
  });

  it("should return true when node has no acceptance requirements", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [],
    };

    const status: Record<string, NodeStatus> = { a: "done" };
    const closed: EvidenceClosure = { a: [] };

    expect(nodeDone(def, "a", status, closed)).toBe(true);
  });
});

describe("readyNodes", () => {
  it("should return node with no incoming edges when pending", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [],
    };

    const status: Record<string, NodeStatus> = { a: "pending" };
    const closed: EvidenceClosure = { a: [] };

    expect(readyNodes(def, status, closed)).toEqual(["a"]);
  });

  it("should respect needs edge: source must be done with evidence", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: ["test"],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: ["test"],
          auto: true,
        },
      ],
    };

    const status: Record<string, NodeStatus> = {
      a: "done",
      b: "pending",
    };
    const closed: EvidenceClosure = { a: [] };

    // 'a' is done but test evidence not closed; b should not be ready
    expect(readyNodes(def, status, closed)).toEqual([]);
  });

  it("should allow transition when evidence is satisfied", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: ["test"],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: ["test"],
          auto: true,
        },
      ],
    };

    const status: Record<string, NodeStatus> = {
      a: "done",
      b: "pending",
    };
    const closed: EvidenceClosure = { a: ["test"] };

    expect(readyNodes(def, status, closed)).toEqual(["b"]);
  });

  it("should respect after edge: source must settle", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "after",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const status: Record<string, NodeStatus> = {
      a: "running",
      b: "pending",
    };
    const closed: EvidenceClosure = { a: [] };

    // 'a' is still running, not settled
    expect(readyNodes(def, status, closed)).toEqual([]);
  });

  it("should allow after edge when source is failed", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "after",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const status: Record<string, NodeStatus> = {
      a: "failed",
      b: "pending",
    };
    const closed: EvidenceClosure = { a: [] };

    expect(readyNodes(def, status, closed)).toEqual(["b"]);
  });

  it("should allow optional source with skipped status on needs edge", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
          optional: true,
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const status: Record<string, NodeStatus> = {
      a: "skipped",
      b: "pending",
    };
    const closed: EvidenceClosure = { a: [] };

    expect(readyNodes(def, status, closed)).toEqual(["b"]);
  });

  it("should not allow failed source on needs edge", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const status: Record<string, NodeStatus> = {
      a: "failed",
      b: "pending",
    };
    const closed: EvidenceClosure = { a: [] };

    expect(readyNodes(def, status, closed)).toEqual([]);
  });
});

describe("parallelLayers", () => {
  it("should detect cycles", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
        {
          from: "b",
          to: "a",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    expect(() => parallelLayers(def)).toThrow("workflow has a cycle");
  });

  it("should return single layer for linear workflow", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [],
    };

    expect(parallelLayers(def)).toEqual([["a"]]);
  });

  it("should put parallel nodes in same layer", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "start",
          capability: "cap.start",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "worker-a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "worker-b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "end",
          capability: "cap.end",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "start",
          to: "worker-a",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
        {
          from: "start",
          to: "worker-b",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
        {
          from: "worker-a",
          to: "end",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
        {
          from: "worker-b",
          to: "end",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const layers = parallelLayers(def);
    expect(layers.length).toBe(3);
    expect(layers[0]).toEqual(["start"]);
    expect(layers[1]).toContain("worker-a");
    expect(layers[1]).toContain("worker-b");
    expect(layers[2]).toEqual(["end"]);
  });
});

describe("nextTransitions", () => {
  it("should return outgoing edges as transitions", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: ["test"],
          guard: "some-guard",
          auto: true,
        },
      ],
    };

    const transitions = nextTransitions(def, "a");
    expect(transitions.length).toBe(1);
    expect(transitions[0]!.to).toBe("b");
    expect(transitions[0]!.mode).toBe("needs");
    expect(transitions[0]!.evidenceRequired).toEqual(["test"]);
    expect(transitions[0]!.guard).toBe("some-guard");
    expect(transitions[0]!.auto).toBe(true);
  });
});

describe("failureRoute", () => {
  it("should return onFailure node", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "fallback",
          capability: "cap.fallback",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          onFailure: "fallback",
          auto: true,
        },
      ],
    };

    expect(failureRoute(def, "a")).toBe("fallback");
  });

  it("should return undefined if no onFailure", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [],
    };

    expect(failureRoute(def, "a")).toBeUndefined();
  });
});

describe("retryable", () => {
  it("should return false if status is not failed", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [],
    };

    const status: Record<string, NodeStatus> = { a: "done" };

    expect(retryable(def, "a", status)).toBe(false);
  });

  it("should return true if failed and all needs-sources are done", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const status: Record<string, NodeStatus> = { a: "done", b: "failed" };

    expect(retryable(def, "b", status)).toBe(true);
  });

  it("should return false if failed but needs-source is not done", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const status: Record<string, NodeStatus> = { a: "running", b: "failed" };

    expect(retryable(def, "b", status)).toBe(false);
  });
});

describe("workflowView", () => {
  it("should classify nodes correctly", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "c",
          capability: "cap.c",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
          optional: true,
        },
        {
          id: "review",
          capability: "cap.review",
          inputs: [],
          outputs: [],
          authority: "approve",
          executorRole: "primary",
          acceptance: [],
          review: true,
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
        {
          from: "b",
          to: "review",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const status: Record<string, NodeStatus> = {
      a: "done",
      b: "running",
      c: "pending",
      review: "review",
    };
    const closed: EvidenceClosure = { a: [], b: [], c: [], review: [] };

    const view = workflowView(def, status, closed);

    expect(view.completed).toContain("a");
    expect(view.active).toContain("b");
    expect(view.optional).toContain("c");
    expect(view.reviewGates).toContain("review");
  });

  it("should set currentStage to active if any, else unlocked", () => {
    const def: WorkflowDefinition = {
      id: "test",
      name: "Test",
      version: 1,
      outcome: "Test",
      nodes: [
        {
          id: "a",
          capability: "cap.a",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
        {
          id: "b",
          capability: "cap.b",
          inputs: [],
          outputs: [],
          authority: "modify",
          executorRole: "primary",
          acceptance: [],
        },
      ],
      edges: [
        {
          from: "a",
          to: "b",
          mode: "needs",
          evidenceRequired: [],
          auto: true,
        },
      ],
    };

    const status: Record<string, NodeStatus> = {
      a: "running",
      b: "pending",
    };
    const closed: EvidenceClosure = { a: [], b: [] };

    const view = workflowView(def, status, closed);

    expect(view.currentStage).toEqual(["a"]);
  });
});

describe("frontendProductActualization", () => {
  it("should be valid", () => {
    const def = frontendProductActualization();
    const errors = validateWorkflow(def);
    expect(errors).toEqual([]);
  });

  it("should have correct id and version", () => {
    const def = frontendProductActualization();
    expect(def.id).toBe("wf.frontend-product-actualization");
    expect(def.version).toBe(1);
  });

  it("should have workers in same parallel layer (V-006 assertion)", () => {
    const def = frontendProductActualization();
    const layers = parallelLayers(def);

    // Find the layer with both workers
    let workerLayer: string[] | null = null;
    for (const layer of layers) {
      if (layer.includes("worker-a") && layer.includes("worker-b")) {
        workerLayer = layer;
        break;
      }
    }

    expect(workerLayer).not.toBeNull();
    expect(workerLayer).toContain("worker-a");
    expect(workerLayer).toContain("worker-b");
  });

  it("should have review gate with incoming edge", () => {
    const def = frontendProductActualization();
    const reviewNode = def.nodes.find((n) => n.id === "review");
    expect(reviewNode).toBeDefined();
    expect(reviewNode?.review).toBe(true);

    const incomingEdges = def.edges.filter((e) => e.to === "review");
    expect(incomingEdges.length).toBeGreaterThan(0);
  });

  it("should have verify requiring test and journey evidence", () => {
    const def = frontendProductActualization();
    const edge = def.edges.find((e) => e.from === "verify" && e.to === "review");
    expect(edge).toBeDefined();
    expect(edge?.evidenceRequired).toContain("test");
    expect(edge?.evidenceRequired).toContain("journey");
  });
});

describe("documentWorkflow", () => {
  it("should be valid", () => {
    const def = documentWorkflow();
    const errors = validateWorkflow(def);
    expect(errors).toEqual([]);
  });

  it("should have correct id and structure", () => {
    const def = documentWorkflow();
    expect(def.id).toBe("wf.weekly-sales-report");
    expect(def.nodes.length).toBe(5);
    expect(def.nodes[0]!.id).toBe("domain-rules");
    expect(def.nodes[4]!.id).toBe("review");
  });

  it("should form a linear chain", () => {
    const def = documentWorkflow();
    const layers = parallelLayers(def);
    expect(layers.length).toBe(5);
    layers.forEach((layer) => {
      expect(layer.length).toBe(1);
    });
  });
});
