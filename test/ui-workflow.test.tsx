import { describe, it, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { WorkflowGraph } from "../src/ui/workbench/WorkflowGraph";
import { NodeInspector } from "../src/ui/workbench/NodeInspector";
import {
  frontendProductActualization,
  parallelLayers,
} from "../src/workbench/workflow";

describe("WorkflowGraph", () => {
  it("renders nodes with aria-label containing status word", () => {
    const def = frontendProductActualization();
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    // Initialize all nodes as pending
    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    // Set some specific statuses, and close evidence for done nodes
    status["product-briefing"] = "done";
    closed["product-briefing"] = ["human"]; // Close the evidence
    status["reference-distillation"] = "running";
    status["structural-sketch"] = "blocked";

    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraph, {
        def,
        status,
        closed,
        onSelect: () => {},
      })
    );

    // Check that nodes are rendered with their status in aria-label
    expect(html).toContain('aria-label="product-briefing, done"');
    expect(html).toContain('aria-label="reference-distillation, running"');
    expect(html).toContain('aria-label="structural-sketch, blocked"');
  });

  it("marks done nodes without full evidence", () => {
    const def = frontendProductActualization();
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    // Mark product-briefing as done but don't close its evidence
    status["product-briefing"] = "done";
    closed["product-briefing"] = []; // No evidence closed

    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraph, {
        def,
        status,
        closed,
        onSelect: () => {},
      })
    );

    // Should show "evidence open" in aria-label
    expect(html).toContain('aria-label="product-briefing, done, evidence open"');
  });

  it("shows selected node with aria-pressed true", () => {
    const def = frontendProductActualization();
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraph, {
        def,
        status,
        closed,
        selected: "product-briefing",
        onSelect: () => {},
      })
    );

    // Should have aria-pressed="true" for selected node
    expect(html).toContain(
      'aria-pressed="true"'
    );
  });

  it("shows needs edges as solid and after edges as dashed", () => {
    const def = frontendProductActualization();
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraph, {
        def,
        status,
        closed,
        onSelect: () => {},
      })
    );

    // Should have needs and after classes
    expect(html).toContain('class="wb-wf-edge needs"');
    expect(html).toContain('class="wb-wf-edge after"');
  });

  it("worker-a and worker-b share same layer (column)", () => {
    const def = frontendProductActualization();
    const layers = parallelLayers(def);

    // Find worker-a and worker-b
    let workerALayer = -1;
    let workerBLayer = -1;

    layers.forEach((layer, idx) => {
      if (layer.includes("worker-a")) workerALayer = idx;
      if (layer.includes("worker-b")) workerBLayer = idx;
    });

    // They should be in the same layer
    expect(workerALayer).toBe(workerBLayer);
    expect(workerALayer).not.toBe(-1);
  });

  it("shows empty state when no nodes", () => {
    const def = {
      id: "empty",
      name: "Empty",
      version: 1,
      outcome: "Nothing",
      nodes: [],
      edges: [],
    };
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraph, {
        def,
        status,
        closed,
        onSelect: () => {},
      })
    );

    expect(html).toContain("No workflow nodes defined");
  });

  it("shows summary with current stage and unlocked next", () => {
    const def = frontendProductActualization();
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    // Make first node ready
    status["product-briefing"] = "ready";

    const html = renderToStaticMarkup(
      React.createElement(WorkflowGraph, {
        def,
        status,
        closed,
        onSelect: () => {},
      })
    );

    expect(html).toContain("Current stage:");
    expect(html).toContain("Unlocked next:");
  });
});

describe("NodeInspector", () => {
  const def = frontendProductActualization();

  it("shows Start button only when node is ready", () => {
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    // product-briefing has no incoming edges, so it's ready when pending
    status["product-briefing"] = "pending";

    const html = renderToStaticMarkup(
      React.createElement(NodeInspector, {
        def,
        nodeId: "product-briefing",
        status,
        closed,
        invariants: [],
        onAdvance: () => {},
      })
    );

    expect(html).toContain(">Start<");
  });

  it("hides Start button when node is not ready", () => {
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    // reference-distillation depends on product-briefing
    status["product-briefing"] = "pending";
    status["reference-distillation"] = "pending";

    const html = renderToStaticMarkup(
      React.createElement(NodeInspector, {
        def,
        nodeId: "reference-distillation",
        status,
        closed,
        invariants: [],
        onAdvance: () => {},
      })
    );

    // Should not have Start button (since it's blocked on product-briefing)
    const startMatch = html.match(/<button[^>]*>Start</);
    expect(startMatch).toBeFalsy();
  });

  it("shows Mark done disabled reason when evidence not closed", () => {
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    status["product-briefing"] = "running";
    closed["product-briefing"] = []; // No evidence closed

    const html = renderToStaticMarkup(
      React.createElement(NodeInspector, {
        def,
        nodeId: "product-briefing",
        status,
        closed,
        invariants: [],
        onAdvance: () => {},
      })
    );

    // Should show disabled reason with evidence kinds
    expect(html).toContain("Close these first:");
  });

  it("shows Retry button only for failed retryable nodes", () => {
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    // Set up a node that is failed and retryable:
    // It needs product-briefing which is done
    status["product-briefing"] = "done";
    closed["product-briefing"] = ["human"]; // Mark as done with evidence

    status["reference-distillation"] = "failed";

    const html = renderToStaticMarkup(
      React.createElement(NodeInspector, {
        def,
        nodeId: "reference-distillation",
        status,
        closed,
        invariants: [],
        onAdvance: () => {},
      })
    );

    // Should show Retry button
    expect(html).toContain(">Retry<");
  });

  it("shows node information sections", () => {
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    status["product-briefing"] = "pending";

    const html = renderToStaticMarkup(
      React.createElement(NodeInspector, {
        def,
        nodeId: "product-briefing",
        status,
        closed,
        binding: {
          capabilityId: "capability.product-briefing",
          implementationId: "briefing-v1",
          provider: "llm",
          executorKind: "llm",
          setup: {},
        },
        executorLabel: "PrimaryAgent",
        invariants: ["constraint-1", "constraint-2"],
        onAdvance: () => {},
      })
    );

    // Should contain sections
    expect(html).toContain("product-briefing");
    expect(html).toContain("Purpose");
    expect(html).toContain("Implementation");
    expect(html).toContain("Executor");
    expect(html).toContain("PrimaryAgent");
    expect(html).toContain("constraint-1");
  });

  it("shows evidence list with closed/open status", () => {
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    status["product-briefing"] = "running";
    closed["product-briefing"] = ["human"]; // One evidence closed

    const html = renderToStaticMarkup(
      React.createElement(NodeInspector, {
        def,
        nodeId: "product-briefing",
        status,
        closed,
        invariants: [],
        onAdvance: () => {},
      })
    );

    // product-briefing has acceptance: ["human"]
    expect(html).toContain("human");
  });

  it("shows waiting on message for pending node with unsatisfied edges", () => {
    const status: Record<string, any> = {};
    const closed: Record<string, any> = {};

    def.nodes.forEach((n) => {
      status[n.id] = "pending";
      closed[n.id] = [];
    });

    // reference-distillation needs product-briefing
    status["product-briefing"] = "pending";
    status["reference-distillation"] = "pending";

    const html = renderToStaticMarkup(
      React.createElement(NodeInspector, {
        def,
        nodeId: "reference-distillation",
        status,
        closed,
        invariants: [],
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Waiting on:");
    expect(html).toContain("product-briefing");
  });
});
