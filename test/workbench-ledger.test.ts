import { describe, it, expect } from "bun:test";
import type {
  AcceptanceCriterion,
  EvidenceEntry,
  WorkerReturn,
} from "../src/workbench/types.ts";
import {
  ledgerRows,
  openRequired,
  groupLedger,
  reviewReadiness,
  acceptanceReady,
  doneLevel,
  artifactVerification,
  evidenceClosureForTask,
} from "../src/workbench/ledger.ts";

// ---- Helpers ----

function criterion(
  id: string,
  kind: "test" | "independent-check" | "journey" | "audit" | "integrity" | "human",
  required: boolean = true
): AcceptanceCriterion {
  return {
    id,
    kind,
    description: `Criterion ${id}`,
    required,
  };
}

function entry(
  id: string,
  criterionId: string,
  kind: "test" | "independent-check" | "journey" | "audit" | "integrity" | "human" | "domain" | "implementation" | "quality" | "runtime",
  status: "pass" | "fail" | "pending"
): EvidenceEntry {
  return {
    id,
    taskId: "task-1",
    criterionId,
    kind,
    status,
    summary: `Evidence ${id}`,
  };
}

function workerReturn(
  changed: string[] = ["file.ts"],
  tested: string[] = ["test.ts"],
  evidence: string[] = ["ev-1"],
  remaining: string[] = [],
  readyForReview: boolean = true
): WorkerReturn {
  return {
    changed,
    tested,
    evidence,
    remaining,
    risks: [],
    readyForReview,
  };
}

// ---- Ledger Rows Tests ----

describe("ledgerRows", () => {
  it("closes row when there is a pass entry and no later fail", () => {
    const acc = [criterion("c1", "test")];
    const entries = [entry("ev-1", "c1", "test", "pass")];

    const rows = ledgerRows(acc, entries);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      criterionId: "c1",
      state: "closed",
      entryIds: ["ev-1"],
    });
  });

  it("marks as failed when fail comes after pass", () => {
    const acc = [criterion("c1", "test")];
    const entries = [
      entry("ev-1", "c1", "test", "pass"),
      entry("ev-2", "c1", "test", "fail"),
    ];

    const rows = ledgerRows(acc, entries);

    expect(rows[0]!.state).toBe("failed");
  });

  it("marks as closed when pass comes after fail (later pass reopens)", () => {
    const acc = [criterion("c1", "test")];
    const entries = [
      entry("ev-1", "c1", "test", "fail"),
      entry("ev-2", "c1", "test", "pass"),
    ];

    const rows = ledgerRows(acc, entries);

    expect(rows[0]!.state).toBe("closed");
  });

  it("marks as failed when only fail entries exist", () => {
    const acc = [criterion("c1", "test")];
    const entries = [entry("ev-1", "c1", "test", "fail")];

    const rows = ledgerRows(acc, entries);

    expect(rows[0]!.state).toBe("failed");
  });

  it("marks as open when only pending entries exist", () => {
    const acc = [criterion("c1", "test")];
    const entries = [entry("ev-1", "c1", "test", "pending")];

    const rows = ledgerRows(acc, entries);

    expect(rows[0]!.state).toBe("open");
  });

  it("marks as open when no entries exist", () => {
    const acc = [criterion("c1", "test")];
    const entries: EvidenceEntry[] = [];

    const rows = ledgerRows(acc, entries);

    expect(rows[0]!.state).toBe("open");
  });

  it("returns one row per criterion in order", () => {
    const acc = [
      criterion("c1", "test"),
      criterion("c2", "journey"),
      criterion("c3", "audit"),
    ];
    const entries: EvidenceEntry[] = [];

    const rows = ledgerRows(acc, entries);

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.criterionId)).toEqual(["c1", "c2", "c3"]);
  });

  it("collects all entry ids for a criterion", () => {
    const acc = [criterion("c1", "test")];
    const entries = [
      entry("ev-1", "c1", "test", "pass"),
      entry("ev-2", "c1", "test", "fail"),
      entry("ev-3", "c1", "test", "pending"),
    ];

    const rows = ledgerRows(acc, entries);

    expect(rows[0]!.entryIds).toEqual(["ev-1", "ev-2", "ev-3"]);
  });

  it("preserves kind and required flag from criterion", () => {
    const acc = [
      criterion("c1", "test", true),
      criterion("c2", "journey", false),
    ];
    const entries: EvidenceEntry[] = [];

    const rows = ledgerRows(acc, entries);

    expect(rows[0]).toMatchObject({
      kind: "test",
      required: true,
    });
    expect(rows[1]).toMatchObject({
      kind: "journey",
      required: false,
    });
  });
});

// ---- openRequired Tests ----

describe("openRequired", () => {
  it("returns required rows that are not closed", () => {
    const rows = [
      {
        criterionId: "c1",
        kind: "test" as const,
        description: "Test",
        required: true,
        state: "open" as const,
        entryIds: [],
      },
      {
        criterionId: "c2",
        kind: "test" as const,
        description: "Test",
        required: true,
        state: "closed" as const,
        entryIds: ["ev-1"],
      },
      {
        criterionId: "c3",
        kind: "test" as const,
        description: "Test",
        required: true,
        state: "failed" as const,
        entryIds: ["ev-2"],
      },
      {
        criterionId: "c4",
        kind: "test" as const,
        description: "Test",
        required: false,
        state: "open" as const,
        entryIds: [],
      },
    ];

    const open = openRequired(rows);

    expect(open).toHaveLength(2);
    expect(open.map((r) => r.criterionId)).toEqual(["c1", "c3"]);
  });

  it("returns empty when all required rows are closed", () => {
    const rows = [
      {
        criterionId: "c1",
        kind: "test" as const,
        description: "Test",
        required: true,
        state: "closed" as const,
        entryIds: ["ev-1"],
      },
    ];

    const open = openRequired(rows);

    expect(open).toHaveLength(0);
  });
});

// ---- groupLedger Tests ----

describe("groupLedger", () => {
  it("groups entries by kind with correct marks", () => {
    const entries = [
      { ...entry("ev-1", "c1", "domain", "pass"), criterionId: undefined },
      { ...entry("ev-2", "c2", "implementation", "fail"), criterionId: undefined },
      { ...entry("ev-3", "c3", "test", "pending"), criterionId: undefined },
    ];

    const groups = groupLedger(entries);

    // Should have Domain, Implementation, Tests groups
    expect(groups.map((g) => g.group)).toEqual(["Domain", "Implementation", "Tests"]);

    // Check marks
    const domainGroup = groups.find((g) => g.group === "Domain")!;
    expect(domainGroup.marks[0]!.mark).toBe("✓");

    const implementationGroup = groups.find((g) => g.group === "Implementation")!;
    expect(implementationGroup.marks[0]!.mark).toBe("✗");

    const testsGroup = groups.find((g) => g.group === "Tests")!;
    expect(testsGroup.marks[0]!.mark).toBe("○");
  });

  it("groups test, independent-check, integrity under Tests", () => {
    const entries = [
      { ...entry("ev-1", "c1", "test", "pass"), criterionId: undefined },
      { ...entry("ev-2", "c2", "independent-check", "pass"), criterionId: undefined },
      { ...entry("ev-3", "c3", "integrity", "pass"), criterionId: undefined },
    ];

    const groups = groupLedger(entries);

    const testsGroup = groups.find((g) => g.group === "Tests")!;
    expect(testsGroup.marks).toHaveLength(3);
  });

  it("groups journey and runtime under Runtime", () => {
    const entries = [
      { ...entry("ev-1", "c1", "journey", "pass"), criterionId: undefined },
      { ...entry("ev-2", "c2", "runtime", "pass"), criterionId: undefined },
    ];

    const groups = groupLedger(entries);

    const runtimeGroup = groups.find((g) => g.group === "Runtime")!;
    expect(runtimeGroup.marks).toHaveLength(2);
  });

  it("groups audit and quality under Quality", () => {
    const entries = [
      { ...entry("ev-1", "c1", "audit", "pass"), criterionId: undefined },
      { ...entry("ev-2", "c2", "quality", "pass"), criterionId: undefined },
    ];

    const groups = groupLedger(entries);

    const qualityGroup = groups.find((g) => g.group === "Quality")!;
    expect(qualityGroup.marks).toHaveLength(2);
  });

  it("groups human under Review", () => {
    const entries = [
      { ...entry("ev-1", "c1", "human", "pass"), criterionId: undefined },
    ];

    const groups = groupLedger(entries);

    expect(groups.find((g) => g.group === "Review")).toBeDefined();
  });

  it("omits empty groups", () => {
    const entries = [
      { ...entry("ev-1", "c1", "domain", "pass"), criterionId: undefined },
    ];

    const groups = groupLedger(entries);

    expect(groups.map((g) => g.group)).toEqual(["Domain"]);
  });

  it("maintains fixed group order", () => {
    const entries = [
      { ...entry("ev-1", "c1", "human", "pass"), criterionId: undefined },
      { ...entry("ev-2", "c2", "domain", "pass"), criterionId: undefined },
      { ...entry("ev-3", "c3", "test", "pass"), criterionId: undefined },
    ];

    const groups = groupLedger(entries);

    expect(groups.map((g) => g.group)).toEqual(["Domain", "Tests", "Review"]);
  });
});

// ---- reviewReadiness Tests (V-008 + V-009) ----

describe("reviewReadiness (V-008 + V-009)", () => {
  it("blocks when worker return contract is missing", () => {
    const acc = [criterion("c1", "test")];
    const entries: EvidenceEntry[] = [];

    const readiness = reviewReadiness({ acceptance: acc, entries });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("worker return contract missing");
  });

  it("blocks when changed files not reported", () => {
    const acc = [criterion("c1", "test")];
    const entries = [entry("ev-1", "c1", "test", "pass")];
    const wr = workerReturn([], ["test.ts"], ["ev-1"]);

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: wr });

    expect(readiness.blockers).toContain("changed files not reported");
  });

  it("blocks when tests not reported", () => {
    const acc = [criterion("c1", "test")];
    const entries = [entry("ev-1", "c1", "test", "pass")];
    const wr = workerReturn(["file.ts"], [], ["ev-1"]);

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: wr });

    expect(readiness.blockers).toContain("tests not reported");
  });

  it("blocks when evidence not attached", () => {
    const acc = [criterion("c1", "test")];
    const entries = [entry("ev-1", "c1", "test", "pass")];
    const wr = workerReturn(["file.ts"], ["test.ts"], []);

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: wr });

    expect(readiness.blockers).toContain("evidence not attached");
  });

  it("blocks when remaining work not declared (not an array)", () => {
    const acc = [criterion("c1", "test")];
    const entries = [entry("ev-1", "c1", "test", "pass")];
    const wr = workerReturn();
    // Cast to bypass type check for test
    const invalidWr = { ...wr, remaining: undefined as unknown as string[] };

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: invalidWr });

    expect(readiness.blockers).toContain("remaining work not declared");
  });

  it("blocks when worker did not declare ready for review", () => {
    const acc = [criterion("c1", "test")];
    const entries = [entry("ev-1", "c1", "test", "pass")];
    const wr = workerReturn(["file.ts"], ["test.ts"], ["ev-1"], [], false);

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: wr });

    expect(readiness.blockers).toContain("worker did not declare ready for review");
  });

  it("blocks when evidence id not found in ledger", () => {
    const acc = [criterion("c1", "test")];
    const entries = [entry("ev-1", "c1", "test", "pass")];
    const wr = workerReturn(["file.ts"], ["test.ts"], ["ev-999"]);

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: wr });

    expect(readiness.blockers).toContain("evidence ev-999 not found in ledger");
  });

  it("blocks for each open required non-human criterion", () => {
    const acc = [
      criterion("c1", "test", true),
      criterion("c2", "journey", true),
      criterion("c3", "human", true),
    ];
    const entries = [
      entry("ev-1", "c1", "test", "pending"),
      entry("ev-2", "c2", "journey", "pending"),
    ];
    const wr = workerReturn();

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: wr });

    expect(readiness.blockers).toContain("criterion c1 (test) not closed");
    expect(readiness.blockers).toContain("criterion c2 (journey) not closed");
    expect(readiness.blockers).not.toContain("criterion c3 (human) not closed"); // human not a blocker
  });

  it("ready when all checks pass", () => {
    const acc = [criterion("c1", "test")];
    const entries = [entry("ev-1", "c1", "test", "pass")];
    const wr = workerReturn();

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: wr });

    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
  });

  it("V-009: blocks when required independent-check is open while all required tests are closed", () => {
    const acc = [
      criterion("c1", "test", true),
      criterion("c2", "independent-check", true),
    ];
    const entries = [
      entry("ev-1", "c1", "test", "pass"),
      entry("ev-2", "c2", "independent-check", "pending"),
    ];
    const wr = workerReturn();

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: wr });

    expect(readiness.blockers).toContain("independent check required but tests alone passed");
    expect(readiness.blockers).toContain("criterion c2 (independent-check) not closed");
  });

  it("does not block for V-009 when no required independent-check exists", () => {
    const acc = [criterion("c1", "test", true)];
    const entries = [entry("ev-1", "c1", "test", "pass")];
    const wr = workerReturn();

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: wr });

    expect(readiness.blockers).not.toContain("independent check required but tests alone passed");
  });

  it("does not block for V-009 when a required test is still open", () => {
    const acc = [
      criterion("c1", "test", true),
      criterion("c2", "independent-check", true),
    ];
    const entries = [
      entry("ev-1", "c1", "test", "pending"),
      entry("ev-2", "c2", "independent-check", "pending"),
    ];
    const wr = workerReturn();

    const readiness = reviewReadiness({ acceptance: acc, entries, workerReturn: wr });

    expect(readiness.blockers).not.toContain("independent check required but tests alone passed");
  });
});

// ---- acceptanceReady Tests ----

describe("acceptanceReady", () => {
  it("ready when all required criteria are closed", () => {
    const acc = [
      criterion("c1", "test", true),
      criterion("c2", "journey", true),
    ];
    const entries = [
      entry("ev-1", "c1", "test", "pass"),
      entry("ev-2", "c2", "journey", "pass"),
    ];

    const readiness = acceptanceReady({ acceptance: acc, entries, humanApproved: false });

    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
  });

  it("not ready when required non-human criterion is not closed", () => {
    const acc = [criterion("c1", "test", true)];
    const entries = [entry("ev-1", "c1", "test", "pending")];

    const readiness = acceptanceReady({ acceptance: acc, entries, humanApproved: false });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("criterion c1 (test) not closed");
  });

  it("ready when human criterion is closed by humanApproved flag", () => {
    const acc = [criterion("c1", "human", true)];
    const entries: EvidenceEntry[] = [];

    const readiness = acceptanceReady({ acceptance: acc, entries, humanApproved: true });

    expect(readiness.ready).toBe(true);
  });

  it("ready when human criterion has a passing entry", () => {
    const acc = [criterion("c1", "human", true)];
    const entries = [entry("ev-1", "c1", "human", "pass")];

    const readiness = acceptanceReady({ acceptance: acc, entries, humanApproved: false });

    expect(readiness.ready).toBe(true);
  });

  it("not ready when human criterion has no passing entry and humanApproved is false", () => {
    const acc = [criterion("c1", "human", true)];
    const entries = [entry("ev-1", "c1", "human", "pending")];

    const readiness = acceptanceReady({ acceptance: acc, entries, humanApproved: false });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("criterion c1 (human) not closed");
  });

  it("ignores non-required criteria", () => {
    const acc = [
      criterion("c1", "test", true),
      criterion("c2", "test", false),
    ];
    const entries = [
      entry("ev-1", "c1", "test", "pass"),
      entry("ev-2", "c2", "test", "pending"),
    ];

    const readiness = acceptanceReady({ acceptance: acc, entries, humanApproved: false });

    expect(readiness.ready).toBe(true);
  });
});

// ---- doneLevel Tests ----

describe("doneLevel", () => {
  it("returns not-started when finished is false", () => {
    const level = doneLevel({
      finished: false,
      produced: true,
      readiness: { ready: true, blockers: [] },
      testedClosed: true,
      accepted: true,
      operationalized: true,
    });

    expect(level).toBe("not-started");
  });

  it("returns finished when finished is true but produced is false", () => {
    const level = doneLevel({
      finished: true,
      produced: false,
      readiness: { ready: true, blockers: [] },
      testedClosed: true,
      accepted: true,
      operationalized: true,
    });

    expect(level).toBe("finished");
  });

  it("returns produced when finished and produced are true but testedClosed is false", () => {
    const level = doneLevel({
      finished: true,
      produced: true,
      readiness: { ready: true, blockers: [] },
      testedClosed: false,
      accepted: true,
      operationalized: true,
    });

    expect(level).toBe("produced");
  });

  it("returns tested when finished, produced, testedClosed are true but readiness is not satisfied", () => {
    const level = doneLevel({
      finished: true,
      produced: true,
      readiness: { ready: false, blockers: ["blocker"] },
      testedClosed: true,
      accepted: true,
      operationalized: true,
    });

    expect(level).toBe("tested");
  });

  it("returns tested when readiness is undefined", () => {
    const level = doneLevel({
      finished: true,
      produced: true,
      readiness: undefined,
      testedClosed: true,
      accepted: true,
      operationalized: true,
    });

    expect(level).toBe("tested");
  });

  it("returns ready-for-review when readiness is satisfied but accepted is false", () => {
    const level = doneLevel({
      finished: true,
      produced: true,
      readiness: { ready: true, blockers: [] },
      testedClosed: true,
      accepted: false,
      operationalized: true,
    });

    expect(level).toBe("ready-for-review");
  });

  it("returns accepted when all preconditions met but operationalized is false", () => {
    const level = doneLevel({
      finished: true,
      produced: true,
      readiness: { ready: true, blockers: [] },
      testedClosed: true,
      accepted: true,
      operationalized: false,
    });

    expect(level).toBe("accepted");
  });

  it("returns operationalized when all conditions are true", () => {
    const level = doneLevel({
      finished: true,
      produced: true,
      readiness: { ready: true, blockers: [] },
      testedClosed: true,
      accepted: true,
      operationalized: true,
    });

    expect(level).toBe("operationalized");
  });
});

// ---- artifactVerification Tests ----

describe("artifactVerification", () => {
  it("returns unverified when evidenceIds is empty", () => {
    const entries = [entry("ev-1", "c1", "test", "pass")];

    const result = artifactVerification([], entries);

    expect(result).toBe("unverified");
  });

  it("returns verified when all evidenceIds exist with status pass", () => {
    const entries = [
      entry("ev-1", "c1", "test", "pass"),
      entry("ev-2", "c2", "test", "pass"),
    ];

    const result = artifactVerification(["ev-1", "ev-2"], entries);

    expect(result).toBe("verified");
  });

  it("returns unverified when an evidence id does not exist", () => {
    const entries = [entry("ev-1", "c1", "test", "pass")];

    const result = artifactVerification(["ev-1", "ev-999"], entries);

    expect(result).toBe("unverified");
  });

  it("returns unverified when an evidence id has status fail", () => {
    const entries = [
      entry("ev-1", "c1", "test", "pass"),
      entry("ev-2", "c2", "test", "fail"),
    ];

    const result = artifactVerification(["ev-1", "ev-2"], entries);

    expect(result).toBe("unverified");
  });

  it("returns unverified when an evidence id has status pending", () => {
    const entries = [
      entry("ev-1", "c1", "test", "pass"),
      entry("ev-2", "c2", "test", "pending"),
    ];

    const result = artifactVerification(["ev-1", "ev-2"], entries);

    expect(result).toBe("unverified");
  });
});

// ---- evidenceClosureForTask Tests ----

describe("evidenceClosureForTask", () => {
  it("returns distinct kinds with at least one pass entry", () => {
    const entries = [
      { ...entry("ev-1", "c1", "test", "pass"), criterionId: undefined },
      { ...entry("ev-2", "c1", "test", "pass"), criterionId: undefined },
      { ...entry("ev-3", "c2", "domain", "pass"), criterionId: undefined },
    ];

    const kinds = evidenceClosureForTask(entries);

    expect(kinds).toContain("test");
    expect(kinds).toContain("domain");
    expect(kinds).toHaveLength(2);
  });

  it("returns in first-seen order", () => {
    const entries = [
      { ...entry("ev-1", "c1", "journey", "pass"), criterionId: undefined },
      { ...entry("ev-2", "c2", "test", "pass"), criterionId: undefined },
      { ...entry("ev-3", "c3", "journey", "pass"), criterionId: undefined },
    ];

    const kinds = evidenceClosureForTask(entries);

    expect(kinds).toEqual(["journey", "test"]);
  });

  it("excludes entries with fail or pending status", () => {
    const entries = [
      { ...entry("ev-1", "c1", "test", "fail"), criterionId: undefined },
      { ...entry("ev-2", "c2", "test", "pending"), criterionId: undefined },
      { ...entry("ev-3", "c3", "domain", "pass"), criterionId: undefined },
    ];

    const kinds = evidenceClosureForTask(entries);

    expect(kinds).toEqual(["domain"]);
  });

  it("returns empty array when no pass entries exist", () => {
    const entries = [
      { ...entry("ev-1", "c1", "test", "fail"), criterionId: undefined },
      { ...entry("ev-2", "c2", "test", "pending"), criterionId: undefined },
    ];

    const kinds = evidenceClosureForTask(entries);

    expect(kinds).toHaveLength(0);
  });

  it("returns empty array when entries is empty", () => {
    const kinds = evidenceClosureForTask([]);

    expect(kinds).toHaveLength(0);
  });
});
