import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "bun:test";
import { LedgerPanel } from "../src/ui/workbench/LedgerPanel.tsx";
import { WorkerReturnForm } from "../src/ui/workbench/WorkerReturnForm.tsx";
import { ReviewCard } from "../src/ui/workbench/ReviewCard.tsx";
import type { WorkerReturn, Invariant } from "../src/workbench/types.ts";
import type { LedgerRow, LedgerGroup } from "../src/workbench/ledger.ts";

describe("LedgerPanel", () => {
  it("shows empty state when no rows", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <LedgerPanel
          rows={[]}
          groups={[]}
          onRecord={() => {}}
        />
      </div>
    );
    expect(html).toContain("No acceptance criteria yet");
    expect(html).toContain("Add them in the Acceptance field");
  });

  it("shows empty evidence state when no groups", () => {
    const rows: LedgerRow[] = [
      {
        criterionId: "c1",
        kind: "test",
        description: "Must compile",
        required: true,
        state: "open",
        entryIds: [],
      },
    ];
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <LedgerPanel
          rows={rows}
          groups={[]}
          onRecord={() => {}}
        />
      </div>
    );
    expect(html).toContain("No evidence recorded yet");
  });

  it("renders criteria table with correct marks and states", () => {
    const rows: LedgerRow[] = [
      {
        criterionId: "c1",
        kind: "test",
        description: "Must compile",
        required: true,
        state: "closed",
        entryIds: ["e1"],
      },
      {
        criterionId: "c2",
        kind: "independent-check",
        description: "Code reviewed",
        required: false,
        state: "failed",
        entryIds: ["e2"],
      },
      {
        criterionId: "c3",
        kind: "journey",
        description: "End to end works",
        required: true,
        state: "open",
        entryIds: [],
      },
    ];
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <LedgerPanel rows={rows} groups={[]} onRecord={() => {}} />
      </div>
    );
    expect(html).toContain("Must compile");
    expect(html).toContain("Code reviewed");
    expect(html).toContain("End to end works");
    expect(html).toContain("✓");
    expect(html).toContain("✗");
    expect(html).toContain("○");
    expect(html).toContain("closed");
    expect(html).toContain("failed");
    expect(html).toContain("open");
    expect(html).toContain("required");
    expect(html).toContain("optional");
  });

  it("renders evidence groups with marks and text", () => {
    const groups: LedgerGroup[] = [
      {
        group: "Tests",
        marks: [
          { entryId: "e1", mark: "✓", text: "compile test passed" },
          { entryId: "e2", mark: "✗", text: "integration test failed" },
        ],
      },
      {
        group: "Quality",
        marks: [
          { entryId: "e3", mark: "○", text: "audit pending" },
        ],
      },
    ];
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <LedgerPanel rows={[]} groups={groups} onRecord={() => {}} />
      </div>
    );
    expect(html).toContain("Tests");
    expect(html).toContain("Quality");
    expect(html).toContain("compile test passed");
    expect(html).toContain("integration test failed");
    expect(html).toContain("audit pending");
  });

  it("hides form when locked", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <LedgerPanel
          rows={[]}
          groups={[]}
          locked={true}
          onRecord={() => {}}
        />
      </div>
    );
    expect(html).not.toContain("Record evidence");
  });

  it("shows form when not locked", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <LedgerPanel
          rows={[]}
          groups={[]}
          locked={false}
          onRecord={() => {}}
        />
      </div>
    );
    expect(html).toContain("Record evidence");
    expect(html).toContain("Enter a summary");
  });
});

describe("WorkerReturnForm", () => {
  it("renders all fields", () => {
    const initial: WorkerReturn = {
      changed: ["src/index.ts"],
      tested: ["npm run test"],
      evidence: ["e1", "e2"],
      remaining: ["fix edge case"],
      risks: ["might break existing code"],
      readyForReview: false,
    };
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <WorkerReturnForm
          initial={initial}
          onSubmit={() => {}}
        />
      </div>
    );
    expect(html).toContain("Return contract");
    expect(html).toContain("changed, tested, evidence, remaining");
    expect(html).toContain("Changed files");
    expect(html).toContain("Tested");
    expect(html).toContain("Evidence ids");
    expect(html).toContain("Remaining work");
    expect(html).toContain("Risks");
    expect(html).toContain("Ready for review");
    expect(html).toContain("Save return contract");
  });

  it("shows prefilled note", () => {
    const initial: WorkerReturn = {
      changed: [],
      tested: [],
      evidence: [],
      remaining: [],
      risks: [],
      readyForReview: false,
    };
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <WorkerReturnForm initial={initial} onSubmit={() => {}} />
      </div>
    );
    expect(html).toContain("Prefilled from the session trace");
  });

  it("disables form when disabled prop is true", () => {
    const initial: WorkerReturn = {
      changed: [],
      tested: [],
      evidence: [],
      remaining: [],
      risks: [],
      readyForReview: false,
    };
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <WorkerReturnForm
          initial={initial}
          disabled={true}
          onSubmit={() => {}}
        />
      </div>
    );
    expect(html).toContain("Cannot edit while disabled");
  });
});

describe("ReviewCard", () => {
  const invariants: Invariant[] = [
    {
      id: "inv1",
      kind: "domain",
      statement: "Backward compatible API",
    },
  ];
  const blockers = [
    "changed files not reported",
    "evidence not attached",
  ];

  it("shows submit-for-review mode when status is READY", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="READY"
          intent="Add feature X"
          invariants={invariants}
          changed={[]}
          evidence={{ closed: 0, total: 1, failed: 0 }}
          economics="n/a"
          remaining={[]}
          blockers={[]}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    expect(html).toContain("Review");
    expect(html).toContain("Submit for review");
    expect(html).not.toContain("Ready for review");
    expect(html).not.toContain("Accepted by a reviewer");
  });

  it("disables submit button when blockers present", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="READY"
          intent="Add feature X"
          invariants={invariants}
          changed={[]}
          evidence={{ closed: 0, total: 1, failed: 0 }}
          economics="n/a"
          remaining={[]}
          blockers={blockers}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    expect(html).toContain("Not ready for review:");
    expect(html).toContain("changed files not reported");
    expect(html).toContain("evidence not attached");
    expect(html).toContain("Resolve blockers to submit");
  });

  it("shows ready-for-review mode with consequential card", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="READY_FOR_REVIEW"
          intent="Add feature X"
          invariants={invariants}
          changed={["src/main.ts", "test/main.test.ts"]}
          evidence={{ closed: 2, total: 3, failed: 0 }}
          economics="50 tokens, 1s runtime"
          remaining={["handle edge case Y"]}
          blockers={[]}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    expect(html).toContain('aria-label="Review gate"');
    expect(html).toContain("Ready for review");
    expect(html).toContain("Intent");
    expect(html).toContain("Add feature X");
    expect(html).toContain("Invariants");
    expect(html).toContain("Changes");
    expect(html).toContain("src/main.ts");
    expect(html).toContain("Evidence");
    expect(html).toContain("of");
    expect(html).toContain("criteria closed");
    expect(html).toContain("Economics");
    expect(html).toContain("Remaining");
    expect(html).toContain("handle edge case Y");
    expect(html).toContain("Accept");
    expect(html).toContain("Request rework");
  });

  it("shows failed count in ready-for-review when failed > 0", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="READY_FOR_REVIEW"
          intent="Fix bug"
          invariants={[]}
          changed={[]}
          evidence={{ closed: 1, total: 3, failed: 1 }}
          economics="n/a"
          remaining={[]}
          blockers={[]}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    expect(html).toContain("criteria closed");
    expect(html).toContain("failed");
  });

  it("shows no files message when changed is empty", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="READY_FOR_REVIEW"
          intent="Update docs"
          invariants={[]}
          changed={[]}
          evidence={{ closed: 0, total: 0, failed: 0 }}
          economics="n/a"
          remaining={[]}
          blockers={[]}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    expect(html).toContain("No files reported");
  });

  it("shows nothing declared for empty remaining", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="READY_FOR_REVIEW"
          intent="Complete feature"
          invariants={[]}
          changed={[]}
          evidence={{ closed: 0, total: 0, failed: 0 }}
          economics="n/a"
          remaining={[]}
          blockers={[]}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    expect(html).toContain("Nothing declared");
  });

  it("disables buttons when canDecide is false", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="READY_FOR_REVIEW"
          intent="Ready to review"
          invariants={[]}
          changed={[]}
          evidence={{ closed: 0, total: 0, failed: 0 }}
          economics="n/a"
          remaining={[]}
          blockers={[]}
          canDecide={false}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    expect(html).toContain(
      "Only a person can accept work. Sign in as the operator to decide."
    );
  });

  it("shows accepted message when status is ACCEPTED", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="ACCEPTED"
          intent="Done feature"
          invariants={[]}
          changed={[]}
          evidence={{ closed: 0, total: 0, failed: 0 }}
          economics="n/a"
          remaining={[]}
          blockers={[]}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    expect(html).toContain("Accepted by a reviewer");
    expect(html).not.toContain("Submit for review");
    expect(html).not.toContain("Request rework");
  });

  it("shows accepted message when status is OPERATIONALIZED", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="OPERATIONALIZED"
          intent="Complete"
          invariants={[]}
          changed={[]}
          evidence={{ closed: 0, total: 0, failed: 0 }}
          economics="n/a"
          remaining={[]}
          blockers={[]}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    expect(html).toContain("Accepted by a reviewer");
  });

  it("shows invariants list in ready-for-review mode", () => {
    const invariants: Invariant[] = [
      { id: "i1", kind: "domain", statement: "API backward compatible" },
      { id: "i2", kind: "product", statement: "Performance no regression" },
    ];
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="READY_FOR_REVIEW"
          intent="Feature complete"
          invariants={invariants}
          changed={[]}
          evidence={{ closed: 0, total: 0, failed: 0 }}
          economics="n/a"
          remaining={[]}
          blockers={[]}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    expect(html).toContain("Invariants");
    expect(html).toContain("API backward compatible");
    expect(html).toContain("Performance no regression");
  });

  it("has exactly one primary button in ready-for-review mode", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="READY_FOR_REVIEW"
          intent="Test"
          invariants={[]}
          changed={[]}
          evidence={{ closed: 0, total: 0, failed: 0 }}
          economics="n/a"
          remaining={[]}
          blockers={[]}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    const primaryCount = (html.match(/class="wb-btn primary"/g) || []).length;
    expect(primaryCount).toBe(1);
  });

  it("has exactly one primary button in submit mode", () => {
    const html = renderToStaticMarkup(
      <div className="wb-root">
        <ReviewCard
          status="READY"
          intent="Test"
          invariants={[]}
          changed={[]}
          evidence={{ closed: 0, total: 0, failed: 0 }}
          economics="n/a"
          remaining={[]}
          blockers={[]}
          canDecide={true}
          onRequestReview={() => {}}
          onAccept={() => {}}
          onRework={() => {}}
        />
      </div>
    );
    const primaryCount = (html.match(/class="wb-btn primary"/g) || []).length;
    expect(primaryCount).toBe(1);
  });
});
