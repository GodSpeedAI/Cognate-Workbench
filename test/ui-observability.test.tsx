import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SubagentTree, type SubagentRowView } from "../src/ui/App.tsx";

describe("subagent usage display", () => {
  test("reports unavailable usage instead of fabricated zero tokens and duration", () => {
    const row: SubagentRowView = {
      sessionId: "session-1",
      toolCallId: "tool-1",
      title: "Verifier",
      desc: "Check the change",
      prompt: "Check the change",
      status: "completed",
    };
    const html = renderToStaticMarkup(<SubagentTree rows={[row]} onOpen={() => {}} />);

    expect(html).toContain("Usage unavailable");
    expect(html).not.toContain("0 tok");
    expect(html).not.toContain("0s");
  });
});
