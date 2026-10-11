import React, { useMemo, useState } from "react";
import type {
  WorkflowDefinition,
  WorkflowNode,
  NodeStatus,
  EvidenceKind,
  ImplementationBinding,
} from "../../workbench/types";
import {
  readyNodes,
  nextTransitions,
  retryable,
} from "../../workbench/workflow";

// Displays detailed information about a workflow node and provides actions.
// Shows acceptance criteria, incoming/outgoing edges, and state transitions.

interface NodeInspectorProps {
  readonly def: WorkflowDefinition;
  readonly nodeId: string;
  readonly status: Readonly<Record<string, NodeStatus>>;
  readonly closed: Readonly<Record<string, readonly EvidenceKind[]>>;
  readonly binding?: ImplementationBinding;
  readonly executorLabel?: string;
  readonly invariants: readonly string[];
  readonly onAdvance: (
    to: NodeStatus,
    closedEvidence?: readonly EvidenceKind[]
  ) => void;
}

export const NodeInspector: React.FC<NodeInspectorProps> = ({
  def,
  nodeId,
  status,
  closed,
  binding,
  executorLabel,
  invariants,
  onAdvance,
}) => {
  const node = def.nodes.find((n) => n.id === nodeId);
  const [attestingEvidence, setAttestingEvidence] = useState<
    Set<EvidenceKind>
  >(new Set());

  if (!node) {
    return <div>Node not found</div>;
  }

  const nodeStatus = status[nodeId] || "pending";
  const isReady = useMemo(
    () => readyNodes(def, status, closed).includes(nodeId),
    [def, status, closed, nodeId]
  );
  const nextTrans = useMemo(
    () => nextTransitions(def, nodeId),
    [def, nodeId]
  );
  const isRetryable = useMemo(
    () => retryable(def, nodeId, status),
    [def, nodeId, status]
  );

  const closedEvidenceForNode = closed[nodeId] || [];
  const openEvidence = node.acceptance.filter(
    (e) => !closedEvidenceForNode.includes(e)
  );
  const allEvidenceClosed = openEvidence.length === 0;

  // Find incoming edges that are not satisfied
  const incomingEdges = def.edges.filter((e) => e.to === nodeId);
  const unsatisfiedSources = incomingEdges
    .filter((e) => {
      const sourceStatus = status[e.from];
      if (e.mode === "needs") {
        // Source must be done
        return sourceStatus !== "done";
      } else {
        // Source must settle
        return sourceStatus !== "done" && sourceStatus !== "failed" && sourceStatus !== "skipped";
      }
    })
    .map((e) => e.from);

  // Determine primary action
  let primaryAction: "start" | "mark-done" | "retry" | null = null;
  if (isReady) {
    primaryAction = "start";
  } else if ((nodeStatus === "running" || nodeStatus === "review") && allEvidenceClosed) {
    primaryAction = "mark-done";
  } else if (isRetryable) {
    primaryAction = "retry";
  }

  const handleStartClick = () => {
    onAdvance("running");
  };

  const handleReviewClick = () => {
    onAdvance("review");
  };

  const handleDoneClick = () => {
    if (allEvidenceClosed) {
      onAdvance("done", closedEvidenceForNode);
    }
  };

  const handleFailedClick = () => {
    onAdvance("failed");
  };

  const handleRetryClick = () => {
    onAdvance("pending");
  };

  const handleAttestClick = () => {
    const attestedEvidence = Array.from(attestingEvidence) as EvidenceKind[];
    const allClosed = [
      ...new Set([...closedEvidenceForNode, ...attestedEvidence]),
    ] as EvidenceKind[];
    onAdvance("done", allClosed);
    setAttestingEvidence(new Set());
  };

  // Capability id without prefix
  const capabilityDisplay = node.capability.startsWith("capability.")
    ? node.capability.substring("capability.".length)
    : node.capability;

  return (
    <div className="wb-ni-root">
      {/* Header with node id and status */}
      <div className="wb-ni-header">
        <div className="wb-ni-heading">
          <h2>{node.id}</h2>
          <span className="wb-ni-status-chip">{nodeStatus}</span>
        </div>
      </div>

      {/* Main information */}
      <div className="wb-ni-section">
        <dl className="wb-ni-definition-list">
          <dt>Purpose</dt>
          <dd>{capabilityDisplay}</dd>

          <dt>Implementation</dt>
          <dd>
            {binding
              ? `${binding.provider} / ${binding.implementationId}`
              : "not bound"}
          </dd>

          <dt>Executor</dt>
          <dd>{executorLabel ?? node.executorRole}</dd>

          <dt>Authority</dt>
          <dd>{node.authority}</dd>

          <dt>Inherited invariants</dt>
          <dd>
            {invariants.length > 0 ? invariants.join(", ") : "none"}
          </dd>
        </dl>
      </div>

      {/* Evidence needed */}
      {node.acceptance.length > 0 && (
        <div className="wb-ni-section">
          <div className="wb-ni-section-title">Evidence needed</div>
          <ul className="wb-ni-evidence-list">
            {node.acceptance.map((kind) => {
              const isClosed = closedEvidenceForNode.includes(kind);
              return (
                <li key={kind} className={isClosed ? "evidence-closed" : "evidence-open"}>
                  {kind}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Transitions / Next */}
      {nextTrans.length > 0 && (
        <div className="wb-ni-section">
          <div className="wb-ni-section-title">Next</div>
          <ul className="wb-ni-transition-list">
            {nextTrans.map((t) => {
              const evidence =
                t.evidenceRequired.length > 0
                  ? ` (needs: ${t.evidenceRequired.join(", ")})`
                  : "";
              return (
                <li key={t.to}>
                  <span className="wb-ni-transition-arrow">
                    {t.to} ({t.mode}, {t.auto ? "auto" : "manual"})
                    {evidence}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Waiting on info */}
      {nodeStatus === "pending" && !isReady && unsatisfiedSources.length > 0 && (
        <div className="wb-ni-waiting-on">
          Waiting on: {unsatisfiedSources.join(", ")}
        </div>
      )}

      {/* Evidence attest section if applicable */}
      {(nodeStatus === "running" || nodeStatus === "review") &&
        !allEvidenceClosed &&
        openEvidence.length > 0 && (
          <div className="wb-ni-section">
            <div className="wb-ni-section-title">Attest evidence closed</div>
            <div className="wb-ni-attest">
              {openEvidence.map((kind) => (
                <label key={kind} className="wb-ni-attest-item">
                  <input
                    type="checkbox"
                    checked={attestingEvidence.has(kind)}
                    onChange={(e) => {
                      const newSet = new Set(attestingEvidence);
                      if (e.target.checked) {
                        newSet.add(kind);
                      } else {
                        newSet.delete(kind);
                      }
                      setAttestingEvidence(newSet);
                    }}
                  />
                  {kind}
                </label>
              ))}
            </div>
          </div>
        )}

      {/* Actions */}
      <div className="wb-ni-actions">
        {isReady && (
          <button
            type="button"
            className="wb-btn primary"
            onClick={handleStartClick}
          >
            Start
          </button>
        )}

        {nodeStatus === "running" && node.review && (
          <button
            type="button"
            className="wb-btn"
            onClick={handleReviewClick}
          >
            Send to review
          </button>
        )}

        {(nodeStatus === "running" || nodeStatus === "review") && (
          <>
            {allEvidenceClosed && attestingEvidence.size === 0 ? (
              <button
                type="button"
                className={
                  primaryAction === "mark-done" ? "wb-btn primary" : "wb-btn"
                }
                onClick={handleDoneClick}
              >
                Mark done
              </button>
            ) : attestingEvidence.size > 0 ? (
              <button
                type="button"
                className="wb-btn"
                onClick={handleAttestClick}
              >
                Attest and mark done
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="wb-btn"
                  disabled
                  title="Mark done disabled"
                >
                  Mark done
                </button>
                {openEvidence.length > 0 && (
                  <div className="wb-ni-disabled-reason">
                    Close these first: {openEvidence.join(", ")}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {nodeStatus === "running" && (
          <button
            type="button"
            className="wb-btn"
            onClick={handleFailedClick}
          >
            Mark failed
          </button>
        )}

        {isRetryable && (
          <button
            type="button"
            className={primaryAction === "retry" ? "wb-btn primary" : "wb-btn"}
            onClick={handleRetryClick}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
};
