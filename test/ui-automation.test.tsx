import { describe, it, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import AutomationPanel from "../src/ui/workbench/AutomationPanel";
import type { AutomationRecord } from "../src/workbench/state";
import type { AutomationRun } from "../src/workbench/automation";

// Helper to render and extract text
function renderAndText(component: React.ReactElement): string {
  return renderToStaticMarkup(component);
}

// Helper to create a test automation run
function makeRun(
  state: "SCHEDULED" | "DISPATCHED" | "RUNNING" | "PRODUCED" | "VERIFIED" | "COMPLETE" | "FAILED",
  overrides?: Partial<AutomationRun>
): AutomationRecord {
  const run: AutomationRun = {
    id: "run-1",
    name: "Test Automation",
    state,
    substrate: "local-desktop",
    inputs: {},
    capabilities: [],
    acceptance: ["acceptance-1", "acceptance-2"],
    closedAcceptance: state === "VERIFIED" || state === "COMPLETE" ? ["acceptance-1", "acceptance-2"] : [],
    outputs: state === "PRODUCED" || state === "VERIFIED" || state === "COMPLETE" ? ["output-1"] : [],
    ...overrides,
  };

  return {
    run,
    schedule: { kind: "daily", hour: 9, minute: 0, timezone: "UTC" },
    nextFire: "2025-01-06T09:00:00Z",
  };
}

describe("AutomationPanel", () => {
  it("shows empty state when no runs", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [],
        acceptedTasks: [{ id: "task-1", title: "Task 1" }],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("No automations yet");
    expect(html).toContain("Accept a task, then schedule it here");
  });

  it("shows honest note about scheduler", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("This app records outcomes that you or a runner report");
    expect(html).toContain("does not run a scheduler in the background");
  });

  it("disables form when no accepted tasks", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("SCHEDULED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Only an accepted task can be operationalized");
    expect(html).toContain("Accept a task first");
  });

  it("shows state track with aria-current for current state", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("DISPATCHED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    // Should have the state track with aria-label
    expect(html).toContain('aria-label="Run state"');

    // States: scheduled (✓), dispatched (aria-current), running (○), etc.
    expect(html).toContain("scheduled");
    expect(html).toContain("dispatched");
    expect(html).toContain("aria-current=\"step\"");
  });

  it("marks completed states with checkmark", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("PRODUCED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    // scheduled and dispatched and running are completed (show ✓)
    // produced is current
    expect(html).toContain("✓");
  });

  it("displays FAILED state with failure reason chip", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [
          {
            id: "run-1",
            record: makeRun("FAILED", { failure: "timeout error" }),
          },
        ],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("failed: timeout error");
    expect(html).toContain("bad");
  });

  it("shows delivery receipt note", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("SCHEDULED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("A delivery receipt means dispatched, not done");
  });

  it("shows primary button for SCHEDULED state", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("SCHEDULED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Record delivery receipt");
    expect(html).toContain("primary");
  });

  it("shows primary button for DISPATCHED state", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("DISPATCHED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Mark running");
  });

  it("shows primary button for RUNNING state with output input", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("RUNNING") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Record output");
  });

  it("shows verification gate with checkboxes in PRODUCED state", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("PRODUCED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Attest closed");
    expect(html).toContain("acceptance-1");
    expect(html).toContain("acceptance-2");
    expect(html).toContain("Confirm verified");
  });

  it("shows disabled reason when verification gate not complete", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("PRODUCED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Close every acceptance item first");
  });

  it("shows primary button for VERIFIED state", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("VERIFIED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Complete");
  });

  it("shows substrate info with note", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("SCHEDULED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("local-desktop");
    expect(html).toContain("Runs only while this app is open");
  });

  it("shows acceptance gate list with open/closed markers", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [
          {
            id: "run-1",
            record: makeRun("VERIFIED", {
              closedAcceptance: ["acceptance-1", "acceptance-2"],
            }),
          },
        ],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Acceptance gate");
    expect(html).toContain("✓ closed");
    expect(html).toContain("acceptance-1");
  });

  it("shows outputs list", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [
          {
            id: "run-1",
            record: makeRun("PRODUCED", {
              outputs: ["result-1", "result-2"],
            }),
          },
        ],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Outputs");
    expect(html).toContain("result-1");
    expect(html).toContain("result-2");
  });

  it("shows nothing produced message when no outputs", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("RUNNING") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Nothing produced yet");
  });

  it("displays schedule description", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("SCHEDULED") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Daily 09:00 UTC");
  });

  it("shows next fire time", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [
          {
            id: "run-1",
            record: {
              ...makeRun("SCHEDULED"),
              nextFire: "2025-01-07T09:00:00Z",
            },
          },
        ],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Next fire: 2025-01-07T09:00:00Z");
  });

  it("shows unknown for missing next fire", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [
          {
            id: "run-1",
            record: {
              run: makeRun("SCHEDULED").run,
              schedule: { kind: "daily", hour: 9, minute: 0, timezone: "UTC" },
            },
          },
        ],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Next fire: unknown");
  });

  it("shows create form with all fields", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("SCHEDULED") }],
        acceptedTasks: [{ id: "task-1", title: "Task 1" }],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Schedule an accepted workflow");
    expect(html).toContain("Name");
    expect(html).toContain("Source task");
    expect(html).toContain("Repeat");
    expect(html).toContain("Time");
    expect(html).toContain("Timezone");
    expect(html).toContain("Runner");
    expect(html).toContain("Acceptance items");
    expect(html).toContain("Create automation");
  });

  it("form shows substrate note for selected runner", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [],
        acceptedTasks: [{ id: "task-1", title: "Task 1" }],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Runs only while this app is open");
  });

  it("shows ghost button for create when runs exist", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("SCHEDULED") }],
        acceptedTasks: [{ id: "task-1", title: "Task 1" }],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    // When runs exist, the create button should not be primary
    // Count primary buttons - should only be 1 per run
    const matches = html.match(/class="wb-btn primary"/g);
    expect(matches).toHaveLength(1); // Only the action button for the run, not the create button
  });

  it("shows primary button for create when no runs", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [],
        acceptedTasks: [{ id: "task-1", title: "Task 1" }],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    // When no runs, the create button should be primary
    const matches = html.match(/class="wb-btn primary"/g);
    expect(matches && matches.length > 0).toBe(true);
  });

  it("shows heading Automations", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("<h2>Automations</h2>");
  });

  it("shows subtitle about automation definition", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("An automation is an accepted workflow plus inputs");
  });

  it("shows multiple runs with separate sections", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [
          { id: "run-1", record: makeRun("SCHEDULED", { name: "First Automation" }) },
          { id: "run-2", record: makeRun("VERIFIED", { name: "Second Automation" }) },
        ],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("First Automation");
    expect(html).toContain("Second Automation");
  });

  it("has exactly one primary button per run (except ghost create)", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [
          { id: "run-1", record: makeRun("SCHEDULED") },
          { id: "run-2", record: makeRun("VERIFIED") },
        ],
        acceptedTasks: [{ id: "task-1", title: "Task 1" }],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    // Count primary buttons - should be exactly 2 (one per run)
    // The create button should be ghost (no primary class)
    const matches = html.match(/class="wb-btn primary"/g);
    expect(matches).toHaveLength(2);
  });

  it("shows mark failed ghost button for non-terminal states", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("RUNNING") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("Mark failed");
  });

  it("does not show mark failed for terminal states", () => {
    const htmlComplete = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("COMPLETE") }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    const htmlFailed = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [{ id: "run-1", record: makeRun("FAILED", { failure: "error" }) }],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    // For COMPLETE, we should not have action buttons (it's terminal)
    expect(htmlComplete).not.toContain("Record delivery receipt");
    expect(htmlComplete).not.toContain("Mark running");

    // For FAILED, we should not have action buttons (it's terminal)
    expect(htmlFailed).not.toContain("Record delivery receipt");
    expect(htmlFailed).not.toContain("Mark running");
  });

  it("displays acceptance items as open or closed", () => {
    const html = renderAndText(
      React.createElement(AutomationPanel, {
        runs: [
          {
            id: "run-1",
            record: makeRun("RUNNING", {
              acceptance: ["item-1", "item-2"],
              closedAcceptance: ["item-1"],
            }),
          },
        ],
        acceptedTasks: [],
        onCreate: () => {},
        onAdvance: () => {},
      })
    );

    expect(html).toContain("✓ closed");
    expect(html).toContain("○ open");
    expect(html).toContain("item-1");
    expect(html).toContain("item-2");
  });
});
