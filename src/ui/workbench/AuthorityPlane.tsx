// Authority Plane: shows what the task may do (grants and protected evidence).
// Helps a developer understand permissions at a glance and elevate protected paths.
import React from "react";
import type { AuthorityRow } from "../../workbench/authority";
import type { BlockedRecord } from "../../workbench/state";

export interface AuthorityPlaneProps {
  readonly rows: readonly AuthorityRow[];
  readonly blocked: readonly BlockedRecord[];
  readonly elevated: readonly string[];
  readonly canElevate: boolean;
  readonly onElevate: (path: string) => void;
}

export const AuthorityPlane: React.FC<AuthorityPlaneProps> = ({
  rows,
  blocked,
  elevated,
  canElevate,
  onElevate,
}) => {
  // Group rows by group
  const groupedRows = new Map<string, AuthorityRow[]>();
  for (const row of rows) {
    if (!groupedRows.has(row.group)) {
      groupedRows.set(row.group, []);
    }
    groupedRows.get(row.group)!.push(row);
  }

  // Protected evidence is rows with group === "Protected evidence"
  const protectedRows = groupedRows.get("Protected evidence") ?? [];
  const otherGroups = Array.from(groupedRows.entries()).filter(
    ([group]) => group !== "Protected evidence"
  );

  const grantChipClass = (grant: string): string => {
    switch (grant) {
      case "yes":
        return "ok";
      case "approval":
        return "warn";
      case "no":
        return "bad";
      case "immutable":
        return "live";
      default:
        return "";
    }
  };

  const grantLabel = (grant: string): string => {
    switch (grant) {
      case "yes":
        return "yes";
      case "approval":
        return "ask first";
      case "no":
        return "no";
      case "immutable":
        return "immutable";
      default:
        return grant;
    }
  };

  const [elevateInput, setElevateInput] = React.useState("");

  return (
    <div className="wb-authority-plane wb-root">
      <div className="wb-section">
        <div className="wb-section-head">
          <div>
            <h2>Authority</h2>
            <div className="wb-hint">What this task may do. Nothing is allowed by default.</div>
          </div>
        </div>

        {/* Render non-protected groups */}
        {otherGroups.map(([group, groupRows]) => (
          <div key={group} className="wb-authority-group">
            <h4 className="wb-authority-group-title">{group}</h4>
            <ul className="wb-list">
              {groupRows.map((row, idx) => (
                <li key={`${group}-${idx}`} className="wb-authority-row">
                  <div className="wb-authority-label">{row.label}</div>
                  <span className={`wb-chip ${grantChipClass(row.grant)}`}>
                    {grantLabel(row.grant)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Protected evidence section */}
        <div className="wb-section">
          {protectedRows.length > 0 ? (
            <div className="wb-authority-group">
              <h4 className="wb-authority-group-title">Protected evidence</h4>
              <ul className="wb-list">
                {protectedRows.map((row, idx) => (
                  <li key={`protected-${idx}`} className="wb-authority-row">
                    <div className="wb-authority-label">{row.label}</div>
                    <span className={`wb-chip ${grantChipClass(row.grant)}`}>
                      {grantLabel(row.grant)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="wb-empty">
              <strong>No protected evidence.</strong> Mark source data and tests as protected in the Authority field of the contract.
            </div>
          )}
        </div>

        {/* Blocked writes */}
        {blocked.length > 0 && (
          <div className="wb-section">
            <h4 className="wb-authority-group-title">Blocked writes</h4>
            <ul className="wb-list">
              {blocked.map((record) => (
                <li key={record.id} className="wb-blocked-row">
                  <div className="wb-graphite">
                    {record.tool} {record.path}
                    {record.pattern ? ` (pattern ${record.pattern})` : ""}
                  </div>
                  <div className="wb-muted wb-blocked-reason">{record.reason}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {blocked.length === 0 && (
          <div className="wb-section">
            <div role="status" className="wb-muted">
              Nothing has been blocked.
            </div>
          </div>
        )}

        {/* Elevated paths */}
        {elevated.length > 0 && (
          <div className="wb-section">
            <h4 className="wb-authority-group-title">Elevated paths</h4>
            <ul className="wb-list">
              {elevated.map((path) => (
                <li key={path} className="wb-authority-row">
                  <div className="wb-mono">{path}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Elevation form */}
        {canElevate && (
          <div className="wb-section">
            <fieldset className="wb-authority-form">
              <legend className="wb-authority-form-legend">Elevate a path</legend>
              <div className="wb-field-row">
                <div className="wb-field">
                  <label htmlFor="elevate-path">Exact path</label>
                  <input
                    id="elevate-path"
                    type="text"
                    value={elevateInput}
                    onChange={(e) => setElevateInput(e.currentTarget.value)}
                    placeholder="e.g., src/secrets.json"
                  />
                </div>
                <button
                  className="wb-btn danger"
                  onClick={() => {
                    if (elevateInput.trim()) {
                      onElevate(elevateInput.trim());
                      setElevateInput("");
                    }
                  }}
                  style={{ alignSelf: "flex-end" }}
                >
                  Elevate this path
                </button>
              </div>
              <div className="wb-muted" style={{ fontSize: "12px", marginTop: "8px" }}>
                Elevation lets the agent change one protected file, still with approval. It does not unprotect patterns.
              </div>
            </fieldset>
          </div>
        )}

        {!canElevate && (
          <div className="wb-section">
            <div className="wb-muted" style={{ fontSize: "12px" }}>
              Only a person can elevate a path.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
