// Pure review/diff view helpers (T11): the shapes and renderings behind the Review panel's tab
// strip, "Code view", "Download patch" and "Open patch in a new tab". No React, no client, no DOM —
// unit-tested in test/workbench-review-patch.test.ts.

/** The payload an `edit` tool call produced: one file, its counts, and its hunk lines. */
export interface EditSummary {
  readonly file_path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly diffLines: readonly string[];
}

/** A Review tab: one file change the panel is showing. Keyed by turn + path so the same edit is
 *  never opened twice. */
export interface ReviewTab {
  readonly key: string;
  readonly summary: EditSummary;
  readonly turnNumber: number;
}

export function reviewTabKey(summary: EditSummary, turnNumber: number): ReviewTab {
  return { key: `${turnNumber}:${summary.file_path}`, summary, turnNumber };
}

export type DiffRow = {
  readonly kind: "ctx" | "add" | "del";
  readonly oldNo?: number;
  readonly newNo?: number;
  readonly text: string;
};

/** Splits `EditSummary.diffLines` (context/`-`/`+` prefixed, no line numbers) into gutter'd rows for
 *  the Review panel — a single hunk covering the whole reconstructed file (this app's `diffLines`
 *  algorithm in `capabilities/tools.ts` always produces one contiguous change region bounded by
 *  context on both sides, so one `@@` header for the full old/new line counts is accurate, not an
 *  approximation). */
export function diffHunk(diffLines: readonly string[]): { readonly rows: readonly DiffRow[]; readonly header: string } {
  let oldNo = 1;
  let newNo = 1;
  const rows: DiffRow[] = [];
  for (const line of diffLines) {
    const text = line.slice(1);
    if (line.startsWith("+")) {
      rows.push({ kind: "add", newNo, text });
      newNo++;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", oldNo, text });
      oldNo++;
    } else {
      rows.push({ kind: "ctx", oldNo, newNo, text });
      oldNo++;
      newNo++;
    }
  }
  const oldCount = oldNo - 1;
  const newCount = newNo - 1;
  return { rows, header: `@@ -1,${oldCount} +1,${newCount} @@` };
}

/** Renders the change as an actual unified patch — what "Download patch" writes and "Open patch in
 *  a new tab" displays. */
export function renderUnifiedPatch(summary: EditSummary, header: string): string {
  const lines = [`--- a/${summary.file_path}`, `+++ b/${summary.file_path}`, header, ...summary.diffLines];
  return `${lines.join("\n")}\n`;
}

/** The file as it will read after this change: every row except deletions, with the new-file
 *  gutter. This is what the "Code view" toggle shows. */
export function renderFileAfterChange(diffLines: readonly string[]): readonly { readonly no: number; readonly text: string }[] {
  const out: { no: number; text: string }[] = [];
  let newNo = 1;
  for (const line of diffLines) {
    if (line.startsWith("-")) continue;
    out.push({ no: newNo, text: line.slice(1) });
    newNo++;
  }
  return out;
}
