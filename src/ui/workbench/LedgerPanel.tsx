// Acceptance criteria table and evidence ledger: what must stay true and what is proven.
// Serves the Review gate (V-004 acceptance evidence review).

import { useState } from "react";
import type { EvidenceKind } from "../../workbench/types.ts";
import type { LedgerRow, LedgerGroup } from "../../workbench/ledger.ts";

interface LedgerPanelProps {
  readonly rows: readonly LedgerRow[];
  readonly groups: readonly LedgerGroup[];
  readonly locked?: boolean;
  readonly onRecord: (e: {
    readonly kind: EvidenceKind;
    readonly status: "pass" | "fail" | "pending";
    readonly summary: string;
    readonly criterionId?: string;
  }) => void;
}

const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  "test",
  "independent-check",
  "journey",
  "audit",
  "integrity",
  "domain",
  "implementation",
  "quality",
  "runtime",
];

export function LedgerPanel({
  rows,
  groups,
  locked,
  onRecord,
}: LedgerPanelProps) {
  const [formKind, setFormKind] = useState<EvidenceKind>("test");
  const [formStatus, setFormStatus] = useState<"pass" | "fail" | "pending">(
    "pending"
  );
  const [formCriterion, setFormCriterion] = useState<string>("");
  const [formSummary, setFormSummary] = useState("");

  const handleRecord = () => {
    if (!formSummary.trim()) return;
    onRecord({
      kind: formKind,
      status: formStatus,
      summary: formSummary,
      criterionId: formCriterion || undefined,
    });
    setFormSummary("");
  };

  const canRecord = formSummary.trim().length > 0;

  return (
    <div className="wb-ledger-panel">
      <section className="wb-section">
        <h3>Acceptance and evidence</h3>

        {rows.length === 0 ? (
          <p className="wb-empty">
            <strong>No acceptance criteria yet.</strong> Add them in the
            Acceptance field of the contract; without them nothing can be
            proven.
          </p>
        ) : (
          <table className="wb-ledger-table">
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">Kind</th>
                <th scope="col">Requirement</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.criterionId}>
                  <td>{row.description}</td>
                  <td>
                    <span className="wb-chip">{row.kind}</span>
                  </td>
                  <td>{row.required ? "required" : "optional"}</td>
                  <td>
                    <span
                      className={`wb-mark ${row.state}`}
                      aria-label={row.state}
                    >
                      {row.state === "closed" && "✓"}
                      {row.state === "failed" && "✗"}
                      {row.state === "open" && "○"}
                      <span className="wb-mark-text">
                        {row.state === "closed" && "closed"}
                        {row.state === "failed" && "failed"}
                        {row.state === "open" && "open"}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="wb-section">
        <h4>Evidence ledger</h4>

        {groups.length === 0 ? (
          <p className="wb-empty">No evidence recorded yet.</p>
        ) : (
          <div className="wb-ledger-groups">
            {groups.map((group) => (
              <div key={group.group} className="wb-ledger-group">
                <h4>{group.group}</h4>
                <ul className="wb-list">
                  {group.marks.map((mark) => (
                    <li key={mark.entryId}>
                      <span
                        className={`wb-mark ${
                          mark.mark === "✓"
                            ? "pass"
                            : mark.mark === "✗"
                              ? "fail"
                              : "open"
                        }`}
                        aria-label={
                          mark.mark === "✓"
                            ? "pass"
                            : mark.mark === "✗"
                              ? "fail"
                              : "pending"
                        }
                      >
                        {mark.mark}
                      </span>
                      {mark.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {!locked && (
        <section className="wb-section">
          <fieldset className="wb-ledger-form">
            <legend>Record evidence</legend>

            <div className="wb-field">
              <label htmlFor="evidence-kind">Kind</label>
              <select
                id="evidence-kind"
                value={formKind}
                onChange={(e) => setFormKind(e.currentTarget.value as EvidenceKind)}
              >
                {EVIDENCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <span className="wb-muted">
                Human acceptance is recorded by the reviewer, not here.
              </span>
            </div>

            <div className="wb-field">
              <label htmlFor="evidence-status">Status</label>
              <select
                id="evidence-status"
                value={formStatus}
                onChange={(e) =>
                  setFormStatus(e.currentTarget.value as "pass" | "fail" | "pending")
                }
              >
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            <div className="wb-field">
              <label htmlFor="evidence-criterion">Criterion (optional)</label>
              <select
                id="evidence-criterion"
                value={formCriterion}
                onChange={(e) => setFormCriterion(e.currentTarget.value)}
              >
                <option value="">None</option>
                {rows.map((row) => (
                  <option key={row.criterionId} value={row.criterionId}>
                    {row.description}
                  </option>
                ))}
              </select>
            </div>

            <div className="wb-field">
              <label htmlFor="evidence-summary">Summary</label>
              <textarea
                id="evidence-summary"
                value={formSummary}
                onChange={(e) => setFormSummary(e.currentTarget.value)}
                placeholder="Describe the evidence"
              />
            </div>

            <div className="wb-btn-row">
              <button
                className="wb-btn ghost"
                onClick={handleRecord}
                disabled={!canRecord}
              >
                Record
              </button>
              {!canRecord && (
                <span className="wb-muted">Enter a summary</span>
              )}
            </div>
          </fieldset>
        </section>
      )}
    </div>
  );
}
