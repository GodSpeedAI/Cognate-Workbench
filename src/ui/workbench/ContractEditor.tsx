import React, { useState, useMemo } from "react";
import type {
  TaskContract,
  ContractField,
  AuthorityScopes,
  Grant,
  ExecutorBinding,
  ExecutorRole,
  Invariant,
  InvariantKind,
  AcceptanceCriterion,
  AcceptanceKind,
} from "../../workbench/types";
import { defaultAuthority } from "../../workbench/contract";
import { MenuSelect } from "../shell/MenuSelect.tsx";

/** The grant triple every authority scope offers (the S1 conversion's shared option set). */
const GRANT_OPTIONS = [
  { value: "yes", label: "yes" },
  { value: "approval", label: "approval" },
  { value: "no", label: "no" },
] as const;

/** One labeled authority-scope field: the S1 shape (label + grant MenuSelect) nine times over. */
function GrantField({
  id,
  label,
  value,
  locked,
  onPick,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: Grant;
  readonly locked: boolean;
  readonly onPick: (grant: Grant) => void;
}) {
  return (
    <div className="wb-field">
      <label htmlFor={id}>{label}</label>
      <MenuSelect
        id={id}
        ariaLabel={label}
        value={value}
        options={GRANT_OPTIONS}
        onPick={onPick}
        disabled={locked}
        variant="field"
        placement="down"
      />
    </div>
  );
}

interface Capability {
  readonly id: string;
  readonly purpose: string;
  readonly category: string;
}

export interface ContractEditorProps {
  readonly field: ContractField;
  readonly contract: Partial<TaskContract>;
  readonly capabilities: readonly Capability[];
  readonly locked?: boolean;
  readonly onSave: (patch: Partial<TaskContract>) => void;
  readonly onClose: () => void;
}

export const ContractEditor: React.FC<ContractEditorProps> = ({
  field,
  contract,
  capabilities,
  locked = false,
  onSave,
  onClose,
}) => {
  // Local draft state
  const [draftContext, setDraftContext] = useState(() => ({
    workspaceId: contract.context?.workspaceId ?? "",
    files: (contract.context?.files ?? []).join("\n"),
    branch: contract.context?.branch ?? "",
  }));

  const [draftGoal, setDraftGoal] = useState(() => ({
    outcome: contract.goal?.outcome ?? "",
    deliverable: contract.goal?.deliverable ?? "",
    nonGoals: (contract.goal?.nonGoals ?? []).join("\n"),
  }));

  const [draftSkills, setDraftSkills] = useState(
    () => new Set(contract.skills ?? [])
  );

  const [draftAuthority, setDraftAuthority] = useState<AuthorityScopes>(
    () => contract.authority ?? defaultAuthority()
  );

  const [draftExecutors, setDraftExecutors] = useState<ExecutorBinding[]>(
    () => [...(contract.executors ?? [])]
  );

  const [draftBudget, setDraftBudget] = useState(() => ({
    maxMinutes: contract.budget?.maxMs ? contract.budget.maxMs / 60000 : "",
    maxTokens: contract.budget?.maxTokens ?? "",
    maxCostUsd: contract.budget?.maxCostUsd ?? "",
    maxConcurrency: contract.budget?.maxConcurrency ?? "",
  }));

  const [draftInvariants, setDraftInvariants] = useState<Invariant[]>(
    () => [...(contract.invariants ?? [])]
  );

  const [draftAcceptance, setDraftAcceptance] = useState<
    AcceptanceCriterion[]
  >(() => [...(contract.acceptance ?? [])]);

  // Validation
  const isGoalBlank = !draftGoal.outcome.trim();
  const hasBlankInvariant =
    draftInvariants.some((inv) => !inv.statement.trim()) ||
    draftInvariants.length === 0;
  const hasBlankAcceptance =
    draftAcceptance.some((acc) => !acc.description.trim()) ||
    draftAcceptance.length === 0;

  const isInvalid =
    field === "goal"
      ? isGoalBlank
      : field === "invariants"
        ? hasBlankInvariant
        : field === "acceptance"
          ? hasBlankAcceptance
          : false;

  const disabledReason = isGoalBlank
    ? "Goal outcome is required"
    : hasBlankInvariant
      ? "All invariants must have a statement"
      : hasBlankAcceptance
        ? "All acceptance criteria must have a description"
        : "";

  // Save handlers
  const handleSave = () => {
    if (isInvalid) return;

    const patch: Record<string, unknown> = {};

    if (field === "context") {
      patch.context = {
        workspaceId: draftContext.workspaceId || undefined,
        files: draftContext.files
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
        branch: draftContext.branch || undefined,
      };
    } else if (field === "goal") {
      patch.goal = {
        outcome: draftGoal.outcome,
        deliverable: draftGoal.deliverable || undefined,
        nonGoals: draftGoal.nonGoals
          .split("\n")
          .map((g) => g.trim())
          .filter(Boolean),
      };
    } else if (field === "skills") {
      patch.skills = Array.from(draftSkills);
    } else if (field === "authority") {
      patch.authority = draftAuthority;
    } else if (field === "executors") {
      patch.executors = draftExecutors;
    } else if (field === "budget") {
      const budgetPatch: { maxMs?: number; maxTokens?: number; maxCostUsd?: number; maxConcurrency?: number } = {};
      if (draftBudget.maxMinutes !== "") {
        budgetPatch.maxMs = Number(draftBudget.maxMinutes) * 60000;
      }
      if (draftBudget.maxTokens !== "") {
        budgetPatch.maxTokens = Number(draftBudget.maxTokens);
      }
      if (draftBudget.maxCostUsd !== "") {
        budgetPatch.maxCostUsd = Number(draftBudget.maxCostUsd);
      }
      if (draftBudget.maxConcurrency !== "") {
        budgetPatch.maxConcurrency = Number(draftBudget.maxConcurrency);
      }
      if (Object.keys(budgetPatch).length > 0) {
        patch.budget = budgetPatch;
      }
    } else if (field === "invariants") {
      patch.invariants = draftInvariants;
    } else if (field === "acceptance") {
      patch.acceptance = draftAcceptance;
    }

    onSave(patch as Partial<TaskContract>);
  };

  // Group capabilities by category
  const capsByCategory = useMemo(() => {
    const groups: Record<string, Capability[]> = {};
    capabilities.forEach((cap) => {
      if (!groups[cap.category]) {
        groups[cap.category] = [];
      }
      const group = groups[cap.category];
      if (group) {
        group.push(cap);
      }
    });
    return groups;
  }, [capabilities]);

  const fieldLabel = {
    context: "Context",
    goal: "Goal",
    skills: "Skills",
    authority: "Authority",
    executors: "Executors",
    budget: "Budget",
    invariants: "Invariants",
    acceptance: "Acceptance",
  }[field];

  return (
    <section className="wb-section wb-contract-editor" aria-label={`Edit ${fieldLabel}`}>
      <h3>{fieldLabel}</h3>

      {locked && (
        <div role="status" className="wb-contract-locked-notice">
          The contract cannot change while the task is running. Stop it first.
        </div>
      )}

      {field === "context" && (
        <div className="wb-contract-field-group">
          <div className="wb-field">
            <label htmlFor="context-workspace">Workspace ID</label>
            <input
              id="context-workspace"
              type="text"
              value={draftContext.workspaceId}
              onChange={(e) =>
                setDraftContext({ ...draftContext, workspaceId: e.target.value })
              }
              disabled={locked}
              readOnly={true}
            />
          </div>
          <div className="wb-field">
            <label htmlFor="context-files">Files</label>
            <textarea
              id="context-files"
              value={draftContext.files}
              onChange={(e) =>
                setDraftContext({ ...draftContext, files: e.target.value })
              }
              disabled={locked}
              placeholder="One path per line"
            />
          </div>
          <div className="wb-field">
            <label htmlFor="context-branch">Branch</label>
            <input
              id="context-branch"
              type="text"
              value={draftContext.branch}
              onChange={(e) =>
                setDraftContext({ ...draftContext, branch: e.target.value })
              }
              disabled={locked}
            />
          </div>
        </div>
      )}

      {field === "goal" && (
        <div className="wb-contract-field-group">
          <div className="wb-field">
            <label htmlFor="goal-outcome">
              Outcome <span className="wb-required">*</span>
            </label>
            <textarea
              id="goal-outcome"
              value={draftGoal.outcome}
              onChange={(e) =>
                setDraftGoal({ ...draftGoal, outcome: e.target.value })
              }
              disabled={locked}
              placeholder="What is the desired outcome?"
            />
          </div>
          <div className="wb-field">
            <label htmlFor="goal-deliverable">Deliverable</label>
            <input
              id="goal-deliverable"
              type="text"
              value={draftGoal.deliverable}
              onChange={(e) =>
                setDraftGoal({ ...draftGoal, deliverable: e.target.value })
              }
              disabled={locked}
              placeholder="What artifact is produced?"
            />
          </div>
          <div className="wb-field">
            <label htmlFor="goal-nongοals">Non-Goals</label>
            <textarea
              id="goal-nongοals"
              value={draftGoal.nonGoals}
              onChange={(e) =>
                setDraftGoal({ ...draftGoal, nonGoals: e.target.value })
              }
              disabled={locked}
              placeholder="One per line"
            />
          </div>
        </div>
      )}

      {field === "skills" && (
        <div className="wb-contract-field-group">
          {Object.entries(capsByCategory).map(([category, caps]) => (
            <fieldset key={category}>
              <legend>{category}</legend>
              <div className="wb-skills-group">
                {caps.map((cap) => {
                  const capId = cap.id.replace(/^capability\./, "");
                  return (
                    <label key={cap.id} className="wb-skill-checkbox">
                      <input
                        type="checkbox"
                        checked={draftSkills.has(cap.id)}
                        onChange={(e) => {
                          const newSkills = new Set(draftSkills);
                          if (e.target.checked) {
                            newSkills.add(cap.id);
                          } else {
                            newSkills.delete(cap.id);
                          }
                          setDraftSkills(newSkills);
                        }}
                        disabled={locked}
                      />
                      <span className="wb-skill-id">{capId}</span>
                      <span className="wb-skill-purpose">{cap.purpose}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {field === "authority" && (
        <div className="wb-contract-field-group">
          <div className="wb-field-row">
            <GrantField
              id="auth-fs-read"
              label="Workspace read"
              value={draftAuthority.filesystem.read}
              locked={locked}
              onPick={(read) =>
                setDraftAuthority({ ...draftAuthority, filesystem: { ...draftAuthority.filesystem, read } })
              }
            />
            <GrantField
              id="auth-fs-write"
              label="Workspace write"
              value={draftAuthority.filesystem.write}
              locked={locked}
              onPick={(write) =>
                setDraftAuthority({ ...draftAuthority, filesystem: { ...draftAuthority.filesystem, write } })
              }
            />
            <GrantField
              id="auth-fs-outside"
              label="Outside workspace"
              value={draftAuthority.filesystem.outsideWorkspace}
              locked={locked}
              onPick={(outsideWorkspace) =>
                setDraftAuthority({
                  ...draftAuthority,
                  filesystem: { ...draftAuthority.filesystem, outsideWorkspace },
                })
              }
            />
          </div>

          <div className="wb-field-row">
            <GrantField
              id="auth-shell-run"
              label="Run shell commands"
              value={draftAuthority.shell.run}
              locked={locked}
              onPick={(run) =>
                setDraftAuthority({ ...draftAuthority, shell: { ...draftAuthority.shell, run } })
              }
            />
            <GrantField
              id="auth-shell-destructive"
              label="Destructive shell commands"
              value={draftAuthority.shell.destructive}
              locked={locked}
              onPick={(destructive) =>
                setDraftAuthority({ ...draftAuthority, shell: { ...draftAuthority.shell, destructive } })
              }
            />
          </div>

          <div className="wb-field-row">
            <GrantField
              id="auth-net-outbound"
              label="Outbound network"
              value={draftAuthority.network.outbound}
              locked={locked}
              onPick={(outbound) =>
                setDraftAuthority({ ...draftAuthority, network: { ...draftAuthority.network, outbound } })
              }
            />
          </div>

          <div className="wb-field-row">
            <GrantField
              id="auth-pkg-install"
              label="Install packages"
              value={draftAuthority.packages.install}
              locked={locked}
              onPick={(install) =>
                setDraftAuthority({ ...draftAuthority, packages: { ...draftAuthority.packages, install } })
              }
            />
          </div>

          <div className="wb-field-row">
            <GrantField
              id="auth-ext-install"
              label="Install plugin"
              value={draftAuthority.extensions.install}
              locked={locked}
              onPick={(install) =>
                setDraftAuthority({ ...draftAuthority, extensions: { ...draftAuthority.extensions, install } })
              }
            />
            <GrantField
              id="auth-ext-enable"
              label="Enable plugin"
              value={draftAuthority.extensions.enable}
              locked={locked}
              onPick={(enable) =>
                setDraftAuthority({ ...draftAuthority, extensions: { ...draftAuthority.extensions, enable } })
              }
            />
          </div>

          <div className="wb-field">
            <label htmlFor="auth-protected-paths">Protected paths</label>
            <textarea
              id="auth-protected-paths"
              value={draftAuthority.protectedPaths.join("\n")}
              onChange={(e) => {
                setDraftAuthority({
                  ...draftAuthority,
                  protectedPaths: e.target.value
                    .split("\n")
                    .map((p) => p.trim())
                    .filter(Boolean),
                });
              }}
              disabled={locked}
              placeholder="Patterns: dir/, file.csv, *.csv, tests/**. Protected paths are immutable unless a reviewer elevates an exact path."
            />
          </div>
        </div>
      )}

      {field === "executors" && (
        <div className="wb-contract-field-group">
          {draftExecutors.map((executor, idx) => (
            <div key={idx} className="wb-executor-row">
              <div className="wb-field-row">
                <div className="wb-field">
                  <label htmlFor={`exec-role-${idx}`}>Role</label>
                  <MenuSelect
                    id={`exec-role-${idx}`}
                    ariaLabel="Role"
                    value={executor.role}
                    options={[
                      { value: "primary", label: "primary" },
                      { value: "architect", label: "architect" },
                      { value: "worker", label: "worker" },
                      { value: "verifier", label: "verifier" },
                    ]}
                    onPick={(role) => {
                      const newExecutors = [...draftExecutors];
                      newExecutors[idx] = { ...executor, role };
                      setDraftExecutors(newExecutors);
                    }}
                    disabled={locked}
                    variant="field"
                    placement="down"
                  />
                </div>
                <div className="wb-field">
                  <label htmlFor={`exec-executor-${idx}`}>Executor</label>
                  <input
                    id={`exec-executor-${idx}`}
                    type="text"
                    value={executor.executor}
                    onChange={(e) => {
                      const newExecutors = [...draftExecutors];
                      newExecutors[idx] = {
                        ...executor,
                        executor: e.target.value,
                      };
                      setDraftExecutors(newExecutors);
                    }}
                    disabled={locked}
                    placeholder="e.g., model:deepseek-chat"
                  />
                </div>
                <div className="wb-field">
                  <label htmlFor={`exec-kind-${idx}`}>Kind</label>
                  <MenuSelect
                    id={`exec-kind-${idx}`}
                    ariaLabel="Kind"
                    value={executor.kind}
                    options={[
                      { value: "llm", label: "llm" },
                      { value: "deterministic", label: "deterministic" },
                    ]}
                    onPick={(kind) => {
                      const newExecutors = [...draftExecutors];
                      newExecutors[idx] = { ...executor, kind };
                      setDraftExecutors(newExecutors);
                    }}
                    disabled={locked}
                    variant="field"
                    placement="down"
                  />
                </div>
              </div>
              <div className="wb-field-row">
                <div className="wb-field">
                  <label htmlFor={`exec-billing-${idx}`}>Billing route (optional)</label>
                  <input
                    id={`exec-billing-${idx}`}
                    type="text"
                    value={executor.billingRoute ?? ""}
                    onChange={(e) => {
                      const newExecutors = [...draftExecutors];
                      newExecutors[idx] = {
                        ...executor,
                        billingRoute: e.target.value || undefined,
                      };
                      setDraftExecutors(newExecutors);
                    }}
                    disabled={locked}
                  />
                </div>
                <button
                  type="button"
                  className="wb-btn wb-executor-remove"
                  onClick={() => {
                    setDraftExecutors(draftExecutors.filter((_, i) => i !== idx));
                  }}
                  disabled={locked}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="wb-btn"
            onClick={() => {
              setDraftExecutors([
                ...draftExecutors,
                {
                  role: "primary",
                  executor: "",
                  kind: "llm",
                },
              ]);
            }}
            disabled={locked}
          >
            Add executor
          </button>
        </div>
      )}

      {field === "budget" && (
        <div className="wb-contract-field-group">
          <div className="wb-field-row">
            <div className="wb-field">
              <label htmlFor="budget-minutes">Max minutes</label>
              <input
                id="budget-minutes"
                type="number"
                value={draftBudget.maxMinutes}
                onChange={(e) =>
                  setDraftBudget({ ...draftBudget, maxMinutes: e.target.value })
                }
                disabled={locked}
              />
            </div>
            <div className="wb-field">
              <label htmlFor="budget-tokens">Max tokens</label>
              <input
                id="budget-tokens"
                type="number"
                value={draftBudget.maxTokens}
                onChange={(e) =>
                  setDraftBudget({ ...draftBudget, maxTokens: e.target.value })
                }
                disabled={locked}
              />
            </div>
            <div className="wb-field">
              <label htmlFor="budget-cost">Max cost USD</label>
              <input
                id="budget-cost"
                type="number"
                step="0.01"
                value={draftBudget.maxCostUsd}
                onChange={(e) =>
                  setDraftBudget({ ...draftBudget, maxCostUsd: e.target.value })
                }
                disabled={locked}
              />
            </div>
            <div className="wb-field">
              <label htmlFor="budget-concurrency">Max concurrency</label>
              <input
                id="budget-concurrency"
                type="number"
                value={draftBudget.maxConcurrency}
                onChange={(e) =>
                  setDraftBudget({
                    ...draftBudget,
                    maxConcurrency: e.target.value,
                  })
                }
                disabled={locked}
              />
            </div>
          </div>
        </div>
      )}

      {field === "invariants" && (
        <div className="wb-contract-field-group">
          {draftInvariants.map((invariant, idx) => (
            <div key={idx} className="wb-invariant-row">
              <div className="wb-field">
                <label htmlFor={`inv-kind-${idx}`}>Kind</label>
                <MenuSelect
                  id={`inv-kind-${idx}`}
                  ariaLabel="Kind"
                  value={invariant.kind}
                  options={[
                    { value: "domain", label: "domain" },
                    { value: "product", label: "product" },
                    { value: "design", label: "design" },
                    { value: "governance", label: "governance" },
                    { value: "workflow", label: "workflow" },
                  ]}
                  onPick={(kind) => {
                    const newInvariants = [...draftInvariants];
                    newInvariants[idx] = { ...invariant, kind };
                    setDraftInvariants(newInvariants);
                  }}
                  disabled={locked}
                  variant="field"
                  placement="down"
                />
              </div>
              <div className="wb-field">
                <label htmlFor={`inv-stmt-${idx}`}>Statement</label>
                <textarea
                  id={`inv-stmt-${idx}`}
                  value={invariant.statement}
                  onChange={(e) => {
                    const newInvariants = [...draftInvariants];
                    newInvariants[idx] = {
                      ...invariant,
                      statement: e.target.value,
                    };
                    setDraftInvariants(newInvariants);
                  }}
                  disabled={locked}
                />
              </div>
              <button
                type="button"
                className="wb-btn wb-invariant-remove"
                onClick={() => {
                  setDraftInvariants(draftInvariants.filter((_, i) => i !== idx));
                }}
                disabled={locked}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="wb-btn"
            onClick={() => {
              setDraftInvariants([
                ...draftInvariants,
                { id: `inv-${draftInvariants.length + 1}`, kind: "domain", statement: "" },
              ]);
            }}
            disabled={locked}
          >
            Add invariant
          </button>
        </div>
      )}

      {field === "acceptance" && (
        <div className="wb-contract-field-group">
          <div className="wb-hint">
            An independent check closes a criterion that passing tests alone cannot.
          </div>
          {draftAcceptance.map((criterion, idx) => (
            <div key={idx} className="wb-acceptance-row">
              <div className="wb-field">
                <label htmlFor={`acc-kind-${idx}`}>Kind</label>
                <MenuSelect
                  id={`acc-kind-${idx}`}
                  ariaLabel="Kind"
                  value={criterion.kind}
                  options={[
                    { value: "test", label: "test" },
                    { value: "independent-check", label: "independent-check" },
                    { value: "journey", label: "journey" },
                    { value: "audit", label: "audit" },
                    { value: "integrity", label: "integrity" },
                    { value: "human", label: "human" },
                  ]}
                  onPick={(kind) => {
                    const newAcceptance = [...draftAcceptance];
                    newAcceptance[idx] = { ...criterion, kind };
                    setDraftAcceptance(newAcceptance);
                  }}
                  disabled={locked}
                  variant="field"
                  placement="down"
                />
              </div>
              <div className="wb-field">
                <label htmlFor={`acc-desc-${idx}`}>Description</label>
                <input
                  id={`acc-desc-${idx}`}
                  type="text"
                  value={criterion.description}
                  onChange={(e) => {
                    const newAcceptance = [...draftAcceptance];
                    newAcceptance[idx] = {
                      ...criterion,
                      description: e.target.value,
                    };
                    setDraftAcceptance(newAcceptance);
                  }}
                  disabled={locked}
                />
              </div>
              <label className="wb-required-checkbox">
                <input
                  type="checkbox"
                  checked={criterion.required}
                  onChange={(e) => {
                    const newAcceptance = [...draftAcceptance];
                    newAcceptance[idx] = {
                      ...criterion,
                      required: e.target.checked,
                    };
                    setDraftAcceptance(newAcceptance);
                  }}
                  disabled={locked}
                />
                Required
              </label>
              <button
                type="button"
                className="wb-btn wb-acceptance-remove"
                onClick={() => {
                  setDraftAcceptance(draftAcceptance.filter((_, i) => i !== idx));
                }}
                disabled={locked}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="wb-btn"
            onClick={() => {
              setDraftAcceptance([
                ...draftAcceptance,
                { id: `ac-${draftAcceptance.length + 1}`, kind: "test", description: "", required: true },
              ]);
            }}
            disabled={locked}
          >
            Add criterion
          </button>
        </div>
      )}

      <div className="wb-contract-actions">
        {!locked && (
          <>
            <button
              type="button"
              className="wb-btn primary"
              onClick={handleSave}
              disabled={isInvalid}
            >
              Save
            </button>
            {isInvalid && <span className="wb-contract-error">{disabledReason}</span>}
          </>
        )}
        <button
          type="button"
          className="wb-btn"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </section>
  );
};
