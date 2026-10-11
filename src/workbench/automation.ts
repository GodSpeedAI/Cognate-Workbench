/**
 * Workbench automation: operationalized accepted workflows.
 * Automation = skill composition + input binding + schedule + execution substrate + outcome gate.
 * Lifecycle: SCHEDULED -> DISPATCHED -> RUNNING -> PRODUCED -> VERIFIED -> COMPLETE (or FAILED from any non-terminal).
 * @module src/workbench/automation
 */

import type { AutomationState, ExecutionSubstrate } from "./types.ts";
import { AUTOMATION_STATES } from "./types.ts";

/** Schedule: daily or weekly recurring task at a wall-clock time in a specific timezone. */
export type Schedule =
  | { readonly kind: "daily"; readonly hour: number; readonly minute: number; readonly timezone: string }
  | {
      readonly kind: "weekly";
      readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday
      readonly hour: number;
      readonly minute: number;
      readonly timezone: string;
    };

/**
 * Find the next instant (strictly after `after`) when the schedule fires in its timezone.
 * For daily: next occurrence of the wall-clock time.
 * For weekly: next occurrence of that weekday at the wall-clock time.
 * @param schedule - The schedule rule.
 * @param after - Search starts strictly after this instant (inclusive lower bound is after + 1ms).
 * @returns The next instant in UTC when the local wall-clock time in schedule.timezone matches the schedule.
 */
export function nextFire(schedule: Schedule, after: Date): Date {
  const afterMs = after.getTime();
  const tzName = schedule.timezone;

  // Search forward up to 8 days (covers weekly search) + 14 for safety
  const maxDaysAhead = 14;

  for (let dayOffset = 0; dayOffset <= maxDaysAhead; dayOffset++) {
    // Candidate date: start from after + dayOffset days
    const candidateDate = new Date(afterMs);
    candidateDate.setUTCDate(candidateDate.getUTCDate() + dayOffset);
    candidateDate.setUTCHours(0, 0, 0, 0);

    // For this candidate day, try to build the UTC instant for schedule.hour:schedule.minute in the given timezone
    const candidateUtc = buildUtcForLocalTime(candidateDate, schedule.hour, schedule.minute, tzName);

    // Check if this candidate is strictly after `after`
    if (candidateUtc.getTime() > afterMs) {
      // For weekly, verify the weekday matches
      if (schedule.kind === "weekly") {
        const candidateDow = getWeekdayInTimezone(candidateUtc, tzName);
        if (candidateDow === schedule.weekday) {
          return candidateUtc;
        }
      } else {
        // Daily: any day is fine, we found it
        return candidateUtc;
      }
    }
  }

  // Fallback (should not reach here with maxDaysAhead large enough)
  throw new Error("Could not find next fire time within search horizon");
}

/**
 * Describe a schedule in human-readable form.
 * @param s - The schedule.
 * @returns A string like "Daily 06:30 UTC" or "Monday 08:00 America/New_York".
 */
export function describeSchedule(s: Schedule): string {
  const timeStr = `${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`;

  if (s.kind === "daily") {
    return `Daily ${timeStr} ${s.timezone}`;
  }

  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = weekdays[s.weekday];
  return `${dayName} ${timeStr} ${s.timezone}`;
}

/**
 * An automation run: a dispatch-able, progressible instance of an automation workflow.
 */
export interface AutomationRun {
  readonly id: string;
  readonly name: string;
  readonly state: AutomationState;
  readonly substrate: ExecutionSubstrate;
  readonly inputs: Readonly<Record<string, string>>;
  readonly capabilities: readonly string[];
  readonly acceptance: readonly string[]; // acceptance criterion IDs
  readonly closedAcceptance: readonly string[]; // acceptance criterion IDs that have been satisfied
  readonly outputs: readonly string[];
  readonly failure?: string; // error message if state is FAILED
}

/**
 * Create a new automation run in SCHEDULED state.
 * @param input - Configuration for the new automation.
 * @returns A new AutomationRun in SCHEDULED state with empty closedAcceptance and outputs.
 */
export function newAutomation(input: {
  readonly id: string;
  readonly name: string;
  readonly substrate: ExecutionSubstrate;
  readonly inputs: Readonly<Record<string, string>>;
  readonly capabilities: readonly string[];
  readonly acceptance: readonly string[];
}): AutomationRun {
  return {
    id: input.id,
    name: input.name,
    state: "SCHEDULED",
    substrate: input.substrate,
    inputs: input.inputs,
    capabilities: input.capabilities,
    acceptance: input.acceptance,
    closedAcceptance: [],
    outputs: [],
  };
}

/** Result of an automation operation: success with the updated run, or failure with an error message. */
export type AutomationResult = { readonly ok: true; readonly run: AutomationRun } | { readonly ok: false; readonly error: string };

/**
 * Advance an automation run to the next state in the lifecycle (V-012 validation rules).
 * - Only the immediate next state in AUTOMATION_STATES order is allowed, or FAILED from any non-terminal.
 * - SCHEDULED -> DISPATCHED -> RUNNING -> PRODUCED -> VERIFIED -> COMPLETE
 * - FAILED is terminal and can be reached from any non-terminal state.
 * - COMPLETE and FAILED are terminal states.
 *
 * Gate rules:
 * - To PRODUCED: facts.outputs must be non-empty (or existing run.outputs must be non-empty).
 * - To VERIFIED: every ID in run.acceptance must appear in the merged closedAcceptance.
 * - To COMPLETE: current state must be VERIFIED (delivery receipt cannot complete).
 * - FAILED requires facts.failure to be provided.
 *
 * @param run - The current automation run.
 * @param to - The target state.
 * @param facts - Optional updates (outputs, closedAcceptance, failure).
 * @returns Success with the updated run, or failure with an error message.
 */
export function advance(
  run: AutomationRun,
  to: AutomationState,
  facts?: {
    readonly outputs?: readonly string[];
    readonly closedAcceptance?: readonly string[];
    readonly failure?: string;
  }
): AutomationResult {
  // Terminal states cannot be advanced
  if (run.state === "COMPLETE" || run.state === "FAILED") {
    return { ok: false, error: `Cannot advance from terminal state ${run.state}` };
  }

  // Check if transition is valid: either next in sequence or FAILED from any non-terminal
  let isValidTransition = false;

  if (to === "FAILED") {
    // FAILED can be reached from any non-terminal state
    isValidTransition = true;
    if (!facts?.failure) {
      return { ok: false, error: "FAILED requires facts.failure to be provided" };
    }
  } else {
    // Must be the next state in AUTOMATION_STATES
    const stateArray = AUTOMATION_STATES as readonly string[];
    const currentIndex = stateArray.indexOf(run.state as string);
    const targetIndex = stateArray.indexOf(to as string);

    if (currentIndex === -1 || targetIndex === -1) {
      return { ok: false, error: `Invalid state: ${run.state} or ${to}` };
    }

    isValidTransition = targetIndex === currentIndex + 1;

    if (!isValidTransition) {
      return {
        ok: false,
        error: `Cannot skip states: ${run.state} -> ${to}. Expected ${AUTOMATION_STATES[currentIndex + 1]}`,
      };
    }
  }

  if (!isValidTransition) {
    return { ok: false, error: `Invalid state transition: ${run.state} -> ${to}` };
  }

  // Apply gate rules specific to the target state
  let mergedOutputs = run.outputs;
  let mergedClosedAcceptance = [...run.closedAcceptance];
  let failure = run.failure;

  if (to === "PRODUCED") {
    // Gate: must have outputs
    mergedOutputs = facts?.outputs ?? run.outputs;
    if (mergedOutputs.length === 0) {
      return { ok: false, error: "nothing produced" };
    }
  }

  if (to === "VERIFIED") {
    // Gate: all acceptance criteria must be closed
    if (facts?.closedAcceptance) {
      mergedClosedAcceptance = Array.from(new Set([...run.closedAcceptance, ...facts.closedAcceptance]));
    }

    const openIds: string[] = [];
    for (const id of run.acceptance) {
      if (!mergedClosedAcceptance.includes(id)) {
        openIds.push(id);
      }
    }

    if (openIds.length > 0) {
      return { ok: false, error: `Cannot verify: acceptance criteria not closed: ${openIds.join(", ")}` };
    }
  }

  if (to === "COMPLETE") {
    // Gate: must be in VERIFIED state first (delivery receipt cannot complete)
    if (run.state !== "VERIFIED") {
      return { ok: false, error: `Cannot complete from ${run.state}; must be VERIFIED first` };
    }
  }

  if (to === "FAILED") {
    failure = facts?.failure ?? run.failure;
  }

  // Build the updated run
  const updated: AutomationRun = {
    ...run,
    state: to,
    outputs: mergedOutputs,
    closedAcceptance: mergedClosedAcceptance,
    failure,
  };

  return { ok: true, run: updated };
}

/**
 * Handle a delivery receipt: indicates that a SCHEDULED automation has been dispatched.
 * If the run is SCHEDULED, advance to DISPATCHED.
 * Otherwise, return an error.
 * @param run - The current automation run.
 * @returns Success with the updated run (now DISPATCHED), or failure.
 */
export function deliveryReceipt(run: AutomationRun): AutomationResult {
  if (run.state === "SCHEDULED") {
    return advance(run, "DISPATCHED");
  }

  return { ok: false, error: "receipt only means DISPATCHED" };
}

/**
 * Describe an execution substrate: label, whether it survives quitting the app, and a user note.
 * @param substrate - The execution substrate.
 * @returns Information about the substrate.
 */
export function substrateNote(
  substrate: ExecutionSubstrate
): { readonly label: string; readonly survivesQuit: boolean; readonly note: string } {
  switch (substrate) {
    case "local-desktop":
      return {
        label: "local-desktop",
        survivesQuit: false,
        note: "Runs only while this app is open",
      };

    case "local-service":
      return {
        label: "local-service",
        survivesQuit: true,
        note: "Runs in the background service; closing the app does not stop it",
      };

    case "remote-runner":
      return {
        label: "remote-runner",
        survivesQuit: true,
        note: "Runs in the background service; closing the app does not stop it",
      };

    case "cloud":
      return {
        label: "cloud",
        survivesQuit: true,
        note: "Runs in the background service; closing the app does not stop it",
      };
  }
}

/**
 * Check if a state is terminal (no further transitions possible).
 * @param state - The state to check.
 * @returns True if COMPLETE or FAILED, false otherwise.
 */
export function isTerminal(state: AutomationState): boolean {
  return state === "COMPLETE" || state === "FAILED";
}

// ---- Helpers for timezone-aware time computation ----

/**
 * Get the weekday (0=Sunday) for a UTC instant in a given timezone.
 */
function getWeekdayInTimezone(utcDate: Date, tzName: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: tzName,
  });

  const parts = formatter.formatToParts(utcDate);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";

  const weekdayMap: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };

  return weekdayMap[weekdayStr] ?? 0;
}

/**
 * Build the UTC instant corresponding to a specific local time in a timezone.
 * DST handling cross-checked against croner (MIT) src/date.ts and src/helpers/timezone.ts @ 713ee72; re-implemented.
 * Handles DST gaps (spring-forward: return time after gap) and overlaps (fall-back: return first occurrence).
 * @param candidateDate - A UTC date (used only to set the calendar day; time is ignored).
 * @param hour - Target local hour.
 * @param minute - Target local minute.
 * @param tzName - IANA timezone name.
 * @returns A UTC Date where local wall-clock time in tzName equals hour:minute.
 */
function buildUtcForLocalTime(candidateDate: Date, hour: number, minute: number, tzName: string): Date {
  // Get the UTC date components for the candidate day
  const year = candidateDate.getUTCFullYear();
  const month = candidateDate.getUTCMonth() + 1; // 1-12
  const date = candidateDate.getUTCDate();

  // Validate timezone by attempting to format a test date
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: tzName,
    });
    // Test the formatter to catch invalid timezone
    formatter.formatToParts(new Date());
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Invalid timezone '${tzName}'. Please provide a valid IANA timezone (e.g., 'America/New_York', 'Europe/Stockholm'). Original error: ${errorMessage}`
    );
  }

  // Start with a UTC guess: noon on that day (arbitrary middle point)
  const guessUtc = new Date(Date.UTC(year, month - 1, date, 12, 0, 0, 0));

  // Read what time it is in the target timezone at this guess
  const guessLocal = parseFormattedLocalTime(guessUtc, tzName, formatter);

  // Compute offset: what UTC time do we need to be at to get hour:minute local?
  // offset = (guess_local - target_local) => (target_utc = guess_utc - offset)
  const offsetHours = guessLocal.hour - hour;
  const offsetMinutes = guessLocal.minute - minute;
  const offsetMs = (offsetHours * 60 + offsetMinutes) * 60 * 1000;

  // First guess
  const dateGuess1 = new Date(guessUtc.getTime() - offsetMs);
  const check1 = parseFormattedLocalTime(dateGuess1, tzName, formatter);

  // If the first guess matches, check for DST overlap (fall-back)
  if (check1.hour === hour && check1.minute === minute) {
    // First guess matched. Now check if there's an earlier UTC time (1 hour earlier)
    // that also produces the same local time. If yes, we're in a DST overlap.
    const altGuess = new Date(dateGuess1.getTime() - 3600000); // 1 hour earlier
    const altCheck = parseFormattedLocalTime(altGuess, tzName, formatter);

    if (altCheck.hour === hour && altCheck.minute === minute) {
      // Both the current and 1-hour-earlier times produce the same local time.
      // We're in a DST overlap. Return the earlier one (first occurrence).
      return altGuess;
    }

    // First guess matched and there's no overlap, so return it.
    return dateGuess1;
  }

  // First guess didn't match. Refine with a second iteration.
  const dateGuess2 = new Date(dateGuess1.getTime() - ((check1.hour - hour) * 60 + (check1.minute - minute)) * 60 * 1000);
  const check2 = parseFormattedLocalTime(dateGuess2, tzName, formatter);

  if (check2.hour === hour && check2.minute === minute) {
    // Second guess matched. Check for overlap again.
    const altGuess = new Date(dateGuess2.getTime() - 3600000);
    const altCheck = parseFormattedLocalTime(altGuess, tzName, formatter);

    if (altCheck.hour === hour && altCheck.minute === minute) {
      // We're in a DST overlap. Return the earlier one (first occurrence).
      return altGuess;
    }

    // Second guess matched without overlap, return it.
    return dateGuess2;
  }

  // Neither guess matched. We're in a DST gap (spring-forward).
  // Return the later of the two guesses (the time after the gap).
  return dateGuess1.getTime() > dateGuess2.getTime() ? dateGuess1 : dateGuess2;
}

/**
 * Parse a formatted local date/time string to extract numeric hour, minute, etc.
 */
function parseFormattedLocalTime(
  utcDate: Date,
  tzName: string,
  formatter: Intl.DateTimeFormat
): { hour: number; minute: number; second: number } {
  try {
    const parts = formatter.formatToParts(utcDate);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    const second = parseInt(parts.find((p) => p.type === "second")?.value ?? "0", 10);

    return { hour, minute, second };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Invalid timezone '${tzName}'. Please provide a valid IANA timezone (e.g., 'America/New_York', 'Europe/Stockholm'). Original error: ${errorMessage}`
    );
  }
}
