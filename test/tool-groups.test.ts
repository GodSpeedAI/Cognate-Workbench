// Unit tests for the collapsed tool-activity mechanism (plan T01).
//
// These assert the *mechanism* ported from PandaCode — grouping, the run cap, boundary handling and
// summary clause assembly — not the donor's HTML. The four teeth named in the plan each appear below
// and are labelled, because a suite that only checks the happy path would not catch a cap that does
// not bind, a narration row swallowed into a group, or a summary that reads as success when calls
// failed.
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TOOL_RUN_CAP,
  TOOL_KINDS,
  groupToolRuns,
  summarizeToolRuns,
  toolActionLabelFor,
  toolDetail,
  toolStepKey,
  toolStepLabelFor,
  type ToolRun,
  type ToolStepLike,
} from "../src/toolGroups.ts";

function step(tool: string, toolCallId: string, status: ToolStepLike["status"] = "success"): ToolStepLike {
  return { toolCallId, tool, args: {}, status };
}

/** A narration row: no `toolCallId`, so the extractor yields `undefined` and it becomes a boundary. */
interface Narration {
  readonly text: string;
}

type Entry = ToolStepLike | Narration;

function keyOf(entry: Entry): string | undefined {
  return "toolCallId" in entry ? entry.toolCallId : undefined;
}

/** Narrow a run to its tool form, failing loudly instead of silently skipping a test. */
function asToolRun<T>(run: ToolRun<T> | undefined): Extract<ToolRun<T>, { kind: "tools" }> {
  expect(run?.kind).toBe("tools");
  if (run === undefined || run.kind !== "tools") throw new Error("expected a tool run");
  return run;
}

describe("groupToolRuns", () => {
  test("consecutive calls collapse into one run keyed by the first call", () => {
    const runs = groupToolRuns([step("read", "a"), step("read", "b"), step("bash", "c")], toolStepKey);
    expect(runs).toHaveLength(1);
    const run = asToolRun(runs[0]);
    expect(run.items).toHaveLength(3);
    // Stable key: the run is addressed by its FIRST call, so it survives entries streaming in.
    expect(run.key).toBe("a");
  });

  test("TEETH: 7 consecutive calls with cap 5 produce 2 runs, not 1", () => {
    const calls = Array.from({ length: 7 }, (_, i) => step("read", `call-${i}`));
    const runs = groupToolRuns(calls, toolStepKey);
    expect(runs).toHaveLength(2);
    const [first, second] = runs;
    expect(asToolRun(first).items).toHaveLength(DEFAULT_TOOL_RUN_CAP);
    expect(asToolRun(second).items).toHaveLength(2);
    // The second run's key is the 6th call's id — proof the cap bound rather than being cosmetic.
    expect(asToolRun(second).key).toBe("call-5");
  });

  test("TEETH: a narration entry breaks the run and is never a group child", () => {
    const entries: Entry[] = [
      step("read", "a"),
      step("edit", "b"),
      { text: "Now I'll check the tests." },
      step("read", "c"),
    ];
    const runs = groupToolRuns(entries, keyOf);
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.kind)).toEqual(["tools", "message", "tools"]);
    // The narration is its own row, so it can never be counted in a summary clause.
    const middle = runs[1];
    if (middle?.kind !== "message") throw new Error("expected the narration to be its own row");
    expect((middle.item as Narration).text).toContain("check the tests");
    // Neither tool run absorbed it: 2 then 1.
    expect(asToolRun(runs[0]).items).toHaveLength(2);
    expect(asToolRun(runs[2]).items).toHaveLength(1);
  });

  test("all-narration input yields no tool runs", () => {
    const runs = groupToolRuns<Entry>([{ text: "one" }, { text: "two" }], keyOf);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.kind === "message")).toBe(true);
  });

  test("an empty turn yields no runs", () => {
    expect(groupToolRuns<ToolStepLike>([], toolStepKey)).toHaveLength(0);
  });

  test("a non-positive cap still groups (clamped) instead of dropping calls", () => {
    // Degenerate input must not silently lose entries.
    const runs = groupToolRuns([step("read", "a"), step("read", "b")], toolStepKey, 0);
    expect(runs).toHaveLength(2);
    expect(asToolRun(runs[0]).items).toHaveLength(1);
  });

  test("input is not mutated", () => {
    const entries = [step("read", "a"), step("read", "b")];
    const snapshot = JSON.stringify(entries);
    groupToolRuns(entries, toolStepKey);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});

describe("summarizeToolRuns", () => {
  test("names one clause per tool kind with correct singular/plural", () => {
    expect(summarizeToolRuns([step("bash", "a")]).text).toBe("Ran 1 command");
    expect(summarizeToolRuns([step("read", "a"), step("read", "b")]).text).toBe("Read 2 files");
    expect(summarizeToolRuns([step("bash", "a"), step("bash", "b"), step("bash", "c")]).text)
      .toBe("Ran 3 commands");
  });

  test("joins two clauses with 'and' and no Oxford comma", () => {
    const steps = [step("bash", "a"), step("bash", "b"), step("read", "c")];
    expect(summarizeToolRuns(steps).text).toBe("Ran 2 commands and read 1 file");
  });

  test("caps named clauses at 2 and reports the remainder as 'and N more steps'", () => {
    const steps = [step("bash", "a"), step("read", "b"), step("edit", "c")];
    const summary = summarizeToolRuns(steps);
    // Three distinct kinds, only two named; the third is counted in the remainder.
    expect(summary.text).toBe("Ran 1 command, read 1 file and 1 more step");
    expect(summary.text).toContain("1 more step");
  });

  test("pluralises the remainder", () => {
    const steps = [
      step("bash", "a"), step("read", "b"), step("edit", "c"), step("subagent", "d"), step("run_code", "e"),
    ];
    expect(summarizeToolRuns(steps).text).toContain("3 more steps");
  });

  test("TEETH: failures are appended so the summary cannot read as success", () => {
    const steps = [
      step("bash", "a", "failed"),
      step("bash", "b", "failed"),
      step("read", "c"),
    ];
    const summary = summarizeToolRuns(steps);
    expect(summary.failedCount).toBe(2);
    // Failed calls still count in their clause (the donor groups by kind, not by outcome), so the
    // tally after the separator is what prevents the line reading as unqualified success.
    expect(summary.text).toBe("Ran 2 commands and read 1 file · 2 failed");
    expect(summary.text.endsWith("· 2 failed")).toBe(true);
  });

  test("a run that is entirely failed still states the count", () => {
    const steps = Array.from({ length: 6 }, (_, i) => step("bash", `c-${i}`, "failed"));
    const summary = summarizeToolRuns(steps);
    expect(summary.text).toBe("Ran 6 commands · 6 failed");
    expect(summary.failedCount).toBe(6);
  });

  test("a still-running call uses present tense and a trailing ellipsis", () => {
    const summary = summarizeToolRuns([step("bash", "a", "running"), step("bash", "b")]);
    expect(summary.running).toBe(true);
    expect(summary.text).toBe("Running 2 commands…");
  });

  test("a settled run has no ellipsis and past tense", () => {
    const summary = summarizeToolRuns([step("bash", "a"), step("bash", "b")]);
    expect(summary.running).toBe(false);
    expect(summary.text).not.toContain("…");
    expect(summary.text.startsWith("Ran")).toBe(true);
  });

  test("running plus failed reads honestly together", () => {
    const summary = summarizeToolRuns([step("bash", "a", "running"), step("bash", "b", "failed")]);
    expect(summary.text).toBe("Running 2 commands… · 1 failed");
  });

  test("an invariant noun is never counted or pluralised", () => {
    // `updated 2 the plan` would be wrong; the donor special-cases this and so must we.
    expect(summarizeToolRuns([step("todo_write", "a"), step("todo_write", "b")]).text)
      .toBe("Updated the plan");
  });

  test("an unknown tool degrades to a generic count instead of inventing a noun", () => {
    expect(summarizeToolRuns([step("mystery_tool", "a"), step("mystery_tool", "b")]).text)
      .toBe("Used 2 tools");
  });

  test("no steps yields an empty summary rather than a stray clause", () => {
    const summary = summarizeToolRuns([]);
    expect(summary.text).toBe("");
    expect(summary.failedCount).toBe(0);
    expect(summary.running).toBe(false);
  });
});

describe("TOOL_KINDS table", () => {
  test("covers exactly the tools the two label functions knew about", () => {
    // Regression guard: the table replaced two hand-maintained switch statements. If a tool is
    // dropped from it, that tool silently loses its label in both renderers.
    expect(Object.keys(TOOL_KINDS).sort()).toEqual(
      ["bash", "edit", "exit_plan_mode", "read", "run_code", "subagent", "todo_write"].sort(),
    );
  });

  test("every entry carries both a noun and an action", () => {
    for (const [tool, kind] of Object.entries(TOOL_KINDS)) {
      expect(kind.noun, `${tool} noun`).toBeTruthy();
      expect(kind.action, `${tool} action`).toBeTruthy();
    }
  });

  test("TEETH: table-driven labels reproduce the pre-change strings exactly", () => {
    // The four work-details modes x the seven tools, asserted against the literal strings the two
    // original functions returned. This is the equivalence proof for the refactor: it must be
    // byte-identical or the observability tests downstream would drift.
    const args: Record<string, Record<string, unknown>> = {
      read: { file_path: "src/greet.ts" },
      edit: { file_path: "src/greet.ts" },
      bash: { description: "run tests" },
      run_code: { description: "sum 1..3" },
      todo_write: {},
      exit_plan_mode: {},
      subagent: { description: "check the change" },
    };
    // Pre-change `verboseStepLabel` output, verbatim from src/ui/App.tsx:3208-3218.
    const expectedVerbose: Record<string, string> = {
      read: "Read · src/greet.ts",
      edit: "Edit · src/greet.ts",
      bash: "Bash · run tests",
      run_code: "Run code · sum 1..3",
      todo_write: "To-dos · todo_write",
      exit_plan_mode: "Plan review · exit_plan_mode",
      subagent: "Subagent · check the change",
    };
    for (const [tool, kind] of Object.entries(TOOL_KINDS)) {
      const detail = toolDetail(tool, args[tool] ?? {});
      // The settled line is "<noun> · <detail>"; two tools use their own name as the detail.
      const rendered = kind.nameIsDetail ? `${kind.noun} · ${tool}` : `${kind.noun} · ${detail}`;
      // Every key in TOOL_KINDS has a counterpart above by construction; assert it rather than
      // passing a possibly-undefined value into `toBe` (`noUncheckedIndexedAccess`).
      const expected = expectedVerbose[tool];
      if (expected === undefined) throw new Error(`missing pre-change fixture for ${tool}`);
      expect(rendered, `${tool} verbose label`).toBe(expected);
    }
  });

  test("bash falls back to the raw command when there is no description", () => {
    expect(toolDetail("bash", { command: "ls -la" })).toBe("ls -la");
    // The human description wins when both are present.
    expect(toolDetail("bash", { description: "list files", command: "ls -la" })).toBe("list files");
  });

  test("a tool with no detail args yields an empty suffix", () => {
    expect(toolDetail("read", {})).toBe("");
    expect(toolDetail("todo_write", { file_path: "ignored" })).toBe("");
  });

  test("an unknown tool has no detail and no invented label", () => {
    expect(toolDetail("mystery_tool", { file_path: "x" })).toBe("");
    expect(TOOL_KINDS["mystery_tool"]).toBeUndefined();
  });

  test("empty-string args do not produce a dangling separator", () => {
    // `Read · ` with a trailing space would look like a rendering bug; "" suppresses the suffix.
    expect(toolDetail("read", { file_path: "" })).toBe("");
    expect(toolDetail("read", { file_path: "   " })).toBe("");
  });
});


describe("label builders", () => {
  test("TEETH: live labels are byte-identical to the pre-change behaviour", () => {
    // Verbatim expectations from src/ui/App.tsx:2349-2365, for both `showDetail` settings, i.e. all
    // four work-details modes (standard/detailed => true, compact/verbose => false).
    const cases: readonly {
      tool: string;
      args: Readonly<Record<string, unknown>>;
      withDetail: string;
      withoutDetail: string;
    }[] = [
      {
        tool: "read",
        args: { file_path: "src/greet.ts" },
        withDetail: "Reading files · src/greet.ts",
        withoutDetail: "Reading files",
      },
      {
        tool: "edit",
        args: { file_path: "src/greet.ts" },
        withDetail: "Editing files · src/greet.ts",
        withoutDetail: "Editing files",
      },
      {
        tool: "bash",
        args: { description: "run the tests" },
        withDetail: "Running commands · run the tests",
        withoutDetail: "Running commands",
      },
      {
        tool: "run_code",
        args: { description: "sum 1..3" },
        withDetail: "Running code · sum 1..3",
        withoutDetail: "Running code",
      },
      // Name-is-detail tools ignore the mode flag entirely.
      {
        tool: "todo_write",
        args: {},
        withDetail: "Updating the plan · todo_write",
        withoutDetail: "Updating the plan · todo_write",
      },
      {
        tool: "exit_plan_mode",
        args: {},
        withDetail: "Calling tools · exit_plan_mode",
        withoutDetail: "Calling tools · exit_plan_mode",
      },
      {
        tool: "subagent",
        args: { description: "check the change" },
        withDetail: "Coordinating subagents · check the change",
        withoutDetail: "Coordinating subagents",
      },
    ];
    for (const c of cases) {
      expect(toolActionLabelFor(c.tool, c.args, true), `${c.tool} detailed`).toBe(c.withDetail);
      expect(toolActionLabelFor(c.tool, c.args, false), `${c.tool} compact`).toBe(c.withoutDetail);
    }
  });

  test("an unknown tool keeps the original 'Running <tool>' fallback", () => {
    expect(toolActionLabelFor("mystery_tool", {}, true)).toBe("Running mystery_tool");
    // ...and the settled label falls back to the bare name, as before.
    expect(toolStepLabelFor("mystery_tool", {})).toBe("mystery_tool");
  });

  test("settled labels are always detailed, whatever the mode", () => {
    // `verboseStepLabel` never consulted the work-details mode; the settled list is the detail view.
    expect(toolStepLabelFor("read", { file_path: "a.ts" })).toBe("Read · a.ts");
    expect(toolStepLabelFor("bash", { description: "build" })).toBe("Bash · build");
  });
});


