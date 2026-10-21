import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Json } from "@godspeedai/cognate-events";
import { useCognate, useContinuations, useProjection } from "@godspeedai/cognate-react";
import { ComposerBar } from "./workbench/ComposerBar.tsx";
import { WorkbenchView, useBindableTasks } from "./workbench/Workbench.tsx";
import { ExpertsTeamsPanel } from "./experts/ExpertsTeamsPanel.tsx";
import { captureSnapshot, resolveAttention, withReferent, type FocusRef } from "../workbench/focus.ts";
import { renderMarkdown } from "./markdown.ts";
import { AmbiguousStepCard } from "./AmbiguousStepCard.tsx";
import { CognitiveFrame, SurfaceView } from "./CognitiveFrame.tsx";
import { SshWorkspaceForm, WorldBanner, WslWorkspaceForm, useExecutionWorlds } from "./RemoteWorkspaceForm.tsx";
import { DirectoryField } from "./DirectoryField.tsx";
import { errorText } from "./workbench/data.ts";
import type { TraceRow, TraceRequest, TraceTool, TraceTurn } from "../projections/sessionTrace.ts";
import { TOOL_DEFS } from "../agents/agentCoding.ts";
import {
  DEFAULT_WORK_DETAILS_MODE,
  WORK_DETAILS_LABELS,
  WORK_DETAILS_MODES,
  isWorkDetailsMode,
  showsLiveProcessDetail,
  type WorkDetailsMode,
} from "../workDetails.ts";
import {
  AGENT_PRESETS,
  AGENT_PRESET_LABELS,
  APPEARANCE_MODES,
  LANGUAGE_CODES,
  LANGUAGE_LABELS,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  PERFORMANCE_DETAIL_LABELS,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  SEND_BEHAVIOR_LABELS,
  SEND_BEHAVIORS,
  isAppearanceMode,
  isPermissionMode,
  pluginEnabled,
  resolveGeneralSettings,
  type AgentPreset,
  type AppearanceMode,
  type GeneralSettings,
  type PermissionMode,
  type SendBehavior,
} from "../settings.ts";
import {
  CheckIcon,
  ChevronDownIcon,
  PluginIcon,
  ChevronRightIcon,
  CodeViewIcon,
  MoreIcon,
  SearchIcon,
  SlidersIcon,
  CollapseIcon,
  CopyIcon,
  EditIcon,
  FileIcon,
  FolderIcon,
  FullscreenIcon,
  GearIcon,
  ListViewIcon,
  LogoIcon,
  PanelRightIcon,
  PlusIcon,
  SendIcon,
  SplitViewIcon,
  StopIcon,
  TrashIcon,
} from "./icons.tsx";
import {
  ARCHIVE_FILTER_LABELS,
  GROUP_BY_LABELS,
  applyArchiveFilter,
  groupSessions,
  hiddenArchiveCount,
  orderSessions,
  sessionMatchesSearch,
  type ArchiveFilter,
  type GroupBy,
  type OrderBy,
  type SessionRow,
  type SessionGroup,
} from "../sidebarView.ts";
import {
  SHORTCUT_ACTIONS,
  chordFromKeyboardEvent,
  describeChord,
  effectiveChord,
  isChord,
  isDefault,
  restoreDefaults,
  validateAssignment,
} from "../shortcuts.ts";
import type { ConfigPathResult } from "../capabilities/configPath.ts";
import { copyToClipboard, downloadTextFile } from "./download.ts";
import type { ModelCatalogResult } from "../modelCatalog.ts";
import type { PluginCatalogResult } from "../capabilities/pluginInstall.ts";
import { catalogEntry, optionalPluginEnabled, type PluginStatus, type PluginView } from "../plugins.ts";
import { diffHunk, renderFileAfterChange, renderUnifiedPatch, reviewTabKey, type EditSummary, type ReviewTab } from "../reviewPatch.ts";
import type { ShortcutOverrides } from "../shortcuts.ts";

interface WorkspaceRow {
  readonly id: string;
  readonly root: string;
  readonly title: string;
  /** Where the root lives (`local`, or a connected SSH/WSL world). Absent on pre-remote records. */
  readonly executionWorldId?: string;
}

// `SessionRow` now comes from `src/sidebarView.ts` (T11): the same shape plus the durable
// `archived` flag, so the sidebar's grouping/filter/order logic is shared with its unit tests.

interface ChatMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly at?: string;
  readonly tookMs?: number;
  readonly failed?: boolean;
  readonly cancelled?: boolean;
  /** T11 (J-H-provider-error): the terminal `turn.failed` payload — renders "This turn failed" /
   *  message / CODE (reference-behavior-matrix.md §8). */
  readonly failureCode?: string;
  readonly failureMessage?: string;
  /** Final retry count out of `MAX_MODEL_RETRIES` (5) once the turn failed — "Retried model request
   *  (k/5) · Ns" settles at this value (reference-behavior-matrix.md §8). */
  readonly retryCount?: number;
  /** The last successful `edit` tool call this turn made, if any (`10-file-change-*`). */
  readonly editSummary?: EditSummary;
  /** Step count for this turn — `useToolTimeline(activeRunId).length + 1` at finalize time (the
   *  `+1` is the model's own generation step, present even with zero tool calls or on a cancelled
   *  turn) — feeds the composer footer's "N turns M steps" counter. Critic round-2 batch A P1:
   *  counters must reflect a cancelled turn too, not stay pinned at 0. Critic round-3 P2-2: the
   *  round-2 fix used the raw tool-call count with no `+1`, so a cancelled turn with no completed
   *  tool calls still showed "0 steps" against reference's "1 steps" — reference/observations/aria/
   *  {15-completed-session,19-cancelled,09-tool-complete,12-approval-resolved-allow,
   *  13c-plan-completed}.desktop.txt confirm steps = tool-call count + 1 in every observed case
   *  (0→1, 1→2, 2→3, 3→4). */
  readonly stepCount?: number;
  /** True for the live in-progress preview bubble — suppresses the "Worked"/"Took Ns" status row,
   *  which only makes sense once the turn has actually finished (also what `CognateDriver.waitForIdle`
   *  in the parity-capture suite keys off of — a status row on a still-streaming bubble made it
   *  detect "idle" far too early for a multi-step tool turn; see `tests/drivers/cognate.ts`). */
  readonly streaming?: boolean;
  /** Snapshot of this turn's `useToolTimeline(activeRunId)` entries at finalize time — only used by
   *  the "Verbose" Work details mode (reference-behavior-matrix.md §10a: `foldCompletedTurns: false`
   *  — every step stays visible individually instead of folding behind the "Took Ns" disclosure).
   *  Not persisted across a reload/session-switch (this app's `session.history` only returns
   *  `stepCount`, not per-step detail — see docs/known-gaps.md); a reloaded historical turn falls
   *  back to the folded view even under Verbose. */
  readonly steps?: readonly ToolEntry[];
}

interface ToolEntry {
  readonly toolCallId: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: "running" | "success" | "failed";
  readonly result?: unknown;
  readonly error?: string;
  readonly approval?: { readonly status: "pending" | "approved" | "denied"; readonly permission?: string; readonly justification?: string; readonly surface?: unknown };
}

interface PlanTodo {
  readonly content: string;
  readonly status: string;
}

interface PlanStateRow {
  readonly sessionId: string;
  readonly on: boolean;
  readonly todos: readonly PlanTodo[];
  readonly review?: { readonly status: "pending" | "approved" | "changes_requested"; readonly toolCallId: string; readonly heading: string; readonly markdown: string };
}

interface ModelConfigRow {
  readonly providerId: string;
  readonly baseURL: string;
  readonly protocol: string;
  readonly model: string;
  readonly configuredAt: string;
}

// T11 removed the `NOT_IMPLEMENTED` "disabled control" marker: every control it guarded is now
// wired to a real capability, so no surface ships a button that explains itself only via tooltip.

function useCurrentWorkspaceId(): string | undefined {
  const rows = useProjection("workspaces");
  const current = rows?.find((r) => r.key === "current");
  return typeof current?.value === "string" ? current.value : undefined;
}

function useWorkspaces(): readonly WorkspaceRow[] {
  const rows = useProjection("workspaces");
  return useMemo(
    () => (rows ?? []).filter((r) => r.key.startsWith("record/")).map((r) => r.value as unknown as WorkspaceRow),
    [rows],
  );
}

function useSessions(): readonly SessionRow[] {
  const rows = useProjection("sessions");
  return useMemo(
    () =>
      (rows ?? [])
        .filter((r) => !r.key.includes("/"))
        .map((r) => r.value as unknown as SessionRow),
    [rows],
  );
}

/** J-TASK-scope/link: the durable Task↔Session binding row for one session (`session-task-bindings`
 *  projection, written by the validated `session.task.bind` capability). Absent row = never bound
 *  (an equally valid "no task"); `taskId: null` = an explicit detach. */
export interface SessionTaskBindingRow {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly taskId: string | null;
}

function useSessionTaskBinding(sessionId: string | undefined): SessionTaskBindingRow | undefined {
  // J-TASK-scope/link: subscribe only when a session is actually open. With no session there is no
  // binding to show, and mounting the store anyway would make the client keep one more projection
  // in sync for the whole app lifetime (the already-mounted "sessions" store is reused instead —
  // the client memoizes projection stores by name, so this costs nothing extra).
  const rows = useProjection(sessionId === undefined ? "sessions" : "session-task-bindings");
  return useMemo(
    () => (sessionId ? ((rows ?? []).find((r) => r.key === sessionId)?.value as unknown as SessionTaskBindingRow | undefined) : undefined),
    [rows, sessionId],
  );
}

/** Reads the `plans` projection (`src/projections/plans.ts`) for one session — the To-dos widget,
 *  the plan review card, and the sidebar's "Plan awaiting review <title>" prefix all key off this. */
function usePlanState(sessionId: string | undefined): PlanStateRow | undefined {
  const rows = useProjection("plans");
  return useMemo(() => {
    if (!sessionId) return undefined;
    const row = rows?.find((r) => r.key === sessionId);
    return row ? (row.value as unknown as PlanStateRow) : undefined;
  }, [rows, sessionId]);
}

export interface SubagentRowView {
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly title: string;
  readonly desc: string;
  readonly prompt: string;
  readonly status: "running" | "completed" | "failed";
  readonly output?: string;
}

/** J-F-delegation: this session's subagent rows (keyed `${parentRunId}/${toolCallId}` in
 *  `src/projections/subagents.ts` — fire-and-forget delegation has no single parent run to key off
 *  of, so rows are matched by their own `sessionId` field instead) — the banner's "N subagent(s)"
 *  disclosure and the "Subagent sessions" tree (reference-behavior-matrix.md §6.4,
 *  `14b-subagent-completed-panel`). */
function useSubagents(sessionId: string | undefined): readonly SubagentRowView[] {
  const rows = useProjection("subagents");
  return useMemo(() => {
    if (!sessionId) return [];
    return (rows ?? [])
      .map((r) => r.value as unknown as SubagentRowView)
      .filter((r) => r.sessionId === sessionId);
  }, [rows, sessionId]);
}

/** Session ids with a currently-pending plan review — for the sidebar's "Plan awaiting review
 *  <title>" prefix (reference-behavior-matrix.md §6.3, `13b-plan-review-prompt`'s treeitem). */
function usePlanReviewPendingSessions(): ReadonlySet<string> {
  const rows = useProjection("plans");
  return useMemo(() => {
    const set = new Set<string>();
    for (const row of rows ?? []) {
      const value = row.value as unknown as PlanStateRow;
      if (value?.review?.status === "pending") set.add(row.key);
    }
    return set;
  }, [rows]);
}

function useModelConfig(): ModelConfigRow | undefined {
  const rows = useProjection("model-config");
  const current = rows?.find((r) => r.key === "current");
  return current ? (current.value as unknown as ModelConfigRow) : undefined;
}

/** Settings -> General inventory (usage pass U2, reference-behavior-matrix.md §11): the current
 *  values of every General setting, folded from durable `settings.changed` events (the `settings`
 *  projection's single "current" row) with per-field defaults for a fresh home — same durability
 *  as every other setting in this app (model-config, onboarding), so each survives both a reload
 *  and a full runtime restart. The legacy `localStorage["cognate.theme"]` value seeds `appearance`
 *  only until the first explicit choice (theme persistence moved into this durable row this
 *  tranche, matching the reference's persisted Appearance). */
function useGeneralSettings(): GeneralSettings {
  const rows = useProjection("settings");
  const current = rows?.find((r) => r.key === "current");
  return useMemo(() => {
    let legacyAppearance: string | undefined;
    try {
      legacyAppearance = localStorage.getItem("cognate.theme") ?? undefined;
    } catch {
      legacyAppearance = undefined;
    }
    return resolveGeneralSettings(current?.value, legacyAppearance);
  }, [current]);
}

/** Usage pass U7: the durable RealityTrace plugin state and its toggle. The state folds from
 *  `settings.changed` events (`plugins` map, per-key merge) so it survives a reload AND a full
 *  runtime restart; the toggle invokes `settings.changePlugin`, whose only side effect is the
 *  durable event — the observation drain gate reads the same fold per cycle (server.ts). */
function useRealityTracePlugin(): { readonly enabled: boolean; readonly toggle: (enabled: boolean) => Promise<void> } {
  const client = useCognate();
  const rows = useProjection("settings");
  const current = rows?.find((r) => r.key === "current");
  // The row value is the WHOLE settings record — the plugin map lives in its `plugins` field.
  const plugins = (current?.value as { plugins?: Record<string, boolean> } | undefined)?.plugins;
  const enabled = pluginEnabled(plugins, "realitytrace");
  const toggle = useCallback(
    async (next: boolean) => {
      try {
        await client.invoke("settings.changePlugin", { plugins: { realitytrace: next } } as never);
      } catch (error) {
        console.error("settings: settings.changePlugin failed", error);
      }
    },
    [client],
  );
  return { enabled, toggle };
}

/** Resolves the durable `appearance` setting ("light"/"dark"/"system") to the concrete theme the
 *  shell renders with, following the OS color scheme live while "system" is selected (usage pass
 *  U2 — "System" is the new third Appearance option; default per reference §11). */
function useTheme(appearance: AppearanceMode): string {
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const theme = appearance === "system" ? (systemDark ? "dark" : "light") : appearance;
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return theme;
}

/** Whether the given first-run step (`"notice"` | `"apikey"`) has already been dismissed for this
 *  `COGNATE_HARNESS_HOME` — folded from durable `onboarding.dismissed` events (`onboarding`
 *  projection). Absence of a row is what makes the first-run dialog pair reappear on a fresh home,
 *  same mechanism the reference uses per-`DSH_HOME` (critic round-1 P0-1). */
function useOnboardingDismissed(step: "notice" | "apikey"): boolean {
  const rows = useProjection("onboarding");
  // `ReadProjection` strips the tenant prefix the projection stores keys with (same convention as
  // `model-config`'s "current" / `workspaces`'s "record/<id>" rows) — the row key here is the bare
  // step name, not `${tenant}/${step}`.
  return useMemo(() => rows?.some((r) => r.key === step) ?? false, [rows, step]);
}

/** "just now" / "2m" / "3h" / "5d" — same rough granularity as the reference's session-tree
 * relative-time suffix (see reference/observations/aria/15-completed-session.desktop.txt: a
 * session row name ends in a relative-time word like "now"). */
function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (diffSec < 45) return "now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d`;
}

// The sidebar's search/order/group/archive logic now lives in `src/sidebarView.ts` (T11), imported
// above and unit-tested in test/workbench-sidebar-view.test.ts.

/** One sidebar session row (usage pass U3 refactor of the former inline map — shared by the
 *  workspace-tree grouping and the "In one list" grouping).
 *
 *  T11 (J-SESSION-archive): the row gained an archive/restore toggle. It is a sibling of the
 *  row's own open button rather than nested inside it (a button may not contain a button), with
 *  `role="treeitem"` lifted onto the wrapper — the same shape the workspace rows already use. */
export function SessionRowButton({
  session,
  active,
  planPending,
  onOpen,
  onToggleArchive,
}: {
  readonly session: SessionRow;
  readonly active: boolean;
  readonly planPending: boolean;
  readonly onOpen: () => void;
  readonly onToggleArchive: () => void;
}) {
  const archived = session.archived === true;
  const label = session.title || "New Session";
  // A waiting run is labelled by what it is blocked on: an interrupted step needs operator
  // reconciliation (never an approval); other known non-approval waits name their type.
  const waiting = session.lastStatus === "waiting" && !planPending;
  const needsReconciliation = waiting && session.waitingType === "ambiguous-invocation";
  const otherWait = waiting && !needsReconciliation && session.waitingType && session.waitingType !== "tool-approval" ? session.waitingType : undefined;
  return (
    <div role="treeitem" aria-selected={active} className={active ? "session-row-wrap active" : "session-row-wrap"}>
      <button type="button" className="session-row" onClick={onOpen} title={session.title}>
        <span className="session-row-title">
          {planPending ? "Plan awaiting review " : needsReconciliation ? "Needs reconciliation " : otherWait ? `Waiting: ${otherWait} ` : waiting ? "Waiting for approval " : ""}
          {label}
          {archived ? " (archived)" : ""}
        </span>
        {needsReconciliation && (
          <span className="approval-badge" title="Needs reconciliation">
            <span className="approval-badge-dot" aria-hidden="true" />
            Reconcile
          </span>
        )}
        {waiting && !needsReconciliation && (
          <span className="approval-badge" title={otherWait ? `Waiting: ${otherWait}` : "Waiting for approval"}>
            <span className="approval-badge-dot" aria-hidden="true" />
            {otherWait ? "Waiting" : "Approval"}
          </span>
        )}
        <span className="session-row-time">{relativeTime(session.updatedAt)}</span>
      </button>
      <button
        type="button"
        className="icon-btn session-row-archive"
        aria-label={archived ? `Restore ${label} from the archive` : `Archive ${label}`}
        title={archived ? "Restore from archive" : "Archive"}
        aria-pressed={archived}
        onClick={onToggleArchive}
      >
        {archived ? "↺" : "⌫"}
      </button>
    </div>
  );
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open-modal stack (usage pass U2): the Keyboard shortcuts dialog stacks over Settings, and the
 *  Full-access confirmation stacks over the General pane — "Close menu or top dialog Esc" (listed
 *  as a real binding in that dialog) must close only the TOP dialog, so each mounted modal
 *  registers itself here and ignores Escape/Tab while something sits above it. */
const OPEN_MODAL_STACK: HTMLElement[] = [];

/** Shared modal contract (technical audit: only one of three modal surfaces had this before this
 *  redesign) — traps focus inside the dialog, returns focus to whatever opened it on unmount, and
 *  optionally calls `onEscape` when the dialog is open and Escape is pressed. Every modal in this
 *  app (Settings, both first-run dialogs, Keyboard shortcuts, the Full-access confirmation) uses
 *  this instead of inventing its own subset. */
function useModalFocus(dialogRef: RefObject<HTMLElement | null>, onEscape?: () => void): void {
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog) OPEN_MODAL_STACK.push(dialog);
    const focusables = dialog?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusables && focusables[0] ? focusables[0] : dialog)?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only the top-most open modal reacts — a stacked dialog (shortcuts over Settings, the
      // Full-access confirmation over General) absorbs Escape/Tab first.
      if (dialog && OPEN_MODAL_STACK[OPEN_MODAL_STACK.length - 1] !== dialog) return;
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const index = dialog ? OPEN_MODAL_STACK.indexOf(dialog) : -1;
      if (index >= 0) OPEN_MODAL_STACK.splice(index, 1);
      previouslyFocused?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** First-run dialog #1 (critic round-1 P0-1): same structure/roles as the reference's "Internal
 *  Testing Notice" (`dialog`, `heading[level=2]`, single "Continue" button; reference-behavior-
 *  matrix.md §1) — Cognate-branded wording, not DeepSeek's copy (spec: brand/copy may be swapped,
 *  the control itself may not be dropped). */
function FirstRunNotice({ onContinue }: { readonly onContinue: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);
  return (
    <div className="modal-backdrop">
      <div
        className="modal first-run-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-notice-heading"
        tabIndex={-1}
        ref={dialogRef}
      >
        <h2 id="first-run-notice-heading">Welcome to Cognate Console</h2>
        <p>
          Cognate Console runs a coding agent against your own workspace: it can read and edit
          files, run shell commands, and execute code on your behalf. Every one of those actions is
          visible in the transcript as it happens, and anything irreversible — like running
          arbitrary code — pauses for your explicit approval first.
        </p>
        <p>This build is under active development; expect rough edges and changing behavior.</p>
        <div className="modal-actions">
          <button type="button" onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

/** First-run dialog #2 (critic round-1 P0-1): same structure as the reference's "Add an API key to
 *  get started" (API-key textbox, "Configure later"/"Save and continue", the latter disabled until a
 *  key is entered; reference-behavior-matrix.md §1). This tranche has no default/preset provider to
 *  key-only configure (no DeepSeek-branded "official" provider) — "Save and continue" dismisses this
 *  step the same as "Configure later"; the entered key is not persisted here (an assumption, not an
 *  observed reference behavior — see docs/known-gaps.md). Full provider setup happens in Settings →
 *  Models afterward. */
function FirstRunApiKey({ onDismiss }: { readonly onDismiss: () => void }) {
  const [key, setKey] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef);
  return (
    <div className="modal-backdrop">
      <div
        className="modal first-run-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-apikey-heading"
        tabIndex={-1}
        ref={dialogRef}
      >
        <h2 id="first-run-apikey-heading">Add an API key to get started</h2>
        <p>Configure a model provider to start building.</p>
        <label>
          API key
          <input type="password" aria-label="API key" value={key} onChange={(e) => setKey(e.currentTarget.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onDismiss}>
            Configure later
          </button>
          <button type="button" disabled={key.trim().length === 0} onClick={onDismiss}>
            Save and continue
          </button>
        </div>
      </div>
    </div>
  );
}

/** Sequences the two first-run dialogs, gated by the `onboarding` projection — renders nothing once
 *  both steps are dismissed (or the apikey step is moot because a model is already configured, e.g.
 *  a home reused from an older build of this app). */
function FirstRunDialogs() {
  const client = useCognate();
  const noticeDismissed = useOnboardingDismissed("notice");
  const apikeyDismissed = useOnboardingDismissed("apikey");
  const modelConfig = useModelConfig();
  const dismiss = useCallback((step: "notice" | "apikey") => void client.invoke("onboarding.dismiss", { step }), [client]);
  if (!noticeDismissed) return <FirstRunNotice onContinue={() => dismiss("notice")} />;
  if (!apikeyDismissed && !modelConfig) return <FirstRunApiKey onDismiss={() => dismiss("apikey")} />;
  return null;
}

function WorkspaceChooser() {
  const client = useCognate();
  const settings = useGeneralSettings();
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      // The `workspaces` projection (subscribed via useProjection) picks up `workspace.selected`
      // as soon as it commits — no local state needed here.
      await client.invoke("workspace.select", { path });
      setPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [client, path]);

  return (
    <div className="workspace-chooser">
      <div className="workspace-chooser-card">
        <p role="alert" className="empty-state">
          Unable to create default workspace. Use Choose workspace to select a folder.
        </p>
        {/* No session exists yet, so the badge reflects the durable DEFAULT preset for new sessions
            (settings.changePreset) rather than a dead "Standard mode" label. */}
        <PresetMenu
          current={undefined}
          fallback={settings.preset}
          onPick={(preset) => {
            void client.invoke("settings.changePreset", { preset } as never).catch((e) => console.error("settings.changePreset failed", e));
          }}
        />
        {/* J-WS-directory-discovery: the same accessible folder type-ahead the Add-workspace
            dialog uses — the first-run chooser and the dialog share one picker, not two flows. */}
        <DirectoryField
          worldId="local"
          label="Workspace directory path"
          placeholder="/path/to/project"
          value={path}
          onChange={setPath}
          invoke={(capability, input) => client.invoke(capability, input as never) as unknown as Promise<unknown>}
          onSubmit={() => {
            if (path.trim() && !busy) void submit();
          }}
          hint="Type a folder path — matching folders appear as you type."
        />
        <button type="button" disabled={busy || path.trim().length === 0} onClick={submit}>
          Choose workspace
        </button>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** A small, original list of generic OpenAI-compatible provider presets for the "Third-party model
 *  provider" combobox (critic round-1 P0-4) — deliberately not a copy of the reference's ~35-entry
 *  DeepSeek-branded provider list (that list mixes in DeepSeek's own brand assets); this is a short
 *  placeholder set of well-known OpenAI-compatible endpoints, sufficient to exercise the tab/combobox
 *  control itself. Picking one pre-fills the Custom model API form's Base URL/Provider ID/Display
 *  name fields (this app has no live per-provider defaults database beyond this).
 */
const THIRD_PARTY_PRESETS: readonly {
  readonly id: string;
  readonly label: string;
  readonly baseURL: string;
  /** Sensible wire default for the preset; the operator can still change it in the form. */
  readonly protocol: (typeof API_PROTOCOL_OPTIONS)[number];
}[] = [
  { id: "openai", label: "OpenAI", baseURL: "https://api.openai.com/v1", protocol: "OpenAI Responses" },
  { id: "openrouter", label: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", protocol: "OpenAI Chat Completions" },
  { id: "azure-openai", label: "Azure OpenAI", baseURL: "https://your-resource.openai.azure.com/openai/deployments/your-deployment", protocol: "OpenAI Chat Completions" },
  { id: "groq", label: "Groq", baseURL: "https://api.groq.com/openai/v1", protocol: "OpenAI Chat Completions" },
  { id: "mistral", label: "Mistral", baseURL: "https://api.mistral.ai/v1", protocol: "OpenAI Chat Completions" },
  { id: "together", label: "Together AI", baseURL: "https://api.together.xyz/v1", protocol: "OpenAI Chat Completions" },
  { id: "fireworks", label: "Fireworks AI", baseURL: "https://api.fireworks.ai/inference/v1", protocol: "OpenAI Chat Completions" },
  { id: "anthropic", label: "Anthropic", baseURL: "https://api.anthropic.com/v1", protocol: "Anthropic Messages" },
];

const API_PROTOCOL_OPTIONS = ["OpenAI Chat Completions", "OpenAI Responses", "Anthropic Messages"] as const;

/** UI display name ↔ wire protocol value persisted by `model.configure`. "openai-compatible" is a
 *  legacy wire value that only arrives from old persisted configs; it edits as OpenAI Chat
 *  Completions (its actual semantics) and stays valid until the operator changes protocol. */
const PROTOCOL_WIRE_VALUES = {
  "OpenAI Chat Completions": "openai-completions",
  "OpenAI Responses": "openai-responses",
  "Anthropic Messages": "anthropic-messages",
} as const satisfies Readonly<Record<(typeof API_PROTOCOL_OPTIONS)[number], WireProtocolValue>>;
type WireProtocolValue = "openai-compatible" | "openai-completions" | "openai-responses" | "anthropic-messages";
function protocolToWire(display: (typeof API_PROTOCOL_OPTIONS)[number]): Exclude<WireProtocolValue, "openai-compatible"> {
  return PROTOCOL_WIRE_VALUES[display];
}
function wireToProtocol(wire: string): (typeof API_PROTOCOL_OPTIONS)[number] {
  if (wire === "openai-responses") return "OpenAI Responses";
  if (wire === "anthropic-messages") return "Anthropic Messages";
  return "OpenAI Chat Completions";
}

interface ModelRow {
  readonly id: string;
  readonly modelId: string;
  readonly displayName: string;
}

/** A shared dropdown-menu control (usage pass U2): a trigger button labelled with the current
 *  value, a `role="menu"` popover of `menuitem` buttons, outside-click/Escape to close, and
 *  ↑/↓ focus movement between items — the Work-details dropdown's behavior generalized so every
 *  General-pane menu (Permission, Language, Performance & usage, Send behavior) and the composer's
 *  access-mode menu share one implementation ("Move menu selection ↑ ↓" / "Select menu item Enter"
 *  in the Keyboard shortcuts dialog are real because of this). */
interface DropdownMenuItem {
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly title?: string;
}

function DropdownMenu({
  label,
  items,
  onSelect,
  triggerAriaLabel,
  triggerClassName,
  dropup = false,
  disabled = false,
}: {
  readonly label: string;
  readonly items: readonly DropdownMenuItem[];
  readonly onSelect: (value: string) => void;
  readonly triggerAriaLabel?: string;
  readonly triggerClassName?: string;
  readonly dropup?: boolean;
  readonly disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const menuButtons = (): HTMLButtonElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = menuButtons();
    if (buttons.length === 0) return;
    const index = buttons.findIndex((b) => b === document.activeElement);
    if (index === -1) {
      buttons[e.key === "ArrowDown" ? 0 : buttons.length - 1]!.focus();
    } else {
      const delta = e.key === "ArrowDown" ? 1 : -1;
      buttons[(index + delta + buttons.length) % buttons.length]!.focus();
    }
  };

  return (
    <div className="work-details-dropdown" ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {label}
        <svg className="dropdown-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      {open && (
        <div role="menu" className={dropup ? "work-details-menu dropup" : "work-details-menu"} ref={menuRef}>
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                onSelect(item.value);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Full-access confirmation dialog (usage pass U2, checkpoint 22f): selecting "Full access"
 *  from the Permission menu opens it — heading, a Close control, a risk paragraph, an
 *  "I understand…" checkbox, and Cancel / "Enable Full access" with the confirm button disabled
 *  until the checkbox is checked. Same structure as the reference's dialog; the paragraph's
 *  wording is Cognate's own (the copy rule bars DeepSeek text verbatim). While it is open, the
 *  Permission control renders disabled (same checkpoint). */
function FullAccessConfirmDialog({
  onConfirm,
  onCancel,
}: {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const [ack, setAck] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onCancel);
  return (
    <div className="modal-backdrop modal-backdrop-stacked">
      <div
        className="modal full-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="full-access-heading"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="dialog-banner">
          <h2 id="full-access-heading">Enable Full access?</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onCancel}>
            ×
          </button>
        </div>
        <p>
          Full access lets new sessions act without the usual confirmation steps, including
          sensitive operations, file changes, and external commands. Only turn it on for tasks
          where you already trust what the agent will do.
        </p>
        <label className="full-access-ack">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.currentTarget.checked)} />
          I understand the risks and want to continue
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!ack} onClick={onConfirm}>
            Enable Full access
          </button>
        </div>
      </div>
    </div>
  );
}

/** This app's REAL keyboard actions and fixed bindings (usage pass U2, checkpoint 22d) — the
 *  Keyboard shortcuts dialog's data. The editable action list itself lives in `src/shortcuts.ts`
 *  (T11) so the dialog, the conflict rules and their unit tests share one source of truth; this
 *  module keeps only the read-only regions that are UI presentation. */
const SHORTCUT_FIXED_REGIONS: readonly { readonly region: string; readonly rows: readonly { readonly label: string; readonly keys: string }[] }[] = [
  {
    region: "Message input",
    rows: [
      { label: "Send message", keys: "Enter" },
      { label: "New line", keys: "Shift Enter" },
    ],
  },
  {
    region: "Menus and dialogs",
    rows: [
      { label: "Close menu or top dialog", keys: "Esc" },
      { label: "Move menu selection", keys: "↑ ↓" },
      { label: "Select menu item", keys: "Enter" },
    ],
  },
  {
    region: "Approval area",
    rows: [
      { label: "Allow once", keys: "Enter" },
      { label: "Reject", keys: "Esc" },
    ],
  },
];

/** `dialog "Keyboard shortcuts"` (usage pass U2, checkpoint 22d; made real in T11): a searchable
 *  list of this app's real actions/bindings grouped "Application" (editable) / "Message input" /
 *  "Menus and dialogs" / "Approval area", plus a contentinfo "Restore all defaults".
 *
 *  Editing reads the DURABLE overrides from the `settings` projection (survives reload and restart)
 *  and writes them through `settings.changeShortcuts`, so the dialog and the global key listener
 *  always agree. Capture happens in the capture phase on `window` so neither the dialog's own
 *  Escape handling nor the global shortcut listener can fire while a chord is being typed. */
export function ShortcutsDialog({
  overrides,
  onChangeShortcuts,
  onClose,
}: {
  /** Durable per-action overrides from the `settings` projection. */
  readonly overrides: ShortcutOverrides;
  /** Writes one whole-value shortcut patch through `settings.changeShortcuts`. */
  readonly onChangeShortcuts: (shortcuts: ShortcutOverrides) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [capture, setCapture] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelEditing = useCallback(() => {
    setEditingId(undefined);
    setCapture(undefined);
    setError(undefined);
  }, []);

  const commit = useCallback(
    async (chord: string) => {
      if (editingId === undefined) return;
      const decision = validateAssignment(editingId, chord, overrides);
      if (!decision.ok) {
        setError(decision.reason);
        return;
      }
      setSaving(true);
      try {
        await onChangeShortcuts({ [editingId]: chord });
        cancelEditing();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [editingId, overrides, onChangeShortcuts, cancelEditing],
  );

  const restore = useCallback(async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onChangeShortcuts(restoreDefaults());
      cancelEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [onChangeShortcuts, cancelEditing]);

  useModalFocus(dialogRef, onClose);

  // Chord capture: window + capture phase so this handler runs before every other keydown listener
  // in the app, and `stopImmediatePropagation` keeps them all from acting on the same keystroke.
  useEffect(() => {
    if (editingId === undefined) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancelEditing();
        return;
      }
      if (e.key === "Enter" && capture !== undefined && isChord(capture)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void commit(capture);
        return;
      }
      const chord = chordFromKeyboardEvent(e);
      if (!chord) {
        // Modifier-only presses (Ctrl, Shift…) are on the way to a chord — swallow them silently.
        if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" || e.key === "Meta") {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      setCapture(chord);
      setError(undefined);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [editingId, capture, cancelEditing, commit]);

  const q = query.trim().toLowerCase();
  const matches = (...texts: readonly string[]) => q.length === 0 || texts.some((t) => t.toLowerCase().includes(q));
  const actions = SHORTCUT_ACTIONS.filter((a) => matches(a.label, describeChord(effectiveChord(a.id, overrides))));
  const regions = SHORTCUT_FIXED_REGIONS.map((g) => ({
    ...g,
    rows: g.rows.filter((r) => matches(r.label, r.keys)),
  })).filter((g) => g.rows.length > 0);
  const atDefaults = isDefault(overrides);
  return (
    <div className="modal-backdrop modal-backdrop-stacked">
      <div
        className="modal shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-heading"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="dialog-banner">
          <h2 id="shortcuts-heading">Keyboard shortcuts</h2>
          <button type="button" className="icon-btn" aria-label="Close keyboard shortcuts" onClick={onClose}>
            ×
          </button>
        </div>
        <div role="search" aria-label="Search shortcuts" className="shortcuts-search">
          <input type="search" aria-label="Search shortcuts" placeholder="Search shortcuts" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
        </div>
        <div className="shortcuts-body">
          {actions.length > 0 && (
            <div role="region" aria-label="Application" className="shortcuts-region">
              <h3>Application</h3>
              <ul>
                {actions.map((a) => {
                  const editing = editingId === a.id;
                  const current = effectiveChord(a.id, overrides);
                  return (
                    <li key={a.id}>
                      {editing ? (
                        <span className="shortcuts-capture">
                          <span className="shortcuts-capture-hint">
                            {capture === undefined ? "Press keys…" : describeChord(capture)}
                          </span>
                          <button type="button" className="shortcuts-edit-btn" onClick={cancelEditing}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="shortcuts-edit-btn"
                          aria-label={`Edit shortcut for ${a.label}`}
                          disabled={saving}
                          onClick={() => {
                            setEditingId(a.id);
                            setCapture(undefined);
                            setError(undefined);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      <span className="shortcuts-row-text">
                        {a.label} {describeChord(current)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {editingId !== undefined && (
                <p role="status" className="shortcuts-capture-status">
                  Press the key combination you want, then Enter to save. Escape cancels.
                </p>
              )}
            </div>
          )}
          {regions.map((g) => (
            <div key={g.region} role="region" aria-label={g.region} className="shortcuts-region">
              <h3>{g.region}</h3>
              <ul>
                {g.rows.map((r) => (
                  <li key={r.label}>
                    <span className="shortcuts-row-text">
                      {r.label} {r.keys}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {actions.length === 0 && regions.length === 0 && (
            <p className="empty-state small">No shortcuts match “{query}”.</p>
          )}
        </div>
        {error && (
          <p role="alert" className="form-error shortcuts-error">
            {error}
          </p>
        )}
        <div className="shortcuts-footer" role="contentinfo">
          <button type="button" disabled={atDefaults || saving} onClick={() => void restore()}>
            {atDefaults ? "Defaults in use" : "Restore all defaults"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One menu-button control of the General pane (usage pass U2, §11): the button's label IS the
 *  current value (reference convention — every General menu renders its selection as the label),
 *  opening a small `role="menu"` list. Closes on outside click and Escape. */
function SettingMenu<T extends string>({
  value,
  options,
  onPick,
  disabled,
  ariaLabel,
}: {
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onPick: (value: T) => void;
  readonly disabled?: boolean;
  readonly ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div className="work-details-dropdown" ref={ref}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} disabled={disabled} onClick={() => setOpen(!open)}>
        {current}
        <svg className="dropdown-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      {open && (
        <div role="menu" className="work-details-menu">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** This app's own version string, shown in the General pane footer (reference shows its own
 *  "Current version" line). Kept in lockstep with package.json's version by hand. */
const APP_VERSION = "0.2.0";

/** Usage pass U4 (reference-behavior-matrix.md §14–15): this app's OWN plugin inventory — the
 *  honest equivalent of the reference's "Built-in plugins" inspector. Session plugins are the
 *  model-facing tools an agent preset composes (`agentCoding.ts`'s PRESET_TOOLS is the source of
 *  truth); global plugins are the always-on capabilities every session shares. Nothing here is
 *  copied from the reference's plugin list. */
const SESSION_PLUGIN_CATALOG: readonly {
  readonly id: string;
  readonly tool: string;
  readonly name: string;
  readonly description: string;
  readonly presets: readonly AgentPreset[];
}[] = [
  { id: "tool-read", tool: "read", name: "File read", description: "Reads a file's contents from the session workspace.", presets: ["standard", "ptc"] },
  { id: "tool-edit", tool: "edit", name: "File edit", description: "Exact-string replacement with a read-before-edit guard.", presets: ["standard", "ptc"] },
  { id: "tool-bash", tool: "bash", name: "Terminal", description: "Runs shell commands in the workspace as a subprocess.", presets: ["standard", "ptc", "minimal"] },
  { id: "tool-todo", tool: "todo_write", name: "To-dos", description: "The to-do list behind the To-dos widget and plan mode.", presets: ["standard", "ptc"] },
  { id: "tool-exit-plan", tool: "exit_plan_mode", name: "Plan review", description: "Presents a plan for approval and leaves plan mode on approval.", presets: ["standard", "ptc"] },
  { id: "tool-subagent", tool: "subagent", name: "Subagents", description: "Fire-and-forget delegation to durable child agent runs.", presets: ["standard", "ptc"] },
  { id: "tool-run-code", tool: "run_code", name: "Run code", description: "Privileged code execution; sandbox escalations gate on human approval.", presets: ["ptc"] },
];

const GLOBAL_PLUGIN_CATALOG: readonly { readonly id: string; readonly name: string; readonly description: string; readonly enabled: boolean }[] = [
  { id: "model-provider", name: "Model provider", description: "OpenAI-compatible provider hot-swap backed by write-only secrets.", enabled: true },
  { id: "session-history", name: "Session history", description: "Folds prior runs' durable events into the model context each turn.", enabled: true },
  { id: "workspaces", name: "Workspaces", description: "Path-contained workspace scoping for every tool call.", enabled: true },
  { id: "approvals", name: "Approvals", description: "Policy gate + durable continuations for privileged escalations.", enabled: true },
  { id: "preferences", name: "Preferences", description: "Durable Settings → General state, folded from events.", enabled: true },
  { id: "realitytrace", name: "RealityTrace observations", description: "Optional observation adapter delivering run events to an SXR evidence ledger.", enabled: false },
];

const PRESET_DETAILS: Readonly<Record<AgentPreset, string>> = {
  standard: "The everyday catalog: file read and edit, the terminal, to-dos, plan review, and subagents. Privileged code execution (run_code) is not part of this preset, so a model call for it fails closed.",
  ptc: "Everything in Standard mode plus privileged code execution (run_code) — suited to tasks that call tools in batches and then filter, organize, or summarize the results.",
  minimal: "The agent works using only the terminal tool. Useful for testing and comparing its baseline behavior without the rest of the catalog.",
};

/** Settings → Built-in plugins (§14, checkpoints 25*): an inspect-only view of this deployment's
 *  plugins — Session plugins composed per agent preset (with the preset-inspect dropdown), Global
 *  plugins shared by everything. Search filters both. Read-only by design this pass (no
 *  enable/disable toggles of real capabilities — docs/known-gaps.md). */
function BuiltInPluginsPane({ settings }: { readonly settings: GeneralSettings }) {
  // Usage pass U7: the RealityTrace row reads its durable state and toggles for real; the other
  // rows stay informational (docs/known-gaps.md).
  const realitytrace = useRealityTracePlugin();
  const [inspect, setInspect] = useState<AgentPreset>(settings.preset);
  const [sessionOpen, setSessionOpen] = useState(true);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = (...texts: readonly string[]) => q.length === 0 || texts.some((t) => t.toLowerCase().includes(q));
  const sessionRows = SESSION_PLUGIN_CATALOG.filter((p) => matches(p.name, p.id, p.description));
  const globalRows = GLOBAL_PLUGIN_CATALOG.filter((p) => matches(p.name, p.id, p.description));
  return (
    <>
      <h3>Built-in plugins</h3>
      <p className="settings-description">Inspect the plugins this deployment ships.</p>
      <input
        type="search"
        aria-label="Search plugins"
        placeholder="Search plugins"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        className="plugins-search"
      />
      <button type="button" className="disclosure-btn" aria-expanded={sessionOpen} onClick={() => setSessionOpen((v) => !v)}>
        Session plugins
      </button>
      {sessionOpen && (
        <>
          <SettingMenu
            ariaLabel="Choose the agent preset to inspect"
            value={inspect}
            options={AGENT_PRESETS.map((p) => ({ value: p, label: AGENT_PRESET_LABELS[p] }))}
            onPick={setInspect}
          />
          <p className="settings-description">
            Composed per session by agent presets · {SESSION_PLUGIN_CATALOG.filter((p) => p.presets.includes(inspect)).length} plugins
          </p>
          <ul className="plugins-list" aria-label="Session plugins">
            {sessionRows.map((p) => {
              const enabled = p.presets.includes(inspect);
              return (
                <li key={p.id}>
                  <div className="plugin-row">
                    <div className="plugin-row-text">
                      <strong>{p.name}</strong> <span className={enabled ? "plugin-state" : "plugin-state off"}>{enabled ? "Enabled" : "Disabled"}</span>
                      <span className="plugin-description">{p.description}</span>
                      <code>{p.id}</code>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button type="button" className="disclosure-btn" aria-expanded={globalOpen} onClick={() => setGlobalOpen((v) => !v)}>
        Global plugins
      </button>
      {globalOpen && (
        <>
          <p className="settings-description">Shared by the system and every session · {GLOBAL_PLUGIN_CATALOG.length} plugins</p>
          <ul className="plugins-list" aria-label="Global plugins">
            {globalRows.map((p) => {
              const enabled = p.id === "realitytrace" ? realitytrace.enabled : p.enabled;
              return (
              <li key={p.id}>
                <div className="plugin-row">
                  <div className="plugin-row-text">
                    <strong>{p.name}</strong> <span className={enabled ? "plugin-state" : "plugin-state off"}>{enabled ? "Enabled" : "Disabled"}</span>
                    <span className="plugin-description">{p.description}</span>
                    <code>{p.id}</code>
                  </div>
                  {p.id === "realitytrace" && (
                    <div className="plugin-row-actions">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={realitytrace.enabled}
                        aria-label={`Enable ${p.name}`}
                        onClick={() => void realitytrace.toggle(!realitytrace.enabled)}
                        title={realitytrace.enabled ? "Delivering run events to the SXR evidence ledger" : "Deliver run events to the SXR evidence ledger"}
                        className="settings-switch"
                      />
                    </div>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

/** Settings → Agent presets (§15, checkpoints 26*): preset cards for this app's three presets —
 *  "Set as new task default" (durable via settings.changePreset), "Mode details" and "View
 *  configuration" dialogs (this app's own copy/composition, not the reference's YAML). The
 *  reference's Creator mode is out of scope (docs/known-gaps.md). */
function AgentPresetsPane({ settings }: { readonly settings: GeneralSettings }) {
  const client = useCognate();
  const [detailsFor, setDetailsFor] = useState<AgentPreset | undefined>(undefined);
  const [configFor, setConfigFor] = useState<AgentPreset | undefined>(undefined);
  return (
    <>
      <h3>Agent presets</h3>
      <p className="settings-description">Choose the agent's tools and how it works. Use Standard mode for everyday tasks.</p>
      <ul className="plugins-list" aria-label="Agent presets">
        {AGENT_PRESETS.map((preset) => {
          const isDefault = settings.preset === preset;
          return (
            <li key={preset}>
              <div className="plugin-row preset-card">
                <div className="plugin-row-text">
                  <strong>{AGENT_PRESET_LABELS[preset]}</strong>{" "}
                  <span className="plugin-state">{isDefault ? "New task default" : "Built-in"}</span>
                  <span className="plugin-description">{PRESET_DETAILS[preset]}</span>
                  <code>{preset}</code>
                </div>
                <div className="plugin-row-actions">
                  {isDefault ? (
                    <button type="button" disabled>
                      New task default
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Set as new task default: ${AGENT_PRESET_LABELS[preset]}`}
                      onClick={() => void client.invoke("settings.changePreset", { preset } as never).catch((e) => console.error("settings.changePreset failed", e))}
                    >
                      Set as new task default
                    </button>
                  )}
                  <button type="button" aria-label={`Mode details: ${AGENT_PRESET_LABELS[preset]}`} onClick={() => setDetailsFor(preset)}>
                    Mode details
                  </button>
                  <button type="button" aria-label={`View configuration: ${AGENT_PRESET_LABELS[preset]}`} onClick={() => setConfigFor(preset)}>
                    View configuration
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {detailsFor && (
        <div className="modal-backdrop modal-backdrop-stacked">
          <div className="modal workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="preset-details-heading" tabIndex={-1}>
            <div className="dialog-banner">
              <h2 id="preset-details-heading">{AGENT_PRESET_LABELS[detailsFor]}</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setDetailsFor(undefined)}>
                ×
              </button>
            </div>
            <p>{PRESET_DETAILS[detailsFor]}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setDetailsFor(undefined)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {configFor && (
        <div className="modal-backdrop modal-backdrop-stacked">
          <div className="modal workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="preset-config-heading" tabIndex={-1}>
            <div className="dialog-banner">
              <h2 id="preset-config-heading">View configuration · {AGENT_PRESET_LABELS[configFor]}</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setConfigFor(undefined)}>
                ×
              </button>
            </div>
            <p className="settings-description">The tools this preset registers for the agent's model calls:</p>
            <ul className="plugins-list">
              {SESSION_PLUGIN_CATALOG.filter((p) => p.presets.includes(configFor)).map((p) => (
                <li key={p.id}>
                  <code>{p.tool}</code> — {p.name}: {p.description}
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" onClick={() => setConfigFor(undefined)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The Settings → General pane (usage pass U2, reference-behavior-matrix.md §11, checkpoints 22*):
 *  the full inventory — Permission (with the Full-access confirmation dialog), Language,
 *  Appearance (Light/Dark/System), Font size (1px stepper, floor 12), Work details, Performance &
 *  usage, Coding Tools, Keyboard shortcuts, Send behavior while busy, and a current-version
 *  footer. Every control writes through its own durable `settings.change*` capability; the
 *  `settings` projection round trip re-renders the pane with the new value. */
function GeneralPane({
  settings,
  onOpenShortcuts,
  fullAccessConfirm,
  setFullAccessConfirm,
}: {
  readonly settings: GeneralSettings;
  readonly onOpenShortcuts: () => void;
  readonly fullAccessConfirm: boolean;
  readonly setFullAccessConfirm: (open: boolean) => void;
}) {
  const client = useCognate();
  const change = useCallback(
    async (capability: string, field: string, value: unknown) => {
      try {
        await client.invoke(capability, { [field]: value } as never);
      } catch (error) {
        console.error(`settings: ${capability} failed`, error);
      }
    },
    [client],
  );

  return (
    <>
      <h3>General</h3>

      <p className="settings-subtitle">Permission</p>
      <p className="settings-description">Choose the default permission mode for new sessions</p>
      <SettingMenu
        ariaLabel="Permission mode for new sessions"
        value={settings.permission}
        disabled={fullAccessConfirm}
        options={PERMISSION_MODES.map((m) => ({ value: m, label: PERMISSION_LABELS[m] }))}
        onPick={(m) => {
          // Checkpoint 22f: "Full access" never commits directly — it opens the confirmation
          // dialog, whose checked-state "Enable Full access" button commits.
          if (m === "full-access") setFullAccessConfirm(true);
          else void change("settings.changePermission", "permission", m);
        }}
      />

      <p className="settings-subtitle">Language</p>
      <SettingMenu
        ariaLabel="Language"
        value={settings.language}
        options={LANGUAGE_CODES.map((l) => ({ value: l, label: LANGUAGE_LABELS[l] }))}
        onPick={(l) => void change("settings.changeLanguage", "language", l)}
      />

      <p className="settings-subtitle">Appearance</p>
      <div role="group" aria-label="Appearance" className="appearance-group">
        {APPEARANCE_MODES.map((mode) => (
          <button key={mode} type="button" aria-pressed={settings.appearance === mode} onClick={() => void change("settings.changeAppearance", "appearance", mode)}>
            {mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System"}
          </button>
        ))}
      </div>

      <p className="settings-subtitle">Font size</p>
      <p className="settings-description">Only affects conversation content</p>
      <div className="font-size-stepper" role="group" aria-label="Font size">
        <span className="font-size-value">{settings.fontSize}</span>
        <button
          type="button"
          aria-label="Increase font size"
          disabled={settings.fontSize >= MAX_FONT_SIZE_PX}
          onClick={() => void change("settings.changeFontSize", "fontSize", settings.fontSize + 1)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Decrease font size"
          disabled={settings.fontSize <= MIN_FONT_SIZE_PX}
          onClick={() => void change("settings.changeFontSize", "fontSize", settings.fontSize - 1)}
        >
          −
        </button>
        <span className="font-size-unit">px</span>
      </div>

      <p className="settings-subtitle">Work details</p>
      <p className="settings-description">Choose how much detail to show for tool calls</p>
      <SettingMenu
        ariaLabel="Work details"
        value={settings.workDetails}
        options={WORK_DETAILS_MODES.map((m) => ({ value: m, label: WORK_DETAILS_LABELS[m] }))}
        onPick={(m) => void change("settings.changeWorkDetails", "workDetails", m)}
      />

      <p className="settings-subtitle">Performance &amp; usage</p>
      <p className="settings-description">Choose how much performance and usage information to show</p>
      <SettingMenu
        ariaLabel="Performance and usage detail"
        value={settings.performanceDetail}
        options={(["compact", "detailed"] as const).map((m) => ({ value: m, label: PERFORMANCE_DETAIL_LABELS[m] }))}
        onPick={(m) => void change("settings.changePerformanceDetail", "performanceDetail", m)}
      />

      <p className="settings-subtitle">Coding Tools</p>
      <p className="settings-description">Shows trajectory, code diffs, and Agent preset switching in new chats</p>
      <button
        type="button"
        role="switch"
        aria-checked={settings.codingTools}
        aria-label="Coding Tools"
        className="settings-switch"
        onClick={() => void change("settings.changeCodingTools", "codingTools", !settings.codingTools)}
      />

      <p className="settings-subtitle">Keyboard shortcuts</p>
      <p className="settings-description">View and edit available shortcuts and input actions</p>
      <button type="button" onClick={onOpenShortcuts}>
        Edit shortcuts
      </button>

      <p className="settings-subtitle">Send behavior while busy</p>
      <p className="settings-description">
        What Enter and the Send button do while the agent is running; Cmd/Ctrl+Enter uses the other behavior
      </p>
      <SettingMenu
        ariaLabel="Send behavior while busy"
        value={settings.sendBehavior}
        options={SEND_BEHAVIORS.map((b) => ({ value: b, label: SEND_BEHAVIOR_LABELS[b] }))}
        onPick={(b) => void change("settings.changeSendBehavior", "sendBehavior", b)}
      />

      <p className="settings-version">Current version: {APP_VERSION}</p>
    </>
  );
}

/** Settings → Models: a provider list (row + Cancel/Apply for the configured provider's API key,
 *  Edit/Delete) plus a two-tab "Add model provider" wizard (Third-party combobox / Custom model API
 *  form with a Models sub-list and Cancel/Create provider) — critic round-1 P0-4/P1-4. This tranche's
 *  backend (`model.configure`) holds one live provider config (`model-config` projection's single
 *  `"current"` row), so "Edit" reopens the wizard prefilled with the current config. Delete is a
 *  real two-step action that removes the configured provider and its stored secret. */
/** "Open configuration file" (T11, J-CFG-config-path): the browser cannot open a local file, so the
 *  button resolves where configuration lives and hands over the real, non-secret bytes — the path to
 *  copy, the recognised environment variables with sensitive values already redacted, and a
 *  download of the exact file. Nothing secret is ever fetched or rendered. */
export function ConfigFileDialog({
  onResolve,
  onClose,
}: {
  /** Resolves the configuration facts (`config.path`). Injected so this dialog is testable. */
  readonly onResolve: () => Promise<ConfigPathResult>;
  readonly onClose: () => void;
}) {
  const [info, setInfo] = useState<ConfigPathResult | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onClose);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await onResolve();
        if (!cancelled) setInfo(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onResolve]);

  return (
    <div className="modal-backdrop modal-backdrop-stacked">
      <div className="modal config-file-dialog" role="dialog" aria-modal="true" aria-labelledby="config-file-heading" tabIndex={-1} ref={dialogRef}>
        <div className="dialog-banner">
          <h2 id="config-file-heading">Configuration file</h2>
          <button type="button" className="icon-btn" aria-label="Close configuration file" onClick={onClose}>
            ×
          </button>
        </div>
        {busy && <p className="empty-state small">Resolving configuration location…</p>}
        {!busy && error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!busy && info && (
          <div className="config-file-body">
            <dl className="config-file-facts">
              <dt>Home directory</dt>
              <dd>
                <code>{info.home}</code>
              </dd>
              <dt>Configuration file</dt>
              <dd>
                <code>{info.configFile}</code>
                <span className={info.configFileExists ? "config-file-exists" : "config-file-missing"}>
                  {info.configFileExists ? "Exists" : "Not present yet — the download below creates it"}
                </span>
              </dd>
            </dl>
            <div className="config-file-actions">
              <button
                type="button"
                onClick={() => {
                  void copyToClipboard(info.configFile).then((ok) => setCopied(ok));
                }}
              >
                {copied ? "Path copied" : "Copy path"}
              </button>
              <button type="button" onClick={() => downloadTextFile("cognate.config.json", info.export)}>
                Download configuration
              </button>
            </div>
            <h3>Settings in effect</h3>
            <pre className="config-file-pre">{JSON.stringify(info.settings, null, 2)}</pre>
            <h3>Environment</h3>
            <table className="config-file-env">
              <thead>
                <tr>
                  <th scope="col">Variable</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                {info.environment.map((entry) => (
                  <tr key={entry.name}>
                    <td>
                      <code>{entry.name}</code>
                    </td>
                    <td>
                      <code>{entry.value}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="settings-description">Secrets are never included in this view or in the download.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsModels({
  onClose,
  settings,
  onOpenShortcuts,
}: {
  readonly onClose: () => void;
  /** Every General setting, resolved with defaults from the durable `settings` row (usage pass
   *  U2, reference-behavior-matrix.md §11) — the General pane is the full inventory: Permission,
   *  Language, Appearance, Font size, Work details, Performance & usage, Coding Tools, Keyboard
   *  shortcuts, Send behavior while busy. Each control writes through its own
   *  `settings.change*` capability; the projection round trip re-renders this pane. */
  readonly settings: GeneralSettings;
  /** Opens the Keyboard shortcuts dialog (stacked above this modal). */
  readonly onOpenShortcuts: () => void;
}) {
  const client = useCognate();
  const config = useModelConfig();
  const [section, setSection] = useState<"general" | "models" | "plugins" | "presets">("models");
  // Full-access confirmation (checkpoint 22f): opened by selecting "Full access" in the Permission
  // menu; the Permission control stays disabled while it is open, and only the checked-state
  // "Enable Full access" button commits the durable change.
  const [fullAccessConfirm, setFullAccessConfirm] = useState(false);
  const [view, setView] = useState<"list" | "wizard">("list");
  const [addTab, setAddTab] = useState<"third-party" | "custom">("custom");
  const [thirdParty, setThirdParty] = useState("");
  const [providerId, setProviderId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [protocol, setProtocol] = useState<(typeof API_PROTOCOL_OPTIONS)[number]>(API_PROTOCOL_OPTIONS[0]);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<readonly ModelRow[]>([]);
  const [modelError, setModelError] = useState<string | undefined>(undefined);
  const [customizedOpen, setCustomizedOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Quick "Apply" from the list-view row: just the API key, reusing the already-configured
  // provider/base URL/model.
  const [rowApiKey, setRowApiKey] = useState("");
  // T11: "Open configuration file" (config.path), provider Delete (confirmed, secret-first) and
  // "Fetch models" (model.catalog) — the three Settings -> Models actions that were inert.
  const [configFileOpen, setConfigFileOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalogResult | undefined>(undefined);
  const [catalogBusy, setCatalogBusy] = useState(false);

  const resetWizard = useCallback((prefillFromConfig: boolean) => {
    setAddTab("custom");
    setThirdParty("");
    setModelError(undefined);
    setError(undefined);
    if (prefillFromConfig && config) {
      setProviderId(config.providerId);
      setDisplayName(config.providerId);
      setBaseURL(config.baseURL);
      // Editing preserves the provider's actual protocol; only an explicit operator change alters it.
      setProtocol(wireToProtocol(config.protocol));
      setApiKey("");
      setModels([{ id: crypto.randomUUID(), modelId: config.model, displayName: config.model }]);
    } else {
      setProviderId("");
      setDisplayName("");
      setBaseURL("");
      setProtocol(API_PROTOCOL_OPTIONS[0]);
      setApiKey("");
      setModels([]);
    }
  }, [config]);

  const openAddWizard = useCallback(() => {
    resetWizard(false);
    setView("wizard");
  }, [resetWizard]);

  const openEditWizard = useCallback(() => {
    resetWizard(true);
    setView("wizard");
  }, [resetWizard]);

  const applyPreset = useCallback((id: string) => {
    setThirdParty(id);
    const preset = THIRD_PARTY_PRESETS.find((p) => p.id === id);
    if (preset) {
      setProviderId(preset.id);
      setDisplayName(preset.label);
      setBaseURL(preset.baseURL);
      setProtocol(preset.protocol);
      setAddTab("custom");
    }
  }, []);

  const addModelRow = useCallback(() => {
    setModels((prev) => [...prev, { id: crypto.randomUUID(), modelId: "", displayName: "" }]);
  }, []);

  const updateModelRow = useCallback((id: string, patch: Partial<ModelRow>) => {
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const createProviderValid =
    providerId.trim().length > 0 &&
    displayName.trim().length > 0 &&
    baseURL.trim().length > 0 &&
    apiKey.trim().length > 0 &&
    models.length > 0 &&
    models.every((m) => m.modelId.trim().length > 0);

  const createProvider = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    setModelError(undefined);
    try {
      if (models.length === 0 || models.some((m) => m.modelId.trim().length === 0)) {
        const badIndex = models.findIndex((m) => m.modelId.trim().length === 0);
        setModelError(`Model ${badIndex === -1 ? models.length + 1 : badIndex + 1}: Model ID is required.`);
        return;
      }
      if (!providerId || !displayName || !baseURL) throw new Error("Provider ID, display name, and base URL are required.");
      // This tranche's `model.configure` capability holds exactly one live provider config; a
      // Models sub-list with several rows is structurally supported (Fetch/Add), but only the first
      // configured model is actually wired through to the backend — see docs/known-gaps.md.
      await client.invoke("model.configure", {
        providerId,
        baseURL,
        protocol: protocolToWire(protocol),
        model: models[0]!.modelId,
        apiKey,
      });
      setView("list");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [client, providerId, displayName, baseURL, apiKey, models, protocol]);

  const applyRowKey = useCallback(async () => {
    if (!config) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      // Re-keying must not silently rewrite the wire protocol: reuse the configured one.
      await client.invoke("model.configure", {
        providerId: config.providerId,
        baseURL: config.baseURL,
        protocol: config.protocol,
        model: config.model,
        apiKey: rowApiKey,
      });
      setSaved(true);
      setRowApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [client, config, rowApiKey]);

  /** Deletes the single live provider configuration. Destructive, so it is a two-step control:
   *  the first press states exactly what will happen, the second commits. `provider.delete` removes
   *  the stored secret first, so a failure leaves the configuration intact. */
  const deleteProvider = useCallback(async () => {
    if (!config) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await client.invoke("provider.delete", { providerId: config.providerId } as never);
      setDeleteConfirm(false);
      setRowApiKey("");
      setCustomizedOpen(false);
      setCatalog(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleteConfirm(false);
    } finally {
      setBusy(false);
    }
  }, [client, config]);

  /** Discovers real model ids for the provider being added. Read-only: nothing is configured or
   *  recorded until the operator chooses a row and saves. */
  const fetchModels = useCallback(async () => {
    setCatalogBusy(true);
    setCatalog(undefined);
    setModelError(undefined);
    try {
      const result = (await client.invoke("model.catalog", {
        protocol: protocolToWire(protocol),
        baseURL,
        ...(apiKey.trim().length > 0 ? { apiKey } : {}),
      } as never)) as unknown as ModelCatalogResult;
      setCatalog(result);
      if (result.ok) {
        // Append only: fetching must never discard ids the operator typed by hand.
        setModels((prev) => {
          const have = new Set(prev.map((m) => m.modelId.trim()).filter((v) => v.length > 0));
          const added = result.models
            .filter((id) => !have.has(id))
            .map((modelId) => ({ id: crypto.randomUUID(), modelId, displayName: "" }));
          return [...prev, ...added];
        });
      }
    } catch (err) {
      setCatalog({ ok: false, reason: err instanceof Error ? err.message : String(err), models: [] });
    } finally {
      setCatalogBusy(false);
    }
  }, [client, protocol, baseURL, apiKey]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onClose);
  return (
    <div className="modal-backdrop">
      <div className="modal settings-panel" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} ref={dialogRef}>
        <div className="settings-titlebar">
          <h2>Settings</h2>
          <button type="button" className="open-config-file-btn" onClick={() => setConfigFileOpen(true)}>
            Open configuration file
          </button>
          <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}>
            ×
          </button>
        </div>
        {configFileOpen && (
          <ConfigFileDialog
            onResolve={() => client.invoke("config.path", {}) as unknown as Promise<ConfigPathResult>}
            onClose={() => setConfigFileOpen(false)}
          />
        )}
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            <button
              type="button"
              className={section === "general" ? "settings-nav-item active" : "settings-nav-item"}
              aria-current={section === "general" ? "page" : undefined}
              onClick={() => setSection("general")}
            >
              General
            </button>
            <button
              type="button"
              className={section === "models" ? "settings-nav-item active" : "settings-nav-item"}
              aria-current={section === "models" ? "page" : undefined}
              onClick={() => setSection("models")}
            >
              Models
            </button>
            <button
              type="button"
              className={section === "plugins" ? "settings-nav-item active" : "settings-nav-item"}
              aria-current={section === "plugins" ? "page" : undefined}
              onClick={() => setSection("plugins")}
            >
              Built-in plugins
            </button>
            <button
              type="button"
              className={section === "presets" ? "settings-nav-item active" : "settings-nav-item"}
              aria-current={section === "presets" ? "page" : undefined}
              onClick={() => setSection("presets")}
            >
              Agent presets
            </button>
          </nav>
          <div className="settings-content">
            {section === "general" ? (
              <GeneralPane settings={settings} onOpenShortcuts={onOpenShortcuts} fullAccessConfirm={fullAccessConfirm} setFullAccessConfirm={setFullAccessConfirm} />
            ) : section === "plugins" ? (
              <BuiltInPluginsPane settings={settings} />
            ) : section === "presets" ? (
              <AgentPresetsPane settings={settings} />
            ) : view === "list" ? (
              <>
                <h3>Models</h3>
                <p className="settings-subtitle">Enter your API key to use models from the following provider.</p>
                {config ? (
                  <div className="provider-card provider-card-configured">
                    <div className="provider-card-header">
                      <span className="provider-card-name">
                        <CheckIcon aria-hidden="true" />
                        {config.providerId} — {config.model}
                      </span>
                      <span className="provider-card-protocol" title="Wire protocol">
                        {wireToProtocol(config.protocol)}
                      </span>
                      <span className="provider-card-key-status" title="API key configured">
                        <CheckIcon aria-hidden="true" /> API key configured
                      </span>
                      <div className="provider-card-actions">
                        <button type="button" aria-label={`Edit ${config.providerId} (${config.providerId})`} onClick={openEditWizard}>
                          <EditIcon /> Edit
                        </button>
                        {deleteConfirm ? (
                          <span className="provider-delete-confirm">
                            <span role="status" className="provider-delete-confirm-text">
                              Delete {config.providerId} and its stored key? This cannot be undone.
                            </span>
                            <button type="button" className="danger-btn" disabled={busy} onClick={() => void deleteProvider()}>
                              Yes, delete
                            </button>
                            <button type="button" disabled={busy} onClick={() => setDeleteConfirm(false)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Delete ${config.providerId} (${config.providerId})`}
                            disabled={busy}
                            onClick={() => {
                              setError(undefined);
                              setDeleteConfirm(true);
                            }}
                          >
                            <TrashIcon /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <label>
                      API key
                      <input
                        type="password"
                        value={rowApiKey}
                        onChange={(e) => setRowApiKey(e.currentTarget.value)}
                        placeholder="Configured — enter a new value to replace"
                      />
                    </label>
                    <button
                      type="button"
                      className="disclosure-btn"
                      aria-expanded={customizedOpen}
                      onClick={() => setCustomizedOpen((v) => !v)}
                    >
                      Customized settings
                    </button>
                    {customizedOpen && (
                      <div className="provider-customized">
                        <div>
                          Base URL: <code>{config.baseURL}</code>
                        </div>
                        <div>Model: {config.model}</div>
                        <div>API protocol: {wireToProtocol(config.protocol)}</div>
                      </div>
                    )}
                    {error && (
                      <p role="alert" className="form-error">
                        {error}
                      </p>
                    )}
                    {saved && <p className="form-success">Saved. Model changes take effect on the next request.</p>}
                    <div className="provider-card-row-actions">
                      <button type="button" onClick={() => setRowApiKey("")}>
                        Cancel
                      </button>
                      <button type="button" disabled={busy || rowApiKey.trim().length === 0} onClick={applyRowKey}>
                        Apply
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="empty-state small">No model provider configured yet.</p>
                )}
                <button type="button" className="add-provider-btn" onClick={openAddWizard}>
                  <PlusIcon /> Add model provider
                </button>
              </>
            ) : (
              <>
                <h3>Add model provider</h3>
                <div role="tablist" aria-label="How to add" className="add-provider-tabs">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={addTab === "third-party"}
                    className={addTab === "third-party" ? "tab active" : "tab"}
                    onClick={() => setAddTab("third-party")}
                  >
                    Third-party model provider
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={addTab === "custom"}
                    className={addTab === "custom" ? "tab active" : "tab"}
                    onClick={() => setAddTab("custom")}
                  >
                    Custom model API
                  </button>
                </div>
                {addTab === "third-party" ? (
                  <div className="third-party-panel">
                    <label>
                      Provider
                      <select aria-label="Third-party model provider" value={thirdParty} onChange={(e) => applyPreset(e.currentTarget.value)}>
                        <option value="" disabled>
                          Choose a provider…
                        </option>
                        {THIRD_PARTY_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="settings-subtitle">Selecting a provider fills in its details on the Custom model API tab.</p>
                  </div>
                ) : (
                  <div className="provider-card">
                    <label>
                      Provider ID
                      <input value={providerId} onChange={(e) => setProviderId(e.currentTarget.value)} placeholder="acme-gateway" />
                    </label>
                    <p className="field-hint">Lowercase identifier, starting with a letter, that uniquely names this provider in requests and as its credential name.</p>
                    <label>
                      Display name
                      <input value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
                    </label>
                    <label>
                      Base URL
                      <input value={baseURL} onChange={(e) => setBaseURL(e.currentTarget.value)} placeholder="https://gateway.example/v1" />
                    </label>
                    <label>
                      API protocol
                      <select value={protocol} onChange={(e) => setProtocol(e.currentTarget.value as (typeof API_PROTOCOL_OPTIONS)[number])}>
                        {API_PROTOCOL_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      API key
                      <input type="password" value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} />
                    </label>
                    <div role="region" aria-label="Models" className="models-region">
                      <div className="models-region-header">
                        <span>Models</span>
                        <div>
                          <button
                            type="button"
                            disabled={baseURL.trim().length === 0 || catalogBusy}
                            onClick={() => void fetchModels()}
                          >
                            {catalogBusy ? "Fetching…" : "Fetch available models"}
                          </button>
                          <button type="button" onClick={addModelRow}>
                            Add model
                          </button>
                        </div>
                      </div>
                      {catalog !== undefined && !catalog.ok && (
                        <p role="alert" className="form-error">
                          {catalog.reason}
                        </p>
                      )}
                      {catalog !== undefined && catalog.ok && (
                        <p role="status" className="settings-subtitle catalog-status">
                          Found {catalog.models.length} model{catalog.models.length === 1 ? "" : "s"} — added below, unrecognised duplicates were skipped.
                        </p>
                      )}
                      {models.map((m, i) => (
                        <div key={m.id} className="model-row">
                          <input
                            aria-label={`Model ${i + 1} ID`}
                            value={m.modelId}
                            onChange={(e) => updateModelRow(m.id, { modelId: e.currentTarget.value })}
                            placeholder="Model ID"
                          />
                          <input
                            aria-label={`Model ${i + 1} display name`}
                            value={m.displayName}
                            onChange={(e) => updateModelRow(m.id, { displayName: e.currentTarget.value })}
                            placeholder="Display name"
                          />
                        </div>
                      ))}
                      {modelError && (
                        <p role="alert" className="form-error">
                          {modelError}
                        </p>
                      )}
                    </div>
                    {error && (
                      <p role="alert" className="form-error">
                        {error}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        {section === "models" && view === "wizard" && (
          <div className="modal-actions">
            <button type="button" onClick={() => setView("list")}>
              Cancel
            </button>
            <button type="button" disabled={busy || !createProviderValid} onClick={createProvider}>
              Create provider
            </button>
          </div>
        )}
        {fullAccessConfirm && (
          <FullAccessConfirmDialog
            onCancel={() => setFullAccessConfirm(false)}
            onConfirm={() => {
              setFullAccessConfirm(false);
              void client.invoke("settings.changePermission", { permission: "full-access" } as never).catch((e) => console.error("settings: full access failed", e));
            }}
          />
        )}
      </div>
    </div>
  );
}

interface RetryInfo {
  readonly attempt: number;
  readonly maxRetries: number;
  readonly code: string;
  readonly message: string;
}

interface TurnFailure {
  readonly code: string;
  readonly message: string;
}

function useStreamingTurn(runId: string | undefined) {
  const client = useCognate();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "streaming" | "completed" | "failed" | "cancelled">("idle");
  // T11 (J-H-provider-error): recorded `model.request.retried` events for the in-flight run — drives
  // "Retried model request (k/5) · Ns" while retrying and its settled value once failed
  // (reference-behavior-matrix.md §8).
  const [retries, setRetries] = useState<readonly RetryInfo[]>([]);
  const [failure, setFailure] = useState<TurnFailure | undefined>(undefined);
  const attemptRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!runId) {
      setText("");
      setStatus("idle");
      setRetries([]);
      setFailure(undefined);
      return;
    }
    setText("");
    setStatus("streaming");
    setRetries([]);
    setFailure(undefined);
    attemptRef.current = undefined;
    const unsubscribe = client.subscribe({ runId }, (event) => {
      if (event.eventType === "run.invocation.progress") {
        const attempt = (event.metadata as { readonly attempt?: number } | undefined)?.attempt ?? 0;
        const payload = event.payload as { readonly kind?: string; readonly text?: string };
        if (payload.kind !== "text" || typeof payload.text !== "string") return;
        if (attemptRef.current === undefined || attempt > attemptRef.current) {
          attemptRef.current = attempt;
          setText(payload.text);
        } else if (attempt === attemptRef.current) {
          setText((prev) => prev + payload.text!);
        }
        // deltas from a superseded (lower) attempt are discarded
      } else if (event.eventType === "model.request.retried") {
        const payload = event.payload as { readonly attempt?: number; readonly maxRetries?: number; readonly error?: { readonly code?: string; readonly message?: string } };
        setRetries((prev) => [
          ...prev,
          {
            attempt: payload.attempt ?? prev.length + 1,
            maxRetries: payload.maxRetries ?? 5,
            code: payload.error?.code ?? "",
            message: payload.error?.message ?? "",
          },
        ]);
      } else if (event.eventType === "turn.failed") {
        const payload = event.payload as { readonly code?: string; readonly message?: string };
        setFailure({ code: payload.code ?? "", message: payload.message ?? "" });
      } else if (event.eventType === "message.completed") {
        const payload = event.payload as { readonly text?: string };
        if (typeof payload.text === "string") setText(payload.text);
        setStatus("completed");
      } else if (event.eventType === "run.cancelled") {
        setStatus("cancelled");
      } else if (event.eventType === "run.failed") {
        setStatus("failed");
      }
    });
    return unsubscribe;
  }, [client, runId]);

  return { text, status, retries, failure };
}

/** Ticks once a second while `active`, purely to re-render "Deep diving for Ns" / "Retried model
 *  request (k/5) · Ns" with a live elapsed time — reference-behavior-matrix.md §8. */
function useElapsedSeconds(active: boolean, startedAtMs: number): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
}

/** Folds this run's `tool.call.*`/`tool.approval.*` events into an ordered `ToolEntry[]`, keyed by
 *  `toolCallId` (a run's tool loop is sequential, so at most one entry is ever `"running"` at a
 *  time — matching the reference's single "current tool" indicator, e.g. `08-tool-running`). */
function useToolTimeline(runId: string | undefined): readonly ToolEntry[] {
  const client = useCognate();
  const [entries, setEntries] = useState<readonly ToolEntry[]>([]);

  useEffect(() => {
    setEntries([]);
    if (!runId) return;
    const byId = new Map<string, ToolEntry>();
    const flush = () => setEntries([...byId.values()]);
    const unsubscribe = client.subscribe({ runId }, (event) => {
      if (event.eventType === "tool.call.started") {
        const p = event.payload as { readonly toolCallId: string; readonly tool: string; readonly args?: Record<string, unknown> };
        byId.set(p.toolCallId, { toolCallId: p.toolCallId, tool: p.tool, args: p.args ?? {}, status: "running" });
        flush();
      } else if (event.eventType === "tool.call.completed") {
        const p = event.payload as { readonly toolCallId: string; readonly result?: unknown };
        const prev = byId.get(p.toolCallId);
        if (prev) {
          byId.set(p.toolCallId, { ...prev, status: "success", result: p.result });
          flush();
        }
      } else if (event.eventType === "tool.call.failed") {
        const p = event.payload as { readonly toolCallId: string; readonly error?: string };
        const prev = byId.get(p.toolCallId);
        if (prev) {
          byId.set(p.toolCallId, { ...prev, status: "failed", error: p.error });
          flush();
        }
      } else if (event.eventType === "tool.approval.requested") {
        const p = event.payload as { readonly toolCallId: string; readonly permission?: string; readonly justification?: string; readonly surface?: unknown };
        const prev = byId.get(p.toolCallId);
        if (prev) {
          byId.set(p.toolCallId, { ...prev, approval: { status: "pending", permission: p.permission, justification: p.justification, surface: p.surface } });
          flush();
        }
      } else if (event.eventType === "tool.approval.decided") {
        const p = event.payload as { readonly toolCallId: string; readonly approved?: boolean };
        const prev = byId.get(p.toolCallId);
        if (prev?.approval) {
          byId.set(p.toolCallId, { ...prev, approval: { ...prev.approval, status: p.approved ? "approved" : "denied" } });
          flush();
        }
      }
    });
    return unsubscribe;
  }, [client, runId]);

  return entries;
}

/** The current/latest tool action's accessible label, matching the reference's single running-tool
 *  button (`08-tool-running`: `button "Reading files · src/greet.ts"` / `"Running code · ..."`).
 *  The "· <detail>" suffix is gated on `showsLiveProcessDetail(mode)` (Settings -> General -> "Work
 *  details" — reference-behavior-matrix.md §10a): shown for "standard"/"detailed" (the default),
 *  hidden for "compact"/"verbose", exactly the reference's own `liveProcessDetail` table. */
function toolActionLabel(entry: ToolEntry, mode: WorkDetailsMode = DEFAULT_WORK_DETAILS_MODE): string {
  const args = entry.args;
  const detail = showsLiveProcessDetail(mode);
  if (entry.tool === "read") return detail ? `Reading files · ${String(args.file_path ?? "")}` : "Reading files";
  if (entry.tool === "edit") return detail ? `Editing files · ${String(args.file_path ?? "")}` : "Editing files";
  if (entry.tool === "bash") return detail ? `Running commands · ${String(args.description ?? args.command ?? "")}` : "Running commands";
  if (entry.tool === "run_code") return detail ? `Running code · ${String(args.description ?? "")}` : "Running code";
  // reference-behavior-matrix.md §6.3: `13-plan-active` shows "Updating the plan · todo_write",
  // `13b-plan-review-prompt` shows "Calling tools · exit_plan_mode". These carry no variable detail
  // (the tool name itself is the detail), so the work-details mode does not change them.
  if (entry.tool === "todo_write") return "Updating the plan · todo_write";
  if (entry.tool === "exit_plan_mode") return "Calling tools · exit_plan_mode";
  // reference-behavior-matrix.md §6.4: `14-subagent-active` shows "Coordinating subagents ·
  // <description>".
  if (entry.tool === "subagent") return detail ? `Coordinating subagents · ${String(args.description ?? "")}` : "Coordinating subagents";
  return `Running ${entry.tool}`;
}

/** During a run: the "Deep diving..." status plus a plain-text current-tool-action line, matching
 *  the reference's `08-tool-running` (`status: Deep diving...`, `button "Reading files · ..."` is
 *  read here as a plain row, not a modal card — the card only appears once approval is pending, see
 *  `ApprovalBar` below, which replaces the composer the way the reference's does). */
function ToolActivity({
  entries,
  elapsedSeconds,
  workDetails,
}: {
  readonly entries: readonly ToolEntry[];
  readonly elapsedSeconds: number;
  readonly workDetails?: WorkDetailsMode;
}) {
  const current = entries.length > 0 ? entries[entries.length - 1] : undefined;
  if (!current || current.status !== "running") return null;
  return (
    <div className="tool-activity" data-tool-card>
      {/* Critic round-4 P1-5 gave the base `.status-pill` (message-status-row's completed/failed
       *  duration line) no visible dot — this in-progress "Deep diving" indicator is a distinct case
       *  (critic round-4 batch B's sweep: the colored dot belongs here, not on "Took Ns"), so it
       *  keeps its own modifier class. */}
      <span className="status-pill status-active" role="status">
        <span className="sr-only">Deep diving for {elapsedSeconds}s</span>
      </span>
      <button type="button" className="tool-activity-btn" disabled title={`Deep diving for ${elapsedSeconds}s`}>
        {toolActionLabel(current, workDetails)}
      </button>
    </div>
  );
}

/** T11 (J-H-provider-error): the collapsed-by-default "Retried model request (k/5) · Ns" row
 *  (reference-behavior-matrix.md §8) — shown while retrying (the latest attempt) and, settled at its
 *  final value, on the failed turn itself. */
function RetryDisclosure({ retries, elapsedSeconds }: { readonly retries: readonly RetryInfo[]; readonly elapsedSeconds: number }) {
  const [expanded, setExpanded] = useState(false);
  if (retries.length === 0) return null;
  const latest = retries[retries.length - 1]!;
  return (
    <div className="retry-disclosure" data-retry-card>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className="retry-disclosure-btn">
        Retried model request ({latest.attempt}/{latest.maxRetries}) · {elapsedSeconds}s
        <ChevronDownIcon />
      </button>
      {expanded && (
        <ul className="retry-list">
          {retries.map((r, i) => (
            <li key={i}>
              Attempt {r.attempt}/{r.maxRetries}: {r.message} ({r.code})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** T11 (J-H-provider-error): the terminal failure block — exactly "This turn failed" / message /
 *  a `code` badge (reference-behavior-matrix.md §8). No manual "Retry"/"Dismiss" button; the composer
 *  stays available underneath to start a new message. */
function FailureBlock({ code, message }: { readonly code: string; readonly message: string }) {
  return (
    <div className="failure-block" role="alert">
      <p className="failure-title">This turn failed</p>
      <p className="failure-message">{message}</p>
      <span className="failure-code">{code}</span>
    </div>
  );
}

/** Approval bar: docked where the composer normally sits (reference `11-approval-pending`: the
 *  approval card sits at the bottom of the chat pane, composer hidden underneath it) — exact
 *  strings/buttons/keyboard behavior: Enter = allow once, Escape = reject (characterization's
 *  stated keyboard behavior). */
function ApprovalBar({ entry, onDecide }: { readonly entry: ToolEntry; readonly onDecide: (approved: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      className="approval-card surface-consequential"
      data-approval-panel
      tabIndex={-1}
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onDecide(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onDecide(false);
        }
      }}
    >
      <div className="approval-header">
        <span className="approval-dot" aria-hidden="true" />
        <span className="approval-waiting">Waiting for approval</span>
      </div>
      <div role="group" aria-label="Approval details" className="approval-details">
        {entry.approval?.surface ? (
          <SurfaceView surface={entry.approval.surface} />
        ) : (
          <>Allow this operation with {entry.approval?.permission} permissions: {entry.approval?.justification}.</>
        )}
      </div>
      <div className="approval-actions">
        <button type="button" className="approval-btn approval-reject" onClick={() => onDecide(false)}>
          Reject
        </button>
        <button type="button" className="approval-btn approval-allow" onClick={() => onDecide(true)}>
          Allow once
        </button>
      </div>
    </div>
  );
}

/** "To-dos" region: a single summary button (`region "To-dos": button "To-dos N in progress · N
 *  pending"`, reference-behavior-matrix.md §6.3) — renders as soon as `todo_write` has run, under
 *  Standard mode too, and persists after plan mode exits (`13c-plan-completed`). Expandable to the
 *  raw todo list; the reference's own expanded-state content was not captured, so this is this
 *  app's own minimal rendering, not a copy — see docs/known-gaps.md. */
function TodoWidget({ todos }: { readonly todos: readonly PlanTodo[] }) {
  const [expanded, setExpanded] = useState(false);
  if (todos.length === 0) return null;
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const pending = todos.filter((t) => t.status === "pending").length;
  return (
    <div role="region" aria-label="To-dos" className="todo-widget">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        To-dos {inProgress} in progress · {pending} pending
      </button>
      {expanded && (
        <ul className="todo-list">
          {todos.map((todo, i) => (
            <li key={i} className={`todo-status-${todo.status}`}>
              {todo.content}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Subagent sessions" tree (J-F-delegation): one row per child, reference-behavior-matrix.md §6.4:
 *  `"<title> · <desc> · continuable · completed · 0 tok · 0s"` + `"Open <title> in sidebar"`. "Open
 *  ... in sidebar" opens the child's transcript in the right-hand panel (`RightPanel` below) — the
 *  only source for it is this row itself (prompt + output), since children are not sessions
 *  (`src/projections/sessions.ts`) and so have no `session.history` of their own to fetch. */
export function SubagentTree({ rows, onOpen }: { readonly rows: readonly SubagentRowView[]; readonly onOpen: (row: SubagentRowView) => void }) {
  return (
    <div role="tree" aria-label="Subagent sessions" className="subagent-tree" data-subagent-card>
      {rows.map((row) => (
        <button
          key={row.toolCallId}
          type="button"
          role="treeitem"
          className="subagent-row"
          aria-label={`Open ${row.title} in sidebar`}
          onClick={() => onOpen(row)}
        >
          <span className="subagent-row-text">
            {row.title} · {row.desc} · continuable · {row.status}
          </span>
          <span className="subagent-row-stat">Usage unavailable</span>
          <ChevronRightIcon aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** Right-hand panel (reused for J-F-delegation's "Open <title> in sidebar"): the reference's own
 *  right sidebar is otherwise entirely inert this tranche (`docs/known-gaps.md` — "Open right sidebar"),
 *  so this is the first thing to actually populate it; a plan's "View full plan" (J-E-plan) still
 *  renders inline rather than here, unchanged. Shows the child's two-message transcript (its
 *  delegated prompt, its final answer) sourced entirely from its `subagents` projection row. */
function RightPanel({ row, onClose }: { readonly row: SubagentRowView; readonly onClose: () => void }) {
  return (
    <aside className="right-panel" role="tabpanel" aria-label={row.title}>
      <div className="right-panel-tabs" role="tablist">
        <span role="tab" aria-selected="true" className="right-panel-tab">
          {row.title}
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </span>
      </div>
      <div className="right-panel-body">
        <div className="message message-user">
          <div className="message-bubble">
            <div className="message-body">{row.prompt}</div>
          </div>
        </div>
        {row.status === "completed" ? (
          <div className="message message-assistant">
            <div className="message-body">{row.output}</div>
          </div>
        ) : (
          <p className="empty-state small">{row.status === "failed" ? "Subagent failed." : "Running…"}</p>
        )}
      </div>
    </aside>
  );
}

/** Plan review card (J-E-plan): docked where the composer normally sits, same pattern as
 *  `ApprovalBar` — `region "Approve this plan and leave plan mode?"` (reference-behavior-matrix.md
 *  §6.3, `13b-plan-review-prompt`). The reference also auto-opens the plan in a right-sidebar tab;
 *  this tranche has no right sidebar (`docs/known-gaps.md` — "Open right sidebar" is already inert), so
 *  the full plan is shown inline via "View full plan" instead. */
function PlanReviewCard({
  heading,
  markdown,
  onDecide,
}: {
  readonly heading: string;
  readonly markdown: string;
  readonly onDecide: (approved: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const firstLine = markdown
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#"));
  return (
    <div
      className="plan-review-card surface-consequential"
      data-plan-panel
      role="region"
      aria-label="Approve this plan and leave plan mode?"
      tabIndex={-1}
      ref={ref}
      onKeyDown={(e) => {
        // Same contract as ApprovalBar (DESIGN.md § Interaction conventions): both cards mean "the
        // agent is blocked on your decision" and should feel identical from the keyboard.
        if (e.key === "Enter") {
          e.preventDefault();
          onDecide(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onDecide(false);
        }
      }}
    >
      <div className="plan-review-header">
        <span className="plan-review-dot" aria-hidden="true" />
        <span className="plan-review-label">Plan review</span>
      </div>
      <button type="button" className="plan-review-disclosure" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        View full plan
      </button>
      <h3 className="plan-review-heading">{heading}</h3>
      {expanded ? (
        <div className="plan-review-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />
      ) : (
        firstLine && <p className="plan-review-preview">{firstLine}</p>
      )}
      <div className="plan-review-actions">
        <button type="button" className="plan-review-btn plan-review-changes" onClick={() => onDecide(false)}>
          Request changes
        </button>
        <button type="button" className="plan-review-btn plan-review-approve" onClick={() => onDecide(true)}>
          Approve
        </button>
      </div>
    </div>
  );
}

/** The folded diff view for an `edit` tool call — folds to the first 9 rows, expandable
 *  (`10-file-change-collapsed`/`-expanded`). Expanded state is the reference's "Review · turn <n>"
 *  split-diff panel (reference-behavior-matrix.md §6.1: line-numbered old/new panes, red/green
 *  highlighted changed lines) plus its bottom toolbar — "Split view" and "Line wrap" toggles, and an
 *  "Open <file> in sidebar" button (critic round-1 P0-6). */
/** The "Edited <file> +N -M" chip (critic round-2 batch B P0): opens the dedicated right-side
 *  Review panel (`ReviewPanel` below) beside the chat — it must NOT render an inline diff in the
 *  message itself (that was this app's pre-round-2 shape; the reference's `10-file-change-expanded`
 *  is a real split panel with its own tab strip/toolbar/gutter'd diff, reused from the same
 *  right-panel infrastructure the subagent child view already uses). */
function EditDiff({
  summary,
  turnNumber,
  onOpenReview,
}: {
  readonly summary: EditSummary;
  readonly turnNumber: number;
  readonly onOpenReview: (summary: EditSummary, turnNumber: number) => void;
}) {
  const fileName = summary.file_path.split("/").pop() ?? summary.file_path;
  // Critic round-4 P2 (laptop file-change card): a colored file-type glyph by extension, matching
  // the reference's blue "TS" square — consistent at every viewport width since it's not keyed off
  // any breakpoint-dependent card size, just the file name.
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return (
    <div className="edit-diff">
      <button
        type="button"
        className="edit-diff-toggle edit-diff-card"
        aria-label={`View changes to ${summary.file_path}: Edited ${fileName} +${summary.additions} -${summary.deletions}`}
        onClick={() => onOpenReview(summary, turnNumber)}
      >
        <span className="edit-diff-icon" data-ext={ext} aria-hidden="true">
          {ext === "ts" || ext === "tsx" ? "TS" : <FileIcon />}
        </span>
        <span className="edit-diff-info">
          <span className="edit-diff-heading">Edited {fileName}</span>
          <span className="edit-diff-stat">
            +{summary.additions} -{summary.deletions}
          </span>
        </span>
      </button>
    </div>
  );
}

/** The Review split-diff panel (critic round-2 batch B P0, `10-file-change-expanded`; layout and
 *  view controls completed in T11): a right-hand pane beside the chat with a real tab strip (open,
 *  switch and close file changes), layout controls (split / fullscreen / collapse), three view
 *  modes (list, split, code), a visible file-location line, and a "More ways to open" menu that
 *  copies the path or hands the patch to another browser tab. Geometry per
 *  product-characterization.md §2 (see `.review-right-panel` in app.css). */
export function ReviewPanel({
  initialTab,
  availableTabs,
  workspaceRoot,
  onClose,
}: {
  readonly initialTab: ReviewTab;
  /** Every other edit in this session — the "Add tab" picker. */
  readonly availableTabs: readonly ReviewTab[];
  readonly workspaceRoot: string | undefined;
  readonly onClose: () => void;
}) {
  const [tabs, setTabs] = useState<readonly ReviewTab[]>([initialTab]);
  const [activeKey, setActiveKey] = useState(initialTab.key);
  const [view, setView] = useState<"list" | "split" | "code">("split");
  const [lineWrap, setLineWrap] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [addTabOpen, setAddTabOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<undefined | "more">(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0]!;
  const summary = active.summary;
  const fileName = summary.file_path.split("/").pop() ?? summary.file_path;
  const { rows, header } = useMemo(() => diffHunk(summary.diffLines), [summary.diffLines]);
  const codeRows = useMemo(() => renderFileAfterChange(summary.diffLines), [summary.diffLines]);
  const absolutePath = workspaceRoot ? `${workspaceRoot.replace(/\/$/, "")}/${summary.file_path}` : undefined;

  // Click-away + Escape close the two menus.
  useEffect(() => {
    if (addTabOpen === false && openMenu === undefined) return;
    const onDown = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setAddTabOpen(false);
        setOpenMenu(undefined);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAddTabOpen(false);
        setOpenMenu(undefined);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [addTabOpen, openMenu]);

  const openPatchInNewTab = useCallback(() => {
    const text = renderUnifiedPatch(summary, header);
    const url = URL.createObjectURL(new Blob([text], { type: "text/x-diff;charset=utf-8" }));
    const opened = window.open(url, "_blank", "noopener");
    if (!opened) setNotice("The browser blocked the new tab — use Download patch instead.");
    // Revoke once the tab has had a chance to load the blob.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [summary, header]);

  const downloadPatch = useCallback(() => {
    const base = fileName.replace(/\.[^.]+$/, "") || "change";
    downloadTextFile(`${base}.diff`, renderUnifiedPatch(summary, header));
  }, [summary, header, fileName]);

  const copyPath = useCallback(
    async (value: string, label: string) => {
      const ok = await copyToClipboard(value);
      setNotice(ok ? `${label} copied.` : `Could not copy — the path is shown in the toolbar.`);
    },
    [],
  );

  const addToTab = useCallback((tab: ReviewTab) => {
    setTabs((prev) => (prev.some((t) => t.key === tab.key) ? prev : [...prev, tab]));
    setActiveKey(tab.key);
    setAddTabOpen(false);
  }, []);

  const closeTab = useCallback(
    (key: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.key !== key);
        if (next.length === 0) {
          onClose();
          return prev;
        }
        setActiveKey((current) => (current === key ? next[next.length - 1]!.key : current));
        return next;
      });
    },
    [onClose],
  );

  const available = availableTabs.filter((t) => !tabs.some((open) => open.key === t.key));

  const cls = ["right-panel", "review-right-panel"];
  if (fullscreen) cls.push("review-fullscreen");
  if (collapsed) cls.push("review-collapsed");

  if (collapsed) {
    return (
      <aside className={cls.join(" ")} role="tabpanel" aria-label={`Review · turn ${active.turnNumber}`} aria-expanded="false">
        <button type="button" className="review-expand-btn" aria-label="Expand right sidebar" title="Expand right sidebar" onClick={() => setCollapsed(false)}>
          <PanelRightIcon />
        </button>
      </aside>
    );
  }

  return (
    <aside className={cls.join(" ")} role="tabpanel" aria-label={`Review · turn ${active.turnNumber}`}>
      <div className="right-panel-tabs" role="tablist" ref={toolbarRef}>
        {tabs.map((tab) => (
          <span
            key={tab.key}
            role="tab"
            aria-selected={tab.key === active.key}
            tabIndex={tab.key === active.key ? 0 : -1}
            className={tab.key === active.key ? "right-panel-tab" : "right-panel-tab inactive"}
            onClick={() => setActiveKey(tab.key)}
          >
            Review · turn {tab.turnNumber}
            <button type="button" aria-label={`Close review of ${tab.summary.file_path}`} onClick={() => closeTab(tab.key)}>
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className="right-panel-add-tab"
          aria-label="Add tab"
          aria-haspopup="menu"
          aria-expanded={addTabOpen}
          onClick={() => setAddTabOpen((v) => !v)}
        >
          <PlusIcon />
        </button>
        {addTabOpen && (
          <div role="menu" className="right-panel-tab-menu">
            {available.length === 0 ? (
              <span className="right-panel-tab-menu-empty">No other file changes in this session.</span>
            ) : (
              available.map((tab) => (
                <button key={tab.key} type="button" role="menuitem" onClick={() => addToTab(tab)}>
                  Turn {tab.turnNumber} · {tab.summary.file_path}
                </button>
              ))
            )}
          </div>
        )}
        {/* Layout controls at the tab-strip level (critic round-3 P1), now wired: Split mirrors the
         *  toolbar's split view, Fullscreen expands the panel over the frame, and Collapse shrinks
         *  it to a rail with a single expand control. */}
        <button
          type="button"
          className="review-toolbar-btn icon-btn"
          aria-label="Split"
          aria-pressed={view === "split"}
          title="Split"
          onClick={() => setView((v) => (v === "split" ? "list" : "split"))}
        >
          <SplitViewIcon />
        </button>
        <button
          type="button"
          className="review-toolbar-btn icon-btn"
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-pressed={fullscreen}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => setFullscreen((v) => !v)}
        >
          <FullscreenIcon />
        </button>
        <button
          type="button"
          className="review-toolbar-btn icon-btn"
          aria-label="Collapse right sidebar"
          title="Collapse right sidebar"
          onClick={() => setCollapsed(true)}
        >
          <PanelRightIcon />
        </button>
      </div>
      <div className="review-panel-toolbar" role="toolbar" aria-label="Review view">
        <button type="button" className="review-toolbar-btn icon-btn" aria-pressed={view === "list"} onClick={() => setView("list")} aria-label="List view" title="List view">
          <ListViewIcon />
        </button>
        <button type="button" className="review-toolbar-btn icon-btn" aria-pressed={view === "split"} onClick={() => setView("split")} aria-label="Split view" title="Split view">
          <SplitViewIcon />
        </button>
        <button
          type="button"
          className="review-toolbar-btn icon-btn"
          aria-pressed={view === "code"}
          onClick={() => setView((v) => (v === "code" ? "split" : "code"))}
          aria-label="Code view"
          title="Code view — the file as it will be after this change"
        >
          <CodeViewIcon />
        </button>
        <span className="review-panel-file">{summary.file_path}</span>
        <span className="review-panel-stat">
          +{summary.additions} -{summary.deletions}
        </span>
        <button type="button" className="review-toolbar-btn" aria-pressed={lineWrap} onClick={() => setLineWrap((v) => !v)}>
          Line wrap
        </button>
        <button
          type="button"
          className="review-toolbar-btn"
          aria-pressed={showLocation}
          onClick={() => setShowLocation((v) => !v)}
        >
          Show file location
        </button>
        <button
          type="button"
          className="review-toolbar-btn"
          aria-haspopup="menu"
          aria-expanded={openMenu === "more"}
          onClick={() => setOpenMenu((v) => (v === "more" ? undefined : "more"))}
        >
          More ways to open
        </button>
        {openMenu === "more" && (
          <div role="menu" className="review-more-menu">
            <button type="button" role="menuitem" onClick={() => void copyPath(summary.file_path, "Path")}>
              Copy path
            </button>
            <button type="button" role="menuitem" disabled={!absolutePath} onClick={() => absolutePath && void copyPath(absolutePath, "Full path")}>
              Copy full path
            </button>
            <button type="button" role="menuitem" onClick={openPatchInNewTab}>
              Open patch in a new tab
            </button>
            <button type="button" role="menuitem" onClick={downloadPatch}>
              Download patch (.diff)
            </button>
          </div>
        )}
      </div>
      {showLocation && (
        <p className="review-panel-location" role="status">
          {absolutePath ? (
            <>
              <code>{absolutePath}</code>
            </>
          ) : (
            <>
              <code>{summary.file_path}</code> (workspace root unknown — select a workspace to resolve the full path)
            </>
          )}
        </p>
      )}
      {notice && (
        <p className="review-panel-location" role="status">
          {notice}
        </p>
      )}
      <div className="review-panel-body">
        {view === "code" ? (
          <div className={`review-diff-unified${lineWrap ? " wrap-lines" : ""}`} aria-label={`Code view of ${summary.file_path}`}>
            {codeRows.map((r, i) => (
              <div key={i} className="review-diff-row diff-ctx">
                <span className="review-diff-gutter">{r.no}</span>
                <span className="review-diff-text">{r.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="review-hunk-header">{header}</div>
            {view === "split" ? (
              <div className={`review-diff-split${lineWrap ? " wrap-lines" : ""}`}>
                <div className="review-diff-pane review-diff-old">
                  {rows
                    .filter((r) => r.kind !== "add")
                    .map((r, i) => (
                      <div key={i} className={`review-diff-row${r.kind === "del" ? " diff-del" : " diff-ctx"}`}>
                        <span className="review-diff-gutter">{r.oldNo}</span>
                        <span className="review-diff-text">{r.text}</span>
                      </div>
                    ))}
                </div>
                <div className="review-diff-pane review-diff-new">
                  {rows
                    .filter((r) => r.kind !== "del")
                    .map((r, i) => (
                      <div key={i} className={`review-diff-row${r.kind === "add" ? " diff-add" : " diff-ctx"}`}>
                        <span className="review-diff-gutter">{r.newNo}</span>
                        <span className="review-diff-text">{r.text}</span>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div className={`review-diff-unified${lineWrap ? " wrap-lines" : ""}`}>
                {rows.map((r, i) => (
                  <div key={i} className={`review-diff-row${r.kind === "add" ? " diff-add" : r.kind === "del" ? " diff-del" : " diff-ctx"}`}>
                    <span className="review-diff-gutter">{r.oldNo ?? ""}</span>
                    <span className="review-diff-gutter">{r.newNo ?? ""}</span>
                    <span className="review-diff-text">{r.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function CodeBlocks({ containerRef }: { readonly containerRef: React.RefObject<HTMLDivElement | null> }) {
  // Fenced code blocks come back from renderMarkdown() as plain
  // `<pre class="code-block" data-lang="...">` nodes (see ./markdown.ts) — they need a language
  // label + "Wrap lines" / "Copy" controls added after the fact, since dangerouslySetInnerHTML
  // can't carry React event handlers. Runs after every render; idempotent via a data attribute.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const blocks = root.querySelectorAll<HTMLPreElement>("pre.code-block:not([data-enhanced])");
    blocks.forEach((pre) => {
      pre.setAttribute("data-enhanced", "1");
      const lang = pre.getAttribute("data-lang") || "text";
      const header = document.createElement("div");
      header.className = "code-block-header";
      const label = document.createElement("span");
      label.className = "code-block-lang";
      label.textContent = lang;
      const wrapBtn = document.createElement("button");
      wrapBtn.type = "button";
      wrapBtn.className = "code-block-action";
      wrapBtn.setAttribute("aria-label", "Wrap lines");
      wrapBtn.setAttribute("aria-pressed", "true");
      wrapBtn.textContent = "Wrap lines";
      pre.classList.add("wrap-lines");
      wrapBtn.addEventListener("click", () => {
        const wrapped = pre.classList.toggle("wrap-lines");
        wrapBtn.setAttribute("aria-pressed", String(wrapped));
      });
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "code-block-action";
      copyBtn.setAttribute("aria-label", "Copy");
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", () => {
        const code = pre.querySelector("code")?.textContent ?? "";
        navigator.clipboard?.writeText(code).catch(() => {});
      });
      header.append(label, wrapBtn, copyBtn);
      pre.parentElement?.insertBefore(header, pre);
    });
  });
  return null;
}

function Composer({
  disabled,
  sending,
  modelLabel,
  planMode,
  onSend,
  onStop,
  onTogglePlanMode,
  turns = 0,
  steps = 0,
  accessMode,
  onAccessModeChange,
  sendBehavior,
  onBusySubmit,
  queued,
  onCancelQueued,
  focusToken,
}: {
  readonly disabled: boolean;
  readonly sending: boolean;
  readonly modelLabel: string | undefined;
  /** J-E-plan: whether the active session is currently in plan mode — swaps the composer
   *  placeholder and shows the "Plan mode on, press to turn off" toggle (reference-behavior-matrix.md
   *  §6.3, `13-plan-active`). */
  readonly planMode: boolean;
  readonly onSend: (message: string) => void;
  readonly onStop: () => void;
  readonly onTogglePlanMode: () => void;
  /** This session's completed-turn / tool-step counts (critic round-2 batch A P1) — derived from
   *  the transcript's own `stepCount`s, not a stub 0. */
  readonly turns?: number;
  readonly steps?: number;
  /** Usage pass U2 (§11): the session's access mode — a functional per-session dropdown now, whose
   *  value `send()` passes to `agent.coding` as `AgentCodingInput.mode` for `approvalGate`. */
  readonly accessMode: PermissionMode;
  readonly onAccessModeChange: (mode: PermissionMode) => void;
  /** Usage pass U2 (§11): "What Enter and the Send button do while the agent is running;
   *  Cmd/Ctrl+Enter uses the other behavior." While a run streams, the composer stays typeable and
   *  Enter performs this behavior (Queue: park the message; Steer: cancel + send). */
  readonly sendBehavior: SendBehavior;
  readonly onBusySubmit: (message: string, behavior: SendBehavior) => void;
  /** A message parked by the Queue behavior, waiting for the active run to settle. Absent on
   *  surfaces that never queue (the hero composer). */
  readonly queued?: string;
  readonly onCancelQueued?: () => void;
  /** J-SESSION-draft: bumped when this composer should take focus (a fresh draft, a reopened
   *  session) — focusing only when the field is actually usable (not `disabled`). */
  readonly focusToken?: number;
}) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusToken === undefined || focusToken === 0 || disabled) return;
    textareaRef.current?.focus();
  }, [focusToken, disabled]);
  const submit = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setMessage("");
  }, [message, onSend]);
  const busySubmit = useCallback(
    (behavior: SendBehavior) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      onBusySubmit(trimmed, behavior);
      setMessage("");
    },
    [message, onBusySubmit],
  );
  return (
    <div className="composer-card">
      <textarea
        ref={textareaRef}
        aria-label={planMode ? "describe your task to generate plan" : "Message or run a task, / commands, @ files or sessions"}
        disabled={disabled}
        placeholder={
          disabled
            ? "Select a workspace and configure a model to start"
            : planMode
              ? "describe your task to generate plan"
              : "Message or run a task, / commands, @ files or sessions"
        }
        value={message}
        onChange={(e) => setMessage(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (sending) {
              // Cmd/Ctrl+Enter uses the other behavior (§11's description, verbatim semantics).
              busySubmit(e.ctrlKey || e.metaKey ? (sendBehavior === "queue" ? "steer" : "queue") : sendBehavior);
            } else {
              submit();
            }
          }
        }}
      />
      {queued !== undefined && (
        <div className="composer-queued" role="status">
          <span className="composer-queued-text" title={queued}>
            Queued — sends when the current run finishes: {queued}
          </span>
          <button type="button" className="icon-btn" aria-label="Cancel queued message" onClick={onCancelQueued}>
            ×
          </button>
        </div>
      )}
      <div className="composer-toolbar">
        <SettingMenu
          ariaLabel={`Access mode, current: ${PERMISSION_LABELS[accessMode]}`}
          value={accessMode}
          disabled={disabled}
          options={PERMISSION_MODES.map((m) => ({ value: m, label: PERMISSION_LABELS[m] }))}
          onPick={onAccessModeChange}
        />
        {planMode && (
          <button type="button" className="plan-mode-toggle" aria-label="Plan mode on, press to turn off" onClick={onTogglePlanMode}>
            Plan
          </button>
        )}
        <span className="composer-info-label" title="Model configured in Settings → Models">
          {modelLabel ?? "No model"}
        </span>
        <div className="composer-spacer" />
        {sending ? (
          <button type="button" className="send-btn stop" aria-label="Stop generating" onClick={onStop}>
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className="send-btn"
            aria-label="Send message"
            disabled={disabled || message.trim().length === 0}
            onClick={submit}
          >
            <SendIcon />
          </button>
        )}
      </div>
      <div className="composer-stats">
        <span className="stat-chip">
          {turns} turn{turns === 1 ? "" : "s"} · {steps} step{steps === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

/** A settled turn's individual-step line for "Verbose" Work details (reference-behavior-matrix.md
 *  §10a) — short noun label + "· <detail>", matching the reference's own ungrouped verbose list
 *  (`21-work-details-verbose`: "Read · <path>", "Bash · <description>", "Edit · <path>"). */
function verboseStepLabel(entry: ToolEntry): string {
  const args = entry.args;
  if (entry.tool === "read") return `Read · ${String(args.file_path ?? "")}`;
  if (entry.tool === "edit") return `Edit · ${String(args.file_path ?? "")}`;
  if (entry.tool === "bash") return `Bash · ${String(args.description ?? args.command ?? "")}`;
  if (entry.tool === "run_code") return `Run code · ${String(args.description ?? "")}`;
  if (entry.tool === "todo_write") return "To-dos · todo_write";
  if (entry.tool === "exit_plan_mode") return "Plan review · exit_plan_mode";
  if (entry.tool === "subagent") return `Subagent · ${String(args.description ?? "")}`;
  return entry.tool;
}

/** Reality over narrative: a call the task's authority refused is always shown, whatever the
 *  Work details verbosity, because the agent's own summary may say otherwise. */
function AuthorityNotice({ steps }: { readonly steps?: readonly ToolEntry[] }) {
  const blocked = (steps ?? []).filter((e) => e.status === "failed" && /blocked by authority/.test(e.error ?? ""));
  if (blocked.length === 0) return null;
  return (
    <div className="authority-notice" role="alert">
      <strong>Blocked by the task&apos;s authority</strong>
      <ul>
        {blocked.map((e) => (
          <li key={e.toolCallId}>
            <span className="authority-notice-tool">{e.tool}</span> {(e.error ?? "").replace(/^Error: blocked by authority \(([^)]*)\): /, "$1: ")}
          </li>
        ))}
      </ul>
      <p>The blocked change was not made. Check the agent&apos;s summary against what actually happened.</p>
    </div>
  );
}

function MessageBubble({
  message,
  elapsedSeconds,
  turnNumber,
  onOpenReview,
  workDetails,
}: {
  readonly message: ChatMessage;
  readonly elapsedSeconds?: number;
  readonly turnNumber?: number;
  readonly onOpenReview?: (summary: EditSummary, turnNumber: number) => void;
  readonly workDetails?: WorkDetailsMode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  if (message.role === "system") {
    return (
      <div className="message message-system" role="status">
        {message.content}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="message message-user">
        <div className="message-bubble">
          <div className="message-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
        </div>
        <div className="message-meta">
          <button type="button" className="meta-action" aria-label="Copy" title="Copy">
            <CopyIcon />
          </button>
          {message.at && <span className="meta-time">{message.at}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`message message-assistant${message.failed ? " message-failed" : ""}`}>
      {message.streaming ? (
        <div className="message-status-row">
          <span className="status-pill status-streaming" role="status">
            <span className="sr-only">Deep diving for {elapsedSeconds ?? 0}s</span>
          </span>
          <span className="took-btn" aria-hidden="true">Deep diving for {elapsedSeconds ?? 0}s</span>
        </div>
      ) : (
        <div className="message-status-row">
          {/* Critic round-3 P2: reference's "Stopped" line carries no leading dot (unlike
           *  "Worked"/"Failed") — `status-cancelled` keeps the accessible status text but removes
           *  the visual indicator. */}
          <span
            className={`status-pill${message.failed ? " status-failed" : ""}${message.cancelled ? " status-cancelled" : ""}${message.failed ? " disabled" : ""}`}
            role="status"
          >
            <span className="sr-only">{message.failed ? "Failed" : message.cancelled ? "Stopped" : "Worked"}</span>
          </span>
          {/* T11 (J-H-cancellation): a disabled "Stopped" chip in place of the duration badge —
           *  matches reference/observations/aria/19-cancelled.desktop.txt's `button "Stopped"
           *  [disabled]` (no "Took Ns" text on a cancelled turn). */}
          <button type="button" className="took-btn" disabled>
            {message.cancelled ? "Stopped" : `Took ${Math.max(0, Math.round((message.tookMs ?? 0) / 1000))}s`}
          </button>
        </div>
      )}
      {message.failed && message.retryCount !== undefined && (
        <RetryDisclosure
          retries={[{ attempt: message.retryCount, maxRetries: 5, code: message.failureCode ?? "", message: message.failureMessage ?? "" }]}
          elapsedSeconds={Math.max(0, Math.round((message.tookMs ?? 0) / 1000))}
        />
      )}
      <div className="message-divider" />
      {/* "Verbose" Work details (reference-behavior-matrix.md §10a): every step stays visible
       *  individually instead of folding behind the "Took Ns" line above (foldCompletedTurns: false
       *  — see `21-work-details-verbose` vs. `21-work-details-{compact,standard,detailed}`, which all
       *  fold identically at this default single-turn depth). Only available for the turn that just
       *  finished in this browser session (`message.steps`) — see the ChatMessage.steps doc comment. */}
      {workDetails === "verbose" && message.steps && message.steps.length > 0 && (
        <ul className="verbose-step-list" aria-label="Tool call steps">
          {message.steps.map((entry) => (
            <li key={entry.toolCallId} className={entry.status === "failed" ? "verbose-step-failed" : undefined}>
              {verboseStepLabel(entry)}
              {entry.status === "failed" && entry.error && <span className="verbose-step-error"> · Error: {entry.error}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="message-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
      <CodeBlocks containerRef={bodyRef} />
      <AuthorityNotice steps={message.steps} />
      {message.editSummary && onOpenReview && (
        <EditDiff summary={message.editSummary} turnNumber={turnNumber ?? 1} onOpenReview={onOpenReview} />
      )}
      {message.failed && message.failureMessage && <FailureBlock code={message.failureCode ?? ""} message={message.failureMessage} />}
      {!message.failed && !message.streaming && (
        <div className="message-actions">
          {message.cancelled && <span className="cancelled-tag">Stopped</span>}
          <button type="button" className="meta-action" aria-label="Copy" title="Copy">
            <CopyIcon />
          </button>
          {message.at && <span className="meta-time">{message.at}</span>}
        </div>
      )}
    </div>
  );
}

/** Usage pass U3 (§12): the "Add workspace" dialog — the same path-input + `workspace.select`
 *  flow the no-workspace chooser uses, opened from the sidebar header's "Add workspace" button or
 *  the hero menu's "Add workspace…". (The reference's full directory-browser dialog is out of scope
 *  this pass — docs/known-gaps.md.) */
type ContainmentInspection = {
  readonly executionPosture?: "contained" | "uncontained-local";
  readonly configured: boolean;
  readonly platformSupported: boolean;
  readonly reason?: string;
  readonly limits?: { readonly timeoutMs: number; readonly maxOutputBytes: number };
};

type WorkspaceInvoke = (capability: string, input: unknown) => Promise<unknown>;

export async function selectWorkspaceForExecution(
  invoke: WorkspaceInvoke,
  path: string,
  mode: "local" | "contained",
  inspection: ContainmentInspection | undefined,
): Promise<void> {
  if (mode === "contained") {
    if (inspection?.configured !== true || inspection.platformSupported !== true) {
      throw new Error(inspection?.reason ?? "Linux child containment is not available.");
    }
    await invoke("workspace.contained.select", { path });
    return;
  }
  await invoke("workspace.select", { path });
}

/** The local workspace picker. Under the default contained posture it preselects Linux child
 *  containment once the host reports it available (until the operator picks a mode); under the
 *  explicit uncontained-local posture, or without host support, it stays on local. */
export function LocalWorkspaceForm({
  invoke,
  onClose,
}: {
  readonly invoke: WorkspaceInvoke;
  readonly onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const [mode, setModeState] = useState<"local" | "contained">("local");
  const [modeChosen, setModeChosen] = useState(false);
  const setMode = useCallback((next: "local" | "contained") => {
    setModeChosen(true);
    setModeState(next);
  }, []);
  const [inspection, setInspection] = useState<ContainmentInspection | undefined>();
  const [inspectionError, setInspectionError] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void invoke("execution.containment.inspect", {}).then((result) => {
      if (active) setInspection(result as ContainmentInspection);
    }).catch((err: unknown) => {
      if (active) setInspectionError(err instanceof Error ? err.message : String(err));
    });
    return () => { active = false; };
  }, [invoke]);

  const containmentAvailable = inspection?.configured === true && inspection.platformSupported === true;
  useEffect(() => {
    if (!modeChosen && containmentAvailable && inspection?.executionPosture !== "uncontained-local") {
      setModeState("contained");
    }
  }, [containmentAvailable, inspection?.executionPosture, modeChosen]);
  const containmentReason = inspectionError ?? inspection?.reason ??
    (inspection?.platformSupported === false ? "Linux child containment is unavailable on this platform." :
      inspection?.configured === false ? "Linux child containment is not configured by the host." :
        "Checking host support…");
  const containmentLimits = inspection?.limits
    ? ` Wall-time limit: ${Math.ceil(inspection.limits.timeoutMs / 1000)} seconds; output limit: ${(inspection.limits.maxOutputBytes / (1024 * 1024)).toFixed(1)} MiB.`
    : "";

  const submit = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      await selectWorkspaceForExecution(invoke, path, mode, inspection);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, [inspection, invoke, mode, onClose, path]);

  return (
    <>
      <p className="settings-description">Choose a folder for the agent to read and edit files in.</p>
      {/* J-WS-directory-discovery: folder completion from the *selected execution world* — for the
          local tab that is this machine; typing a partial path shows matching folders, keyboard
          (arrows + Tab/Enter) and pointer both complete, and pasting a full path still works. */}
      <DirectoryField
        worldId="local"
        label="Workspace directory path"
        placeholder="/path/to/project"
        value={path}
        onChange={setPath}
        invoke={invoke}
        onSubmit={() => {
          if (path.trim() && !busy) void submit();
        }}
        hint="This computer — start typing a folder path to see matches."
      />
      <fieldset className="workspace-execution-choice">
        <legend>Execution mode</legend>
        <label>
          <input type="radio" name="workspace-execution-mode" value="local" checked={mode === "local"} onChange={() => setMode("local")} />
          {inspection?.executionPosture === "uncontained-local"
            ? "Local · uncontained — agents run commands and write files on this computer as you"
            : "Local · read-only to agents — commands and writes need a contained workspace"}
        </label>
        <label title={containmentAvailable ? undefined : containmentReason}>
          <input
            type="radio"
            name="workspace-execution-mode"
            value="contained"
            checked={mode === "contained"}
            disabled={!containmentAvailable}
            aria-describedby="workspace-containment-status"
            onChange={() => setMode("contained")}
          />
          Linux child containment
        </label>
        <p id="workspace-containment-status" className="settings-description" role="status" aria-live="polite">
          {containmentAvailable ?
            `Host configured. The workspace is preflighted when opened; child process network access is denied.${containmentLimits} The Workbench host application is not isolated.` :
              containmentReason}
        </p>
      </fieldset>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary" disabled={busy || path.trim().length === 0} onClick={() => void submit()}>
          Open
        </button>
      </div>
    </>
  );
}

function AddWorkspaceDialog({ onClose }: { readonly onClose: () => void }) {
  const client = useCognate();
  const [place, setPlace] = useState<"local" | "ssh" | "wsl">("local");
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onClose);
  const invoke = useCallback<WorkspaceInvoke>(
    (capability, input) => client.invoke(capability, input as never) as unknown as Promise<unknown>,
    [client],
  );
  const places = [["local", "This computer"], ["ssh", "SSH"], ["wsl", "WSL"]] as const;
  return (
    <div className="modal-backdrop modal-backdrop-stacked">
      <div className="modal workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="add-workspace-heading" tabIndex={-1} ref={dialogRef}>
        <div className="dialog-banner">
          <h2 id="add-workspace-heading">Add workspace</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div role="tablist" aria-label="Where the workspace lives" className="rw-tabs">
          {places.map(([id, text], i) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`ws-place-${id}`}
              aria-selected={place === id}
              aria-controls="ws-place-panel"
              tabIndex={place === id ? 0 : -1}
              className="rw-tab"
              onClick={() => setPlace(id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const next = places[(i + (e.key === "ArrowRight" ? 1 : places.length - 1)) % places.length]![0];
                setPlace(next);
                requestAnimationFrame(() => document.getElementById(`ws-place-${next}`)?.focus());
              }}
            >
              {text}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="ws-place-panel" aria-labelledby={`ws-place-${place}`}>
          {place === "local" ? (
            <LocalWorkspaceForm invoke={invoke} onClose={onClose} />
          ) : place === "ssh" ? (
            <>
              <p className="settings-description">Work in a folder on another machine over SSH. Files and commands stay on that machine.</p>
              <SshWorkspaceForm onAdded={onClose} />
            </>
          ) : (
            <>
              <p className="settings-description">Work in a folder inside a WSL distribution on this machine.</p>
              <WslWorkspaceForm onAdded={onClose} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Usage pass U3 (§12): the per-workspace "Rename" dialog — writes the durable `workspace.rename`
 *  capability; the `workspaces` projection round trip updates the sidebar row. */
function RenameWorkspaceDialog({
  workspace,
  onClose,
}: {
  readonly workspace: { readonly id: string; readonly title: string };
  readonly onClose: () => void;
}) {
  const client = useCognate();
  const [title, setTitle] = useState(workspace.title);
  const [error, setError] = useState<string | undefined>(undefined);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onClose);
  const submit = useCallback(async () => {
    try {
      await client.invoke("workspace.rename", { workspaceId: workspace.id, title } as never);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, workspace.id, title, onClose]);
  return (
    <div className="modal-backdrop modal-backdrop-stacked">
      <div className="modal workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-workspace-heading" tabIndex={-1} ref={dialogRef}>
        <div className="dialog-banner">
          <h2 id="rename-workspace-heading">Rename workspace</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <input aria-label="Workspace name" value={title} onChange={(e) => setTitle(e.currentTarget.value)} onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) void submit();
        }} autoFocus />
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!title.trim()} onClick={() => void submit()}>
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}

/** The session header's agent-preset selector (usage pass U4, §15): the mode badge is a menu button
 *  labelled with the session's current preset ("Standard mode" / "PTC mode" / "Minimal mode"); a
 *  pick applies to the session's NEXT turn (the composer sends `AgentCodingInput.preset`). The
 *  current value comes from the `sessions` projection's folded `mode` field (last run's preset,
 *  or the approval-derived sticky "ptc" fallback for direct-API sessions); `fallback` is the
 *  settings default for sessions that have not run a turn yet. */
function PresetMenu({
  current,
  fallback,
  onPick,
}: {
  readonly current: AgentPreset | undefined;
  readonly fallback: AgentPreset;
  readonly onPick: (preset: AgentPreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const value = current ?? fallback;
  return (
    <div className="preset-menu-wrap" ref={ref}>
      <button type="button" className="mode-badge mode-badge-btn" aria-label={`Agent preset, current: ${AGENT_PRESET_LABELS[value]}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {AGENT_PRESET_LABELS[value]}
      </button>
      {open && (
        <div role="menu" className="workspace-actions-menu preset-menu">
          {AGENT_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              role="menuitem"
              aria-checked={preset === value}
              title={PRESET_DETAILS[preset]}
              onClick={() => {
                onPick(preset);
                setOpen(false);
              }}
            >
              {AGENT_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Presentational body of the sidebar Plugins panel — data and callbacks as props, so the status
 *  words, the refresh line, the "only render a control that acts" toggle rule and the install /
 *  refusal outcomes are assertable without a client. Serves `j_plg_install` (T11). */
export function PluginsPanelBody({
  detail,
  catalog,
  loading,
  error,
  refreshedAt,
  outcome,
  pending,
  addOpen,
  enabledKeys,
  onClose,
  onOpenDetail,
  onCloseDetail,
  onRefresh,
  onOpenAdd,
  onCloseAdd,
  onInstall,
  onToggle,
}: {
  readonly detail: PluginView | undefined;
  readonly catalog: PluginCatalogResult | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly refreshedAt: string | undefined;
  readonly outcome: string | undefined;
  readonly pending: string | undefined;
  readonly addOpen: boolean;
  readonly enabledKeys: ReadonlySet<string>;
  readonly onClose: () => void;
  readonly onOpenDetail: (id: string) => void;
  readonly onCloseDetail: () => void;
  readonly onRefresh: () => void;
  readonly onOpenAdd: () => void;
  readonly onCloseAdd: () => void;
  readonly onInstall: (pluginId: string, install: boolean) => void;
  readonly onToggle: (pluginId: string, next: boolean) => void;
}) {
  return (
    <div className="plugins-panel" role="region" aria-label="Plugins">
      <div className="plugins-panel-header">
        <div>
          <h1>{detail ? detail.name : "Plugins"}</h1>
          <p className="settings-description">
            {detail ? "Plugin detail" : "Add and manage plugins"}
            {catalog && !detail ? ` · ${catalog.views.length} in ${catalog.sources.length} source${catalog.sources.length === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="plugins-panel-actions">
          {detail ? (
            <button type="button" onClick={onCloseDetail}>
              ← All plugins
            </button>
          ) : (
            <>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Refresh plugin list${refreshedAt ? `, last refreshed ${refreshedAt}` : ""}`}
                disabled={loading}
                onClick={onRefresh}
              >
                ⟳
              </button>
              <button type="button" className="btn-primary" onClick={onOpenAdd}>
                <PlusIcon /> Add plugin
              </button>
            </>
          )}
          <button type="button" className="icon-btn" aria-label="Close plugins panel" onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      {refreshedAt && !detail && (
        <p className="plugins-status" role="status">
          Refreshed {refreshedAt}
        </p>
      )}
      {loading && !catalog && <p className="empty-state small">Loading plugins…</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {outcome && (
        <p role="status" className="plugins-status">
          {outcome}
        </p>
      )}

      {detail ? (
        <div className="plugin-detail">
          <p className="plugin-detail-description">{detail.description}</p>
          <dl className="plugin-detail-facts">
            <dt>Identifier</dt>
            <dd>
              <code>{detail.id}</code>
            </dd>
            <dt>Lifecycle</dt>
            <dd>{detail.lifecycle}</dd>
            <dt>Status</dt>
            <dd>{STATUS_LABELS[detail.status]}</dd>
            {detail.implementation.kind === "tool" && (
              <>
                <dt>Tool</dt>
                <dd>
                  <code>{detail.implementation.tool}</code>
                </dd>
              </>
            )}
            {detail.presets && detail.presets.length > 0 && (
              <>
                <dt>Composed by</dt>
                <dd>{detail.presets.join(", ")} preset{detail.presets.length === 1 ? "" : "s"}</dd>
              </>
            )}
          </dl>
          {detail.reason && <p className="plugin-detail-reason">{detail.reason}</p>}
          <div className="plugin-detail-actions">
            {detail.lifecycle === "optional" &&
              (detail.status === "installed" ? (
                <button type="button" disabled={pending !== undefined} onClick={() => onInstall(detail.id, false)}>
                  {pending === detail.id ? "Removing…" : "Uninstall"}
                </button>
              ) : (
                <button type="button" className="btn-primary" disabled={pending !== undefined} onClick={() => onInstall(detail.id, true)}>
                  {pending === detail.id ? "Installing…" : "Install"}
                </button>
              ))}
          </div>
        </div>
      ) : (
        <>
          <h3>Official</h3>
          <ul className="plugins-list" aria-label="Official plugins">
            {catalog?.views.map((p) => (
              <li key={p.id}>
                <div className="plugin-row">
                  <div className="plugin-row-text">
                    <strong>{p.name}</strong>
                    <span className="plugin-description">{p.description}</span>
                    <span className="plugin-status-line">{STATUS_LABELS[p.status]}</span>
                  </div>
                  <div className="plugin-row-actions">
                    <button type="button" aria-label={`View ${p.name}`} onClick={() => onOpenDetail(p.id)}>
                      View
                    </button>
                    {p.toggleable && p.implementation.kind === "settings-toggle" ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={optionalPluginEnabled(enabledKeys, p)}
                        aria-label={`Enable ${p.name}`}
                        onClick={() => onToggle(p.implementation.kind === "settings-toggle" ? p.implementation.key : p.id, !optionalPluginEnabled(enabledKeys, p))}
                        title={optionalPluginEnabled(enabledKeys, p) ? "On — switch off to stop it" : "Off — switch on to start it"}
                        className="settings-switch"
                      />
                    ) : (
                      <span className="plugin-not-toggleable" title={p.reason}>
                        {p.reason}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
            {catalog && catalog.views.length === 0 && <p className="empty-state small">This deployment's catalog is empty.</p>}
          </ul>
        </>
      )}

      {addOpen && (
        <AddPluginDialog
          installable={catalog?.installable ?? []}
          installed={new Set(catalog?.records.map((r) => r.pluginId) ?? [])}
          busy={pending}
          onInstall={(id) => onInstall(id, true)}
          onClose={onCloseAdd}
        />
      )}
    </div>
  );
}

/** The sidebar "Plugins" global panel (usage pass U4 §14, checkpoint 25b; made real in T11).
 *
 *  Every row is now backed by the server-authoritative `plugin.catalog`: lifecycle decides whether
 *  a switch may exist at all (see `src/plugins.ts`), so nothing renders that would do nothing.
 *  Refresh re-queries the registry; "Add plugin" installs through `plugin.install`; View opens the
 *  `#plugins/<id>` route, which survives Back, Forward and reload. */
function PluginsPanel({
  detailId,
  onClose,
  onOpenDetail,
  onCloseDetail,
}: {
  /** From the `#plugins/<id>` hash route. `undefined` is the list view. */
  readonly detailId: string | undefined;
  readonly onClose: () => void;
  readonly onOpenDetail: (id: string) => void;
  readonly onCloseDetail: () => void;
}) {
  const client = useCognate();
  const settings = useGeneralSettings();
  const [catalog, setCatalog] = useState<PluginCatalogResult | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [refreshedAt, setRefreshedAt] = useState<string | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<string | undefined>(undefined);

  const enabledKeys = useMemo(() => {
    const entries = Object.entries(settings.plugins ?? {}).filter(([, on]) => on);
    return new Set(entries.map(([k]) => k));
  }, [settings.plugins]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = (await client.invoke("plugin.catalog", {})) as unknown as PluginCatalogResult;
      setCatalog(result);
      setRefreshedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const runInstall = useCallback(
    async (pluginId: string, install: boolean) => {
      setPending(pluginId);
      setOutcome(undefined);
      try {
        const result = (await client.invoke(install ? "plugin.install" : "plugin.uninstall", { pluginId } as never)) as unknown as {
          readonly ok?: boolean;
          readonly message?: string;
        };
        setOutcome(result.message ?? (result.ok ? "Done." : "The request was refused."));
        await load();
      } catch (err) {
        setOutcome(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(undefined);
      }
    },
    [client, load],
  );

  const detail = detailId === undefined ? undefined : catalog?.views.find((v) => v.id === detailId);

  return (
    <PluginsPanelBody
      detail={detail}
      catalog={catalog}
      loading={loading}
      error={error}
      refreshedAt={refreshedAt}
      outcome={outcome}
      pending={pending}
      addOpen={addOpen}
      enabledKeys={enabledKeys}
      onClose={onClose}
      onOpenDetail={onOpenDetail}
      onCloseDetail={onCloseDetail}
      onRefresh={() => void load()}
      onOpenAdd={() => setAddOpen(true)}
      onCloseAdd={() => setAddOpen(false)}
      onInstall={(pluginId, install) => void runInstall(pluginId, install)}
      onToggle={(pluginKey, next) => {
        void client
          .invoke("settings.changePlugin", { plugins: { [pluginKey]: next } } as never)
          .catch((e) => console.error("settings.changePlugin failed", e));
      }}
    />
  );
}

/** Plain-language status for each lifecycle outcome — never colour alone. */
const STATUS_LABELS: Readonly<Record<PluginStatus, string>> = {
  "always-on": "Always on",
  "composes-tools": "Composed by presets",
  installed: "Installed",
  available: "Not installed",
  inert: "Installed, inert",
};

/** "Add plugin" (T11): a picker over the ids the registry declares installable. Installs are
 *  reported back verbatim, including an inert install or a refusal. */
function AddPluginDialog({
  installable,
  installed,
  busy,
  onInstall,
  onClose,
}: {
  readonly installable: readonly string[];
  readonly installed: ReadonlySet<string>;
  readonly busy: string | undefined;
  readonly onInstall: (id: string) => void;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onClose);
  const candidates = installable.filter((id) => !installed.has(id));
  return (
    <div className="modal-backdrop modal-backdrop-stacked">
      <div className="modal add-plugin-dialog" role="dialog" aria-modal="true" aria-labelledby="add-plugin-heading" tabIndex={-1} ref={dialogRef}>
        <div className="dialog-banner">
          <h2 id="add-plugin-heading">Add plugin</h2>
          <button type="button" className="icon-btn" aria-label="Close add plugin" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="add-plugin-body">
          {candidates.length === 0 ? (
            <p className="empty-state small">Everything this deployment offers is already installed.</p>
          ) : (
            <ul className="plugins-list">
              {candidates.map((id) => {
                const entry = catalogEntry(id);
                return (
                  <li key={id}>
                    <div className="plugin-row">
                      <div className="plugin-row-text">
                        <strong>{entry?.name ?? id}</strong>
                        <span className="plugin-description">{entry?.description ?? ""}</span>
                      </div>
                      <div className="plugin-row-actions">
                        <button type="button" disabled={busy !== undefined} onClick={() => onInstall(id)}>
                          {busy === id ? "Installing…" : "Install"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** Usage pass U5 (reference-behavior-matrix.md SS13): the session's trace row from the public
 *  `session-trace` projection — live during a run, durable after a reload (the projection re-folds
 *  from durable Cognate events). */
function useSessionTrace(sessionId: string | undefined): TraceRow | undefined {
  const rows = useProjection("session-trace");
  return useMemo(() => {
    if (!sessionId) return undefined;
    const found = rows?.find((r) => r.key === `trace/${sessionId}`);
    return found ? (found.value as unknown as TraceRow) : undefined;
  }, [rows, sessionId]);
}

function toolDurationMs(tool: TraceTool): number | undefined {
  if (!tool.completedAt) return undefined;
  return Math.max(0, Date.parse(tool.completedAt) - Date.parse(tool.startedAt));
}

function requestDurationMs(request: TraceRequest, turn: TraceTurn): number | undefined {
  // Approximate: the request ends when the next trace event after it was recorded (the turn's
  // last event is the cheapest deterministic bound). Tool rows carry exact durations instead.
  const after = [...turn.tools.map((t) => t.startedAt), ...turn.tools.map((t) => t.completedAt ?? "")].filter((t) => t.length > 0).map((t) => Date.parse(t)).sort((a, b) => a - b);
  const start = Date.parse(request.startedAt);
  const end = after.find((t) => t > start);
  return end === undefined ? undefined : end - start;
}

const TRACE_ROLE_LABELS: Readonly<Record<string, string>> = {
  system: "SYSTEM",
  user: "USER",
  assistant: "ASSISTANT",
  tool: "TOOL",
};

/** Format a duration the way the reference's trajectory rows show it ("1,408 ms"). */
function formatDurationMs(ms: number): string {
  return `${ms.toLocaleString("en-US")} ms`;
}

/** Usage pass U7 (reference-behavior-matrix.md §SS13 checkpoint 24): the trajectory timeline —
 *  a horizontal duration bar per lane (Input / Model / Tools) above the table, positioned from
 *  the events' own timestamps. Input marks where each turn begins (the turn's first recorded
 *  event), Model spans each recorded `model.generate` invocation, Tools spans each tool call's
 *  start→end. Colors are the app's identity (cobalt user / violet model / amber tools), not the
 *  reference's palette. Returns undefined when the trace has no timestamped events yet. */
function buildTrajectoryTimeline(trace: TraceRow | undefined): { readonly lanes: { readonly label: string; readonly cls: string; readonly segs: readonly { readonly left: number; readonly width: number }[] }[] } | undefined {
  if (!trace || trace.turns.length === 0) return undefined;
  const input: { start: number }[] = [];
  const model: { start: number; end?: number }[] = [];
  const tools: { start: number; end?: number }[] = [];
  for (const turn of trace.turns) {
    const starts = [...turn.requests.map((r) => Date.parse(r.startedAt)), ...turn.tools.map((t) => Date.parse(t.startedAt))].filter(Number.isFinite);
    if (starts.length > 0) input.push({ start: Math.min(...starts) });
    for (const request of turn.requests) {
      const start = Date.parse(request.startedAt);
      if (!Number.isFinite(start)) continue;
      const duration = requestDurationMs(request, turn);
      model.push({ start, end: duration !== undefined && duration > 0 ? start + duration : undefined });
    }
    for (const tool of turn.tools) {
      const start = Date.parse(tool.startedAt);
      if (!Number.isFinite(start)) continue;
      const duration = toolDurationMs(tool);
      tools.push({ start, end: duration !== undefined && duration > 0 ? start + duration : undefined });
    }
  }
  const all = [...input.map((e) => e.start), ...model.flatMap((e) => [e.start, e.end ?? e.start]), ...tools.flatMap((e) => [e.start, e.end ?? e.start])];
  if (all.length === 0) return undefined;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(max - min, 1);
  const place = (start: number, end?: number): { left: number; width: number } => {
    const left = ((start - min) / span) * 100;
    const width = end !== undefined ? Math.max(((end - start) / span) * 100, 0.6) : 1.2;
    return { left: Math.min(left, 99.4), width: Math.min(width, 100 - Math.min(left, 99.4)) };
  };
  return {
    lanes: [
      { label: "Input", cls: "tl-input", segs: input.map((e) => place(e.start)) },
      { label: "Model", cls: "tl-model", segs: model.map((e) => place(e.start, e.end)) },
      { label: "Tools", cls: "tl-tools", segs: tools.map((e) => place(e.start, e.end)) },
    ],
  };
}

/** The Trajectory tab (SS13, checkpoints 24*): toolbar (Collapse turns / Search trajectory), a
 *  role-badged trace table (USER rows, ASSISTANT "Request #N" rows, TOOL `tool{args} -> result`
 *  rows), and the right-hand "Event details" panel (TOOL: Summary/Payload/Result/Schema/Timing;
 *  Request: Summary/Options/Timing). Structurally per the pinned reference; the timeline strip and
 *  the Calls toggle are approximated (docs/known-gaps.md). The SYSTEM row kind exists in the data model
 *  but this app sends no system prompt, so no SYSTEM rows appear — honest, not invented. */
function TrajectoryView({
  trace,
  onSelect,
}: {
  readonly trace: TraceRow | undefined;
  readonly onSelect: (detail: { readonly kind: "request" | "tool"; readonly turnIndex: number; readonly requestNumber?: number; readonly toolCallId?: string }) => void;
}) {
  const [collapseTurns, setCollapseTurns] = useState(false);
  const [collapseCalls, setCollapseCalls] = useState(false);
  const [actualDuration, setActualDuration] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const turnMatches = (turn: TraceTurn) =>
    q.length === 0 ||
    turn.userText.toLowerCase().includes(q) ||
    turn.requests.some((r) => (r.responseText ?? "").toLowerCase().includes(q) || (r.failure ?? "").toLowerCase().includes(q)) ||
    turn.tools.some((t) => t.tool.toLowerCase().includes(q) || t.args.toLowerCase().includes(q) || (t.result ?? "").toLowerCase().includes(q) || (t.error ?? "").toLowerCase().includes(q));
  const timeline = buildTrajectoryTimeline(trace);
  return (
    <div className="trajectory-view">
      <div className="trajectory-toolbar" role="toolbar" aria-label="Trajectory toolbar">
        <button type="button" aria-pressed={actualDuration} aria-label="Use actual duration" onClick={() => setActualDuration((v) => !v)}>
          Duration
        </button>
        <button type="button" aria-pressed={collapseTurns} aria-label={collapseTurns ? "Expand turns" : "Collapse turns"} onClick={() => setCollapseTurns((v) => !v)}>
          Turns
        </button>
        <button type="button" aria-pressed={collapseCalls} aria-label={collapseCalls ? "Expand calls" : "Collapse calls"} onClick={() => setCollapseCalls((v) => !v)}>
          Calls
        </button>
        <input type="search" aria-label="Search trajectory" placeholder="Search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      </div>
      {timeline !== undefined && (
        <div className="trajectory-timeline" role="region" aria-label="Trajectory timeline">
          {timeline.lanes.map((lane) => (
            <div key={lane.label} className="trajectory-timeline-row">
              <span className="trajectory-timeline-label">{lane.label}</span>
              <span className={`trajectory-timeline-track ${lane.cls}`}>
                {lane.segs.map((seg, i) => (
                  <span key={i} className="trajectory-timeline-seg" style={{ left: `${seg.left}%`, width: `${seg.width}%` }} />
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="trajectory-table" role="table" aria-label="Execution trace">
        {!trace || trace.turns.length === 0 ? (
          <p className="empty-state small">No trace yet for this session.</p>
        ) : (
          trace.turns.filter(turnMatches).map((turn) =>
            collapseTurns ? (
              <div key={turn.index} role="row" className="trace-row trace-collapsed">
                <span className="trace-role-badge">Turn {turn.index}</span>
                <span className="trace-cell">
                  Collapsed turn summary, {turn.requests.length + turn.tools.length} steps · {turn.tools.length} tool call{turn.tools.length === 1 ? "" : "s"}
                </span>
              </div>
            ) : (
              <div key={turn.index} role="rowgroup" className="trace-turn">
                <div role="row" className="trace-row">
                  <span className="trace-role-badge role-user">USER</span>
                  <span className="trace-cell">{turn.userText}</span>
                </div>
                {turn.requests.map((request) => (
                  <div key={`req-${request.requestNumber}`} role="row" className="trace-row">
                    <span className="trace-role-badge">
                      <button type="button" className="trace-request-btn" onClick={() => onSelect({ kind: "request", turnIndex: turn.index, requestNumber: request.requestNumber })}>
                        Request #{request.requestNumber}
                      </button>
                      ASSISTANT
                    </span>
                    <span className="trace-cell">
                      {request.responseText ? request.responseText : request.failure ? request.failure : "(tool call only)"}
                      {actualDuration && turn !== undefined && requestDurationMs(request, turn) !== undefined && (
                        <span className="trace-duration">{formatDurationMs(requestDurationMs(request, turn)!)}</span>
                      )}
                    </span>
                  </div>
                ))}
                {collapseCalls ? (
                  <div role="row" className="trace-row trace-collapsed">
                    <span className="trace-role-badge role-tool">TOOL</span>
                    <span className="trace-cell">Collapsed calls, {turn.tools.length} tool call{turn.tools.length === 1 ? "" : "s"}</span>
                  </div>
                ) : (
                  turn.tools.map((tool) => {
                    const duration = toolDurationMs(tool);
                    return (
                      <div key={tool.toolCallId} role="row" className="trace-row">
                        <span className="trace-role-badge role-tool">TOOL</span>
                        <button type="button" className="trace-cell trace-tool-btn" onClick={() => onSelect({ kind: "tool", turnIndex: turn.index, toolCallId: tool.toolCallId })}>
                          <code>
                            {tool.tool}
                            {tool.args}
                          </code>
                          <span className="trace-tool-result">→ {tool.status === "failed" ? tool.error : tool.status === "running" ? "(running…)" : (tool.result ?? "(no output)")}</span>
                          {actualDuration && duration !== undefined && <span className="trace-duration">{formatDurationMs(duration)}</span>}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}

/** The "Event details" panel for a selected trace row (SS13): TOOL rows get
 *  Summary/Payload/Result/Schema/Timing; ASSISTANT requests get Summary/Options/Timing. Payload and
 *  Schema render this app's own recorded data / TOOL_DEFS — nothing is copied from the reference. */
function TraceDetailsPanel({
  trace,
  detail,
  onClose,
}: {
  readonly trace: TraceRow | undefined;
  readonly detail: { readonly kind: "request" | "tool"; readonly turnIndex: number; readonly requestNumber?: number; readonly toolCallId?: string };
  readonly onClose: () => void;
}) {
  const turn = trace?.turns.find((t) => t.index === detail.turnIndex);
  const request = detail.requestNumber !== undefined ? turn?.requests.find((r) => r.requestNumber === detail.requestNumber) : undefined;
  const tool = detail.toolCallId !== undefined ? turn?.tools.find((t) => t.toolCallId === detail.toolCallId) : undefined;
  // Usage pass U7: the RealityTrace enrichment reflects the plugin's durable state — when the
  // plugin is off, receipts stay queued and the panel says so instead of implying delivery.
  const realitytrace = useRealityTracePlugin();
  const client = useCognate();
  const [tab, setTab] = useState<"summary" | "payload" | "result" | "schema" | "options" | "timing" | "ledger">(request ? "summary" : "summary");
  // Usage pass U6 (RealityTrace, Option A): the receipt layer for this row's events — queried on
  // mount via `observation.status`; the drill-down reads the SXR record's correlation payload.
  const [ledger, setLedger] = useState<readonly { readonly eventId: string; readonly state?: string; readonly observationId?: string; readonly targetRef?: string | null; readonly attempts?: number }[] | undefined>(undefined);
  const [sxrRecord, setSxrRecord] = useState<string | undefined>(undefined);
  const eventIds = useMemo(() => [request?.eventId, tool?.eventId].filter((id): id is string => Boolean(id)), [request?.eventId, tool?.eventId]);
  useEffect(() => {
    setLedger(undefined);
    setSxrRecord(undefined);
    if (eventIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = (await client.invoke("observation.status", { eventIds } as never)) as unknown as {
          readonly statuses: readonly { readonly eventId: string; readonly state?: string; readonly observationId?: string; readonly targetRef?: string | null; readonly attempts?: number }[];
        };
        if (!cancelled) setLedger(res.statuses);
      } catch {
        if (!cancelled) setLedger([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, eventIds]);
  const toolStep = tool && turn ? turn.tools.findIndex((t) => t.toolCallId === tool.toolCallId) + 1 : undefined;
  const heading = request ? `Request #${request.requestNumber} Turn ${turn?.index}` : tool ? `TOOL Turn ${turn?.index} · Step ${toolStep}` : "";
  const tabs = request
    ? (["summary", "options", "timing", "ledger"] as const)
    : (["summary", "payload", "result", "schema", "timing", "ledger"] as const);
  return (
    <aside className="right-panel trace-details" role="complementary" aria-label="Event details">
      <div className="right-panel-tabs" role="tablist">
        <span className="trace-details-heading">{heading}</span>
        <div className="trace-details-tabs">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === "summary" ? "Summary" : t === "payload" ? "Payload" : t === "result" ? "Result" : t === "schema" ? "Schema" : t === "options" ? "Options" : t === "timing" ? "Timing" : "RealityTrace"}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="right-panel-body">
        {request && tab === "summary" && (
          <dl className="trace-kv">
            <dt>Status</dt>
            <dd>{request.status === "completed" ? "Completed" : "Failed"}</dd>
            <dt>Tool calls</dt>
            <dd>{String(request.responseToolCalls?.length ?? 0)}</dd>
            {request.responseText !== undefined && (
              <>
                <dt>Result</dt>
                <dd>{request.responseText}</dd>
              </>
            )}
            {request.failure !== undefined && (
              <>
                <dt>Failure</dt>
                <dd>{request.failure}</dd>
              </>
            )}
          </dl>
        )}
        {request && tab === "options" && (
          <dl className="trace-kv">
            <dt>Tools offered</dt>
            <dd>{request.toolNames.join(", ") || "(none)"}</dd>
            <dt>Messages</dt>
            <dd>{request.messages.length}</dd>
          </dl>
        )}
        {tool && tab === "summary" && (
          <dl className="trace-kv">
            <dt>Hierarchy</dt>
            <dd>
              <button type="button" onClick={() => undefined}>
                Assistant Message
              </button>
            </dd>
            <dt>Status</dt>
            <dd>{tool.status === "success" ? "Completed" : tool.status === "failed" ? "Failed" : "Running"}</dd>
          </dl>
        )}
        {tool && tab === "payload" && <pre className="trace-json">{tool.args}</pre>}
        {tool && tab === "result" && <pre className="trace-json">{tool.status === "failed" ? (tool.error ?? "") : (tool.result ?? "(no output)")}</pre>}
        {tool && tab === "schema" && (
          <>
            <h4>{tool.tool}</h4>
            <p className="settings-description">{TOOL_DEFS.find((t) => t.name === tool.tool)?.description ?? "No schema recorded for this tool."}</p>
            <pre className="trace-json">{JSON.stringify(TOOL_DEFS.find((t) => t.name === tool.tool)?.inputSchema ?? {}, null, 2)}</pre>
          </>
        )}
        {tab === "timing" && (
          <dl className="trace-kv">
            <dt>Started</dt>
            <dd>{(request ?? tool)?.startedAt}</dd>
            <dt>Duration</dt>
            <dd>
              {tool
                ? toolDurationMs(tool) !== undefined
                  ? `${toolDurationMs(tool)} ms`
                  : "(running)"
                : request
                  ? turn && requestDurationMs(request, turn) !== undefined
                    ? `${requestDurationMs(request, turn)} ms`
                    : "(n/a)"
                  : ""}
            </dd>
            <dt>Timing source</dt>
            <dd>Session timestamps</dd>
          </dl>
        )}
        {tab === "ledger" && (
          <div className="trace-ledger">
            <p className="settings-description">
              RealityTrace receipts for this row's events — the trace itself stays event-sourced; this is the evidence layer.
            </p>
            {!realitytrace.enabled && (
              <p className="settings-description plugin-off-banner">
                RealityTrace observations are disabled — enable the RealityTrace plugin in the sidebar Plugins panel. Events stay queued and deliver when enabled.
              </p>
            )}
            {ledger === undefined ? (
              <p className="settings-description">Checking receipts…</p>
            ) : ledger.length === 0 ? (
              <p className="settings-description">No observation receipts recorded for this row's events.</p>
            ) : (
              ledger.map((entry) => (
                <dl key={entry.eventId} className="trace-kv">
                  <dt>Event</dt>
                  <dd>
                    <code>{entry.eventId}</code>
                  </dd>
                  <dt>Status</dt>
                  <dd>{entry.state ?? "queued"}</dd>
                  {entry.observationId !== undefined && (
                    <>
                      <dt>Observation</dt>
                      <dd>
                        <code>{entry.observationId}</code>
                      </dd>
                    </>
                  )}
                  {entry.targetRef ? (
                    <>
                      <dt>Ledger position</dt>
                      <dd>
                        <code>{entry.targetRef}</code>{" "}
                        <button
                          type="button"
                          onClick={() =>
                            void client
                              .invoke("observation.record", { targetRef: entry.targetRef } as never)
                              .then((res: unknown) => {
                                const correlation = (res as { readonly correlation?: unknown }).correlation;
                                setSxrRecord(correlation === null || correlation === undefined ? "no record at this position" : JSON.stringify(correlation, null, 2));
                              })
                              .catch((e) => setSxrRecord(`read failed: ${e instanceof Error ? e.message : String(e)}`))
                          }
                        >
                          View SXR record
                        </button>
                      </dd>
                    </>
                  ) : null}
                  {entry.attempts !== undefined && (
                    <>
                      <dt>Attempts</dt>
                      <dd>{entry.attempts}</dd>
                    </>
                  )}
                </dl>
              ))
            )}
            {sxrRecord !== undefined && <pre className="trace-json">{sxrRecord}</pre>}
          </div>
        )}
      </div>
    </aside>
  );
}

/** "Into the Unknown" hero landing (critic round-2 batch A P0, checkpoints 04/05): a workspace is
 *  selected but the active session has no messages yet — reference/observations/aria/
 *  04-workspace-selected.desktop.txt and 05-empty-session.desktop.txt are byte-identical, both
 *  showing this centered landing (logo, heading, "Preview" badge, workspace/mode pills, a centered
 *  composer) with no tab bar or header actions. The session chrome (title bar, Chat/Trajectory
 *  tabs) only appears once the session has an actual message (06-user-message onward). */
function HeroLanding({
  workspaceLabel,
  modeLabel,
  composerDisabled,
  modelLabel,
  onSend,
  accessMode,
  onAccessModeChange,
  sendBehavior,
  workspaces,
  onSwitchWorkspace,
  onAddWorkspace,
  composerFocusToken,
}: {
  readonly workspaceLabel: string;
  readonly modeLabel: string;
  readonly composerDisabled: boolean;
  readonly modelLabel: string | undefined;
  readonly onSend: (message: string) => void;
  /** Usage pass U2: the hero composer's access-mode dropdown edits the pending choice the
   *  session-creating send() consumes (no session id exists yet to key an override onto). */
  readonly accessMode: PermissionMode;
  readonly onAccessModeChange: (mode: PermissionMode) => void;
  readonly sendBehavior: SendBehavior;
  /** Usage pass U3 (§12): the composer-area "Choose workspace" control — a dropdown of added
   *  workspaces + "Add workspace…" once at least one exists. */
  readonly workspaces: readonly WorkspaceRow[];
  readonly onSwitchWorkspace: (ws: WorkspaceRow) => void;
  readonly onAddWorkspace: () => void;
  /** J-SESSION-draft: forwarded to the composer so a fresh draft takes focus. */
  readonly composerFocusToken?: number;
}) {
  const [chooseOpen, setChooseOpen] = useState(false);
  const chooseRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!chooseOpen) return;
    const onDown = (e: MouseEvent) => {
      if (chooseRef.current && !chooseRef.current.contains(e.target as Node)) setChooseOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChooseOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [chooseOpen]);
  return (
    <>
      <div className="hero-landing">
        <LogoIcon className="hero-logo" />
        <div className="hero-heading-row">
          <h1 className="hero-heading">Start a session</h1>
          <span className="hero-preview-badge">Preview</span>
        </div>
        <div className="hero-pills">
          <div className="hero-pill hero-pill-choice" ref={chooseRef}>
            <button
              type="button"
              aria-label="Choose workspace"
              aria-haspopup="menu"
              aria-expanded={chooseOpen}
              title={workspaceLabel}
              onClick={() => setChooseOpen((v) => !v)}
            >
              <FolderIcon aria-hidden="true" />
              {workspaceLabel}
              <ChevronDownIcon aria-hidden="true" />
            </button>
            {chooseOpen && (
              <div role="menu" className="workspace-actions-menu hero-choose-menu">
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setChooseOpen(false);
                      onSwitchWorkspace(ws);
                    }}
                  >
                    {ws.title || ws.id}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setChooseOpen(false);
                    onAddWorkspace();
                  }}
                >
                  Add workspace…
                </button>
              </div>
            )}
          </div>
          <span className="mode-badge">{modeLabel}</span>
        </div>
        <div className="hero-composer">
          <Composer
            disabled={composerDisabled}
            sending={false}
            modelLabel={modelLabel}
            planMode={false}
            onSend={onSend}
            onStop={() => undefined}
            onTogglePlanMode={() => undefined}
            accessMode={accessMode}
            onAccessModeChange={onAccessModeChange}
            sendBehavior={sendBehavior}
            onBusySubmit={() => undefined}
            focusToken={composerFocusToken}
          />
        </div>
      </div>
    </>
  );
}


function WorkbenchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="3.5" rx="1" />
      <rect x="2" y="8.5" width="5" height="5" rx="1" />
      <rect x="9" y="8.5" width="5" height="5" rx="1" />
    </svg>
  );
}

export function App() {
  const client = useCognate();
  const workspaces = useWorkspaces();
  const worlds = useExecutionWorlds();
  const sessions = useSessions();
  const modelConfig = useModelConfig();
  const currentWorkspaceId = useCurrentWorkspaceId();
  // The open Case (if any) rides on each run so the agent gets the Case-scoped tools and mediation context.
  const activeCaseId = useProjection("cognitive")?.find((r) => r.key === "activeCase")?.value as string | undefined;
  // Usage pass U2: every General setting resolves from the durable `settings` row (one merged
  // "current" row folded from `settings.changed` events); the concrete theme follows the
  // `appearance` setting (light/dark/system — system tracks the OS scheme live).
  const settings = useGeneralSettings();
  const theme = useTheme(settings.appearance);
  const workDetails = settings.workDetails;
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // "Open keyboard shortcuts Ctrl /" (ShortcutsDialog's one real binding) — a global listener, so
  // the dialog opens from anywhere. Ignored while typing in a textarea/input (the reference's
  // binding list is application-level, not composer-level).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && (e.ctrlKey || e.metaKey)) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const [collapsed, setCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Usage pass U2: per-session access mode (the composer dropdown) — an override map keyed by
  // session id, seeded from the settings default for new sessions (`pendingAccessMode` carries a
  // hero-composer choice into the session send() creates). The `sessions` projection folds each
  // run's mode back from durable events, so a reload restores the last-used value.
  const [accessModeOverrides, setAccessModeOverrides] = useState<Record<string, PermissionMode>>({});
  const [pendingAccessMode, setPendingAccessMode] = useState<PermissionMode | undefined>(undefined);
  // Send behavior while busy (§11): a Queue-parked message waits (ref-mirrored so the settle
  // effect reads it without a dependency loop); Steer cancels + sends immediately.
  const [queuedMessage, setQueuedMessage] = useState<string | undefined>(undefined);
  const queuedRef = useRef<string | undefined>(undefined);
  // Usage pass U3 (reference-behavior-matrix.md §12): the sidebar's Workspaces header controls and
  // multi-workspace tree — search, view options (grouping/ordering), per-workspace collapse state,
  // the per-workspace actions menu, and the Add-workspace / Rename dialogs.
  const [searchOpen, setSearchOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const viewOptionsRef = useRef<HTMLDivElement>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("workspace-tree");
  const [orderBy, setOrderBy] = useState<OrderBy>("manual");
  // T11 (J-SESSION-archive): whether archived conversations are listed is a view preference, not
  // stored state — archiving is durable, visibility is not.
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("hide-archived");
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<ReadonlySet<string>>(new Set());
  const [wsMenuFor, setWsMenuFor] = useState<string | undefined>(undefined);
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [renameFor, setRenameFor] = useState<{ readonly id: string; readonly title: string } | undefined>(undefined);
  const [chooseWsOpen, setChooseWsOpen] = useState(false);
  const chooseWsRef = useRef<HTMLDivElement>(null);
  // Usage pass U4 (§14): the sidebar "Plugins" global panel — a toggle that swaps the center
  // column for the plugin manager (the reference's panel replaces the session surface, per the
  // 25b checkpoint's aria tree).
  const [pluginsPanelOpen, setPluginsPanelOpen] = useState(false);
  const [expertsPanelOpen, setExpertsPanelOpen] = useState(false);
  // T11: `#plugins/<id>` is the panel's only route. The hash is the source of truth, so Back,
  // Forward and a reload all restore the same view; opening pushes one history entry and closing
  // unwinds it (or replaces it when the page was deep-linked).
  const [detailPluginId, setDetailPluginId] = useState<string | undefined>(undefined);
  const pushedDetailRef = useRef(false);
  useEffect(() => {
    const readHash = () => {
      const match = /^#?\/?plugins\/(.+)$/.exec(window.location.hash);
      const id = match ? decodeURIComponent(match[1]!) : undefined;
      setDetailPluginId(id);
      if (id) setPluginsPanelOpen(true);
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, []);
  const openPluginDetail = useCallback((id: string) => {
    pushedDetailRef.current = true;
    window.location.hash = `plugins/${encodeURIComponent(id)}`;
  }, []);
  const closePluginDetail = useCallback(() => {
    if (pushedDetailRef.current) {
      pushedDetailRef.current = false;
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    setDetailPluginId(undefined);
  }, []);
  /** Closing the panel must also unwind its route, so a stale hash never re-opens it on reload. */
  const closePluginsPanel = useCallback(() => {
    if (detailPluginId !== undefined) {
      if (pushedDetailRef.current) {
        pushedDetailRef.current = false;
        window.history.back();
      } else {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        setDetailPluginId(undefined);
      }
    }
    setPluginsPanelOpen(false);
  }, [detailPluginId]);
  // Workbench: the cockpit view (tasks, workflows, capabilities, automations) and the task the
  // conversation is bound to (scopes authority, attributes usage).
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  // Focus (ported from gs-term): the person's explicit selection in the Workbench. "this" is resolved
  // by fixed precedence and FROZEN at send time, so it cannot drift while the agent works.
  const [focusSelection, setFocusSelection] = useState<FocusRef | undefined>(undefined);
  // Usage pass U4 (§15): per-session agent preset (the header selector) — the value the composer
  // sends as `AgentCodingInput.preset` on this session's NEXT turn; the `sessions` projection folds
  // the last run's preset back into the row's `mode` badge field.
  const [presetOverrides, setPresetOverrides] = useState<Record<string, AgentPreset>>({});
  // Usage pass U5 (§13): the session header's Chat/Trajectory tab strip (gated on the Coding Tools
  // setting) and the Event-details panel's selected row.
  const [sessionTab, setSessionTab] = useState<"chat" | "trajectory">("chat");
  const [traceDetail, setTraceDetail] = useState<{ readonly kind: "request" | "tool"; readonly turnIndex: number; readonly requestNumber?: number; readonly toolCallId?: string } | undefined>(undefined);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [transcript, setTranscript] = useState<readonly ChatMessage[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined);
  // J-TASK-scope/link: which task this conversation serves is a *durable per-session binding*
  // (the `session-task-bindings` projection, written by `session.task.bind`), not global UI state —
  // a new session never inherits another session's task. Two presentation-only overlays span the
  // sub-second fold window without ever becoming the truth:
  //  - `optimisticBind`: the value the user just picked, until the projection row agrees;
  //  - `pendingTaskId`: a task picked from the session-less hero surface, consumed (and made
  //    durable) by the session-creating first send — same shape as `pendingAccessMode`.
  const sessionTaskBinding = useSessionTaskBinding(activeSessionId);
  const [optimisticBind, setOptimisticBind] = useState<{ readonly sessionId: string; readonly taskId: string | null } | undefined>(undefined);
  const [pendingTaskId, setPendingTaskId] = useState<string | undefined>(undefined);
  const [taskBindError, setTaskBindError] = useState<string | undefined>(undefined);
  const activeTaskId = useMemo(() => {
    if (!activeSessionId) return pendingTaskId;
    if (optimisticBind && optimisticBind.sessionId === activeSessionId && sessionTaskBinding?.taskId !== optimisticBind.taskId) {
      return optimisticBind.taskId ?? undefined;
    }
    return sessionTaskBinding?.taskId ?? undefined;
  }, [activeSessionId, pendingTaskId, optimisticBind, sessionTaskBinding]);
  /** Attach (`taskId`) or detach (`null`) the durable binding for the active session. */
  const bindTask = useCallback(
    async (taskId: string | null) => {
      setTaskBindError(undefined);
      if (!activeSessionId) {
        // No conversation yet: park the choice for the session the next send creates.
        setPendingTaskId(taskId ?? undefined);
        return;
      }
      setOptimisticBind({ sessionId: activeSessionId, taskId });
      try {
        await client.invoke("session.task.bind", { sessionId: activeSessionId, taskId } as never);
      } catch (e) {
        setOptimisticBind(undefined);
        setTaskBindError(errorText(e));
      }
    },
    [client, activeSessionId],
  );
  const bindableTasks = useBindableTasks(currentWorkspaceId, activeSessionId);
  const attentionNow = useMemo(() => {
    const bound = bindableTasks.find((t) => t.id === activeTaskId);
    return {
      workspaceId: currentWorkspaceId ?? "",
      ...(focusSelection ? { selection: focusSelection } : {}),
      ...(bound ? { activeRun: { kind: "task" as const, id: bound.id, workspaceId: bound.workspaceId, label: bound.title } } : {}),
      pinned: [] as readonly FocusRef[],
    };
  }, [currentWorkspaceId, focusSelection, bindableTasks, activeTaskId]);
  const resolvedAttention = useMemo(() => resolveAttention(attentionNow), [attentionNow]);
  const messageWithFocus = useCallback((message: string) => withReferent(message, captureSnapshot(crypto.randomUUID(), attentionNow, new Date().toISOString())), [attentionNow]);
  const runStartedAtRef = useRef<number>(0);
  const streaming = useStreamingTurn(activeRunId);
  const elapsedSeconds = useElapsedSeconds(streaming.status === "streaming", runStartedAtRef.current);
  const toolEntries = useToolTimeline(activeRunId);
  const { open: openContinuations, resolve: resolveContinuation } = useContinuations(activeRunId);

  // The tool loop is sequential (one call in flight at a time), so at most one `tool-approval`
  // continuation is ever open for a run — match it to the tool entry currently waiting.
  const decideApproval = useCallback(
    async (_toolCallId: string, approved: boolean) => {
      const continuation = openContinuations.find((c) => c.type === "tool-approval");
      if (!continuation) return;
      await resolveContinuation(continuation.id, "resume", { approved });
    },
    [openContinuations, resolveContinuation],
  );
  const pendingApproval = toolEntries.find((e) => e.approval?.status === "pending");

  // J-E-plan: the active session's plan state (`plans` projection) — used for the To-dos widget,
  // the composer's plan-mode placeholder/toggle, and the review card below. A run's tool loop is
  // sequential (same invariant as approvals above), so at most one `plan-review` continuation is
  // ever open at a time.
  const planState = usePlanState(activeSessionId);
  const planReviewPendingSessions = usePlanReviewPendingSessions();
  // Usage pass U5 (§13): the active session's execution trace + the Coding Tools gate.
  const trace = useSessionTrace(activeSessionId);

  // J-F-delegation: subagent rows for the active session, plus a local toggle for the banner's "N
  // subagent(s)" disclosure (reference-behavior-matrix.md §6.4).
  const subagentRows = useSubagents(activeSessionId);
  const [subagentsExpanded, setSubagentsExpanded] = useState(false);
  const [openChildToolCallId, setOpenChildToolCallId] = useState<string | undefined>(undefined);
  const openChildRow = subagentRows.find((r) => r.toolCallId === openChildToolCallId);
  // Review split-diff panel (critic round-2 batch B P0) — mutually exclusive with the subagent
  // child-transcript panel; both reuse the same right-hand-pane slot beside the chat.
  const [openReview, setOpenReview] = useState<{ readonly summary: EditSummary; readonly turnNumber: number } | undefined>(undefined);
  // T11: every edit in this session, keyed the same way ReviewPanel keys its tabs — the "Add tab"
  // picker and the panel's initial tab come from one source.
  const availableReviewTabs = useMemo(
    () =>
      transcript
        .map((message, index) => (message.editSummary ? reviewTabKey(message.editSummary, index + 1) : undefined))
        .filter((tab): tab is ReviewTab => tab !== undefined),
    [transcript],
  );
  const openReviewPanel = useCallback((summary: EditSummary, turnNumber: number) => {
    setOpenChildToolCallId(undefined);
    setOpenReview({ summary, turnNumber });
  }, []);
  const planReviewContinuation = openContinuations.find((c) => c.type === "plan-review");
  const decidePlanReview = useCallback(
    async (approved: boolean) => {
      if (!planReviewContinuation) return;
      await resolveContinuation(planReviewContinuation.id, "resume", { approved });
    },
    [planReviewContinuation, resolveContinuation],
  );
  // An interrupted agent step (`run.invocation.reconcile`): the run waits, unrepeated, until the
  // operator records what actually happened. Only a direct operator call can resolve it.
  const ambiguousContinuation = openContinuations.find((c) => c.type === "ambiguous-invocation");
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileError, setReconcileError] = useState<string>();
  const decideAmbiguous = useCallback(
    async (outcome: "succeeded" | "failed", reason: string) => {
      if (!ambiguousContinuation) return;
      setReconcileBusy(true);
      setReconcileError(undefined);
      try {
        await client.invoke("run.invocation.reconcile", { continuationId: ambiguousContinuation.id, outcome, reason } as never);
      } catch (failure: unknown) {
        setReconcileError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setReconcileBusy(false);
      }
    },
    [ambiguousContinuation, client],
  );
  // Generic fallback: an open continuation of a type this view does not render is still visible.
  const otherContinuation = openContinuations.find((c) => !["tool-approval", "plan-review", "ambiguous-invocation"].includes(c.type));

  // Sidebar auto-collapses *below* 1024px viewport width, matching the reference's
  // `SIDEBAR_AUTO_COLLAPSE = 1024px` breakpoint (product-characterization.md §2: "sidebar
  // auto-collapses to rail below this width" — 1024px itself, the laptop checkpoint viewport, stays
  // expanded; critic round-1 P0-2 confirmed the reference keeps the full sidebar at exactly
  // 1024x768). A manual toggle can still re-expand it over a squeezed center column.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setCollapsed(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const composerDisabled = !currentWorkspaceId || !modelConfig;
  const currentSession = sessions.find((s) => s.id === activeSessionId);
  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId);
  // Usage pass U2: the composer dropdown's effective value — the per-session override, else the
  // `sessions` projection's folded access mode (last run's `mode`), else the settings default
  // (hero composer: a pending choice made before the session exists, else the settings default).
  const effectiveAccessMode: PermissionMode =
    (activeSessionId ? accessModeOverrides[activeSessionId] : undefined) ??
    (currentSession && isPermissionMode(currentSession.accessMode) ? currentSession.accessMode : undefined) ??
    (activeSessionId ? settings.permission : (pendingAccessMode ?? settings.permission));
  const changeAccessMode = useCallback(
    (mode: PermissionMode) => {
      if (activeSessionId) setAccessModeOverrides((prev) => ({ ...prev, [activeSessionId]: mode }));
      else setPendingAccessMode(mode);
    },
    [activeSessionId],
  );

  // Remembers the last-open session per workspace (`localStorage`, per-browser only — see Artifact
  // tool's browser-storage guidance; this is a UI convenience, not durable state) so a reload lands
  // back on the same session instead of the empty "no session selected" shell
  // (`17-restored-after-reload`, `11b-approval-pending-after-reload`). The actual run/approval state
  // shown once reopened comes entirely from durable events/projections, not from this key.
  const rememberSession = useCallback((workspaceId: string, sessionId: string) => {
    try {
      localStorage.setItem(`cognate.lastSession.${workspaceId}`, sessionId);
    } catch {
      // best-effort; ignore storage failures (private mode, quota, etc.)
    }
  }, []);

  const openSession = useCallback(
    async (sessionId: string) => {
      setActiveSessionId(sessionId);
      setOpenReview(undefined);
      setTraceDetail(undefined);
      setSessionTab("chat");
      // J-SESSION-draft: reopening (a click, a reload, a restart) puts the person straight back in
      // the conversation — the composer is focused and ready when prerequisites are satisfied.
      setComposerFocusToken((token) => token + 1);
      // Reattach to a still-in-flight run (running, or waiting on an approval continuation) so its
      // live tool/approval state survives a reload (`11b-approval-pending-after-reload`) — the
      // `sessions` projection's `runId`/`lastStatus` are durable, so this works after a full
      // restart too, not just a soft reload.
      const row = sessions.find((s) => s.id === sessionId);
      const stillInFlight = row && (row.lastStatus === "running" || row.lastStatus === "waiting") && row.runId;
      setActiveRunId(stillInFlight ? (row.runId as string) : undefined);
      // Reattaching after a reload loses the in-memory "when did this run start" clock — reset it to
      // now rather than leaving it at its initial 0, which would render a nonsensical "Took Ns"
      // duration (`Date.now() - 0`) once the reattached run completes.
      if (stillInFlight) runStartedAtRef.current = Date.now();
      if (row) rememberSession(row.workspaceId, sessionId);
      const history = (await client.invoke("session.history", { sessionId })) as {
        role: string;
        content: string;
        stepCount?: number;
      }[];
      setTranscript(
        history.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
          at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          // Critic round-4 P1-3: reopening a session from history must feed the same "N turns M
          // steps" footer counter (`sessionSteps` below) that a live-finished turn does — see
          // `sessionHistory.ts`'s `stepCount` (tool-call count + 1, matching `useToolTimeline(...)
          // .length + 1`), not the unset/`0` default that regressed `15-completed-session`.
          stepCount: m.role === "assistant" ? (m.stepCount ?? 1) : undefined,
        })),
      );
    },
    [client, sessions, rememberSession],
  );

  // Auto-restore the last-open session for the current workspace on mount/reload (see
  // `rememberSession` above) — `openSession` itself reattaches to any still-in-flight run from
  // durable state, so this is what makes `17-restored-after-reload`/`11b-approval-pending-after-
  // reload` show the same session instead of the empty shell.
  useEffect(() => {
    if (!currentWorkspaceId || activeSessionId) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(`cognate.lastSession.${currentWorkspaceId}`);
    } catch {
      remembered = null;
    }
    if (remembered && sessions.some((s) => s.id === remembered)) void openSession(remembered);
  }, [currentWorkspaceId, sessions, activeSessionId, openSession]);

  // J-SESSION-draft: pressing + creates a REAL, durable session (a `session.create` recording run,
  // folded by the `sessions` projection) before any prompt — not an in-memory UUID. Each click
  // mints a fresh idempotency identity, so each click is one new conversation; the invoke waits
  // for its recording run to settle, so the row exists by the time the sidebar selects it.
  const [newSessionPending, setNewSessionPending] = useState(false);
  const [newSessionError, setNewSessionError] = useState<string | undefined>(undefined);
  // Bumped whenever a fresh draft should take composer focus (J-SESSION-draft: "the composer is
  // focused and ready when prerequisites are satisfied" — a model must be configured).
  const [composerFocusToken, setComposerFocusToken] = useState(0);

  const startNewSession = useCallback(
    async (workspaceId: string) => {
      if (newSessionPending) return;
      setNewSessionPending(true);
      setNewSessionError(undefined);
      // J-SESSION-draft: the + action means "take me to the conversation" — the center surface
      // switches immediately (from Workbench, Experts & Teams, Plugins or chat), so the composer
      // is visible the moment the click lands; only the durable identity then arrives async.
      setExpertsPanelOpen(false);
      setPluginsPanelOpen(false);
      setWorkbenchOpen(false);
      try {
        const result = (await client.invoke("session.create", { workspaceId, requestId: crypto.randomUUID() } as never)) as { sessionId: string };
        // No state may leak from a previous session: transcript, review, trace, plan tab and the
        // explicit focus selection all reset; the task binding is per-session by construction.
        setActiveSessionId(result.sessionId);
        setActiveRunId(undefined);
        setTranscript([]);
        setOpenReview(undefined);
        setTraceDetail(undefined);
        setSessionTab("chat");
        setFocusSelection(undefined);
        rememberSession(workspaceId, result.sessionId);
        setComposerFocusToken((token) => token + 1);
      } catch (e) {
        // Visible, actionable failure (never console-only); the + button retries.
        setNewSessionError(errorText(e));
      } finally {
        setNewSessionPending(false);
      }
    },
    [client, newSessionPending, rememberSession],
  );

  const newSession = useCallback(() => {
    if (currentWorkspaceId) void startNewSession(currentWorkspaceId);
  }, [currentWorkspaceId, startNewSession]);

  // Usage pass U3 (§12): "New session in <name>" — a workspace row's hover action. Selecting the
  // workspace (an idempotent re-select for a known path) switches the current pointer, then a
  // fresh durable session opens in it. The creation names the workspace by stable id explicitly,
  // so the current pointer and the creation can never race.
  const newSessionIn = useCallback(
    async (ws: WorkspaceRow) => {
      try {
        await client.invoke("workspace.select", { path: ws.root, worldId: ws.executionWorldId ?? "local" } as never);
      } catch (error) {
        setNewSessionError(errorText(error));
        return;
      }
      await startNewSession(ws.id);
    },
    [client, startNewSession],
  );

  // Close the sidebar's floating menus on outside click / Escape (same pattern as SettingMenu).
  useEffect(() => {
    if (!viewOptionsOpen && !chooseWsOpen && wsMenuFor === undefined) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (viewOptionsOpen && viewOptionsRef.current && !viewOptionsRef.current.contains(target)) setViewOptionsOpen(false);
      if (chooseWsOpen && chooseWsRef.current && !chooseWsRef.current.contains(target)) setChooseWsOpen(false);
      if (wsMenuFor !== undefined && !(target instanceof Element && target.closest(".workspace-actions-menu, .workspace-actions-btn"))) setWsMenuFor(undefined);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setViewOptionsOpen(false);
        setChooseWsOpen(false);
        setWsMenuFor(undefined);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [viewOptionsOpen, chooseWsOpen, wsMenuFor]);

  const send = useCallback(
    async (message: string) => {
      // J-SESSION-draft / J-RUN-task-attribution: submit into the *session's own* workspace (its
      // durable row), never the asynchronously-updated global "current" pointer, so a workspace
      // switch can never land a turn in the wrong workspace.
      const sendWorkspaceId = currentSession?.workspaceId ?? currentWorkspaceId;
      if (!sendWorkspaceId) return;
      let sessionId = activeSessionId ?? "";
      // The task this turn serves: the active session's durable binding, or — on the session-
      // creating first send — the parked choice, bound durably below before the run freezes it.
      let runTaskId = activeTaskId;
      if (!sessionId) {
        // The hero composer's first send creates the conversation's durable identity first
        // (idempotent `session.create`), binds the parked task choice if any, and only then
        // starts the run — the same session.create the + button uses, so every conversation has
        // exactly one durable row and never a duplicate.
        const requestId = crypto.randomUUID();
        try {
          const created = (await client.invoke("session.create", { workspaceId: sendWorkspaceId, requestId } as never)) as { sessionId: string };
          sessionId = created.sessionId;
        } catch (e) {
          // The turn still runs (the run itself records the session row); the visible draft-
          // creation failure surfaces through the sidebar's error path on the next + click.
          console.error("session.create (first send) failed", e);
          sessionId = crypto.randomUUID();
        }
        setActiveSessionId(sessionId);
        rememberSession(sendWorkspaceId, sessionId);
        if (pendingTaskId) {
          const taskId = pendingTaskId;
          setPendingTaskId(undefined);
          setOptimisticBind({ sessionId, taskId });
          runTaskId = taskId;
          try {
            await client.invoke("session.task.bind", { sessionId, taskId } as never);
          } catch (e) {
            setOptimisticBind(undefined);
            console.error("session.task.bind (first send) failed", e);
          }
        }
      }
      // Usage pass U2: the access mode this run runs under — the per-session override, else the
      // pending hero-composer choice (consumed by the session-creating send), else the settings
      // default. `agent.coding` feeds it to `approvalGate`; the `sessions` projection folds it.
      const mode = accessModeOverrides[sessionId] ?? (activeSessionId ? undefined : pendingAccessMode) ?? settings.permission;
      const preset = activeSessionId ? (presetOverrides[sessionId] ?? settings.preset) : settings.preset;
      if (!activeSessionId) {
        if (pendingAccessMode !== undefined) {
          setAccessModeOverrides((prev) => ({ ...prev, [sessionId]: pendingAccessMode }));
          setPendingAccessMode(undefined);
        }
      }
      const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      // J-E-plan: a leading "/plan " prefix (composer literal-insertion, reference-behavior-
      // matrix.md §6.3) enters plan mode server-side (`agent.coding`'s `plan.mode.changed` event) —
      // mirror the reference's inline notice optimistically here so it appears with this turn
      // rather than waiting a round trip for the `plans` projection to catch up.
      const enteringPlan = /^\/plan\s+\S/i.test(message) && !planState?.on;
      setTranscript((prev) => [
        ...prev,
        ...(enteringPlan ? [{ role: "system" as const, content: "plan · Plan mode on. Use /plan off to leave." }] : []),
        { role: "user", content: message, at },
      ]);
      runStartedAtRef.current = Date.now();
      const view = await client.startRun(
        "agent.coding",
        { sessionId, workspaceId: sendWorkspaceId, message: messageWithFocus(message), mode, preset, ...(activeCaseId ? { caseId: activeCaseId } : {}), ...(runTaskId ? { taskId: runTaskId } : {}) } as unknown as Json,
        // The run's shared state is seeded with an empty steering list: "Steer now" appends to it.
        { idempotencyKey: crypto.randomUUID(), correlationId: `session:${sessionId}`, state: { steer: [] } as unknown as Json },
      );
      setActiveRunId(view.runId);
    },
    [client, currentWorkspaceId, currentSession, activeSessionId, activeTaskId, rememberSession, pendingTaskId, planState?.on, accessModeOverrides, pendingAccessMode, settings.permission, presetOverrides, settings.preset, activeCaseId, messageWithFocus],
  );

  const stop = useCallback(async () => {
    if (!activeRunId) return;
    await client.cancelRun(activeRunId, "user-cancelled");
  }, [client, activeRunId]);

  // "Plan mode on, press to turn off" (composer toggle) — equivalent to typing "/plan off" and
  // sending it: a new turn that `agent.coding` handles as a pure control command (no model call).
  const togglePlanMode = useCallback(() => {
    void send("/plan off");
  }, [send]);

  // Send behavior while busy (usage pass U2, §11): Queue parks the message until the active run
  // settles; Steer cancels the run and sends immediately (the interrupted turn renders as the
  // usual "Stopped" partial).
  const busySubmit = useCallback(
    (message: string, behavior: SendBehavior) => {
      if (behavior === "steer") {
        if (activeRunId && activeSessionId) {
          // Steer now (V-004): the message joins the ACTIVE trajectory at the agent's next step
          // boundary through the run's shared state. It does not cancel and restart the run.
          const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          setTranscript((prev) => [...prev, { role: "user", content: message, at }, { role: "system" as const, content: "steering · sent to the running agent; it applies at the next step." }]);
          void client.updateState(activeRunId, { patch: [{ op: "add", path: "/steer/-", value: { id: crypto.randomUUID(), text: messageWithFocus(message) } }] } as never, { idempotencyKey: crypto.randomUUID() });
        } else void send(message);
      } else {
        queuedRef.current = message;
        setQueuedMessage(message);
      }
    },
    [activeRunId, activeSessionId, client, send, messageWithFocus],
  );
  const cancelQueued = useCallback(() => {
    queuedRef.current = undefined;
    setQueuedMessage(undefined);
  }, []);

  // Dispatch a Queue-parked message once the run settles (status returns to idle after the settle
  // effect above has appended the finished turn and cleared activeRunId).
  useEffect(() => {
    if (streaming.status !== "idle") return;
    const queued = queuedRef.current;
    if (queued === undefined) return;
    queuedRef.current = undefined;
    setQueuedMessage(undefined);
    void send(queued);
  }, [streaming.status, send]);

  useEffect(() => {
    if (streaming.status === "completed" && streaming.text) {
      const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const tookMs = Date.now() - runStartedAtRef.current;
      // The last successful `edit` this turn made, if any (`10-file-change-collapsed`/`-expanded`).
      const lastEdit = [...toolEntries].reverse().find((e) => e.tool === "edit" && e.status === "success");
      const editSummary = lastEdit ? (lastEdit.result as EditSummary | undefined) : undefined;
      setTranscript((prev) => [...prev, { role: "assistant", content: streaming.text, at, tookMs, editSummary, stepCount: toolEntries.length + 1, steps: toolEntries }]);
      setActiveRunId(undefined);
    } else if (streaming.status === "cancelled") {
      // T11 (J-H-cancellation): the partial streamed text is kept, not discarded, with a "Stopped"
      // status pill and no duration badge (reference-behavior-matrix.md §7).
      const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setTranscript((prev) => [...prev, { role: "assistant", content: streaming.text, at, cancelled: true, stepCount: toolEntries.length + 1, steps: toolEntries }]);
      setActiveRunId(undefined);
    } else if (streaming.status === "failed") {
      // T11 (J-H-provider-error): "This turn failed" / message / CODE, plus the settled retry
      // disclosure (reference-behavior-matrix.md §8).
      const tookMs = Date.now() - runStartedAtRef.current;
      const retryCount = streaming.retries.length > 0 ? streaming.retries[streaming.retries.length - 1]!.attempt : undefined;
      setTranscript((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "",
          failed: true,
          tookMs,
          retryCount,
          failureCode: streaming.failure?.code,
          failureMessage: streaming.failure?.message,
          stepCount: toolEntries.length + 1,
          steps: toolEntries,
        },
      ]);
      setActiveRunId(undefined);
    }
  }, [streaming.status, streaming.text, streaming.retries, streaming.failure, toolEntries]);

  const modelLabel = modelConfig ? `${modelConfig.model}` : undefined;
  const sessionTitle = currentSession?.title || "New Session";
  const breadcrumbTitle = sessionTitle.length > 64 ? `${sessionTitle.slice(0, 63)}…` : sessionTitle;
  // 04/05 hero landing (see HeroLanding's doc comment above): a workspace is chosen but no turn has
  // ever started in the active session — no transcript, nothing streaming, no run in flight.
  const showHero =
    Boolean(currentWorkspaceId) && transcript.length === 0 && streaming.status === "idle" && !activeRunId;
  const sessionTurns = transcript.filter((m) => m.role === "assistant").length;
  const sessionSteps = transcript.reduce((sum, m) => sum + (m.stepCount ?? 0), 0);

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
        <div className="sidebar-top">
          <div className="brand">
            <LogoIcon />
            {!collapsed && (
              <span className="brand-text">
                Cognate
                <span className="brand-chip">Local Build</span>
              </span>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed((c) => !c)}>
            <CollapseIcon />
          </button>
        </div>

        <button
          type="button"
          className="new-session-btn"
          aria-label="New session"
          onClick={newSession}
          disabled={!currentWorkspaceId || newSessionPending}
          aria-busy={newSessionPending}
        >
          <PlusIcon />
          {!collapsed && (newSessionPending ? "Creating…" : "New Session")}
        </button>
        {newSessionError && (
          <p role="alert" className="new-session-error">
            {newSessionError}{" "}
            <button type="button" className="link-btn" onClick={newSession} disabled={!currentWorkspaceId || newSessionPending}>
              Try again
            </button>
          </p>
        )}

        {!collapsed && (
          <nav className="global-panels" aria-label="Global panels">
            <button
              type="button"
              className={expertsPanelOpen ? "global-panel-btn active" : "global-panel-btn"}
              aria-label="Experts and Teams"
              aria-pressed={expertsPanelOpen}
              onClick={() => {
                setExpertsPanelOpen((open) => !open);
                setPluginsPanelOpen(false);
                setWorkbenchOpen(false);
                if (window.matchMedia("(max-width: 1023px)").matches) setCollapsed(true);
              }}
            >
              Experts &amp; Teams
            </button>
            <button
              type="button"
              className={pluginsPanelOpen ? "global-panel-btn active" : "global-panel-btn"}
              aria-label="Plugins"
              aria-pressed={pluginsPanelOpen}
              onClick={() => {
                if (pluginsPanelOpen) closePluginsPanel();
                else { setPluginsPanelOpen(true); setExpertsPanelOpen(false); setWorkbenchOpen(false); }
              }}
            >
              <PluginIcon />
              Plugins
            </button>
            <button
              type="button"
              className={workbenchOpen ? "global-panel-btn active" : "global-panel-btn"}
              aria-label="Workbench"
              aria-pressed={workbenchOpen}
              disabled={!currentWorkspaceId}
              onClick={() => { setWorkbenchOpen((v) => !v); setExpertsPanelOpen(false); setPluginsPanelOpen(false); }}
            >
              <WorkbenchIcon />
              Workbench
            </button>
          </nav>
        )}

        {!collapsed && (
          <div className="workspaces-section">
            <div className="workspaces-header">
              <span>Workspaces</span>
              <div className="workspaces-header-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Search sessions"
                  aria-expanded={searchOpen}
                  title="Search sessions"
                  onClick={() => {
                    setSearchOpen((v) => !v);
                    if (searchOpen) setSessionSearch("");
                  }}
                >
                  <SearchIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="View options"
                  aria-haspopup="menu"
                  aria-expanded={viewOptionsOpen}
                  title="View options"
                  onClick={() => setViewOptionsOpen((v) => !v)}
                >
                  <SlidersIcon />
                </button>
                {viewOptionsOpen && (
                  <div role="menu" className="workspaces-view-options" ref={viewOptionsRef}>
                    <span className="view-options-group-label">Group by</span>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={groupBy === "workspace-sections"}
                      onClick={() => {
                        setGroupBy("workspace-sections");
                        setViewOptionsOpen(false);
                      }}
                    >
                      {GROUP_BY_LABELS["workspace-sections"]}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={groupBy === "workspace-tree"}
                      onClick={() => {
                        setGroupBy("workspace-tree");
                        setViewOptionsOpen(false);
                      }}
                    >
                      {GROUP_BY_LABELS["workspace-tree"]}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={groupBy === "in-one-list"}
                      onClick={() => {
                        setGroupBy("in-one-list");
                        setViewOptionsOpen(false);
                      }}
                    >
                      {GROUP_BY_LABELS["in-one-list"]}
                    </button>
                    <span className="view-options-group-label">Order by</span>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={orderBy === "manual"}
                      onClick={() => {
                        setOrderBy("manual");
                        setViewOptionsOpen(false);
                      }}
                    >
                      Manual
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={orderBy === "last-updated"}
                      onClick={() => {
                        setOrderBy("last-updated");
                        setViewOptionsOpen(false);
                      }}
                    >
                      Last updated
                    </button>
                    <span className="view-options-group-label">Filter sessions</span>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={archiveFilter === "hide-archived"}
                      onClick={() => {
                        setArchiveFilter("hide-archived");
                        setViewOptionsOpen(false);
                      }}
                    >
                      {ARCHIVE_FILTER_LABELS["hide-archived"]}
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={archiveFilter === "show-archived"}
                      onClick={() => {
                        setArchiveFilter("show-archived");
                        setViewOptionsOpen(false);
                      }}
                    >
                      {ARCHIVE_FILTER_LABELS["show-archived"]}
                    </button>
                  </div>
                )}
                <button type="button" className="icon-btn" aria-label="Add workspace" title="Add workspace" onClick={() => setAddWorkspaceOpen(true)}>
                  <PlusIcon />
                </button>
              </div>
            </div>
            {searchOpen && (
              <div className="workspaces-search-row" role="search" aria-label="Search sessions">
                <input
                  aria-label="Search session names"
                  placeholder="Search session names"
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.currentTarget.value)}
                  autoFocus
                />
                <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => setSessionSearch("")}>
                  ×
                </button>
              </div>
            )}
            <div role="tree" aria-label="Sessions" className="session-tree">
              {workspaces.length === 0 ? (
                <p className="empty-state small">No workspace selected</p>
              ) : (() => {
                const grouped = groupSessions({ workspaces, sessions, groupBy, orderBy, archiveFilter, search: sessionSearch });
                const hiddenCount = hiddenArchiveCount(sessions, archiveFilter);
                const renderRow = (session: SessionRow) => (
                  <SessionRowButton
                    key={session.id}
                    session={session}
                    active={session.id === activeSessionId}
                    planPending={planReviewPendingSessions.has(session.id)}
                    onOpen={() => openSession(session.id)}
                    onToggleArchive={() => {
                      const archived = session.archived !== true;
                      void client
                        .invoke("session.setArchived", { sessionId: session.id, archived } as never)
                        .catch((e) => console.error("session.setArchived failed", e));
                    }}
                  />
                );
                const notice =
                  hiddenCount > 0 ? (
                    <p className="empty-state small archive-hidden-notice">
                      {hiddenCount} archived conversation{hiddenCount === 1 ? "" : "s"} hidden.{" "}
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setArchiveFilter("show-archived")}
                      >
                        Show archived
                      </button>
                    </p>
                  ) : null;
                if (grouped.flat) {
                  const hasAnySession = sessions.length > 0;
                  return (
                    <>
                      {grouped.flat.length === 0 ? (
                        hasAnySession && hiddenCount > 0 ? (
                          notice
                        ) : (
                          <p className="empty-state small">No sessions yet</p>
                        )
                      ) : (
                        grouped.flat.map(renderRow)
                      )}
                      {grouped.flat.length > 0 && notice}
                    </>
                  );
                }
                const groups = grouped.groups ?? [];
                if (groups.length === 0 && hiddenCount > 0) return notice;
                return groups.map((group) => {
                  const collapsedWs = collapsedWorkspaces.has(group.workspaceId);
                  return (
                    <div key={group.workspaceId} role="treeitem" aria-expanded={!collapsedWs} className="workspace-row">
                      <span
                        className="workspace-row-label"
                        title={
                          group.executionWorldId && group.executionWorldId !== "local"
                            ? `${worlds.get(group.executionWorldId)?.label ?? group.executionWorldId}: ${group.root}`
                            : group.root
                        }
                      >
                        <FolderIcon aria-hidden="true" />
                        {group.title}
                        {group.executionWorldId ? (
                          <span className="workspace-world-badge">
                            {group.executionWorldId === "local"
                              ? "LOCAL · UNCONTAINED"
                              : worlds.get(group.executionWorldId)?.kind === "linux-bubblewrap"
                                ? `LINUX CHILD CONTAINMENT · ${worlds.get(group.executionWorldId)?.label ?? group.executionWorldId}`
                                : `${(worlds.get(group.executionWorldId)?.kind ?? "remote").toUpperCase()} · ${worlds.get(group.executionWorldId)?.label ?? group.executionWorldId}`}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="icon-btn workspace-new-session-btn"
                          aria-label={`New session in ${group.title}`}
                          title={`New session in ${group.title}`}
                          onClick={() =>
                            void newSessionIn({ id: group.workspaceId, title: group.title, root: group.root, ...(group.executionWorldId ? { executionWorldId: group.executionWorldId } : {}) })
                          }
                        >
                          <PlusIcon />
                        </button>
                        <button
                          type="button"
                          className="icon-btn workspace-actions-btn"
                          aria-label={`Workspace actions for ${group.title}`}
                          aria-haspopup="menu"
                          aria-expanded={wsMenuFor === group.workspaceId}
                          title={`Workspace actions for ${group.title}`}
                          onClick={() => setWsMenuFor(wsMenuFor === group.workspaceId ? undefined : group.workspaceId)}
                        >
                          <MoreIcon />
                        </button>
                        {wsMenuFor === group.workspaceId && (
                          <div role="menu" className="workspace-actions-menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setWsMenuFor(undefined);
                                setRenameFor({ id: group.workspaceId, title: group.title });
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setWsMenuFor(undefined);
                                void client.invoke("workspace.delete", { workspaceId: group.workspaceId } as never).catch((e) => console.error("workspace.delete failed", e));
                              }}
                            >
                              Delete workspace
                            </button>
                          </div>
                        )}
                      </span>
                      {!collapsedWs && (
                        <div className="session-rows">
                          {group.sessions.length === 0 ? (
                            <p className="empty-state small">No sessions yet</p>
                          ) : (
                            group.sessions.map(renderRow)
                          )}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        <div className="sidebar-bottom">
          <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setShowSettings(true)}>
            <GearIcon />
            {!collapsed && <span>Settings</span>}
          </button>
        </div>
      </aside>

      <main className="center-column">
        {expertsPanelOpen ? (
          <ExpertsTeamsPanel workspaceId={currentWorkspaceId} onClose={() => setExpertsPanelOpen(false)} onOpenNavigation={() => setCollapsed(false)} onOpenSettings={() => setShowSettings(true)} />
        ) : pluginsPanelOpen ? (
          <PluginsPanel
            detailId={detailPluginId}
            onClose={closePluginsPanel}
            onOpenDetail={openPluginDetail}
            onCloseDetail={closePluginDetail}
          />
        ) : workbenchOpen && currentWorkspaceId ? (
          <WorkbenchView
            workspaceId={currentWorkspaceId}
            workspaceLabel={workspaces.find((w) => w.id === currentWorkspaceId)?.title || currentWorkspaceId}
            {...(activeSessionId ? { sessionId: activeSessionId } : {})}
            {...(activeTaskId ? { activeTaskId } : {})}
            onWorkOnTask={(taskId) => {
              // J-TASK-scope: "Work on this task" is an explicit binding decision — durable when a
              // conversation is open, a parked choice when the Workbench was opened from the
              // session-less hero (consumed and made durable by the first send).
              void bindTask(taskId);
              setWorkbenchOpen(false);
            }}
            onTaskCreatedInSession={(taskId) => {
              void bindTask(taskId);
            }}
            onFocus={setFocusSelection}
            onClose={() => setWorkbenchOpen(false)}
          />
        ) : !currentWorkspaceId ? (
          <WorkspaceChooser />
        ) : showHero ? (
          <>
          <ComposerBar
            workspaceId={currentWorkspaceId}
            {...(activeSessionId ? { sessionId: activeSessionId } : {})}
            {...(activeTaskId ? { taskId: activeTaskId } : {})}
            onTaskChange={(taskId) => void bindTask(taskId ?? null)}
            bindError={taskBindError}
            onOpenWorkbench={() => setWorkbenchOpen(true)}
            state="idle"
            steps={0}
            elapsedSeconds={0}
            approvalsPending={0}
            {...(resolvedAttention.referent ? { referent: { ref: resolvedAttention.referent, level: resolvedAttention.level } } : {})}
            onClearFocus={() => setFocusSelection(undefined)}
          />
          <HeroLanding
            workspaceLabel={currentWorkspace?.title || currentWorkspace?.id || ""}
            modeLabel={AGENT_PRESET_LABELS[settings.preset]}
            composerDisabled={composerDisabled}
            modelLabel={modelLabel}
            onSend={send}
            accessMode={effectiveAccessMode}
            onAccessModeChange={changeAccessMode}
            sendBehavior={settings.sendBehavior}
            workspaces={workspaces}
            onSwitchWorkspace={(ws) => void newSessionIn(ws)}
            onAddWorkspace={() => setAddWorkspaceOpen(true)}
            composerFocusToken={composerFocusToken}
          />
          </>
        ) : (
          <>
            <header className="session-header">
              <nav aria-label="Session hierarchy" className="breadcrumb">
                {breadcrumbTitle}
              </nav>
              {subagentRows.length > 0 && (
                <div className="subagent-count-wrap">
                  <button
                    type="button"
                    className="subagent-count-btn"
                    aria-expanded={subagentsExpanded}
                    onClick={() => setSubagentsExpanded((v) => !v)}
                  >
                    {subagentRows.length} subagent{subagentRows.length === 1 ? "" : "s"}
                  </button>
                  {/* Anchored dropdown popover directly under the header badge (critic round-2
                   *  batch B P1) — the reference renders this as a small floating card at the
                   *  button's position, not a bottom banner above the composer. */}
                  {subagentsExpanded && (
                    <SubagentTree
                      rows={subagentRows}
                      onOpen={(row) => {
                        setOpenReview(undefined);
                        setOpenChildToolCallId(row.toolCallId);
                      }}
                    />
                  )}
                </div>
              )}
              {settings.codingTools && (
                <div role="tablist" aria-label="Session views" className="session-tabs">
                  <button type="button" role="tab" aria-selected={sessionTab === "chat"} onClick={() => setSessionTab("chat")}>
                    Chat
                  </button>
                  <button type="button" role="tab" aria-selected={sessionTab === "trajectory"} onClick={() => setSessionTab("trajectory")}>
                    Trajectory
                  </button>
                </div>
              )}
              <PresetMenu
                current={
                  currentSession?.mode === "ptc"
                    ? "ptc"
                    : currentSession?.mode === "minimal"
                      ? "minimal"
                      : currentSession?.mode === "standard"
                        ? "standard"
                        : undefined
                }
                fallback={settings.preset}
                onPick={(preset) => {
                  if (activeSessionId) setPresetOverrides((prev) => ({ ...prev, [activeSessionId]: preset }));
                }}
              />
            </header>
            {sessionTab === "trajectory" ? (
              <TrajectoryView trace={trace} onSelect={setTraceDetail} />
            ) : (
            <div
              className="messages"
              aria-live="polite"
              aria-atomic="false"
              aria-relevant="additions text"
              style={{ "--cg-content-font-size": `${settings.fontSize}px` } as React.CSSProperties}
            >
              {transcript.length === 0 && streaming.status === "idle" && <p className="empty-state">Start the conversation below.</p>}
              {transcript.map((message, index) => (
                <MessageBubble key={index} message={message} turnNumber={index + 1} onOpenReview={openReviewPanel} workDetails={workDetails} />
              ))}
              {streaming.status === "streaming" && (
                <>
                  <MessageBubble message={{ role: "assistant", content: streaming.text, streaming: true }} elapsedSeconds={elapsedSeconds} />
                  {streaming.retries.length > 0 && <RetryDisclosure retries={streaming.retries} elapsedSeconds={elapsedSeconds} />}
                  <ToolActivity entries={toolEntries} elapsedSeconds={elapsedSeconds} workDetails={workDetails} />
                </>
              )}
            </div>
            )}
            {(() => {
              const current = workspaces.find((w) => w.id === currentWorkspaceId);
              return current?.executionWorldId && current.executionWorldId !== "local" ? (
                <WorldBanner worldId={current.executionWorldId} label={worlds.get(current.executionWorldId)?.label ?? current.executionWorldId} />
              ) : null;
            })()}
            {planState && planState.todos.length > 0 && <TodoWidget todos={planState.todos} />}
            {currentWorkspaceId && (
              <ComposerBar
                workspaceId={currentWorkspaceId}
                {...(activeSessionId ? { sessionId: activeSessionId } : {})}
                {...(activeTaskId ? { taskId: activeTaskId } : {})}
                onTaskChange={(taskId) => void bindTask(taskId ?? null)}
                bindError={taskBindError}
                onOpenWorkbench={() => setWorkbenchOpen(true)}
                state={pendingApproval || planReviewContinuation || ambiguousContinuation ? "waiting" : streaming.status === "streaming" ? "running" : "idle"}
                steps={toolEntries.length + 1}
                elapsedSeconds={elapsedSeconds}
                approvalsPending={pendingApproval ? 1 : 0}
                {...(resolvedAttention.referent ? { referent: { ref: resolvedAttention.referent, level: resolvedAttention.level } } : {})}
                onClearFocus={() => setFocusSelection(undefined)}
              />
            )}
            {otherContinuation && (
              <p role="status" className="continuation-waiting">Waiting on {otherContinuation.type} ({otherContinuation.status.toLowerCase()})</p>
            )}
            {pendingApproval ? (
              <ApprovalBar entry={pendingApproval} onDecide={(approved) => decideApproval(pendingApproval.toolCallId, approved)} />
            ) : ambiguousContinuation ? (
              <AmbiguousStepCard
                capability={String((ambiguousContinuation.payload as { readonly capability?: string }).capability ?? "step")}
                busy={reconcileBusy}
                error={reconcileError}
                onReconcile={(outcome, reason) => void decideAmbiguous(outcome, reason)}
              />
            ) : planReviewContinuation ? (
              <PlanReviewCard
                heading={String((planReviewContinuation.payload as { readonly heading?: string }).heading ?? "")}
                markdown={String((planReviewContinuation.payload as { readonly markdown?: string }).markdown ?? "")}
                onDecide={decidePlanReview}
              />
            ) : (
              <Composer
                disabled={composerDisabled}
                sending={streaming.status === "streaming"}
                modelLabel={modelLabel}
                planMode={Boolean(planState?.on)}
                onSend={send}
                onStop={stop}
                onTogglePlanMode={togglePlanMode}
                turns={sessionTurns}
                steps={sessionSteps}
                accessMode={effectiveAccessMode}
                onAccessModeChange={changeAccessMode}
                sendBehavior={settings.sendBehavior}
                onBusySubmit={busySubmit}
                queued={queuedMessage}
                onCancelQueued={cancelQueued}
                focusToken={composerFocusToken}
              />
            )}
          </>
        )}
      </main>
      {openReview ? (
        <ReviewPanel
          initialTab={reviewTabKey(openReview.summary, openReview.turnNumber)}
          availableTabs={availableReviewTabs}
          workspaceRoot={currentWorkspace?.root}
          onClose={() => setOpenReview(undefined)}
        />
      ) : traceDetail ? (
        <TraceDetailsPanel trace={trace} detail={traceDetail} onClose={() => setTraceDetail(undefined)} />
      ) : (
        openChildRow ? <RightPanel row={openChildRow} onClose={() => setOpenChildToolCallId(undefined)} /> : <CognitiveFrame awaitingDecision={Boolean(pendingApproval)} />
      )}
      {showSettings && <SettingsModels onClose={() => setShowSettings(false)} settings={settings} onOpenShortcuts={() => setShortcutsOpen(true)} />}
      {shortcutsOpen && (
        <ShortcutsDialog
          overrides={settings.shortcuts}
          onChangeShortcuts={(shortcuts) => client.invoke("settings.changeShortcuts", { shortcuts } as never) as unknown as Promise<void>}
          onClose={() => setShortcutsOpen(false)}
        />
      )}
      {addWorkspaceOpen && <AddWorkspaceDialog onClose={() => setAddWorkspaceOpen(false)} />}
      {renameFor && <RenameWorkspaceDialog workspace={renameFor} onClose={() => setRenameFor(undefined)} />}
      <FirstRunDialogs />
    </div>
  );
}
