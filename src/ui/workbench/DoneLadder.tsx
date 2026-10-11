/**
 * DoneLadder: displays six-stage done taxonomy.
 * Shows task completion from initial start through operationalization.
 */

import type { DoneLevel } from "../../workbench/types";

export interface DoneLadderProps {
  readonly level: DoneLevel;
}

const STAGES = [
  "Finished",
  "Produced",
  "Tested",
  "Ready for review",
  "Accepted",
  "Operationalized",
] as const;

const STAGE_KEYS = [
  "finished",
  "produced",
  "tested",
  "ready-for-review",
  "accepted",
  "operationalized",
] as const;

export function DoneLadder({ level }: DoneLadderProps) {
  const reachedIndex =
    level === "not-started"
      ? -1
      : STAGE_KEYS.indexOf(level as (typeof STAGE_KEYS)[number]);

  return (
    <div className="wb-doneLadder">
      <ol
        aria-label="How done is this task"
        className="wb-doneLadder-stages"
      >
        {STAGES.map((stage, index) => {
          const isReached = index <= reachedIndex;
          const isHighest = index === reachedIndex;

          return (
            <li key={stage} className="wb-doneLadder-stage">
              <span className="wb-mark open">
                {isReached ? "✓" : "○"} {stage}
              </span>
              {isHighest && <span aria-current="step"></span>}
            </li>
          );
        })}
      </ol>
      <p className="wb-muted wb-doneLadder-explanation">
        Finished means the agent stopped. It does not mean the work was tested,
        reviewed or accepted.
      </p>
    </div>
  );
}
