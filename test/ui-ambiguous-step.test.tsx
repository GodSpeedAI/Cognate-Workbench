// Presentation tests for an interrupted agent step awaiting operator reconciliation: the chat card
// and the sidebar label. Mirrors the static-markup style of test/ui-experts.test.tsx.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AmbiguousStepCard } from "../src/ui/AmbiguousStepCard.tsx";
import { SessionRowButton } from "../src/ui/App.tsx";
import type { SessionRow } from "../src/sidebarView.ts";

describe("AmbiguousStepCard", () => {
  test("says the step was interrupted, not repeated, and only the operator can record the outcome", () => {
    const html = renderToStaticMarkup(<AmbiguousStepCard capability="expert.model.generate" busy={false} onReconcile={() => {}} />);
    expect(html).toContain("Interrupted step needs reconciliation");
    expect(html).toContain("expert.model.generate");
    expect(html).toContain("interrupted by a restart");
    expect(html).toContain("it was NOT repeated");
    expect(html).toContain("Only the operator can record what actually happened");
  });

  test("offers an observed-outcome select defaulting to failed, a required observation field and the record button", () => {
    const html = renderToStaticMarkup(<AmbiguousStepCard capability="tool.bash" busy={false} onReconcile={() => {}} />);
    expect(html).toContain("Observed outcome");
    expect(html).toMatch(/<option value="failed" selected="">/);
    expect(html).toContain("Step did not complete");
    expect(html).toContain("Step completed");
    expect(html).toContain("What did you observe?");
    expect(html).toMatch(/<textarea required=""/);
    expect(html).toContain("Record reconciliation");
    expect(html).toMatch(/<button type="submit" disabled="">Record reconciliation<\/button>/);
  });

  test("a model call offers only a retry, never a confirmed success", () => {
    const html = renderToStaticMarkup(<AmbiguousStepCard capability="expert.model.generate" modelCall busy={false} onReconcile={() => {}} />);
    expect(html).toContain("Retry the model call");
    expect(html).not.toContain("Step completed");
    expect(html).not.toContain('value="succeeded"');
    expect(html).toContain("no external effect to confirm");
  });

  test("shows a recording state while the reconciliation is in flight", () => {
    const html = renderToStaticMarkup(<AmbiguousStepCard capability="tool.bash" busy={true} onReconcile={() => {}} />);
    expect(html).toContain("Recording…");
  });
});

describe("sidebar label for a waiting run", () => {
  const base: SessionRow = { id: "s1", workspaceId: "w1", title: "Build the report", lastStatus: "waiting", updatedAt: new Date(0).toISOString() };
  const row = (session: SessionRow) => renderToStaticMarkup(<SessionRowButton session={session} active={false} planPending={false} onOpen={() => {}} onToggleArchive={() => {}} />);

  test("an interrupted step reads Needs reconciliation, never Waiting for approval", () => {
    const html = row({ ...base, waitingType: "ambiguous-invocation" });
    expect(html).toContain("Needs reconciliation");
    expect(html).toContain("Reconcile");
    expect(html).not.toContain("Waiting for approval");
    expect(html).not.toContain(">Approval<");
  });

  test("a tool approval keeps the existing approval label", () => {
    const html = row({ ...base, waitingType: "tool-approval" });
    expect(html).toContain("Waiting for approval");
    expect(html).toContain(">Approval<");
    expect(html).not.toContain("Needs reconciliation");
  });

  test("an unknown waiting type is named rather than labelled as approval", () => {
    const html = row({ ...base, waitingType: "novel-gate" });
    expect(html).toContain("Waiting: novel-gate");
    expect(html).not.toContain("Waiting for approval");
  });
});
