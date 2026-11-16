// The window title is the one sanctioned web→shell signal (design §1): the shell reads it
// for the attention cue and notification triggers only — never the close guard — and a
// title that does not parse is "unknown" by contract.
//
// The format is a versioned contract pinned by tests on BOTH sides (web:
// `test/ui-title-status.test.tsx`, shell: `src-tauri/src/title.rs`). The v1 grammar:
//
//     Cognate Workbench
//     Cognate Workbench — running
//     Cognate Workbench — waiting for you
//     Cognate Workbench — needs reconciliation
//     Cognate Workbench — 1 approval waiting
//     Cognate Workbench — N approvals waiting   (N ≥ 2)
//
// The title carries counts and states only — never session content, never secrets — and the
// human text follows the PRODUCT.md copy rules (sentence case, no claims beyond the state).
// Deliberate deviation from the drafted "sentinel prefix in the bytes": the titlebar is
// operator-visible, so the machine contract lives in the grammar + the format tests instead
// of visible sentinel bytes. Changing the wording is a two-sided, test-pinned version bump.

export const TITLE_BASE = "Cognate Workbench";

export type TitleState =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "waiting" }
  | { readonly kind: "reconciliation" }
  | { readonly kind: "approval"; readonly count: number };

/** Priority when markers could collide: the state that waits on the operator wins over
 *  activity. The caller passes one state; this is the documented precedence for composing
 *  from overlapping conditions. */
export function titlePrecedence(state: TitleState): number {
  switch (state.kind) {
    case "approval": return 4;
    case "reconciliation": return 3;
    case "waiting": return 2;
    case "running": return 1;
    case "idle": return 0;
  }
}

export function composeTitle(state: TitleState): string {
  switch (state.kind) {
    case "idle": return TITLE_BASE;
    case "running": return `${TITLE_BASE} — running`;
    case "waiting": return `${TITLE_BASE} — waiting for you`;
    case "reconciliation": return `${TITLE_BASE} — needs reconciliation`;
    case "approval":
      return state.count <= 1
        ? `${TITLE_BASE} — 1 approval waiting`
        : `${TITLE_BASE} — ${state.count} approvals waiting`;
  }
}

export type ParsedTitle =
  | { readonly ok: true; readonly state: TitleState }
  | { readonly ok: false };

/** Strict v1 parser: full match or nothing. Any other string — including an older or newer
 *  format — parses as unknown, and the shell treats unknown as "no cue". */
export function parseTitle(text: string): ParsedTitle {
  if (text === TITLE_BASE) return { ok: true, state: { kind: "idle" } };
  const prefix = `${TITLE_BASE} — `;
  if (!text.startsWith(prefix)) return { ok: false };
  const suffix = text.slice(prefix.length);
  switch (suffix) {
    case "running": return { ok: true, state: { kind: "running" } };
    case "waiting for you": return { ok: true, state: { kind: "waiting" } };
    case "needs reconciliation": return { ok: true, state: { kind: "reconciliation" } };
    case "1 approval waiting": return { ok: true, state: { kind: "approval", count: 1 } };
  }
  const multi = suffix.match(/^(\d+) approvals waiting$/);
  if (multi && Number(multi[1]) >= 2) return { ok: true, state: { kind: "approval", count: Number(multi[1]) } };
  return { ok: false };
}

/** Picks the operator-facing state when several conditions hold at once. */
export function highestTitleState(states: readonly TitleState[]): TitleState {
  let best: TitleState = { kind: "idle" };
  for (const state of states) if (titlePrecedence(state) > titlePrecedence(best)) best = state;
  return best;
}
