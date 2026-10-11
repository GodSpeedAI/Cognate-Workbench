import React from "react";
import type { TaskContract, ContractField } from "../../workbench/types";
import { contractChips, contractMissing } from "../../workbench/contract";

export interface ContractBarProps {
  readonly contract: Partial<TaskContract>;
  readonly active?: ContractField;
  /** Shown for the Workspace chip instead of the raw id. */
  readonly workspaceLabel?: string;
  readonly onSelect: (field: ContractField | undefined) => void;
}

export const ContractBar: React.FC<ContractBarProps> = ({
  contract,
  active,
  workspaceLabel,
  onSelect,
}) => {
  const chips = contractChips(contract);
  const missing = contractMissing(contract);
  const missingFieldNames = missing
    .map((f) => f.toLowerCase())
    .join(", ");

  return (
    <div role="group" aria-label="Task contract" className="wb-contract-bar">
      <div className="wb-contract-chips">
        {chips.map((chip) => (
          <button
            key={chip.field}
            type="button"
            className={`wb-chip wb-chip-btn ${
              chip.state === "missing" ? "missing" : ""
            }`}
            aria-pressed={active === chip.field}
            onClick={() => {
              if (active === chip.field) {
                onSelect(undefined);
              } else {
                onSelect(chip.field);
              }
            }}
          >
            <div className="wb-chip-label">{chip.label}</div>
            <div className="wb-chip-value">{chip.field === "context" && workspaceLabel && chip.state === "set" ? workspaceLabel : chip.value}</div>
          </button>
        ))}
      </div>
      <div role="status" className="wb-contract-status">
        {missing.length > 0
          ? `Missing: ${missingFieldNames}. A task cannot be marked ready until these are set.`
          : "Contract complete."}
      </div>
    </div>
  );
};
