// Review gate: submission, review surface, and acceptance state for task review and approval.
// Three modes: submit-for-review (with blockers if any), ready-for-review consequential surface, or accepted.

import { useState } from "react";
import type { TaskStatus, Invariant } from "../../workbench/types.ts";

interface ReviewCardProps {
  readonly status: TaskStatus;
  readonly intent: string;
  readonly invariants: readonly Invariant[];
  readonly changed: readonly string[];
  readonly evidence: { readonly closed: number; readonly total: number; readonly failed: number };
  readonly economics: string;
  readonly remaining: readonly string[];
  readonly blockers: readonly string[];
  readonly canDecide: boolean;
  readonly onRequestReview: () => void;
  readonly onAccept: (note: string) => void;
  readonly onRework: (note: string) => void;
}

export function ReviewCard({
  status,
  intent,
  invariants,
  changed,
  evidence,
  economics,
  remaining,
  blockers,
  canDecide,
  onRequestReview,
  onAccept,
  onRework,
}: ReviewCardProps) {
  const [reviewNote, setReviewNote] = useState("");

  if (status === "ACCEPTED" || status === "OPERATIONALIZED") {
    return (
      <section className="wb-section">
        <p>Accepted by a reviewer.</p>
      </section>
    );
  }

  if (status === "READY_FOR_REVIEW") {
    return (
      <div
        className="wb-consequential"
        role="region"
        aria-label="Review gate"
      >
        <div className="wb-section-head">
          <h3>Ready for review</h3>
        </div>

        <div className="wb-review-sections">
          <div className="wb-review-section">
            <h4>Intent</h4>
            <p>{intent}</p>
          </div>

          {invariants.length > 0 && (
            <div className="wb-review-section">
              <h4>Invariants</h4>
              <ul className="wb-list">
                {invariants.map((inv) => (
                  <li key={inv.id}>
                    <span className="wb-mono">{inv.kind}:</span> {inv.statement}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="wb-review-section">
            <h4>Changes</h4>
            {changed.length === 0 ? (
              <p className="wb-muted">No files reported</p>
            ) : (
              <ul className="wb-list">
                {changed.map((file, idx) => (
                  <li key={idx}>{file}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="wb-review-section">
            <h4>Evidence</h4>
            <p>
              <strong>{evidence.closed}</strong> of{" "}
              <strong>{evidence.total}</strong> criteria closed
              {evidence.failed > 0 && (
                <>
                  {", "}
                  <strong>{evidence.failed}</strong> failed
                </>
              )}
            </p>
          </div>

          <div className="wb-review-section">
            <h4>Economics</h4>
            <p>{economics}</p>
          </div>

          <div className="wb-review-section">
            <h4>Remaining</h4>
            {remaining.length === 0 ? (
              <p className="wb-muted">Nothing declared</p>
            ) : (
              <ul className="wb-list">
                {remaining.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="wb-review-controls">
          <div className="wb-field">
            <label htmlFor="reviewer-note">Reviewer note</label>
            <textarea
              id="reviewer-note"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.currentTarget.value)}
              placeholder="Optional note for the worker"
            />
          </div>

          <div className="wb-btn-row">
            <button
              className="wb-btn primary"
              onClick={() => onAccept(reviewNote)}
              disabled={!canDecide}
            >
              Accept
            </button>
            <button
              className="wb-btn"
              onClick={() => onRework(reviewNote)}
              disabled={!canDecide}
            >
              Request rework
            </button>
            {!canDecide && (
              <span className="wb-muted">
                Only a person can accept work. Sign in as the operator to
                decide.
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // BACKLOG, BRIEFING, READY, RUNNING, BLOCKED, REWORK
  return (
    <section className="wb-section">
      <h3>Review</h3>

      {blockers.length > 0 && (
        <div className="wb-review-blockers">
          <p>Not ready for review:</p>
          <ul className="wb-list">
            {blockers.map((blocker, idx) => (
              <li key={idx}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="wb-btn-row">
        <button
          className="wb-btn primary"
          onClick={onRequestReview}
          disabled={blockers.length > 0}
        >
          Submit for review
        </button>
        {blockers.length > 0 && (
          <span className="wb-muted">
            Resolve blockers to submit
          </span>
        )}
      </div>
    </section>
  );
}
