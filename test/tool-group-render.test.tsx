import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolGroup } from "../src/ui/App.tsx";
import type { ToolStepLike } from "../src/toolGroups.ts";

function step(
  tool: string,
  toolCallId: string,
  status: ToolStepLike["status"] = "success",
  args: Readonly<Record<string, unknown>> = {},
  error?: string,
): ToolStepLike {
  return error === undefined
    ? { toolCallId, tool, args, status }
    : { toolCallId, tool, args, status, error };
}

describe("ToolGroup", () => {
  test("renders collapsed by default, with the summary visible and no step list", () => {
    const html = renderToStaticMarkup(
      <ToolGroup steps={[step("read", "a", "success", { file_path: "src/a.ts" }), step("read", "b")]} />,
    );
    // The summary is the collapsed affordance...
    expect(html).toContain("Read 2 files");
    // ...and the per-step detail is genuinely hidden, not merely styled away.
    expect(html).not.toContain("src/a.ts");
    // A real disclosure: <button> carrying aria-expanded, per this codebase's convention.
    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="false"');
  });

  test("defaultOpen renders the step list and reports the expanded state", () => {
    const html = renderToStaticMarkup(
      <ToolGroup steps={[step("read", "a", "success", { file_path: "src/a.ts" })]} defaultOpen />,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Read · src/a.ts");
  });

  test("failures are marked in static markup and named in the summary", () => {
    const html = renderToStaticMarkup(
      <ToolGroup steps={[step("bash", "a", "failed", {}, "boom"), step("bash", "b", "failed")]} />,
    );
    // Even collapsed, the failure count is visible...
    expect(html).toContain("2 failed");
    // ...and so is the visual mark, so it does not rely on colour alone.
    expect(html).toContain("tool-group-failed-mark");
    expect(html).toContain("tool-group-failed");
  });

  test("an expanded failing step shows its error text", () => {
    const html = renderToStaticMarkup(
      <ToolGroup steps={[step("bash", "a", "failed", { description: "go" }, "blocked by authority")]} defaultOpen />,
    );
    expect(html).toContain("Bash · go");
    expect(html).toContain("blocked by authority");
  });

  test("a running group shows the live tense and a spinner", () => {
    const html = renderToStaticMarkup(<ToolGroup steps={[step("bash", "a", "running")]} />);
    expect(html).toContain("Running 1 command…");
    expect(html).toContain("tool-group-spinner");
  });

  test("an empty group renders nothing at all", () => {
    expect(renderToStaticMarkup(<ToolGroup steps={[]} />)).toBe("");
  });
});
