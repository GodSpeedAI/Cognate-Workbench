// Worker return contract: changed, tested, evidence, remaining work and readiness declaration.
// Completed by the worker agent before review submission; edited by reviewers.

import { useState } from "react";
import type { WorkerReturn } from "../../workbench/types.ts";

interface WorkerReturnFormProps {
  readonly initial: WorkerReturn;
  readonly disabled?: boolean;
  readonly onSubmit: (r: WorkerReturn) => void;
}

export function WorkerReturnForm({
  initial,
  disabled,
  onSubmit,
}: WorkerReturnFormProps) {
  const [changed, setChanged] = useState(initial.changed.join("\n"));
  const [tested, setTested] = useState(initial.tested.join("\n"));
  const [evidence, setEvidence] = useState(initial.evidence.join("\n"));
  const [remaining, setRemaining] = useState(initial.remaining.join("\n"));
  const [risks, setRisks] = useState(initial.risks.join("\n"));
  const [readyForReview, setReadyForReview] = useState(
    initial.readyForReview
  );

  const handleSubmit = () => {
    const result: WorkerReturn = {
      changed: changed
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      tested: tested
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      evidence: evidence
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      remaining: remaining
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      risks: risks
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      readyForReview,
    };
    onSubmit(result);
  };

  return (
    <section className="wb-section">
      <h3>Return contract</h3>
      <p className="wb-muted">
        changed, tested, evidence, remaining
      </p>
      <p className="wb-muted" style={{ fontSize: "12px", marginBottom: "12px" }}>
        Prefilled from the session trace. Edit anything that is wrong.
      </p>

      <div className="wb-worker-return-form">
        <div className="wb-field">
          <label htmlFor="changed-files">Changed files</label>
          <textarea
            id="changed-files"
            value={changed}
            onChange={(e) => setChanged(e.currentTarget.value)}
            disabled={disabled}
            placeholder="One file per line"
          />
        </div>

        <div className="wb-field">
          <label htmlFor="tested-commands">Tested</label>
          <textarea
            id="tested-commands"
            value={tested}
            onChange={(e) => setTested(e.currentTarget.value)}
            disabled={disabled}
            placeholder="Commands or suites run, one per line"
          />
        </div>

        <div className="wb-field">
          <label htmlFor="evidence-ids">Evidence ids</label>
          <textarea
            id="evidence-ids"
            value={evidence}
            onChange={(e) => setEvidence(e.currentTarget.value)}
            disabled={disabled}
            placeholder="One id per line"
          />
        </div>

        <div className="wb-field">
          <label htmlFor="remaining-work">Remaining work</label>
          <textarea
            id="remaining-work"
            value={remaining}
            onChange={(e) => setRemaining(e.currentTarget.value)}
            disabled={disabled}
            placeholder="One item per line"
          />
        </div>

        <div className="wb-field">
          <label htmlFor="risks">Risks</label>
          <textarea
            id="risks"
            value={risks}
            onChange={(e) => setRisks(e.currentTarget.value)}
            disabled={disabled}
            placeholder="One risk per line"
          />
        </div>

        <div className="wb-field">
          <label>
            <input
              type="checkbox"
              checked={readyForReview}
              onChange={(e) => setReadyForReview(e.currentTarget.checked)}
              disabled={disabled}
            />
            Ready for review
          </label>
        </div>

        <div className="wb-btn-row">
          <button
            className="wb-btn ghost"
            onClick={handleSubmit}
            disabled={disabled}
          >
            Save return contract
          </button>
          {disabled && (
            <span className="wb-muted">Cannot edit while disabled</span>
          )}
        </div>
      </div>
    </section>
  );
}
