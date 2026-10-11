/**
 * RuntimeStrip: compact status line showing runtime state, task progress, and resource usage.
 * Displays in flex-wrap for responsive layouts.
 */

export interface RuntimeStripProps {
  readonly state: "idle" | "running" | "waiting" | "review";
  readonly taskTitle?: string;
  readonly elapsedSeconds?: number;
  readonly steps?: number;
  readonly tokens?: number;
  readonly costUsd?: number;
  readonly provenance?: string;
  readonly budget?: "ok" | "warn" | "exceeded";
  readonly concurrency?: number;
  readonly approvalsPending?: number;
}

function formatElapsed(seconds: number | undefined): string {
  if (seconds === undefined) return "unknown";
  return `${seconds}s`;
}

function formatTokens(tokens: number | undefined): string {
  if (tokens === undefined) return "tok n/a";
  if (tokens >= 1000) {
    const k = (tokens / 1000).toFixed(1);
    return `${k}k tok`;
  }
  return `${tokens} tok`;
}

function formatCost(costUsd: number | undefined): string {
  if (costUsd === undefined) return "cost n/a";
  return `$${costUsd.toFixed(2)}`;
}

function getStateChipClass(state: string): string {
  if (state === "running") return "live";
  return "";
}

function getStateText(state: string): string {
  switch (state) {
    case "running":
      return "running";
    case "waiting":
      return "waiting on you";
    case "review":
      return "in review";
    default:
      return "idle";
  }
}

function getBudgetChipClass(budget: string | undefined): string {
  if (!budget) return "";
  if (budget === "ok") return "ok";
  if (budget === "exceeded") return "bad";
  return "warn";
}

function getBudgetText(budget: string | undefined): string {
  if (!budget) return "";
  if (budget === "ok") return "budget ok";
  if (budget === "exceeded") return "budget exceeded";
  return "budget near limit";
}

export function RuntimeStrip({
  state,
  taskTitle,
  elapsedSeconds,
  steps,
  tokens,
  costUsd,
  provenance,
  budget,
  concurrency,
  approvalsPending,
}: RuntimeStripProps) {
  return (
    <div
      className="wb-runtimeStrip"
      role="status"
      aria-label="Runtime"
    >
      <span className={`wb-chip ${getStateChipClass(state)}`}>
        {getStateText(state)}
      </span>

      {taskTitle && (
        <span className="wb-runtimeStrip-taskTitle">{taskTitle}</span>
      )}

      {elapsedSeconds !== undefined && (
        <span className="wb-runtimeStrip-field">
          {formatElapsed(elapsedSeconds)}
        </span>
      )}

      {steps !== undefined && (
        <span className="wb-runtimeStrip-field">{steps} steps</span>
      )}

      {tokens !== undefined && (
        <span className="wb-runtimeStrip-field">{formatTokens(tokens)}</span>
      )}

      {costUsd !== undefined && (
        <span className="wb-runtimeStrip-field">{formatCost(costUsd)}</span>
      )}

      {provenance && (
        <span className="wb-runtimeStrip-provenance">{provenance}</span>
      )}

      {budget && (
        <span className={`wb-chip ${getBudgetChipClass(budget)}`}>
          {getBudgetText(budget)}
        </span>
      )}

      {concurrency !== undefined && (
        <span className="wb-runtimeStrip-field">peak {concurrency}x</span>
      )}

      {approvalsPending !== undefined && approvalsPending > 0 && (
        <span className="wb-chip warn">
          approvals {approvalsPending}
        </span>
      )}
    </div>
  );
}
