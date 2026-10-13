// Pure sidebar view logic for the session list: archive visibility, ordering, search matching and
// the three "Group by" modes. No React, no client, no I/O — so every rule here is unit-testable
// without a DOM (test/workbench-sidebar-view.test.ts).
//
// T11 (J-SESSION-archive / J-PREFS-shortcuts): archiving is a durable per-session fact folded by the
// `sessions` projection; whether archived conversations are *listed* is a view preference, not a
// stored one, so it lives here rather than in the event log.

/** A session row as the `sessions` projection yields it, plus the view-only shape the sidebar needs. */
export interface SessionRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly lastStatus: string;
  readonly updatedAt: string;
  readonly runId?: string | null;
  /** "ptc" once this session has ever needed a tool-approval escalation. */
  readonly mode?: string;
  /** The session's current access mode, folded from the run input of its latest turn. */
  readonly accessMode?: string;
  /** Durable archive flag (T11). Absent means not archived. */
  readonly archived?: boolean;
}

export interface WorkspaceRow {
  readonly id: string;
  readonly title: string;
  readonly root: string;
  /** Absent on pre-remote records; the UI then treats it as local. */
  readonly executionWorldId?: string;
}

/** The "Filter sessions" pair in the View options menu. `show-archived` is "All conversations". */
export const ARCHIVE_FILTERS = ["hide-archived", "show-archived"] as const;
export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number];

export const ARCHIVE_FILTER_LABELS: Readonly<Record<ArchiveFilter, string>> = {
  "hide-archived": "Hide archived",
  "show-archived": "All conversations (show archived)",
};

export function isArchiveFilter(value: unknown): value is ArchiveFilter {
  return typeof value === "string" && (ARCHIVE_FILTERS as readonly string[]).includes(value);
}

/** Applies the archive filter. Archiving never deletes anything, so this only ever *hides*. */
export function applyArchiveFilter(rows: readonly SessionRow[], filter: ArchiveFilter): readonly SessionRow[] {
  if (filter === "show-archived") return rows;
  return rows.filter((s) => s.archived !== true);
}

/** "Order by" — manual keeps the projection's own order; last-updated sorts `updatedAt` descending. */
export const ORDER_BY_OPTIONS = ["manual", "last-updated"] as const;
export type OrderBy = (typeof ORDER_BY_OPTIONS)[number];

export function orderSessions(rows: readonly SessionRow[], orderBy: OrderBy): readonly SessionRow[] {
  if (orderBy !== "last-updated") return rows;
  return [...rows].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** Case-insensitive match on the session's title (or its "New Session" placeholder) or its id. An
 *  empty query matches everything. */
export function sessionMatchesSearch(session: SessionRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (session.title || "New Session").toLowerCase().includes(q) || session.id.toLowerCase().includes(q);
}

/** The three "Group by" modes. `workspace-sections` (T11) is flat labeled sections with no
 *  tree-collapse behaviour; `workspace-tree` keeps the collapsible tree; `in-one-list` is flat. */
export const GROUP_BY_OPTIONS = ["workspace-tree", "workspace-sections", "in-one-list"] as const;
export type GroupBy = (typeof GROUP_BY_OPTIONS)[number];

export const GROUP_BY_LABELS: Readonly<Record<GroupBy, string>> = {
  "workspace-tree": "Workspace Tree",
  "workspace-sections": "WorkSpace",
  "in-one-list": "In one list",
};

export function isGroupBy(value: unknown): value is GroupBy {
  return typeof value === "string" && (GROUP_BY_OPTIONS as readonly string[]).includes(value);
}

export interface SessionGroup {
  readonly workspaceId: string;
  /** Current title — a renamed workspace shows its new name, never a stale snapshot. */
  readonly title: string;
  readonly root: string;
  readonly executionWorldId?: string;
  readonly sessions: readonly SessionRow[];
}

export interface GroupInput {
  readonly workspaces: readonly WorkspaceRow[];
  readonly sessions: readonly SessionRow[];
  readonly groupBy: GroupBy;
  readonly orderBy: OrderBy;
  readonly archiveFilter: ArchiveFilter;
  readonly search: string;
}

export interface GroupedSessions {
  /** Present for `in-one-list`; absent for the two grouped modes. */
  readonly flat?: readonly SessionRow[];
  /** Present for `workspace-tree` and `workspace-sections`. */
  readonly groups?: readonly SessionGroup[];
}

/**
 * Computes what the sidebar lists.
 *
 * - `in-one-list`: every visible session, ignoring workspace boundaries.
 * - `workspace-tree`: one group per workspace, **including empty ones** (the tree shows
 *   "No sessions yet" so the operator can start one there).
 * - `workspace-sections`: one group per workspace **that has at least one visible session** —
 *   a flat section list has no reason to render an empty heading.
 *
 * A workspace whose sessions are all archived and filtered out therefore disappears from the
 * sections view but stays in the tree.
 */
export function groupSessions(input: GroupInput): GroupedSessions {
  const visible = orderSessions(
    applyArchiveFilter(input.sessions, input.archiveFilter).filter((s) => sessionMatchesSearch(s, input.search)),
    input.orderBy,
  );
  if (input.groupBy === "in-one-list") return { flat: visible };

  const byWorkspace = new Map<string, SessionRow[]>();
  for (const session of visible) {
    const bucket = byWorkspace.get(session.workspaceId);
    if (bucket) bucket.push(session);
    else byWorkspace.set(session.workspaceId, [session]);
  }
  const groups = input.workspaces.map((ws) => ({
    workspaceId: ws.id,
    title: ws.title || ws.id,
    root: ws.root,
    executionWorldId: ws.executionWorldId,
    sessions: byWorkspace.get(ws.id) ?? [],
  }));
  // Workspaces whose sessions reference an id no longer in the list (e.g. deleted workspace) keep
  // their sessions visible rather than silently dropping conversations.
  const known = new Set(input.workspaces.map((ws) => ws.id));
  for (const [workspaceId, sessions] of byWorkspace) {
    if (!known.has(workspaceId)) {
      groups.push({ workspaceId, title: workspaceId, root: workspaceId, executionWorldId: "local", sessions });
    }
  }
  return { groups: input.groupBy === "workspace-sections" ? groups.filter((g) => g.sessions.length > 0) : groups };
}

/** True when the archive filter would currently hide at least one existing session — used to give
 *  the sidebar a visible reason when the list is empty but archived conversations exist. */
export function hiddenArchiveCount(sessions: readonly SessionRow[], filter: ArchiveFilter): number {
  if (filter === "show-archived") return 0;
  return sessions.filter((s) => s.archived === true).length;
}
