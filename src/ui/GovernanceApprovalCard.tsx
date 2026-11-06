// A run waiting on SEA-Forge (P02): a consequential agent action escalated to the external authority.
// The action has NOT run. The operator's decision goes to SEA-Forge on the operator's behalf; the run
// resumes only if SEA-Forge records the approval.

export function GovernanceApprovalCard({
  approvalId,
  capability,
  busy,
  error,
  onDecide,
}: {
  readonly approvalId: string;
  readonly capability?: string | undefined;
  readonly busy: boolean;
  readonly error?: string | undefined;
  readonly onDecide: (resolution: "approved" | "rejected") => void;
}) {
  return (
    <section className="experts-review" aria-label="Action awaiting SEA-Forge approval">
      <h4>Action awaiting approval</h4>
      <p>
        {capability ? <>The agent asked to run <strong>{capability}</strong>. </> : <>The agent asked to run a consequential action. </>}
        SEA-Forge, the external authority, requires your approval. The action has not run, and the run is waiting.
      </p>
      <p className="settings-description">SEA-Forge approval <code>{approvalId}</code></p>
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={() => onDecide("rejected")}>
          Reject
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => onDecide("approved")}>
          {busy ? "Recording…" : "Approve"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** The SEA-Forge approval id and the escalated capability, from a `governance-approval` continuation. */
export function governanceApprovalOf(continuation: { readonly condition?: unknown; readonly payload?: unknown }): { approvalId: string; capability?: string } | undefined {
  const approvalId = (continuation.condition as { approvalId?: unknown } | null | undefined)?.approvalId;
  if (typeof approvalId !== "string") return undefined;
  for (const source of [continuation.payload, continuation.condition]) {
    const capability = (source as { capability?: unknown } | null | undefined)?.capability;
    if (typeof capability === "string") return { approvalId, capability };
  }
  return { approvalId };
}
