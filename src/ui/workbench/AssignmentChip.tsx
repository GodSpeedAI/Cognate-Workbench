// The composer's Assignment control (WP-23, J-CASE-ASSIGNMENT-handoff): where an approved case
// assignment is handed to this conversation, and what the operator can do about it afterwards.
// The session's binding is read from the public `session-assignment-bindings` projection (the
// event log is the truth); the approved Brief and Budget come from
// `session.caseAssignment.candidates`, the live lifecycle and spend from `assignment.view`. Every
// action goes through the operator-only capabilities, so a refusal reaches the person verbatim.
// Nothing here carries the assignment itself, and no action bypasses the capability layer. An
// interrupted step is reconciled in the conversation (the run waits for the operator), not here.
import { useEffect, useMemo, useRef, useState } from "react";
import { useCognate, useProjection } from "@godspeedai/cognate-react";
import type { Json } from "@godspeedai/cognate-events";
import { BranchIcon, ChevronDownIcon } from "../icons.tsx";
import { errorText } from "./data.ts";

interface BudgetEntry {
  readonly currency: string;
  readonly limit: number | "unknown";
  readonly unit: string;
}

interface AssignmentLike {
  readonly assignment_id: string;
  readonly case_id: string;
  readonly step_id: string;
  readonly n: number;
  readonly k: number;
  readonly brief: { readonly instruction: string };
  readonly budget: readonly BudgetEntry[];
}

interface Candidate {
  readonly id: string;
  readonly assignment: AssignmentLike;
}

interface Candidates {
  readonly available: boolean;
  readonly candidates: readonly Candidate[];
}

interface View {
  readonly status: string;
  readonly assignment: AssignmentLike;
  readonly spend: readonly { readonly currency: string; readonly spent: number | "unknown" }[];
  readonly linkExpiresAt?: string;
}

interface BindingRow {
  readonly sessionId: string;
  readonly assignmentId: string;
  readonly runId: string;
}

export interface AssignmentChipProps {
  readonly sessionId: string;
  /** The conversation's access mode and agent preset, given to the handed-off run as a sent message would be. */
  readonly mode: string;
  readonly preset: string;
  /** The conversation's run state: a hand-off waits for an idle conversation; a change refreshes the assignment. */
  readonly state: "idle" | "running" | "waiting";
  /** The conversation starts following the handed-off run; its message is the approved Brief's instruction. */
  readonly onHandedOff: (handed: { readonly sessionId: string; readonly runId: string; readonly instruction: string }) => void;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
/** The lifecycle requires a reason for an interruption; this control records where it came from. */
const INTERRUPT_REASON = "Interrupted by the operator from the Assignment control";

/** `case-0001 · item-03 · 1:1`: the assignment's case, step, and episode and delegation counters. */
export function assignmentLabel(assignment: Pick<AssignmentLike, "case_id" | "step_id" | "n" | "k">): string {
  return `${assignment.case_id} · ${assignment.step_id} · ${assignment.n}:${assignment.k}`;
}

const ceiling = (limit: number | "unknown"): string => (limit === "unknown" ? "unknown" : String(limit));
const budgetLine = (entry: BudgetEntry, spent: number | "unknown" | undefined): string =>
  `${entry.currency}: ${spent ?? 0} of ${ceiling(entry.limit)} ${entry.unit}`;

export function AssignmentChip({ sessionId, mode, preset, state, onHandedOff }: AssignmentChipProps) {
  const client = useCognate();
  const rows = useProjection("session-assignment-bindings");
  const binding = useMemo(
    () => (rows ?? []).map((row) => row.value as unknown as BindingRow).find((row) => row.sessionId === sessionId),
    [rows, sessionId],
  );
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidates>();
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // The approved assignments on offer, read each time the menu opens on an unbound conversation.
  useEffect(() => {
    if (!open || binding) return;
    let live = true;
    // A fresh read per open: an assignment withdrawn since the last open must not be offered.
    setCandidates(undefined);
    void client
      .invoke("session.caseAssignment.candidates", {})
      .then((value) => {
        if (live) setCandidates(value as unknown as Candidates);
      }, (reason: unknown) => {
        if (live) setError(errorText(reason));
      });
    return () => {
      live = false;
    };
  }, [client, open, binding]);

  // The bound assignment's live lifecycle and spend: when it binds, on every conversation run-state
  // change (a settled run completes the assignment), and after each control below.
  // The component is keyed by session (App), so its state never outlives a session; the cleanup flag also drops
  // a late response for a run this binding no longer names.
  const boundRunId = binding?.runId;
  const boundRunRef = useRef(boundRunId);
  boundRunRef.current = boundRunId;
  // It also re-reads whenever the binding row is re-served (the projection moves with the run's events).
  useEffect(() => {
    if (!boundRunId) return;
    let live = true;
    client.invoke("assignment.view", { runId: boundRunId }).then((value) => {
      if (live) setView(value as unknown as View);
    }, (reason: unknown) => {
      if (live) setError(errorText(reason));
    });
    return () => {
      live = false;
    };
  }, [client, binding, boundRunId, state]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(wrapRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  };

  /** One operator control over the bound assignment; the capability's refusal is shown, never swallowed. */
  const control = async (capability: string, input: Json) => {
    setBusy(true);
    setError(undefined);
    const runId = boundRunRef.current;
    try {
      const next = await client.invoke(capability, input) as unknown as View;
      if (boundRunRef.current === runId) setView(next);
    } catch (reason) {
      if (boundRunRef.current === runId) setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const handOff = async (candidate: Candidate) => {
    setBusy(true);
    setError(undefined);
    try {
      const handed = await client.invoke("session.caseAssignment.handoff", { sessionId, candidateId: candidate.id, mode, preset }) as unknown as { runId: string };
      setOpen(false);
      onHandedOff({ sessionId, runId: handed.runId, instruction: candidate.assignment.brief.instruction });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const live = view !== undefined && !TERMINAL.has(view.status);
  const label = binding ? (view ? `${assignmentLabel(view.assignment)} (${view.status})` : binding.assignmentId) : "None";
  return (
    <span className="ctx-menu-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        id="wb-assignment"
        className={`ctx-chip ctx-chip-button${binding ? " is-set" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Assignment: ${label}`}
        title={binding
          ? "The case assignment handed to this conversation. Interrupt, resume and report spend here — its own agent never can."
          : "No case assignment is handed to this conversation. Hand off an approved one to run its Brief under its budget."}
        onClick={() => setOpen((v) => !v)}
      >
        <BranchIcon aria-hidden="true" />
        <span className="ctx-chip-text">{label}</span>
        <ChevronDownIcon aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Assignment" aria-busy={!binding && candidates === undefined && !error} className="ctx-menu" onKeyDown={onMenuKey}>
          {binding ? (
            <>
              {view && (
                <>
                  <p className="ctx-menu-empty">{view.assignment.brief.instruction}</p>
                  {view.assignment.budget.map((entry) => (
                    <p key={entry.currency} className="ctx-menu-empty">{budgetLine(entry, view.spend.find((s) => s.currency === entry.currency)?.spent)}</p>
                  ))}
                </>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={busy || !live || view?.status === "interrupted"}
                onClick={() => void control("assignment.interrupt", { runId: binding.runId, reason: INTERRUPT_REASON, token: crypto.randomUUID() })}
              >
                <span className="ctx-menu-check" />
                <span>Interrupt</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy || view?.status !== "interrupted"}
                onClick={() => void control("assignment.resume", { runId: binding.runId, token: crypto.randomUUID() })}
              >
                <span className="ctx-menu-check" />
                <span>Resume</span>
              </button>
              {view?.assignment.budget.filter((entry) => entry.limit !== "unknown").map((entry) => (
                <button
                  key={entry.currency}
                  type="button"
                  role="menuitem"
                  disabled={busy || !live}
                  onClick={() => void control("assignment.spend", { runId: binding.runId, currency: entry.currency, amount: 1, token: crypto.randomUUID() })}
                >
                  <span className="ctx-menu-check" />
                  <span>Report 1 {entry.unit} of {entry.currency} spent</span>
                </button>
              ))}
            </>
          ) : (
            <>
              {candidates === undefined && !error && <p className="ctx-menu-empty" role="status">Loading case assignments…</p>}
              {candidates?.available === false && <p className="ctx-menu-empty">This host offers no case assignments to hand off.</p>}
              {candidates?.available && candidates.candidates.length === 0 && <p className="ctx-menu-empty">No case assignment is waiting to be handed off.</p>}
              {candidates?.candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="menuitem"
                  disabled={busy || state !== "idle"}
                  aria-label={`Hand off ${candidate.assignment.brief.instruction}`}
                  onClick={() => void handOff(candidate)}
                >
                  <span className="ctx-menu-check" />
                  <span>
                    {candidate.assignment.brief.instruction}
                    <span className="ctx-menu-sub"> {assignmentLabel(candidate.assignment)}</span>
                    <span className="ctx-menu-sub"> {candidate.assignment.budget.map((entry) => `${entry.currency} ${ceiling(entry.limit)} ${entry.unit}`).join(" · ")}</span>
                  </span>
                </button>
              ))}
            </>
          )}
          {error && (
            <p className="ctx-menu-empty" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </span>
  );
}
