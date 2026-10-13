// T11 (J-SESSION-archive): pure sidebar view logic — archive visibility, ordering, search and the
// three "Group by" modes. No DOM, no runtime.
import { describe, expect, test } from "bun:test";
import {
  ARCHIVE_FILTER_LABELS,
  GROUP_BY_LABELS,
  applyArchiveFilter,
  groupSessions,
  hiddenArchiveCount,
  isArchiveFilter,
  isGroupBy,
  orderSessions,
  sessionMatchesSearch,
  type SessionRow,
  type WorkspaceRow,
} from "../src/sidebarView.ts";

const row = (over: Partial<SessionRow> & { readonly id: string }): SessionRow => ({
  workspaceId: "ws-a",
  title: "Untitled",
  lastStatus: "done",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const workspaces: readonly WorkspaceRow[] = [
  { id: "ws-a", title: "Alpha", root: "/a", executionWorldId: "local" },
  { id: "ws-b", title: "Beta", root: "/b", executionWorldId: "local" },
  { id: "ws-empty", title: "Empty", root: "/e", executionWorldId: "local" },
];

describe("archive filter", () => {
  test("show-archived returns everything, including archived", () => {
    const rows = [row({ id: "s1" }), row({ id: "s2", archived: true })];
    expect(applyArchiveFilter(rows, "show-archived").map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  test("hide-archived removes only explicitly archived rows", () => {
    // `archived: undefined` is the fold's "not archived" — it must never be treated as archived.
    const rows = [row({ id: "s1" }), row({ id: "s2", archived: false }), row({ id: "s3", archived: true })];
    expect(applyArchiveFilter(rows, "hide-archived").map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  test("labels match the view options menu copy", () => {
    expect(ARCHIVE_FILTER_LABELS["hide-archived"]).toBe("Hide archived");
    expect(ARCHIVE_FILTER_LABELS["show-archived"]).toBe("All conversations (show archived)");
  });

  test("isArchiveFilter rejects anything else", () => {
    expect(isArchiveFilter("hide-archived")).toBe(true);
    expect(isArchiveFilter("show-archived")).toBe(true);
    expect(isArchiveFilter("maybe")).toBe(false);
    expect(isArchiveFilter(undefined)).toBe(false);
  });

  test("hiddenArchiveCount is 0 when showing archived, else counts", () => {
    const rows = [row({ id: "s1", archived: true }), row({ id: "s2", archived: true }), row({ id: "s3" })];
    expect(hiddenArchiveCount(rows, "show-archived")).toBe(0);
    expect(hiddenArchiveCount(rows, "hide-archived")).toBe(2);
    expect(hiddenArchiveCount(rows, "hide-archived")).toBeLessThanOrEqual(rows.length);
  });
});

describe("ordering", () => {
  test("manual keeps the projection's order (stable, no sort)", () => {
    const rows = [row({ id: "s1", updatedAt: "2026-01-03T00:00:00.000Z" }), row({ id: "s2", updatedAt: "2026-01-01T00:00:00.000Z" })];
    expect(orderSessions(rows, "manual").map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  test("last-updated sorts descending and does not mutate the input", () => {
    const rows = [row({ id: "old", updatedAt: "2026-01-01T00:00:00.000Z" }), row({ id: "new", updatedAt: "2026-06-01T00:00:00.000Z" })];
    const sorted = orderSessions(rows, "last-updated");
    expect(sorted.map((s) => s.id)).toEqual(["new", "old"]);
    expect(rows.map((s) => s.id)).toEqual(["old", "new"]);
  });
});

describe("search", () => {
  const s = row({ id: "sess-42", title: "Fix the router" });
  test("empty query matches everything", () => {
    expect(sessionMatchesSearch(s, "")).toBe(true);
    expect(sessionMatchesSearch(s, "   ")).toBe(true);
  });
  test("matches title case-insensitively", () => {
    expect(sessionMatchesSearch(s, "router")).toBe(true);
    expect(sessionMatchesSearch(s, "ROUTER")).toBe(true);
  });
  test("matches the session id too", () => {
    expect(sessionMatchesSearch(s, "sess-42")).toBe(true);
    expect(sessionMatchesSearch(s, "42")).toBe(true);
  });
  test("non-matching query is false", () => {
    expect(sessionMatchesSearch(s, "database")).toBe(false);
  });
});

describe("group by", () => {
  const sessions = [
    row({ id: "a1", workspaceId: "ws-a" }),
    row({ id: "a2", workspaceId: "ws-a", archived: true }),
    row({ id: "b1", workspaceId: "ws-b" }),
    row({ id: "orphan", workspaceId: "ws-deleted" }),
  ];
  const base = { sessions, workspaces, orderBy: "manual" as const, archiveFilter: "show-archived" as const, search: "" };

  test("labels: the WorkSpace option is workspace-sections", () => {
    expect(GROUP_BY_LABELS["workspace-sections"]).toBe("WorkSpace");
    expect(GROUP_BY_LABELS["workspace-tree"]).toBe("Workspace Tree");
    expect(GROUP_BY_LABELS["in-one-list"]).toBe("In one list");
    expect(isGroupBy("workspace-sections")).toBe(true);
    expect(isGroupBy("nope")).toBe(false);
  });

  test("in-one-list flattens everything", () => {
    const out = groupSessions({ ...base, groupBy: "in-one-list" });
    expect(out.flat?.map((s) => s.id)).toEqual(["a1", "a2", "b1", "orphan"]);
    expect(out.groups).toBeUndefined();
  });

  test("workspace-tree keeps empty workspaces so the operator can start one there", () => {
    const out = groupSessions({ ...base, groupBy: "workspace-tree" });
    expect(out.groups?.map((g) => g.workspaceId)).toEqual(["ws-a", "ws-b", "ws-empty", "ws-deleted"]);
    expect(out.groups?.find((g) => g.workspaceId === "ws-empty")?.sessions).toEqual([]);
  });

  test("workspace-sections omits empty workspaces", () => {
    const out = groupSessions({ ...base, groupBy: "workspace-sections" });
    expect(out.groups?.map((g) => g.workspaceId)).toEqual(["ws-a", "ws-b", "ws-deleted"]);
  });

  test("a deleted workspace's sessions stay visible rather than vanishing", () => {
    const out = groupSessions({ ...base, groupBy: "workspace-sections" });
    const orphan = out.groups?.find((g) => g.workspaceId === "ws-deleted");
    expect(orphan?.sessions.map((s) => s.id)).toEqual(["orphan"]);
    expect(orphan?.title).toBe("ws-deleted");
  });

  test("archiving + hide-archived empties a section, which then disappears from sections but not the tree", () => {
    const onlyArchived = [row({ id: "only", workspaceId: "ws-a", archived: true })];
    const sections = groupSessions({ ...base, sessions: onlyArchived, groupBy: "workspace-sections", archiveFilter: "hide-archived" });
    expect(sections.groups).toEqual([]);
    const tree = groupSessions({ ...base, sessions: onlyArchived, groupBy: "workspace-tree", archiveFilter: "hide-archived" });
    // The tree still lists every workspace (including the now-empty ws-a) so the operator can start
    // a new conversation there; the section view has no reason to render empty headings.
    expect(tree.groups?.map((g) => g.workspaceId)).toEqual(["ws-a", "ws-b", "ws-empty"]);
  });

  test("a renamed workspace shows its current title, never a snapshot", () => {
    const out = groupSessions({ ...base, groupBy: "workspace-tree" });
    expect(out.groups?.find((g) => g.workspaceId === "ws-a")?.title).toBe("Alpha");
  });

  test("filters compose: search narrows within the archive filter", () => {
    const out = groupSessions({ ...base, groupBy: "in-one-list", search: "a1" });
    expect(out.flat?.map((s) => s.id)).toEqual(["a1"]);
  });
});
