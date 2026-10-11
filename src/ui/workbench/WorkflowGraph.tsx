import React, { useMemo } from "react";
import type {
  WorkflowDefinition,
  NodeStatus,
  EvidenceKind,
} from "../../workbench/types";
import {
  parallelLayers,
  workflowView,
  nextTransitions,
} from "../../workbench/workflow";

// Renders workflow definition as an interactive graph with status.
// Shows nodes in parallel layers, edges between them, and selection.

interface WorkflowGraphProps {
  readonly def: WorkflowDefinition;
  readonly status: Readonly<Record<string, NodeStatus>>;
  readonly closed: Readonly<Record<string, readonly EvidenceKind[]>>;
  readonly selected?: string;
  readonly onSelect: (nodeId: string) => void;
}

export const WorkflowGraph: React.FC<WorkflowGraphProps> = ({
  def,
  status,
  closed,
  selected,
  onSelect,
}) => {
  const view = useMemo(() => workflowView(def, status, closed), [
    def,
    status,
    closed,
  ]);

  const layers = useMemo(() => {
    try {
      return parallelLayers(def);
    } catch {
      return [];
    }
  }, [def]);

  const handleKeyDown = (
    nodeId: string,
    e: React.KeyboardEvent<SVGGElement>
  ) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(nodeId);
    }
  };

  if (def.nodes.length === 0) {
    return (
      <div className="wb-empty">
        <strong>No workflow nodes defined</strong>
        {/* empty state text would go here */}
      </div>
    );
  }

  // Fixed geometry: layers as columns, nodes within layers as rows
  const NODE_WIDTH = 200;
  const NODE_HEIGHT = 56;
  const LAYER_WIDTH = NODE_WIDTH + 72; // node width + gap
  const ROW_HEIGHT = NODE_HEIGHT + 20; // node height + gap
  const PADDING = 24;
  const MARKER_SIZE = 10;

  // Calculate SVG dimensions
  const svgWidth = Math.max(
    600,
    layers.length * LAYER_WIDTH + PADDING * 2
  );
  const svgHeight = Math.max(
    160,
    Math.max(...layers.map((l) => l.length)) * ROW_HEIGHT + PADDING * 2
  );

  // Build a lookup of node -> (layerIndex, rowIndex)
  const nodePositions = new Map<string, { layer: number; row: number }>();
  layers.forEach((layer, layerIdx) => {
    layer.forEach((nodeId, rowIdx) => {
      nodePositions.set(nodeId, { layer: layerIdx, row: rowIdx });
    });
  });

  const getNodeXY = (nodeId: string) => {
    const pos = nodePositions.get(nodeId);
    if (!pos) return { x: PADDING, y: PADDING };
    return {
      x: PADDING + pos.layer * LAYER_WIDTH,
      y: PADDING + pos.row * ROW_HEIGHT,
    };
  };

  return (
    <div className="wb-wf-root">
      <div className="wb-wf-summary">
        <div role="status">
          Current stage:{" "}
          {view.currentStage.length > 0
            ? view.currentStage.join(", ")
            : "none"}
        </div>
        <div role="status">
          Unlocked next:{" "}
          {view.unlocked.length > 0 ? view.unlocked.join(", ") : "none"}
        </div>
      </div>

      <div className="wb-wf-container" tabIndex={0} aria-label="Workflow graph">
        <svg
          className="wb-wf-svg"
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth={MARKER_SIZE}
              markerHeight={MARKER_SIZE}
              refX={MARKER_SIZE - 2}
              refY={MARKER_SIZE / 2}
              orient="auto"
              className="wb-wf-marker"
            >
              <polygon
                points={`0 0, ${MARKER_SIZE} ${MARKER_SIZE / 2}, 0 ${MARKER_SIZE}`}
              />
            </marker>
          </defs>

          {/* Render edges */}
          {def.edges.map((edge, idx) => {
            const fromPos = getNodeXY(edge.from);
            const toPos = getNodeXY(edge.to);

            const fromX = fromPos.x + NODE_WIDTH;
            const fromY = fromPos.y + NODE_HEIGHT / 2;
            const toX = toPos.x;
            const toY = toPos.y + NODE_HEIGHT / 2;

            const cpX1 = fromX + (toX - fromX) * 0.3;
            const cpX2 = fromX + (toX - fromX) * 0.7;

            const pathD = `M ${fromX} ${fromY} C ${cpX1} ${fromY}, ${cpX2} ${toY}, ${toX} ${toY}`;

            return (
              <path
                key={`edge-${idx}`}
                d={pathD}
                className={`wb-wf-edge ${edge.mode}`}
                markerEnd="url(#arrowhead)"
              />
            );
          })}

          {/* Render nodes */}
          {def.nodes.map((node) => {
            const pos = getNodeXY(node.id);
            const nodeStatus = status[node.id] || "pending";
            const isSelected = selected === node.id;
            const nodeClass = `wb-wf-node ${nodeStatus}`;
            const doneWithoutEvidence =
              nodeStatus === "done" &&
              node.acceptance.length > 0 &&
              (closed[node.id] || []).length < node.acceptance.length;

            const ariaLabel = doneWithoutEvidence
              ? `${node.id}, ${nodeStatus}, evidence open`
              : `${node.id}, ${nodeStatus}`;

            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={ariaLabel}
                aria-pressed={isSelected}
                className={nodeClass}
                onClick={() => onSelect(node.id)}
                onKeyDown={(e) => handleKeyDown(node.id, e)}
              >
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={NODE_WIDTH}
                  height={NODE_HEIGHT}
                  rx={4}
                />
                <title>{node.id}</title>

                {/* Node ID (truncated) */}
                <g>
                  <title>{node.id}</title>
                  <text
                    x={pos.x + 8}
                    y={pos.y + 18}
                    dominantBaseline="middle"
                  >
                    {node.id.length > 22
                      ? node.id.substring(0, 19) + "…"
                      : node.id}
                  </text>
                </g>

                {/* Status word */}
                <text
                  x={pos.x + 8}
                  y={pos.y + 32}
                  dominantBaseline="middle"
                >
                  {nodeStatus}
                </text>

                {/* Tags */}
                {(node.review || node.optional || doneWithoutEvidence) && (
                  <text
                    x={pos.x + 8}
                    y={pos.y + 48}
                    dominantBaseline="middle"
                  >
                    {node.review && "gate "}
                    {node.optional && "optional "}
                    {doneWithoutEvidence && "evidence open"}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="wb-wf-legend">
        <ul>
          <li>Solid arrow: needs the source done with its evidence</li>
          <li>Dashed arrow: after the source settles</li>
        </ul>
      </div>
    </div>
  );
};
