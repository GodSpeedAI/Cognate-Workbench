// AutomationPanel: Operationalized accepted workflows with schedule, runner, and outcome gate.
// Displays a list of automation runs with their state progression and action controls.
// Serves the automation journey: creation, dispatch, observation, verification, completion.

import React, { useState } from "react";
import type { AutomationRecord } from "../../workbench/state";
import type { ExecutionSubstrate, AutomationState } from "../../workbench/types";
import type { Schedule } from "../../workbench/automation";
import { AUTOMATION_STATES } from "../../workbench/types";
import { describeSchedule, substrateNote } from "../../workbench/automation";

// @ts-ignore CSS import

interface RunItem {
  readonly id: string;
  readonly record: AutomationRecord;
}

interface TaskItem {
  readonly id: string;
  readonly title: string;
}

interface AutomationPanelProps {
  readonly runs: readonly RunItem[];
  readonly acceptedTasks: readonly TaskItem[];
  readonly onCreate: (input: {
    name: string;
    schedule: Schedule;
    substrate: ExecutionSubstrate;
    acceptance: string[];
    sourceTaskId?: string;
  }) => void;
  readonly onAdvance: (
    id: string,
    to: AutomationState | "receipt",
    facts?: {
      outputs?: string[];
      closedAcceptance?: string[];
      failure?: string;
    }
  ) => void;
}

export default function AutomationPanel({
  runs,
  acceptedTasks,
  onCreate,
  onAdvance,
}: AutomationPanelProps) {
  const [formState, setFormState] = useState<{
    name: string;
    sourceTaskId: string;
    weekday: string;
    hour: string;
    minute: string;
    timezone: string;
    substrate: ExecutionSubstrate;
    acceptanceItems: string;
  }>({
    name: "",
    sourceTaskId: acceptedTasks[0]?.id ?? "",
    weekday: "0",
    hour: "09",
    minute: "00",
    timezone: "UTC",
    substrate: "local-desktop",
    acceptanceItems: "",
  });

  const [outputNameByRun, setOutputNameByRun] = useState<Record<string, string>>({});
  const [failureReasonByRun, setFailureReasonByRun] = useState<Record<string, string>>({});
  const [checkedAcceptanceByRun, setCheckedAcceptanceByRun] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [expandedDetails, setExpandedDetails] = useState(false);
  const [recordingOutputId, setRecordingOutputId] = useState<string | null>(null);
  const [recordingFailureId, setRecordingFailureId] = useState<string | null>(null);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const acceptanceArray = formState.acceptanceItems
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (acceptanceArray.length === 0) {
      return; // validation prevents submit when empty
    }

    const isDaily = formState.weekday === "daily";
    const schedule: Schedule = isDaily
      ? {
          kind: "daily",
          hour: parseInt(formState.hour, 10),
          minute: parseInt(formState.minute, 10),
          timezone: formState.timezone,
        }
      : {
          kind: "weekly",
          weekday: parseInt(formState.weekday, 10) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
          hour: parseInt(formState.hour, 10),
          minute: parseInt(formState.minute, 10),
          timezone: formState.timezone,
        };

    onCreate({
      name: formState.name,
      schedule,
      substrate: formState.substrate,
      acceptance: acceptanceArray,
      sourceTaskId: formState.sourceTaskId ? formState.sourceTaskId : undefined,
    });

    // Reset form
    setFormState({
      name: "",
      sourceTaskId: acceptedTasks[0]?.id ?? "",
      weekday: "0",
      hour: "09",
      minute: "00",
      timezone: "UTC",
      substrate: "local-desktop",
      acceptanceItems: "",
    });
    setExpandedDetails(false);
  };

  const handleOutputSave = (runId: string) => {
    const name = outputNameByRun[runId];
    if (name && name.trim()) {
      onAdvance(runId, "PRODUCED", { outputs: [name.trim()] });
      setOutputNameByRun((prev) => ({ ...prev, [runId]: "" }));
    }
  };

  const handleVerifyConfirm = (runId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;

    const checked = checkedAcceptanceByRun[runId] || {};
    const closedAcceptance = Object.keys(checked).filter((key) => checked[key]);

    onAdvance(runId, "VERIFIED", { closedAcceptance });
    setCheckedAcceptanceByRun((prev) => ({ ...prev, [runId]: {} }));
  };

  const handleFailureConfirm = (runId: string) => {
    const reason = failureReasonByRun[runId];
    if (reason && reason.trim()) {
      onAdvance(runId, "FAILED", { failure: reason.trim() });
      setFailureReasonByRun((prev) => ({ ...prev, [runId]: "" }));
    }
  };

  const hasHonestNote = true; // Always visible
  const canCreateAutomation = acceptedTasks.length > 0;
  const shouldShowPrimaryButton = runs.length === 0;

  if (runs.length === 0) {
    return (
      <div className="wb-root">
        <h2>Automations</h2>
        <p>
          An automation is an accepted workflow plus inputs, a schedule, a runner and an outcome
          gate.
        </p>

        {hasHonestNote && (
          <p className="wb-automation-honest-note">
            This app records outcomes that you or a runner report. It does not run a scheduler in
            the background.
          </p>
        )}

        <div className="wb-empty">
          <p>
            <strong>No automations yet.</strong> Accept a task, then schedule it here.
          </p>
        </div>

        {canCreateAutomation && (
          <details className="wb-automation-form-details" open={expandedDetails}>
            <summary>Schedule an accepted workflow</summary>
            <form onSubmit={handleCreateSubmit} className="wb-automation-form">
              <fieldset>
                <div className="wb-field">
                  <label htmlFor="auto-name">Name</label>
                  <input
                    id="auto-name"
                    type="text"
                    value={formState.name}
                    onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                    placeholder="e.g., Daily report"
                  />
                </div>

                <div className="wb-field">
                  <label htmlFor="auto-task">Source task</label>
                  <select
                    id="auto-task"
                    value={formState.sourceTaskId}
                    onChange={(e) => setFormState({ ...formState, sourceTaskId: e.target.value })}
                  >
                    {acceptedTasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="wb-field-row">
                  <div className="wb-field">
                    <label htmlFor="auto-weekday">Repeat</label>
                    <select
                      id="auto-weekday"
                      value={formState.weekday}
                      onChange={(e) => setFormState({ ...formState, weekday: e.target.value })}
                    >
                      <option value="daily">Daily</option>
                      <option value="0">Sunday</option>
                      <option value="1">Monday</option>
                      <option value="2">Tuesday</option>
                      <option value="3">Wednesday</option>
                      <option value="4">Thursday</option>
                      <option value="5">Friday</option>
                      <option value="6">Saturday</option>
                    </select>
                  </div>

                  <div className="wb-field">
                    <label htmlFor="auto-time">Time (hour:minute)</label>
                    <input
                      id="auto-time"
                      type="time"
                      value={`${formState.hour}:${formState.minute}`}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(":");
                        setFormState({ ...formState, hour: h ?? "00", minute: m ?? "00" });
                      }}
                    />
                  </div>

                  <div className="wb-field">
                    <label htmlFor="auto-tz">Timezone</label>
                    <input
                      id="auto-tz"
                      type="text"
                      value={formState.timezone}
                      onChange={(e) => setFormState({ ...formState, timezone: e.target.value })}
                      placeholder="UTC"
                    />
                  </div>
                </div>

                <div className="wb-field">
                  <label htmlFor="auto-substrate">Runner</label>
                  <select
                    id="auto-substrate"
                    value={formState.substrate}
                    onChange={(e) =>
                      setFormState({ ...formState, substrate: e.target.value as ExecutionSubstrate })
                    }
                  >
                    <option value="local-desktop">local-desktop</option>
                    <option value="local-service">local-service</option>
                    <option value="remote-runner">remote-runner</option>
                    <option value="cloud">cloud</option>
                  </select>
                  <div className="wb-automation-substrate-note">
                    {substrateNote(formState.substrate).note}
                  </div>
                </div>

                <div className="wb-field">
                  <label htmlFor="auto-acceptance">Acceptance items</label>
                  <textarea
                    id="auto-acceptance"
                    value={formState.acceptanceItems}
                    onChange={(e) =>
                      setFormState({ ...formState, acceptanceItems: e.target.value })
                    }
                    placeholder="One per line"
                  />
                  {!formState.acceptanceItems.trim() && (
                    <div className="wb-error">At least one acceptance item is required</div>
                  )}
                </div>

                <button
                  type="submit"
                  className={`wb-btn ${shouldShowPrimaryButton ? "primary" : ""}`}
                  disabled={
                    !formState.name.trim() ||
                    !formState.acceptanceItems.trim() ||
                    !formState.sourceTaskId
                  }
                >
                  Create automation
                </button>
              </fieldset>
            </form>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="wb-root">
      <h2>Automations</h2>
      <p>
        An automation is an accepted workflow plus inputs, a schedule, a runner and an outcome
        gate.
      </p>

      {hasHonestNote && (
        <p className="wb-automation-honest-note">
          This app records outcomes that you or a runner report. It does not run a scheduler in
          the background.
        </p>
      )}

      <ul className="wb-list">
        {runs.map((runItem) => {
          const run = runItem.record.run;
          const schedule = runItem.record.schedule;
          const nextFireStr = runItem.record.nextFire ?? "unknown";
          const substrate = substrateNote(run.substrate);
          const isTerm = run.state === "COMPLETE" || run.state === "FAILED";
          const currentStateIndex = AUTOMATION_STATES.indexOf(run.state as typeof AUTOMATION_STATES[number]);

          const outputName = outputNameByRun[runItem.id] || "";
          const failureReason = failureReasonByRun[runItem.id] || "";
          const checkedAcceptance = checkedAcceptanceByRun[runItem.id] || {};
          const openAcceptance = run.acceptance.filter((id) => !run.closedAcceptance.includes(id));

          return (
            <li key={runItem.id} className="wb-section">
              <div className="wb-automation-header">
                <div>
                  <h3>{run.name}</h3>
                  <p className="wb-automation-meta">
                    {describeSchedule(schedule)} • Next fire: {nextFireStr}
                  </p>
                </div>
              </div>

              <div className="wb-automation-runner">
                <span className="wb-chip">{substrate.label}</span>
                <span>{substrate.note}</span>
              </div>

              <ol aria-label="Run state" className="wb-automation-track">
                {AUTOMATION_STATES.map((state, idx) => {
                  const isDone = idx < currentStateIndex;
                  const isCurrent = idx === currentStateIndex;
                  return (
                    <li key={state} {...(isCurrent ? { "aria-current": "step" } : {})}>
                      <span className="wb-automation-step">
                        {isDone ? "✓" : isCurrent ? "●" : "○"}
                      </span>
                      <span>{state.toLowerCase()}</span>
                    </li>
                  );
                })}

                {run.state === "FAILED" && (
                  <li className="wb-automation-failed">
                    <span className="wb-chip bad">failed: {run.failure}</span>
                  </li>
                )}
              </ol>

              <p className="wb-automation-receipt-note">
                A delivery receipt means dispatched, not done.
              </p>

              <div className="wb-automation-acceptance">
                <h4>Acceptance gate</h4>
                <ul className="wb-list">
                  {run.acceptance.map((id) => {
                    const isClosed = run.closedAcceptance.includes(id);
                    return (
                      <li key={id}>
                        <span>{isClosed ? "✓ closed" : "○ open"}</span>
                        <span>{id}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="wb-automation-outputs">
                <h4>Outputs</h4>
                {run.outputs.length > 0 ? (
                  <ul className="wb-list">
                    {run.outputs.map((output, idx) => (
                      <li key={idx}>{output}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="wb-automation-nothing-produced">Nothing produced yet</p>
                )}
              </div>

              <div className="wb-automation-actions">
                {run.state === "SCHEDULED" && (
                  <button
                    type="button"
                    className="wb-btn primary"
                    onClick={() => onAdvance(runItem.id, "receipt")}
                  >
                    Record delivery receipt
                  </button>
                )}

                {run.state === "DISPATCHED" && (
                  <button
                    type="button"
                    className="wb-btn primary"
                    onClick={() => onAdvance(runItem.id, "RUNNING")}
                  >
                    Mark running
                  </button>
                )}

                {run.state === "RUNNING" && (
                  <>
                    {recordingOutputId === runItem.id ? (
                      <div className="wb-automation-inline-input">
                        <input
                          type="text"
                          value={outputName}
                          onChange={(e) =>
                            setOutputNameByRun({ ...outputNameByRun, [runItem.id]: e.target.value })
                          }
                          placeholder="Output name"
                        />
                        <button
                          type="button"
                          className="wb-btn primary"
                          onClick={() => {
                            handleOutputSave(runItem.id);
                            setRecordingOutputId(null);
                          }}
                          disabled={!outputName.trim()}
                        >
                          Save output
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="wb-btn primary"
                        onClick={() => setRecordingOutputId(runItem.id)}
                      >
                        Record output
                      </button>
                    )}
                    <button
                      type="button"
                      className="wb-btn"
                      onClick={() => {
                        setRecordingFailureId(runItem.id);
                      }}
                    >
                      Mark failed
                    </button>
                  </>
                )}

                {run.state === "PRODUCED" && (
                  <>
                    {openAcceptance.length > 0 && (
                      <div className="wb-automation-verification-gate">
                        <h5>Attest closed</h5>
                        <ul className="wb-list">
                          {openAcceptance.map((id) => (
                            <li key={id}>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={checkedAcceptance[id] || false}
                                  onChange={(e) =>
                                    setCheckedAcceptanceByRun({
                                      ...checkedAcceptanceByRun,
                                      [runItem.id]: {
                                        ...checkedAcceptance,
                                        [id]: e.target.checked,
                                      },
                                    })
                                  }
                                />
                                {id}
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <button
                      type="button"
                      className="wb-btn primary"
                      onClick={() => handleVerifyConfirm(runItem.id)}
                      disabled={openAcceptance.length > Object.values(checkedAcceptance).filter(Boolean).length}
                      title={
                        openAcceptance.length >
                        Object.values(checkedAcceptance).filter(Boolean).length
                          ? "Close every acceptance item first"
                          : ""
                      }
                    >
                      Confirm verified
                    </button>
                    {openAcceptance.length >
                      Object.values(checkedAcceptance).filter(Boolean).length && (
                      <div className="wb-error">Close every acceptance item first</div>
                    )}
                    <button
                      type="button"
                      className="wb-btn"
                      onClick={() => {
                        setRecordingFailureId(runItem.id);
                      }}
                    >
                      Mark failed
                    </button>
                  </>
                )}

                {run.state === "VERIFIED" && (
                  <button
                    type="button"
                    className="wb-btn primary"
                    onClick={() => onAdvance(runItem.id, "COMPLETE")}
                  >
                    Complete
                  </button>
                )}

                {recordingFailureId === runItem.id && (
                  <div className="wb-automation-failure-input">
                    <input
                      type="text"
                      value={failureReason}
                      onChange={(e) =>
                        setFailureReasonByRun({ ...failureReasonByRun, [runItem.id]: e.target.value })
                      }
                      placeholder="Failure reason"
                    />
                    <button
                      type="button"
                      className="wb-btn"
                      onClick={() => {
                        handleFailureConfirm(runItem.id);
                        setRecordingFailureId(null);
                      }}
                      disabled={!failureReason.trim()}
                    >
                      Confirm failure
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {canCreateAutomation && (
        <details className="wb-automation-form-details" open={expandedDetails}>
          <summary>Schedule an accepted workflow</summary>
          <form onSubmit={handleCreateSubmit} className="wb-automation-form">
            <fieldset>
              <div className="wb-field">
                <label htmlFor="auto-name">Name</label>
                <input
                  id="auto-name"
                  type="text"
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  placeholder="e.g., Daily report"
                />
              </div>

              <div className="wb-field">
                <label htmlFor="auto-task">Source task</label>
                <select
                  id="auto-task"
                  value={formState.sourceTaskId}
                  onChange={(e) => setFormState({ ...formState, sourceTaskId: e.target.value })}
                >
                  {acceptedTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="wb-field-row">
                <div className="wb-field">
                  <label htmlFor="auto-weekday">Repeat</label>
                  <select
                    id="auto-weekday"
                    value={formState.weekday}
                    onChange={(e) => setFormState({ ...formState, weekday: e.target.value })}
                  >
                    <option value="daily">Daily</option>
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </select>
                </div>

                <div className="wb-field">
                  <label htmlFor="auto-time">Time (hour:minute)</label>
                  <input
                    id="auto-time"
                    type="time"
                    value={`${formState.hour}:${formState.minute}`}
                    onChange={(e) => {
                      const [h, m] = e.target.value.split(":");
                      setFormState({ ...formState, hour: h ?? "00", minute: m ?? "00" });
                    }}
                  />
                </div>

                <div className="wb-field">
                  <label htmlFor="auto-tz">Timezone</label>
                  <input
                    id="auto-tz"
                    type="text"
                    value={formState.timezone}
                    onChange={(e) => setFormState({ ...formState, timezone: e.target.value })}
                    placeholder="UTC"
                  />
                </div>
              </div>

              <div className="wb-field">
                <label htmlFor="auto-substrate">Runner</label>
                <select
                  id="auto-substrate"
                  value={formState.substrate}
                  onChange={(e) =>
                    setFormState({ ...formState, substrate: e.target.value as ExecutionSubstrate })
                  }
                >
                  <option value="local-desktop">local-desktop</option>
                  <option value="local-service">local-service</option>
                  <option value="remote-runner">remote-runner</option>
                  <option value="cloud">cloud</option>
                </select>
                <div className="wb-automation-substrate-note">
                  {substrateNote(formState.substrate).note}
                </div>
              </div>

              <div className="wb-field">
                <label htmlFor="auto-acceptance">Acceptance items</label>
                <textarea
                  id="auto-acceptance"
                  value={formState.acceptanceItems}
                  onChange={(e) =>
                    setFormState({ ...formState, acceptanceItems: e.target.value })
                  }
                  placeholder="One per line"
                />
                {!formState.acceptanceItems.trim() && (
                  <div className="wb-error">At least one acceptance item is required</div>
                )}
              </div>

              <button
                type="submit"
                className={`wb-btn ${shouldShowPrimaryButton ? "primary" : ""}`}
                disabled={
                  !formState.name.trim() ||
                  !formState.acceptanceItems.trim() ||
                  !formState.sourceTaskId
                }
              >
                Create automation
              </button>
            </fieldset>
          </form>
        </details>
      )}

      {acceptedTasks.length === 0 && (
        <div className="wb-empty">
          <p>
            <strong>Only an accepted task can be operationalized.</strong> Accept a task first.
          </p>
        </div>
      )}
    </div>
  );
}
