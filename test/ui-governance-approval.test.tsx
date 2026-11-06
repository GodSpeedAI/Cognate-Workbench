// Presentation tests for a run waiting on SEA-Forge (P02): the chat card, the continuation parsing
// and the sidebar label. Mirrors test/ui-ambiguous-step.test.tsx.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GovernanceApprovalCard, governanceApprovalOf } from "../src/ui/GovernanceApprovalCard.tsx";
import { SessionRowButton } from "../src/ui/App.tsx";
import type { SessionRow } from "../src/sidebarView.ts";

describe("GovernanceApprovalCard", () => {
  test("says the action has not run, names the external authority and the approval, and offers both decisions", () => {
    const html = renderToStaticMarkup(<GovernanceApprovalCard approvalId="apr-op-1" capability="tool.edit" busy={false} onDecide={() => {}} />);
    expect(html).toContain("Action awaiting approval");
    expect(html).toContain("tool.edit");
    expect(html).toContain("SEA-Forge");
    expect(html).toContain("The action has not run");
    expect(html).toContain("apr-op-1");
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Reject<");
  });

  test("disables both decisions while one is being recorded, and shows an error", () => {
    const html = renderToStaticMarkup(<GovernanceApprovalCard approvalId="apr-op-1" busy={true} error="SEA-Forge refused the resolution" onDecide={() => {}} />);
    expect(html.match(/disabled=""/g)?.length).toBe(2);
    expect(html).toContain("Recording…");
    expect(html).toContain('role="alert"');
    expect(html).toContain("SEA-Forge refused the resolution");
  });
});

describe("governanceApprovalOf", () => {
  test("reads the approval id from the condition and the capability from payload or condition", () => {
    expect(governanceApprovalOf({ condition: { kind: "governance_approval", approvalId: "apr-op-1" }, payload: { capability: "tool.bash" } }))
      .toEqual({ approvalId: "apr-op-1", capability: "tool.bash" });
    expect(governanceApprovalOf({ condition: { kind: "governance_approval", approvalId: "apr-op-2" } })).toEqual({ approvalId: "apr-op-2" });
    expect(governanceApprovalOf({ condition: { kind: "other" } })).toBeUndefined();
  });
});

describe("sidebar", () => {
  const base: SessionRow = { id: "s1", workspaceId: "w1", title: "Edit greeting", lastStatus: "waiting", updatedAt: new Date(0).toISOString() };
  const row = (session: SessionRow) => renderToStaticMarkup(<SessionRowButton session={session} active={false} planPending={false} onOpen={() => {}} onToggleArchive={() => {}} />);
  test("a SEA-Forge escalation reads as an approval wait, not as an unknown wait type", () => {
    const html = row({ ...base, waitingType: "governance-approval" });
    expect(html).toContain("Waiting for approval");
    expect(html).not.toContain("governance-approval");
  });
});
