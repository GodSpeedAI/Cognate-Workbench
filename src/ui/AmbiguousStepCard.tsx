// Operator reconciliation card for an interrupted agent capability call (`ambiguous-invocation`).
// The step was NOT repeated after the restart; only the operator can record what actually happened.
import { useState } from "react";

export function AmbiguousStepCard({
  capability,
  busy,
  error,
  onReconcile,
}: {
  readonly capability: string;
  readonly busy: boolean;
  readonly error?: string | undefined;
  readonly onReconcile: (outcome: "succeeded" | "failed", reason: string) => void;
}) {
  const [outcome, setOutcome] = useState<"succeeded" | "failed">("failed");
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  return (
    <section className="experts-review" aria-label="Interrupted step needs reconciliation">
      <h4>Interrupted step needs reconciliation</h4>
      <p>
        The step <strong>{capability}</strong> was interrupted by a restart. Its outcome is unknown, it was NOT repeated, and the run is
        waiting. Only the operator can record what actually happened.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onReconcile(outcome, trimmed);
        }}
      >
        <label>
          Observed outcome
          <select value={outcome} onChange={(event) => setOutcome(event.currentTarget.value as "succeeded" | "failed")}>
            <option value="failed">Step did not complete</option>
            <option value="succeeded">Step completed</option>
          </select>
        </label>
        <label>
          What did you observe?
          <textarea required rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.currentTarget.value)} />
        </label>
        <button type="submit" disabled={busy || !trimmed}>
          {busy ? "Recording…" : "Record reconciliation"}
        </button>
        {error && <span role="alert"> {error}</span>}
      </form>
    </section>
  );
}
