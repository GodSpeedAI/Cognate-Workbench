// Governed settlement (P03): what SEA-Forge settled for this session's agent runs, on the evidence
// RealityTrace recorded when it ran the workspace's declared proof. Workbench only reports it.
import { useEffect, useState } from "react";

export interface SettlementOperation {
  readonly runId: string;
  readonly operationId: string;
  readonly capability: string;
  readonly status: "settled" | "rejected" | "unsettled" | "refused" | "not-attempted";
  readonly final: boolean;
  readonly exitCode?: number | null;
  readonly targetDigest?: string;
  readonly reason?: string;
}

const LABEL: Record<SettlementOperation["status"], string> = {
  settled: "Settled",
  rejected: "Rejected",
  unsettled: "Unsettled",
  refused: "Refused by SEA-Forge",
  "not-attempted": "Not settled",
};

export function SettlementCard({ operations }: { readonly operations: readonly SettlementOperation[] }) {
  if (operations.length === 0) return null;
  return (
    <section className="experts-review" aria-label="Settlement">
      <h4>Settlement</h4>
      <ul>
        {operations.map((op) => (
          <li key={op.operationId} data-status={op.status}>
            <strong>{LABEL[op.status]}</strong> · {op.capability}
            {op.exitCode !== undefined && op.exitCode !== null && <> · proof exited {op.exitCode}</>}
            {op.targetDigest && <> · verified <code title={op.targetDigest}>{op.targetDigest.slice(0, 19)}…</code></>}
            {op.reason && <p className="settings-description">{op.reason}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Polls `settlement.status` for a session while it is open. */
export function useSessionSettlement(
  load: (sessionId: string) => Promise<{ readonly active: boolean; readonly operations: readonly SettlementOperation[] }>,
  sessionId: string | undefined,
  pollMs = 3000,
): readonly SettlementOperation[] {
  const [operations, setOperations] = useState<readonly SettlementOperation[]>([]);
  useEffect(() => {
    setOperations([]);
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const status = await load(sessionId);
        if (cancelled) return;
        setOperations(status.operations);
        if (!status.active) return;
      } catch {
        if (cancelled) return;
      }
      timer = setTimeout(() => void tick(), pollMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load, sessionId, pollMs]);
  return operations;
}
