// Capability List: shows the capability catalog with lifecycle steppers and conflict detection.
// Helps a developer understand what capabilities exist, their implementations, and advance them through the lifecycle.
import React from "react";
import type { CapabilityContractDef, CapabilityState, ImplementationBinding } from "../../workbench/types";
import { CAPABILITY_LIFECYCLE } from "../../workbench/types";
import { nextLifecycle, canInvoke, isTrusted } from "../../workbench/skillOs";
import type { Conflict } from "../../workbench/skillOs";

export interface CapabilityRecord {
  readonly def: CapabilityContractDef;
  readonly implementations: readonly {
    readonly binding: ImplementationBinding;
    readonly state: CapabilityState;
  }[];
  readonly active?: string;
}

export interface CapabilityListProps {
  readonly capabilities: readonly CapabilityRecord[];
  readonly conflicts: readonly Conflict[];
  readonly canGrant: boolean;
  readonly onAdvance: (capabilityId: string, implementationId: string, to: CapabilityState) => void;
  readonly onSeed: () => void;
}

export const CapabilityList: React.FC<CapabilityListProps> = ({
  capabilities,
  conflicts,
  canGrant,
  onAdvance,
  onSeed,
}) => {
  if (capabilities.length === 0) {
    return (
      <div className="wb-capability-list wb-root">
        <div className="wb-section">
          <div className="wb-empty">
            <strong>The capability catalog is empty.</strong> Capabilities are stable contracts; implementations and executors can change without changing them.
          </div>
          <button className="wb-btn primary" onClick={onSeed} style={{ marginTop: "16px" }}>
            Load the starter catalog
          </button>
        </div>
      </div>
    );
  }

  // Group capabilities by category
  const groupedCaps = new Map<string, CapabilityRecord[]>();
  for (const cap of capabilities) {
    if (!groupedCaps.has(cap.def.category)) {
      groupedCaps.get(cap.def.category) || groupedCaps.set(cap.def.category, []);
    }
    groupedCaps.get(cap.def.category)!.push(cap);
  }

  const categories = Array.from(groupedCaps.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  const authorityLevelLabel = (level: string): string =>
    level.charAt(0).toUpperCase() + level.slice(1).toLowerCase();

  const kindChipClass = (kind: string): string => {
    return kind === "llm" ? "warn" : "ok";
  };

  const lifecycleStatusText = (state: CapabilityState): string => {
    if (!canInvoke(state)) {
      return "Not invokable yet";
    }
    if (isTrusted(state)) {
      return "Verified";
    }
    return "Invokable, not yet trusted";
  };

  return (
    <div className="wb-capability-list wb-root">
      {/* Conflicts banner */}
      {conflicts.length > 0 && (
        <div className="wb-section" role="alert">
          <div
            className="wb-consequential"
            style={{ backgroundColor: "var(--cg-surface-sunken)" }}
          >
            <strong>Overlapping decision surfaces:</strong>
            <ul style={{ marginTop: "8px", marginBottom: "0", listStyle: "none", padding: "0" }}>
              {conflicts.map((conflict) => (
                <li key={conflict.surface} style={{ marginBottom: "4px" }}>
                  <strong>{conflict.surface}:</strong> {conflict.capabilities.join(", ")}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Note about lifecycle */}
      <div className="wb-section">
        <div className="wb-hint">
          Built is not installed. Installed is not enabled. Enabled is not verified.
        </div>
      </div>

      {/* Categories and capabilities */}
      {categories.map(([category, caps]) => (
        <div key={category} className="wb-section">
          <h3>{category}</h3>
          {caps.map((cap) => (
            <div key={cap.def.id} className="wb-capability-item">
              {/* Header: name, purpose, authority chips */}
              <div className="wb-capability-header">
                <div className="wb-capability-title">
                  {cap.def.id.replace("capability.", "").replace(/-/g, " ")}
                </div>
                <div className="wb-capability-purpose">{cap.def.purpose}</div>
                <div className="wb-capability-authorities">
                  {cap.def.authority.map((auth) => (
                    <span key={auth} className="wb-chip ok" style={{ fontSize: "10px" }}>
                      {authorityLevelLabel(auth)}
                    </span>
                  ))}
                </div>
              </div>

              {/* Implementations */}
              <div className="wb-capability-implementations">
                {cap.implementations.map((impl) => (
                  <div
                    key={impl.binding.implementationId}
                    className="wb-implementation-item"
                  >
                    {/* Provider and impl id */}
                    <div className="wb-implementation-header">
                      <span className="wb-implementation-provider">
                        {impl.binding.provider}
                      </span>
                      <span className="wb-mono">{impl.binding.implementationId}</span>
                      <span className={`wb-chip ${kindChipClass(impl.binding.executorKind)}`}>
                        {impl.binding.executorKind}
                      </span>
                    </div>

                    {/* Lifecycle stepper */}
                    <ol
                      aria-label={`Lifecycle of ${impl.binding.implementationId}`}
                      className="wb-lifecycle-stepper"
                    >
                      {CAPABILITY_LIFECYCLE.map((stage, idx) => {
                        const stageIdx = CAPABILITY_LIFECYCLE.indexOf(impl.state);
                        const isComplete = idx < stageIdx;
                        const isCurrent = idx === stageIdx;
                        return (
                          <li
                            key={stage}
                            className={`wb-lifecycle-step ${isComplete ? "complete" : ""}`}
                            aria-current={isCurrent ? "step" : undefined}
                          >
                            {isComplete && <span className="wb-mark pass">✓</span>}
                            <span className="wb-lifecycle-label">
                              {stage.toLowerCase().replace(/_/g, " ")}
                            </span>
                          </li>
                        );
                      })}
                    </ol>

                    {/* Status and advance button */}
                    <div className="wb-implementation-status">
                      <div className="wb-muted">
                        {lifecycleStatusText(impl.state)}
                      </div>

                      {nextLifecycle(impl.state) && (
                        <button
                          className="wb-btn"
                          onClick={() => {
                            const next = nextLifecycle(impl.state);
                            if (next) {
                              onAdvance(
                                cap.def.id,
                                impl.binding.implementationId,
                                next
                              );
                            }
                          }}
                          disabled={
                            !canGrant &&
                            (nextLifecycle(impl.state) === "REVIEWED" ||
                              nextLifecycle(impl.state) === "INSTALLED" ||
                              nextLifecycle(impl.state) === "AUTHORITY_GRANTED")
                          }
                        >
                          Advance to{" "}
                          {(nextLifecycle(impl.state) ?? "").toLowerCase().replace(/_/g, " ")}
                        </button>
                      )}

                      {!canGrant &&
                        (nextLifecycle(impl.state) === "REVIEWED" ||
                          nextLifecycle(impl.state) === "INSTALLED" ||
                          nextLifecycle(impl.state) === "AUTHORITY_GRANTED") && (
                          <div className="wb-muted" style={{ fontSize: "12px", marginTop: "4px" }}>
                            Only a person can grant this step.
                          </div>
                        )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
