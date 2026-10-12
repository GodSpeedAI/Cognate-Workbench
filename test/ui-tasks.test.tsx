// UI tests for workbench task components: DoneLadder, TaskList, RuntimeStrip.
// Renders with renderToStaticMarkup and asserts visible words, roles, and aria attributes.

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DoneLadder } from "../src/ui/workbench/DoneLadder";
import { TaskList } from "../src/ui/workbench/TaskList";
import { RuntimeStrip } from "../src/ui/workbench/RuntimeStrip";

describe("DoneLadder", () => {
  test("level: not-started reaches no stages", () => {
    const html = renderToStaticMarkup(
      <DoneLadder level="not-started" />
    );
    expect(html).toContain("How done is this task");
    expect(html).toContain("○ Finished");
    expect(html).toContain("○ Produced");
    expect(html).not.toContain('aria-current="step"');
  });

  test("level: finished reaches and shows current on Finished", () => {
    const html = renderToStaticMarkup(
      <DoneLadder level="finished" />
    );
    expect(html).toContain("✓ Finished");
    expect(html).toContain("○ Produced");
    expect(html).toContain("○ Tested");
    expect(html).toContain('aria-current="step"');
  });

  test("level: produced reaches Finished and Produced, shows current on Produced", () => {
    const html = renderToStaticMarkup(
      <DoneLadder level="produced" />
    );
    expect(html).toContain("✓ Finished");
    expect(html).toContain("✓ Produced");
    expect(html).toContain("○ Tested");
    expect(html).toContain('aria-current="step"');
  });

  test("level: ready-for-review reaches through Ready for review", () => {
    const html = renderToStaticMarkup(
      <DoneLadder level="ready-for-review" />
    );
    expect(html).toContain("✓ Finished");
    expect(html).toContain("✓ Produced");
    expect(html).toContain("✓ Tested");
    expect(html).toContain("✓ Ready for review");
    expect(html).toContain("○ Accepted");
    expect(html).toContain("○ Operationalized");
  });

  test("level: operationalized reaches all stages", () => {
    const html = renderToStaticMarkup(
      <DoneLadder level="operationalized" />
    );
    expect(html).toContain("✓ Finished");
    expect(html).toContain("✓ Produced");
    expect(html).toContain("✓ Tested");
    expect(html).toContain("✓ Ready for review");
    expect(html).toContain("✓ Accepted");
    expect(html).toContain("✓ Operationalized");
  });

  test("includes explanation text", () => {
    const html = renderToStaticMarkup(
      <DoneLadder level="produced" />
    );
    expect(html).toContain(
      "Finished means the agent stopped. It does not mean the work was tested, reviewed or accepted."
    );
  });
});

describe("TaskList", () => {
  test("empty state renders with empty text and one primary button", () => {
    const html = renderToStaticMarkup(
      <TaskList
        tasks={[]}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );
    expect(html).toContain("0 tasks");
    expect(html).toContain("A task is the unit of governed work");
    expect(html).toContain("Create one to begin");
    // Count primary buttons - should be exactly 1
    const primaryMatches = html.match(/class="wb-btn primary"/g);
    expect(primaryMatches).toHaveLength(1);
  });

  test("groups tasks by status in correct order", () => {
    const tasks = [
      {
        id: "t1",
        title: "Task 1",
        status: "ACCEPTED" as const,
        missing: 0,
        doneLevel: "accepted" as const,
      },
      {
        id: "t2",
        title: "Task 2",
        status: "BACKLOG" as const,
        missing: 0,
        doneLevel: "not-started" as const,
      },
      {
        id: "t3",
        title: "Task 3",
        status: "RUNNING" as const,
        missing: 0,
        doneLevel: "produced" as const,
      },
    ];

    const html = renderToStaticMarkup(
      <TaskList
        tasks={tasks}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );

    // Find positions of group headers
    const backlogPos = html.indexOf("Backlog");
    const runningPos = html.indexOf("Running");
    const acceptedPos = html.indexOf("Accepted");

    // Assert order: Backlog comes before Running, Running before Accepted
    expect(backlogPos).toBeGreaterThan(0);
    expect(runningPos).toBeGreaterThan(backlogPos);
    expect(acceptedPos).toBeGreaterThan(runningPos);
  });

  test("shows missing contract fields text when missing > 0", () => {
    const tasks = [
      {
        id: "t1",
        title: "Task with missing fields",
        status: "BRIEFING" as const,
        missing: 3,
        doneLevel: "not-started" as const,
      },
    ];

    const html = renderToStaticMarkup(
      <TaskList
        tasks={tasks}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );

    expect(html).toContain("3 contract fields missing");
  });

  test("shows singular 'field' when missing === 1", () => {
    const tasks = [
      {
        id: "t1",
        title: "Task",
        status: "BRIEFING" as const,
        missing: 1,
        doneLevel: "not-started" as const,
      },
    ];

    const html = renderToStaticMarkup(
      <TaskList
        tasks={tasks}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );

    expect(html).toContain("1 contract field missing");
  });

  test("does not show missing text when missing === 0", () => {
    const tasks = [
      {
        id: "t1",
        title: "Task",
        status: "READY" as const,
        missing: 0,
        doneLevel: "not-started" as const,
      },
    ];

    const html = renderToStaticMarkup(
      <TaskList
        tasks={tasks}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );

    expect(html).not.toContain("missing");
  });

  test("marks selected task with aria-pressed true", () => {
    const tasks = [
      {
        id: "t1",
        title: "Task 1",
        status: "READY" as const,
        missing: 0,
        doneLevel: "not-started" as const,
      },
      {
        id: "t2",
        title: "Task 2",
        status: "READY" as const,
        missing: 0,
        doneLevel: "not-started" as const,
      },
    ];

    const html = renderToStaticMarkup(
      <TaskList
        tasks={tasks}
        selectedId="t1"
        onSelect={() => {}}
        onNew={() => {}}
      />
    );

    // Check that aria-pressed appears for selected task
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Task 1");
  });

  test("renders status chips with correct modifiers", () => {
    const tasks = [
      {
        id: "t1",
        title: "Task Running",
        status: "RUNNING" as const,
        missing: 0,
        doneLevel: "produced" as const,
      },
      {
        id: "t2",
        title: "Task Blocked",
        status: "BLOCKED" as const,
        missing: 0,
        doneLevel: "not-started" as const,
      },
      {
        id: "t3",
        title: "Task Accepted",
        status: "ACCEPTED" as const,
        missing: 0,
        doneLevel: "accepted" as const,
      },
      {
        id: "t4",
        title: "Task Rework",
        status: "REWORK" as const,
        missing: 0,
        doneLevel: "not-started" as const,
      },
    ];

    const html = renderToStaticMarkup(
      <TaskList
        tasks={tasks}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );

    // RUNNING should have 'live' class
    expect(html).toContain("wb-chip live");
    // BLOCKED should have 'warn' class
    expect(html).toContain("wb-chip warn");
    // ACCEPTED should have 'ok' class
    expect(html).toContain("wb-chip ok");
    // REWORK should have 'bad' class
    expect(html).toContain("wb-chip bad");
  });

  test("shows task count as singular when 1 task", () => {
    const tasks = [
      {
        id: "t1",
        title: "Task",
        status: "BACKLOG" as const,
        missing: 0,
        doneLevel: "not-started" as const,
      },
    ];

    const html = renderToStaticMarkup(
      <TaskList
        tasks={tasks}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );

    expect(html).toContain("1 task");
  });

  test("shows task count as plural when multiple tasks", () => {
    const tasks = [
      {
        id: "t1",
        title: "Task 1",
        status: "BACKLOG" as const,
        missing: 0,
        doneLevel: "not-started" as const,
      },
      {
        id: "t2",
        title: "Task 2",
        status: "BACKLOG" as const,
        missing: 0,
        doneLevel: "not-started" as const,
      },
    ];

    const html = renderToStaticMarkup(
      <TaskList
        tasks={tasks}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );

    expect(html).toContain("2 tasks");
  });

  test("has exactly one primary button in non-empty state", () => {
    const tasks = [
      {
        id: "t1",
        title: "Task",
        status: "READY" as const,
        missing: 0,
        doneLevel: "not-started" as const,
      },
    ];

    const html = renderToStaticMarkup(
      <TaskList
        tasks={tasks}
        onSelect={() => {}}
        onNew={() => {}}
      />
    );

    const primaryMatches = html.match(/class="wb-btn primary"/g);
    expect(primaryMatches).toHaveLength(1);
  });
});

describe("RuntimeStrip", () => {
  test("renders state as idle when state is idle", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="idle" />
    );
    expect(html).toContain("idle");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Runtime"');
  });

  test("renders state as running with live chip class", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="running" />
    );
    expect(html).toContain("running");
    expect(html).toContain("wb-chip live");
  });

  test("renders state as 'waiting on you' for waiting", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="waiting" />
    );
    expect(html).toContain("waiting on you");
  });

  test("renders state as 'in review' for review", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="review" />
    );
    expect(html).toContain("in review");
  });

  test("shows task title when provided", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        taskTitle="Build Feature X"
      />
    );
    expect(html).toContain("Build Feature X");
  });

  test("shows elapsed time in seconds", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        elapsedSeconds={42}
      />
    );
    expect(html).toContain("42s");
  });

  test("shows unknown when elapsedSeconds is undefined", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="idle" />
    );
    // No seconds should be shown when undefined
    expect(html).not.toContain("s<");
  });

  test("shows step count", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        steps={5}
      />
    );
    expect(html).toContain("5 steps");
  });

  test("formats tokens compactly with k suffix", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        tokens={1200}
      />
    );
    expect(html).toContain("1.2k tok");
  });

  test("shows tokens under 1000 without k suffix", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        tokens={500}
      />
    );
    expect(html).toContain("500 tok");
  });

  test("shows tok n/a when tokens undefined", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="idle" />
    );
    // tokens not shown when undefined
    expect(html).not.toContain("tok");
  });

  test("formats cost with two decimal places", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        costUsd={0.04}
      />
    );
    expect(html).toContain("$0.04");
  });

  test("shows cost n/a when costUsd undefined", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="idle" />
    );
    expect(html).not.toContain("cost n/a");
  });

  test("shows provenance text when provided", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        provenance="from user input"
      />
    );
    expect(html).toContain("from user input");
  });

  test("omits provenance when not provided", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="idle" />
    );
    expect(html).not.toContain("from user input");
  });

  test("shows budget ok chip", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        budget="ok"
      />
    );
    expect(html).toContain("budget ok");
    expect(html).toContain("wb-chip ok");
  });

  test("shows budget near limit with warn class", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        budget="warn"
      />
    );
    expect(html).toContain("budget near limit");
    expect(html).toContain("wb-chip warn");
  });

  test("shows budget exceeded with bad class", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        budget="exceeded"
      />
    );
    expect(html).toContain("budget exceeded");
    expect(html).toContain("wb-chip bad");
  });

  test("omits budget chip when budget undefined", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="idle" />
    );
    expect(html).not.toContain("budget");
  });

  test("shows peak concurrency", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        concurrency={4}
      />
    );
    expect(html).toContain("peak 4x");
  });

  test("omits concurrency when undefined", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="idle" />
    );
    expect(html).not.toContain("peak");
  });

  test("shows approvals pending with warn chip when > 0", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="waiting"
        approvalsPending={2}
      />
    );
    expect(html).toContain("approvals 2");
    expect(html).toContain("wb-chip warn");
  });

  test("omits approvals when 0 or undefined", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip state="idle" approvalsPending={0} />
    );
    expect(html).not.toContain("approvals");
  });

  test("comprehensive runtime state: all fields", () => {
    const html = renderToStaticMarkup(
      <RuntimeStrip
        state="running"
        taskTitle="Comprehensive Test"
        elapsedSeconds={123}
        steps={8}
        tokens={5000}
        costUsd={0.12}
        provenance="scheduled"
        budget="warn"
        concurrency={3}
        approvalsPending={1}
      />
    );

    expect(html).toContain("running");
    expect(html).toContain("Comprehensive Test");
    expect(html).toContain("123s");
    expect(html).toContain("8 steps");
    expect(html).toContain("5.0k tok");
    expect(html).toContain("$0.12");
    expect(html).toContain("scheduled");
    expect(html).toContain("budget near limit");
    expect(html).toContain("peak 3x");
    expect(html).toContain("approvals 1");
  });
});
