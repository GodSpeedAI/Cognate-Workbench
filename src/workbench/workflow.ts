// Workflow graph scheduling. The needs/after edge semantics follow the pattern in the deepseek-harness reference's scripts/run-gates.ts (see donor-manifest.json); re-implemented, nothing copied.
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  NodeStatus,
  EvidenceKind,
  AcceptanceKind,
} from "./types.ts";

export type EvidenceClosure = Readonly<Record<string, readonly EvidenceKind[]>>;

export interface Transition {
  readonly to: string;
  readonly mode: "needs" | "after";
  readonly auto: boolean;
  readonly evidenceRequired: readonly EvidenceKind[];
  readonly guard?: string;
}

export interface WorkflowView {
  readonly currentStage: string[];
  readonly active: string[];
  readonly blocked: string[];
  readonly reviewGates: string[];
  readonly completed: string[];
  readonly failed: string[];
  readonly retryable: string[];
  readonly optional: string[];
  readonly unlocked: string[];
}

/**
 * Validate a workflow definition.
 * Returns human-readable errors; [] if valid.
 *
 * Checks for:
 * - duplicate node ids
 * - edges naming unknown nodes (including onFailure)
 * - self-edges
 * - cycles (reports cycle node ids)
 * - no nodes
 * - review nodes must have at least one incoming edge or be the only node
 * - edges with evidenceRequired but mode "after" are an error
 */
export function validateWorkflow(def: WorkflowDefinition): string[] {
  const errors: string[] = [];

  // Check no nodes
  if (def.nodes.length === 0) {
    errors.push("Workflow has no nodes");
    return errors;
  }

  // Check duplicate node ids
  const nodeIds = new Set<string>();
  const nodeIdList: string[] = [];
  for (const node of def.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id: ${node.id}`);
    }
    nodeIds.add(node.id);
    nodeIdList.push(node.id);
  }

  // Check edges reference known nodes
  for (const edge of def.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge references unknown source node: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge references unknown target node: ${edge.to}`);
    }
    if (edge.onFailure && !nodeIds.has(edge.onFailure)) {
      errors.push(`Edge onFailure references unknown node: ${edge.onFailure}`);
    }
  }

  // Check no self-edges
  for (const edge of def.edges) {
    if (edge.from === edge.to) {
      errors.push(`Self-edge not allowed: ${edge.from}`);
    }
  }

  // Check no edges with evidenceRequired but mode "after"
  for (const edge of def.edges) {
    if (edge.mode === "after" && edge.evidenceRequired.length > 0) {
      errors.push(
        `Edge from ${edge.from} to ${edge.to} has mode "after" but requires evidence`
      );
    }
  }

  // Check review nodes have incoming edges or are the only node
  if (def.nodes.length > 1) {
    for (const node of def.nodes) {
      if (node.review) {
        const hasIncoming = def.edges.some((e) => e.to === node.id);
        if (!hasIncoming) {
          errors.push(
            `Review node ${node.id} must have at least one incoming edge`
          );
        }
      }
    }
  }

  // Check cycles (using DFS)
  if (def.edges.length > 0) {
    const cycles = detectCycles(nodeIdList, def.edges);
    for (const cycle of cycles) {
      errors.push(`Cycle detected: ${cycle.join(" -> ")}`);
    }
  }

  return errors;
}

/**
 * Detect cycles in a directed graph using DFS.
 * Returns array of cycles, where each cycle is an array of node ids.
 */
function detectCycles(
  nodeIds: string[],
  edges: readonly WorkflowEdge[]
): string[][] {
  const adj = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    adj.set(nodeId, []);
  }
  for (const edge of edges) {
    const neighbors = adj.get(edge.from) || [];
    neighbors.push(edge.to);
    adj.set(edge.from, neighbors);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    for (const neighbor of adj.get(node) || []) {
      if (!visited.has(neighbor)) {
        dfs(neighbor);
      } else if (recStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart).concat(neighbor);
        cycles.push(cycle);
      }
    }

    path.pop();
    recStack.delete(node);
  }

  for (const node of nodeIds) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

/**
 * Check if a node is "done" for scheduling purposes.
 * A node is done if:
 * - status is "done"
 * - AND every kind in node.acceptance is in closed[nodeId]
 *
 * A node that is "done" without its acceptance evidence is NOT done for scheduling.
 */
export function nodeDone(
  def: WorkflowDefinition,
  nodeId: string,
  status: Readonly<Record<string, NodeStatus>>,
  closed: EvidenceClosure
): boolean {
  if (status[nodeId] !== "done") {
    return false;
  }

  const node = def.nodes.find((n) => n.id === nodeId);
  if (!node) {
    return false;
  }

  const closedForNode = closed[nodeId] || [];
  const closedSet = new Set(closedForNode);

  for (const acceptanceKind of node.acceptance) {
    if (!closedSet.has(acceptanceKind)) {
      return false;
    }
  }

  return true;
}

/**
 * Get nodes that are ready to run.
 *
 * A node is ready if:
 * - status is "pending" or "blocked"
 * - AND all incoming edges are satisfied:
 *   - needs-edge: nodeDone(source) && evidenceRequired ⊆ closed[source]
 *   - after-edge: source status in {done, failed, skipped}
 *   - optional source with status "skipped" also satisfies needs-edge
 *   - failed sources do NOT satisfy needs-edges
 * - A node with no incoming edges is ready when pending
 *
 * Returns nodeIds in definition order.
 */
export function readyNodes(
  def: WorkflowDefinition,
  status: Readonly<Record<string, NodeStatus>>,
  closed: EvidenceClosure
): string[] {
  const ready: string[] = [];

  for (const node of def.nodes) {
    const nodeStatus = status[node.id];

    // Must be pending or blocked
    if (nodeStatus !== "pending" && nodeStatus !== "blocked") {
      continue;
    }

    // Find incoming edges
    const incomingEdges = def.edges.filter((e) => e.to === node.id);

    // No incoming edges: ready if pending
    if (incomingEdges.length === 0) {
      ready.push(node.id);
      continue;
    }

    // All incoming edges must be satisfied
    let allSatisfied = true;
    for (const edge of incomingEdges) {
      const sourceNode = def.nodes.find((n) => n.id === edge.from);
      const sourceStatus = status[edge.from];

      if (edge.mode === "needs") {
        // Source must be done with evidence
        const isDone = nodeDone(def, edge.from, status, closed);
        if (!isDone) {
          // Check if source is optional and skipped
          if (sourceNode?.optional && sourceStatus === "skipped") {
            // Satisfies the edge
            continue;
          }
          allSatisfied = false;
          break;
        }

        // Check evidence required
        const closedForSource = closed[edge.from] || [];
        const closedSet = new Set(closedForSource);
        for (const evidenceKind of edge.evidenceRequired) {
          if (!closedSet.has(evidenceKind)) {
            allSatisfied = false;
            break;
          }
        }
        if (!allSatisfied) {
          break;
        }
      } else if (edge.mode === "after") {
        // Source must settle (done, failed, or skipped)
        if (
          sourceStatus !== "done" &&
          sourceStatus !== "failed" &&
          sourceStatus !== "skipped"
        ) {
          allSatisfied = false;
          break;
        }
      }
    }

    if (allSatisfied) {
      ready.push(node.id);
    }
  }

  return ready;
}

/**
 * Compute topological layers using Kahn's algorithm.
 * Returns layers where each layer contains nodes that can run in parallel.
 * Nodes within each layer are sorted by definition order.
 *
 * Assumes valid DAG; throws Error("workflow has a cycle") if cycle detected.
 */
export function parallelLayers(def: WorkflowDefinition): string[][] {
  // Check for cycles
  const cycles = detectCycles(
    def.nodes.map((n) => n.id),
    def.edges
  );
  if (cycles.length > 0) {
    throw new Error("workflow has a cycle");
  }

  // Compute in-degrees
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of def.nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of def.edges) {
    const current = inDegree.get(edge.to) || 0;
    inDegree.set(edge.to, current + 1);

    const neighbors = adj.get(edge.from) || [];
    neighbors.push(edge.to);
    adj.set(edge.from, neighbors);
  }

  // Kahn's algorithm
  const layers: string[][] = [];
  const processed = new Set<string>();

  while (processed.size < def.nodes.length) {
    // Find all nodes with in-degree 0 that haven't been processed
    const currentLayer: string[] = [];

    for (const node of def.nodes) {
      if (
        !processed.has(node.id) &&
        (inDegree.get(node.id) || 0) === 0
      ) {
        currentLayer.push(node.id);
      }
    }

    if (currentLayer.length === 0) {
      throw new Error("workflow has a cycle");
    }

    // Sort by definition order
    currentLayer.sort(
      (a, b) =>
        def.nodes.findIndex((n) => n.id === a) -
        def.nodes.findIndex((n) => n.id === b)
    );

    layers.push(currentLayer);

    // Process this layer
    for (const nodeId of currentLayer) {
      processed.add(nodeId);

      // Decrease in-degree for neighbors
      for (const neighbor of adj.get(nodeId) || []) {
        const current = inDegree.get(neighbor) || 0;
        inDegree.set(neighbor, current - 1);
      }
    }
  }

  return layers;
}

/**
 * Get outgoing edges from a node as Transition objects.
 * Returns transitions in definition order.
 */
export function nextTransitions(
  def: WorkflowDefinition,
  nodeId: string
): Transition[] {
  return def.edges
    .filter((e) => e.from === nodeId)
    .map((e) => ({
      to: e.to,
      mode: e.mode,
      auto: e.auto,
      evidenceRequired: e.evidenceRequired,
      guard: e.guard,
    }));
}

/**
 * Get the failure route for a node.
 * Returns the onFailure node id if the first outgoing edge has one, undefined otherwise.
 */
export function failureRoute(
  def: WorkflowDefinition,
  nodeId: string
): string | undefined {
  const edge = def.edges.find((e) => e.from === nodeId);
  return edge?.onFailure;
}

/**
 * Check if a node can be retried.
 * Returns true iff:
 * - status[nodeId] === "failed"
 * - AND all needs-sources of nodeId are "done"
 *
 * This ensures retrying one node doesn't require restarting upstream.
 */
export function retryable(
  def: WorkflowDefinition,
  nodeId: string,
  status: Readonly<Record<string, NodeStatus>>
): boolean {
  if (status[nodeId] !== "failed") {
    return false;
  }

  // Check that all needs-sources are done
  const incomingEdges = def.edges.filter(
    (e) => e.to === nodeId && e.mode === "needs"
  );
  for (const edge of incomingEdges) {
    if (status[edge.from] !== "done") {
      return false;
    }
  }

  return true;
}

/**
 * Compute a workflow view for the cockpit UI.
 *
 * Classifies nodes by their role in the current state:
 * - completed: nodeDone(node)
 * - active: status === "running"
 * - blocked: status === "blocked"
 * - reviewGates: status === "review"
 * - failed: status === "failed"
 * - retryable: nodeDone && retryable()
 * - optional: node.optional === true
 * - unlocked: readyNodes()
 * - currentStage: active if any, else unlocked
 */
export function workflowView(
  def: WorkflowDefinition,
  status: Readonly<Record<string, NodeStatus>>,
  closed: EvidenceClosure
): WorkflowView {
  const completed: string[] = [];
  const active: string[] = [];
  const blocked: string[] = [];
  const reviewGates: string[] = [];
  const failed: string[] = [];
  const optional: string[] = [];

  for (const node of def.nodes) {
    if (nodeDone(def, node.id, status, closed)) {
      completed.push(node.id);
    }

    if (status[node.id] === "running") {
      active.push(node.id);
    }

    if (status[node.id] === "blocked") {
      blocked.push(node.id);
    }

    if (status[node.id] === "review") {
      reviewGates.push(node.id);
    }

    if (status[node.id] === "failed") {
      failed.push(node.id);
    }

    if (node.optional) {
      optional.push(node.id);
    }
  }

  const unlocked = readyNodes(def, status, closed);
  const retryableNodes = failed.filter((nodeId) =>
    retryable(def, nodeId, status)
  );

  const currentStage =
    active.length > 0 ? active : unlocked;

  return {
    currentStage,
    active,
    blocked,
    reviewGates,
    completed,
    failed,
    retryable: retryableNodes,
    optional,
    unlocked,
  };
}

/**
 * The example workflow: frontend product actualization.
 *
 * Workflow ID: "wf.frontend-product-actualization"
 * Version: 1
 *
 * Nodes in order:
 * 1. product-briefing (capability "capability.product-briefing")
 * 2. reference-distillation
 * 3. structural-sketch
 * 4. design-model
 * 5. anchor-implementation
 * 6. runtime-inspection
 * 7. grounded-repair (optional)
 * 8. work-decomposition
 * 9. worker-a
 * 10. worker-b
 * 11. integration
 * 12. audit
 * 13. polish
 * 14. verify
 * 15. review (review: true)
 * 16. accept
 *
 * Edges:
 * - briefing -> reference-distillation (needs)
 * - briefing -> structural-sketch (needs)
 * - reference-distillation -> design-model (needs)
 * - structural-sketch -> design-model (needs)
 * - design-model -> anchor-implementation (needs)
 * - anchor-implementation -> runtime-inspection (needs)
 * - runtime-inspection -> grounded-repair (needs, guard "direction not accepted")
 * - runtime-inspection -> work-decomposition (needs, guard "direction accepted")
 * - grounded-repair -> work-decomposition (after)
 * - work-decomposition -> worker-a (needs)
 * - work-decomposition -> worker-b (needs)
 * - worker-a -> integration (needs)
 * - worker-b -> integration (needs)
 * - integration -> audit (needs)
 * - audit -> polish (needs)
 * - polish -> verify (needs)
 * - verify -> review (needs, evidenceRequired ["test", "journey"])
 * - review -> accept (needs, auto: false)
 */
export function frontendProductActualization(): WorkflowDefinition {
  return {
    id: "wf.frontend-product-actualization",
    name: "Frontend Product Actualization",
    version: 1,
    outcome: "A complete, tested, and verified frontend product ready for release",
    nodes: [
      {
        id: "product-briefing",
        capability: "capability.product-briefing",
        inputs: [],
        outputs: ["brief"],
        authority: "advise",
        executorRole: "primary",
        acceptance: ["human"],
      },
      {
        id: "reference-distillation",
        capability: "capability.reference-distillation",
        inputs: ["brief"],
        outputs: ["references"],
        authority: "advise",
        executorRole: "architect",
        acceptance: ["domain"],
      },
      {
        id: "structural-sketch",
        capability: "capability.structural-sketch",
        inputs: ["brief"],
        outputs: ["structure"],
        authority: "advise",
        executorRole: "architect",
        acceptance: ["audit"],
      },
      {
        id: "design-model",
        capability: "capability.design-model",
        inputs: ["references", "structure"],
        outputs: ["design"],
        authority: "modify",
        executorRole: "architect",
        acceptance: ["audit"],
      },
      {
        id: "anchor-implementation",
        capability: "capability.anchor-implementation",
        inputs: ["design"],
        outputs: ["anchor"],
        authority: "modify",
        executorRole: "primary",
        acceptance: ["implementation"],
      },
      {
        id: "runtime-inspection",
        capability: "capability.runtime-inspection",
        inputs: ["anchor"],
        outputs: ["direction"],
        authority: "inspect",
        executorRole: "primary",
        acceptance: ["runtime"],
      },
      {
        id: "grounded-repair",
        capability: "capability.grounded-repair",
        inputs: ["direction"],
        outputs: ["repaired"],
        authority: "modify",
        executorRole: "primary",
        acceptance: ["quality"],
        optional: true,
      },
      {
        id: "work-decomposition",
        capability: "capability.work-decomposition",
        inputs: ["direction"],
        outputs: ["tasks"],
        authority: "advise",
        executorRole: "architect",
        acceptance: ["domain"],
      },
      {
        id: "worker-a",
        capability: "capability.worker",
        inputs: ["tasks"],
        outputs: ["work-a"],
        authority: "modify",
        executorRole: "worker",
        acceptance: ["implementation", "test"],
      },
      {
        id: "worker-b",
        capability: "capability.worker",
        inputs: ["tasks"],
        outputs: ["work-b"],
        authority: "modify",
        executorRole: "worker",
        acceptance: ["implementation", "test"],
      },
      {
        id: "integration",
        capability: "capability.integration",
        inputs: ["work-a", "work-b"],
        outputs: ["integrated"],
        authority: "modify",
        executorRole: "primary",
        acceptance: ["integrity", "test"],
      },
      {
        id: "audit",
        capability: "capability.audit",
        inputs: ["integrated"],
        outputs: ["audited"],
        authority: "verify",
        executorRole: "verifier",
        acceptance: ["audit"],
      },
      {
        id: "polish",
        capability: "capability.polish",
        inputs: ["audited"],
        outputs: ["polished"],
        authority: "modify",
        executorRole: "primary",
        acceptance: ["quality"],
      },
      {
        id: "verify",
        capability: "capability.verify",
        inputs: ["polished"],
        outputs: ["verified"],
        authority: "verify",
        executorRole: "verifier",
        acceptance: ["test", "journey"],
      },
      {
        id: "review",
        capability: "capability.review",
        inputs: ["verified"],
        outputs: ["review-decision"],
        authority: "approve",
        executorRole: "primary",
        acceptance: ["human"],
        review: true,
      },
      {
        id: "accept",
        capability: "capability.accept",
        inputs: ["review-decision"],
        outputs: ["product"],
        authority: "approve",
        executorRole: "primary",
        acceptance: ["human"],
      },
    ],
    edges: [
      {
        from: "product-briefing",
        to: "reference-distillation",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "product-briefing",
        to: "structural-sketch",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "reference-distillation",
        to: "design-model",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "structural-sketch",
        to: "design-model",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "design-model",
        to: "anchor-implementation",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "anchor-implementation",
        to: "runtime-inspection",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "runtime-inspection",
        to: "grounded-repair",
        mode: "needs",
        guard: "direction not accepted",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "runtime-inspection",
        to: "work-decomposition",
        mode: "needs",
        guard: "direction accepted",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "grounded-repair",
        to: "work-decomposition",
        mode: "after",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "work-decomposition",
        to: "worker-a",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "work-decomposition",
        to: "worker-b",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "worker-a",
        to: "integration",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "worker-b",
        to: "integration",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "integration",
        to: "audit",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "audit",
        to: "polish",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "polish",
        to: "verify",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "verify",
        to: "review",
        mode: "needs",
        evidenceRequired: ["test", "journey"],
        auto: true,
      },
      {
        from: "review",
        to: "accept",
        mode: "needs",
        evidenceRequired: [],
        auto: false,
      },
    ],
  };
}

/**
 * A second example workflow: weekly sales report.
 *
 * Workflow ID: "wf.weekly-sales-report"
 * Version: 1
 *
 * A domain-agnostic workflow demonstrating the scheduler's generality:
 * domain-rules -> calculation -> report -> independent-verification -> review
 */
export function documentWorkflow(): WorkflowDefinition {
  return {
    id: "wf.weekly-sales-report",
    name: "Weekly Sales Report",
    version: 1,
    outcome: "A verified weekly sales report ready for stakeholder review",
    nodes: [
      {
        id: "domain-rules",
        capability: "capability.domain-rules",
        inputs: [],
        outputs: ["rules"],
        authority: "advise",
        executorRole: "architect",
        acceptance: ["domain"],
      },
      {
        id: "calculation",
        capability: "capability.calculation",
        inputs: ["rules"],
        outputs: ["computed"],
        authority: "execute",
        executorRole: "primary",
        acceptance: ["test", "implementation"],
      },
      {
        id: "report",
        capability: "capability.report",
        inputs: ["computed"],
        outputs: ["report-doc"],
        authority: "modify",
        executorRole: "primary",
        acceptance: ["quality"],
      },
      {
        id: "independent-verification",
        capability: "capability.independent-verification",
        inputs: ["report-doc"],
        outputs: ["verification"],
        authority: "verify",
        executorRole: "verifier",
        acceptance: ["independent-check", "audit"],
      },
      {
        id: "review",
        capability: "capability.review",
        inputs: ["verification"],
        outputs: ["decision"],
        authority: "approve",
        executorRole: "primary",
        acceptance: ["human"],
        review: true,
      },
    ],
    edges: [
      {
        from: "domain-rules",
        to: "calculation",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "calculation",
        to: "report",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "report",
        to: "independent-verification",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
      {
        from: "independent-verification",
        to: "review",
        mode: "needs",
        evidenceRequired: [],
        auto: true,
      },
    ],
  };
}
