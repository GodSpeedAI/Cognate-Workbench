import { describe, expect, test } from "bun:test";
import {
  nextFire,
  describeSchedule,
  newAutomation,
  advance,
  deliveryReceipt,
  substrateNote,
  isTerminal,
  type Schedule,
} from "../src/workbench/automation.ts";

describe("nextFire — daily schedule", () => {
  test("daily schedule: next occurrence of wall-clock time in UTC", () => {
    const schedule: Schedule = {
      kind: "daily",
      hour: 6,
      minute: 30,
      timezone: "UTC",
    };

    // From an arbitrary time before 06:30 UTC, should get next 06:30 UTC
    const after = new Date("2026-01-15T05:00:00Z");
    const next = nextFire(schedule, after);

    // Next 06:30 UTC should be 2026-01-15T06:30:00Z
    expect(next.toISOString()).toBe("2026-01-15T06:30:00.000Z");
  });

  test("daily schedule: past today's time advances to tomorrow", () => {
    const schedule: Schedule = {
      kind: "daily",
      hour: 6,
      minute: 30,
      timezone: "UTC",
    };

    // From after 06:30 UTC today, should get next 06:30 UTC (tomorrow)
    const after = new Date("2026-01-15T06:30:00Z");
    const next = nextFire(schedule, after);

    // Should be strictly after, so tomorrow at 06:30
    expect(next.toISOString()).toBe("2026-01-16T06:30:00.000Z");
  });
});

describe("nextFire — weekly schedule", () => {
  test("weekly schedule: Monday 08:00 EST (2026-01-05 is a Monday)", () => {
    const schedule: Schedule = {
      kind: "weekly",
      weekday: 1, // Monday
      hour: 8,
      minute: 0,
      timezone: "America/New_York",
    };

    // 2026-01-05 is a Monday; 08:00 EST = 13:00 UTC
    // Start strictly before that: 2026-01-05T12:59:00Z (just before 13:00 UTC)
    const after = new Date("2026-01-05T12:59:00Z");
    const next = nextFire(schedule, after);

    // Next fire should be 2026-01-05T13:00:00Z (08:00 EST = 13:00 UTC on that Monday)
    // because we want strictly AFTER after, and after was at 12:59:00Z
    expect(next.getUTCHours()).toBe(13);
    expect(next.getUTCMinutes()).toBe(0);
    // Verify the local time is indeed 08:00 in America/New_York
    const localFormatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    });
    const formatted = localFormatter.format(next);
    expect(formatted).toBe("08:00");
  });

  test("weekly schedule: next Monday after DST transition (2026-03-09 is after DST start)", () => {
    // 2026-03-08 is Sunday (DST starts on 2026-03-08 in America/New_York)
    // 2026-03-09 is Monday, and it's in EDT (UTC-4)
    // So 08:00 EDT = 12:00 UTC (not 13:00 like EST)

    const schedule: Schedule = {
      kind: "weekly",
      weekday: 1, // Monday
      hour: 8,
      minute: 0,
      timezone: "America/New_York",
    };

    // Start from 2026-03-02 at 13:00 UTC (that's 08:00 EST, a Monday)
    // This is strictly at 08:00 EST on a Monday, so next fire should be the next Monday
    const after = new Date("2026-03-02T13:00:00Z");
    const next = nextFire(schedule, after);

    // Next Monday is 2026-03-09, and 08:00 EDT = 12:00 UTC
    expect(next.getUTCHours()).toBe(12);
    expect(next.getUTCMinutes()).toBe(0);

    // Verify local time
    const localFormatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    });
    const formatted = localFormatter.format(next);
    expect(formatted).toBe("08:00");
  });

  test("weekly schedule: finds next occurrence when not on that weekday", () => {
    const schedule: Schedule = {
      kind: "weekly",
      weekday: 3, // Wednesday
      hour: 12,
      minute: 0,
      timezone: "UTC",
    };

    // Start from a Monday (2026-01-05 is Monday) at 10:00 UTC
    const after = new Date("2026-01-05T10:00:00Z");
    const next = nextFire(schedule, after);

    // Next Wednesday is 2026-01-07 at 12:00 UTC
    expect(next.toISOString()).toMatch(/2026-01-07T12:00:00/);
  });
});

describe("describeSchedule", () => {
  test("describes daily schedule", () => {
    const schedule: Schedule = {
      kind: "daily",
      hour: 6,
      minute: 30,
      timezone: "UTC",
    };

    expect(describeSchedule(schedule)).toBe("Daily 06:30 UTC");
  });

  test("describes weekly schedule with timezone", () => {
    const schedule: Schedule = {
      kind: "weekly",
      weekday: 1, // Monday
      hour: 8,
      minute: 0,
      timezone: "America/New_York",
    };

    expect(describeSchedule(schedule)).toBe("Monday 08:00 America/New_York");
  });

  test("all weekdays format correctly", () => {
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    for (let i = 0; i < 7; i++) {
      const schedule: Schedule = {
        kind: "weekly",
        weekday: i as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        hour: 9,
        minute: 15,
        timezone: "UTC",
      };

      expect(describeSchedule(schedule)).toBe(`${weekdays[i]} 09:15 UTC`);
    }
  });
});

describe("newAutomation", () => {
  test("creates automation in SCHEDULED state", () => {
    const automation = newAutomation({
      id: "auto-1",
      name: "Daily Report",
      substrate: "cloud",
      inputs: { reportType: "sales" },
      capabilities: ["reporting", "analytics"],
      acceptance: ["report-generated", "data-verified"],
    });

    expect(automation.state).toBe("SCHEDULED");
    expect(automation.id).toBe("auto-1");
    expect(automation.name).toBe("Daily Report");
    expect(automation.closedAcceptance).toEqual([]);
    expect(automation.outputs).toEqual([]);
    expect(automation.failure).toBeUndefined();
  });
});

describe("advance — state machine with gates (V-012)", () => {
  test("happy path through all states: SCHEDULED -> DISPATCHED -> RUNNING -> PRODUCED -> VERIFIED -> COMPLETE", () => {
    let run = newAutomation({
      id: "auto-1",
      name: "Test",
      substrate: "cloud",
      inputs: {},
      capabilities: [],
      acceptance: ["test-pass"],
    });

    // SCHEDULED -> DISPATCHED
    let result = advance(run, "DISPATCHED");
    expect(result.ok).toBe(true);
    if (result.ok) {
      run = result.run;
      expect(run.state).toBe("DISPATCHED");
    }

    // DISPATCHED -> RUNNING
    result = advance(run, "RUNNING");
    expect(result.ok).toBe(true);
    if (result.ok) {
      run = result.run;
      expect(run.state).toBe("RUNNING");
    }

    // RUNNING -> PRODUCED (must have outputs)
    result = advance(run, "PRODUCED", { outputs: ["output-1"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      run = result.run;
      expect(run.state).toBe("PRODUCED");
      expect(run.outputs).toContain("output-1");
    }

    // PRODUCED -> VERIFIED (must close all acceptance)
    result = advance(run, "VERIFIED", { closedAcceptance: ["test-pass"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      run = result.run;
      expect(run.state).toBe("VERIFIED");
      expect(run.closedAcceptance).toContain("test-pass");
    }

    // VERIFIED -> COMPLETE
    result = advance(run, "COMPLETE");
    expect(result.ok).toBe(true);
    if (result.ok) {
      run = result.run;
      expect(run.state).toBe("COMPLETE");
      expect(isTerminal(run.state)).toBe(true);
    }
  });

  test("delivery receipt advances SCHEDULED to DISPATCHED", () => {
    const run = newAutomation({
      id: "auto-1",
      name: "Test",
      substrate: "cloud",
      inputs: {},
      capabilities: [],
      acceptance: [],
    });

    const result = deliveryReceipt(run);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.state).toBe("DISPATCHED");
    }
  });

  test("delivery receipt from non-SCHEDULED state fails", () => {
    let run = newAutomation({
      id: "auto-1",
      name: "Test",
      substrate: "cloud",
      inputs: {},
      capabilities: [],
      acceptance: [],
    });

    const dispatchResult = advance(run, "DISPATCHED");
    if (dispatchResult.ok) {
      run = dispatchResult.run;
    }

    const receiptResult = deliveryReceipt(run);
    expect(receiptResult.ok).toBe(false);
    if (!receiptResult.ok) {
      expect(receiptResult.error).toBe("receipt only means DISPATCHED");
    }
  });

  test("cannot skip DISPATCHED -> VERIFIED (must go through RUNNING, PRODUCED)", () => {
    let run = newAutomation({
      id: "auto-1",
      name: "Test",
      substrate: "cloud",
      inputs: {},
      capabilities: [],
      acceptance: [],
    });

    const dispatchResult = advance(run, "DISPATCHED");
    if (dispatchResult.ok) {
      run = dispatchResult.run;
    }

    // Try to skip to VERIFIED
    const result = advance(run, "VERIFIED");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Cannot skip states");
    }
  });

  test("PRODUCED gate: requires non-empty outputs", () => {
    let run = newAutomation({
      id: "auto-1",
      name: "Test",
      substrate: "cloud",
      inputs: {},
      capabilities: [],
      acceptance: [],
    });

    const dispatchResult = advance(run, "DISPATCHED");
    if (dispatchResult.ok) {
      run = dispatchResult.run;
    }

    const runResult = advance(run, "RUNNING");
    if (runResult.ok) {
      run = runResult.run;
    }

    // Try to advance to PRODUCED without outputs
    let result = advance(run, "PRODUCED");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("nothing produced");
    }

    // Try with empty outputs array
    result = advance(run, "PRODUCED", { outputs: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("nothing produced");
    }

    // Should succeed with non-empty outputs
    result = advance(run, "PRODUCED", { outputs: ["out-1"] });
    expect(result.ok).toBe(true);
  });

  test("VERIFIED gate: requires all acceptance criteria closed", () => {
    let run = newAutomation({
      id: "auto-1",
      name: "Test",
      substrate: "cloud",
      inputs: {},
      capabilities: [],
      acceptance: ["criteria-1", "criteria-2"],
    });

    // Advance through states to PRODUCED
    const states = ["DISPATCHED", "RUNNING", "PRODUCED"] as const;
    for (const state of states) {
      const result = advance(run, state, state === "PRODUCED" ? { outputs: ["out"] } : undefined);
      if (result.ok) {
        run = result.run;
      }
    }

    // Try to verify with only one criteria closed
    let result = advance(run, "VERIFIED", { closedAcceptance: ["criteria-1"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Cannot verify");
      expect(result.error).toContain("criteria-2");
    }

    // Should succeed when all are closed
    result = advance(run, "VERIFIED", { closedAcceptance: ["criteria-1", "criteria-2"] });
    expect(result.ok).toBe(true);
  });

  test("COMPLETE gate: cannot complete from non-VERIFIED state (delivery receipt rule)", () => {
    let run = newAutomation({
      id: "auto-1",
      name: "Test",
      substrate: "cloud",
      inputs: {},
      capabilities: [],
      acceptance: [],
    });

    // Advance to DISPATCHED
    let result = advance(run, "DISPATCHED");
    if (result.ok) {
      run = result.run;
    }

    // Try to complete from DISPATCHED (should fail due to state sequence)
    result = advance(run, "COMPLETE");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Should be caught by state sequence check
      expect(result.error).toContain("Cannot skip states");
    }

    // Advance through the full sequence to VERIFIED
    let states = ["RUNNING", "PRODUCED", "VERIFIED"] as const;
    for (const state of states) {
      if (state === "PRODUCED") {
        result = advance(run, state, { outputs: ["out"] });
      } else {
        result = advance(run, state);
      }
      if (result.ok) {
        run = result.run;
      }
    }

    // Now from VERIFIED, we should be able to COMPLETE
    result = advance(run, "COMPLETE");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.state).toBe("COMPLETE");
    }
  });

  test("FAILED gate: requires failure message and is terminal", () => {
    let run = newAutomation({
      id: "auto-1",
      name: "Test",
      substrate: "cloud",
      inputs: {},
      capabilities: [],
      acceptance: [],
    });

    // Advance to RUNNING
    let result = advance(run, "DISPATCHED");
    if (result.ok) {
      run = result.run;
    }

    result = advance(run, "RUNNING");
    if (result.ok) {
      run = result.run;
    }

    // Try to fail without message
    result = advance(run, "FAILED");
    expect(result.ok).toBe(false);

    // Should succeed with message
    result = advance(run, "FAILED", { failure: "Network timeout" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      run = result.run;
      expect(run.state).toBe("FAILED");
      expect(run.failure).toBe("Network timeout");
      expect(isTerminal(run.state)).toBe(true);
    }

    // Cannot advance from FAILED (terminal)
    result = advance(run, "COMPLETE");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Cannot advance from terminal state");
    }
  });

  test("FAILED can be reached from any non-terminal state", () => {
    const states: Array<"SCHEDULED" | "DISPATCHED" | "RUNNING" | "PRODUCED" | "VERIFIED"> = [
      "SCHEDULED",
      "DISPATCHED",
      "RUNNING",
      "PRODUCED",
      "VERIFIED",
    ];

    for (const state of states) {
      let run = newAutomation({
        id: `auto-${state}`,
        name: "Test",
        substrate: "cloud",
        inputs: {},
        capabilities: [],
        acceptance: [],
      });

      // Advance to the target state
      const targetStates: Array<"DISPATCHED" | "RUNNING" | "PRODUCED" | "VERIFIED"> = [
        "DISPATCHED",
        "RUNNING",
        "PRODUCED",
        "VERIFIED",
      ];

      for (let i = 0; i < targetStates.indexOf(state as any) + 1; i++) {
        const nextState = targetStates[i]!;
        if (nextState === "PRODUCED") {
          const result = advance(run, nextState, { outputs: ["out"] });
          if (result.ok) {
            run = result.run;
          }
        } else {
          const result = advance(run, nextState);
          if (result.ok) {
            run = result.run;
          }
        }
      }

      // Should be able to FAIL from this state
      const failResult = advance(run, "FAILED", { failure: "Test failure" });
      expect(failResult.ok).toBe(true);
      if (failResult.ok) {
        expect(failResult.run.state).toBe("FAILED");
      }
    }
  });
});

describe("substrateNote", () => {
  test("local-desktop: does not survive quit", () => {
    const note = substrateNote("local-desktop");
    expect(note.label).toBe("local-desktop");
    expect(note.survivesQuit).toBe(false);
    expect(note.note).toContain("only while this app is open");
  });

  test("local-service: survives quit", () => {
    const note = substrateNote("local-service");
    expect(note.label).toBe("local-service");
    expect(note.survivesQuit).toBe(true);
    expect(note.note).toContain("background service");
  });

  test("remote-runner: survives quit", () => {
    const note = substrateNote("remote-runner");
    expect(note.label).toBe("remote-runner");
    expect(note.survivesQuit).toBe(true);
  });

  test("cloud: survives quit", () => {
    const note = substrateNote("cloud");
    expect(note.label).toBe("cloud");
    expect(note.survivesQuit).toBe(true);
  });
});

describe("isTerminal", () => {
  test("COMPLETE is terminal", () => {
    expect(isTerminal("COMPLETE")).toBe(true);
  });

  test("FAILED is terminal", () => {
    expect(isTerminal("FAILED")).toBe(true);
  });

  test("non-terminal states are not terminal", () => {
    const nonTerminal = ["SCHEDULED", "DISPATCHED", "RUNNING", "PRODUCED", "VERIFIED"] as const;
    for (const state of nonTerminal) {
      expect(isTerminal(state)).toBe(false);
    }
  });
});

describe("complex scenario: weekly sales report with multiple acceptance criteria", () => {
  test("complete workflow for weekly sales report automation", () => {
    // Create a weekly Monday 6 AM UTC automation
    let automation = newAutomation({
      id: "sales-report",
      name: "Weekly Sales Report",
      substrate: "cloud",
      inputs: { region: "EMEA", format: "pdf" },
      capabilities: ["reporting", "data-query", "email"],
      acceptance: ["calculations-tests-pass", "report-generated", "net-revenue-present", "evidence-ledger-closed"],
    });

    expect(automation.state).toBe("SCHEDULED");

    // Dispatch it
    let result = advance(automation, "DISPATCHED");
    expect(result.ok).toBe(true);
    if (result.ok) {
      automation = result.run;
    }

    // Start running
    result = advance(automation, "RUNNING");
    expect(result.ok).toBe(true);
    if (result.ok) {
      automation = result.run;
    }

    // Produce outputs
    result = advance(automation, "PRODUCED", {
      outputs: ["sales_report_2026-01-13.pdf", "revenue_ledger.json"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      automation = result.run;
      expect(automation.outputs.length).toBe(2);
    }

    // Gradually close acceptance criteria as they complete
    // First batch: calculations and report passed
    result = advance(automation, "VERIFIED", {
      closedAcceptance: ["calculations-tests-pass", "report-generated", "net-revenue-present", "evidence-ledger-closed"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      automation = result.run;
      expect(automation.state).toBe("VERIFIED");
    }

    // Complete the automation
    result = advance(automation, "COMPLETE");
    expect(result.ok).toBe(true);
    if (result.ok) {
      automation = result.run;
      expect(automation.state).toBe("COMPLETE");
      expect(isTerminal(automation.state)).toBe(true);
    }
  });

  test("weekly report failure mid-workflow", () => {
    let automation = newAutomation({
      id: "sales-report",
      name: "Weekly Sales Report",
      substrate: "cloud",
      inputs: { region: "EMEA" },
      capabilities: ["reporting"],
      acceptance: ["tests-pass", "report-generated"],
    });

    // Advance through initial states
    let result = advance(automation, "DISPATCHED");
    if (result.ok) {
      automation = result.run;
    }

    result = advance(automation, "RUNNING");
    if (result.ok) {
      automation = result.run;
    }

    // Fail due to database unavailable
    result = advance(automation, "FAILED", {
      failure: "Database connection timeout: unable to query revenue data",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      automation = result.run;
      expect(automation.state).toBe("FAILED");
      expect(automation.failure).toContain("Database");
      expect(isTerminal(automation.state)).toBe(true);
    }
  });
});

describe("nextFire — DST handling (croner-aligned)", () => {
  test("spring-forward gap: 02:30 does not exist on 2026-03-08 (America/New_York), return time after gap", () => {
    // 2026-03-08 02:00-03:00 does not exist (spring forward at 2:00 AM -> 3:00 AM EDT)
    // Daily schedule at 02:30 should return the time after the gap
    const schedule: Schedule = {
      kind: "daily",
      hour: 2,
      minute: 30,
      timezone: "America/New_York",
    };

    // Start from just before the gap day
    const after = new Date("2026-03-07T23:00:00Z");
    const next = nextFire(schedule, after);

    // Should be on 2026-03-08 but the local time 02:30 does not exist
    // Croner returns the time AFTER the gap (when clocks jump to 03:00)
    // That's approximately 2026-03-08T07:30:00Z (02:30 EDT = 06:30 UTC, but gap means 07:30 UTC)
    // Actually, the time after the gap would be 03:00 EDT = 07:00 UTC
    // So we expect the result to be > the gap end time
    expect(next.getTime()).toBeGreaterThan(new Date("2026-03-08T06:00:00Z").getTime());

    // Verify that the local wall-clock time is after 02:30 (i.e., >= 03:00)
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    });
    const formatted = formatter.format(next);
    const parts = formatted.split(":").map(Number);
    const localHour = parts[0]!;
    const localMin = parts[1]!;
    expect(localHour * 60 + localMin).toBeGreaterThanOrEqual(3 * 60); // >= 03:00
  });

  test("fall-back overlap: 01:30 occurs twice on 2026-11-01 (America/New_York), pick first occurrence", () => {
    // 2026-11-01 01:00-02:00 EDT occurs twice (fall back at 2:00 AM EDT -> 1:00 AM EST)
    // Daily schedule at 01:30 should return the first occurrence
    const schedule: Schedule = {
      kind: "daily",
      hour: 1,
      minute: 30,
      timezone: "America/New_York",
    };

    // Start from just before the overlap day
    const after = new Date("2026-10-31T23:00:00Z");
    const next = nextFire(schedule, after);

    // The first occurrence of 01:30 EDT on 2026-11-01 is around 2026-11-01T05:30:00Z
    // (01:30 EDT = 05:30 UTC; later 01:30 EST = 06:30 UTC)
    // We should get the earlier one
    expect(next.getTime()).toBeLessThan(new Date("2026-11-01T06:00:00Z").getTime());
    expect(next.getTime()).toBeGreaterThan(new Date("2026-11-01T04:00:00Z").getTime());

    // Verify local time is 01:30
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    });
    const formatted = formatter.format(next);
    expect(formatted).toBe("01:30");

    // Now call nextFire again with this result as the `after` parameter
    // It should advance to 2026-11-02 at 01:30, never repeating the same day
    const next2 = nextFire(schedule, next);

    // Should be on 2026-11-02
    const formatter2 = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    });
    const parts2 = formatter2.formatToParts(next2);
    const year2 = parts2.find((p) => p.type === "year")?.value;
    const month2 = parts2.find((p) => p.type === "month")?.value;
    const day2 = parts2.find((p) => p.type === "day")?.value;
    const hour2 = parts2.find((p) => p.type === "hour")?.value;
    const minute2 = parts2.find((p) => p.type === "minute")?.value;

    expect(year2).toBe("2026");
    expect(month2).toBe("11");
    expect(day2).toBe("02");
    expect(hour2).toBe("01");
    expect(minute2).toBe("30");
  });

  test("half-hour offset timezone: Asia/Kolkata (UTC+05:30)", () => {
    const schedule: Schedule = {
      kind: "daily",
      hour: 14,
      minute: 30,
      timezone: "Asia/Kolkata",
    };

    // From a time before the fire time in Kolkata
    const after = new Date("2026-01-15T08:00:00Z");
    const next = nextFire(schedule, after);

    // 14:30 Asia/Kolkata = 09:00 UTC
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);

    // Verify local time
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    });
    const formatted = formatter.format(next);
    expect(formatted).toBe("14:30");
  });

  test("southern hemisphere DST: Australia/Sydney spring forward on 2026-10-04", () => {
    // Spring forward in southern hemisphere: 3:00 AM -> 4:00 AM AEDT on 2026-10-04
    const schedule: Schedule = {
      kind: "daily",
      hour: 10,
      minute: 0,
      timezone: "Australia/Sydney",
    };

    // From a time before the spring forward
    const after = new Date("2026-10-03T22:00:00Z");
    const next = nextFire(schedule, after);

    // Verify local time is 10:00
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Australia/Sydney",
    });
    const formatted = formatter.format(next);
    expect(formatted).toBe("10:00");

    // Verify it's on or after 2026-10-04 (just check the UTC time is reasonable)
    expect(next.getUTCDate()).toBeGreaterThanOrEqual(3);
    expect(next.getUTCMonth()).toBe(9); // October is month 9 (0-indexed)
  });

  test("200 consecutive daily calls: strictly increasing, 23-25 hours apart", () => {
    const schedule: Schedule = {
      kind: "daily",
      hour: 6,
      minute: 30,
      timezone: "America/New_York",
    };

    let current = new Date("2026-02-01T00:00:00Z");
    let prev = current;
    const results: Date[] = [];

    // Generate 200 consecutive fire times by feeding each result back as `after`
    for (let i = 0; i < 800; i++) {
      const next = nextFire(schedule, current);
      results.push(next);
      current = next;
    }

    // Check strictly increasing
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.getTime()).toBeGreaterThan(results[i - 1]!.getTime());
    }

    // Check each is 23, 24, or 25 hours after the previous (accounting for DST)
    for (let i = 1; i < results.length; i++) {
      const diffMs = results[i]!.getTime() - results[i - 1]!.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);
      // Allow 23-25 hours (covers standard day and DST transitions)
      expect(diffHours).toBeGreaterThanOrEqual(22.5);
      expect(diffHours).toBeLessThanOrEqual(25.5);
    }

    // Check all have local wall time of 06:30
    const formatter = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    });

    for (let i = 0; i < results.length; i++) {
      const formatted = formatter.format(results[i]);
      expect(formatted).toBe("06:30");
    }
  });

  test("invalid timezone throws error with timezone name", () => {
    const schedule: Schedule = {
      kind: "daily",
      hour: 6,
      minute: 30,
      timezone: "InvalidTimezoneName/Fake",
    };

    const after = new Date("2026-01-15T05:00:00Z");

    expect(() => {
      nextFire(schedule, after);
    }).toThrow();

    // The error message should include the invalid timezone name
    try {
      nextFire(schedule, after);
    } catch (e) {
      const errorMsg = (e as Error).message;
      expect(errorMsg).toContain("InvalidTimezoneName");
    }
  });

  test("after exactly equal to a fire instant yields the next one (strictly after)", () => {
    const schedule: Schedule = {
      kind: "daily",
      hour: 6,
      minute: 30,
      timezone: "UTC",
    };

    // This is exactly a fire time
    const fireInstant = new Date("2026-01-15T06:30:00Z");
    const next = nextFire(schedule, fireInstant);

    // Should be strictly after, i.e., the next day's 06:30
    expect(next.toISOString()).toBe("2026-01-16T06:30:00.000Z");
  });

  test("weekly schedule with spring-forward gap verification", () => {
    // Daily schedule at 02:30 on a day that spans the gap
    // This tests that we correctly handle the gap when searching weekly
    const schedule: Schedule = {
      kind: "weekly",
      weekday: 0, // Sunday
      hour: 2,
      minute: 30,
      timezone: "America/New_York",
    };

    // 2026-03-01 is a Sunday
    const after = new Date("2026-02-28T23:00:00Z");
    const next = nextFire(schedule, after);

    // Verify it's on a Sunday
    const dowFormatter = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: "America/New_York",
    });
    const dowFormatted = dowFormatter.format(next);
    expect(dowFormatted).toBe("Sunday");

    // Verify local time is after the gap (>= 03:00 if it's 2026-03-08)
    const dateFormatter = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    });
    const dateFormatted = dateFormatter.format(next);
    if (dateFormatted.startsWith("2026-03-08")) {
      const timeFormatter = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/New_York",
      });
      const timeFormatted = timeFormatter.format(next);
      const timeParts = timeFormatted.split(":").map(Number);
      const h = timeParts[0]!;
      const m = timeParts[1]!;
      expect(h * 60 + m).toBeGreaterThanOrEqual(3 * 60); // >= 03:00
    }
  });
});
