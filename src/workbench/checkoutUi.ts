// Pure presentation logic for the composer's Task-checkout control (J-CHECKOUT-LIFECYCLE). Kept
// out of the component so the wording and defaults can be asserted without a React provider; the
// component owns hooks and mutations, this module owns what a person reads and what the form
// proposes.
import type { WorktreeStatus } from "./gitOps.ts";

export interface BranchListLike {
  readonly default: string;
  readonly branches: readonly string[];
}

/** The default branch name proposed for a Task: its title as a Git-safe slug, the task id when
 *  the title has nothing usable. The capability adds the `workbench/` namespace. */
export function suggestBranchName(title: string, taskId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : taskId;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One line of live facts about a bound checkout, ordered by what needs action first. */
export function checkoutStatusText(status: WorktreeStatus): string {
  if (!status.exists) return "checkout folder missing — recreate it";
  const facts: string[] = [];
  if (status.changes > 0) facts.push(plural(status.changes, "uncommitted change"));
  if (status.pending > 0) facts.push(`${plural(status.pending, "commit")} to merge`);
  if (status.ahead > 0) facts.push(plural(status.ahead, "unpushed commit"));
  if (facts.length === 0) facts.push("clean");
  return facts.join(" · ");
}

/** Whether the merge action can do anything: the branch must exist on disk and hold at least one
 *  commit the target does not contain. A missing checkout is recreated first, never merged, and a
 *  branch with nothing pending never pretends a merge is meaningful. */
export function canMerge(status: WorktreeStatus | undefined): boolean {
  return status !== undefined && status.exists && status.pending > 0;
}

/** The merge outcome text. A conflict is not a success and not a crash: both checkouts are
 *  unchanged, and the person needs the file list to resolve it. */
export function mergeOutcomeText(result: {
  readonly conflicted?: boolean;
  readonly conflicts?: readonly string[];
  readonly target?: string;
  readonly commits?: number;
}): { readonly kind: "ok" | "warn"; readonly text: string } {
  if (result.conflicted) {
    const files = (result.conflicts ?? []).join(", ");
    return { kind: "warn", text: `Merge stopped — nothing changed. Resolve conflicts in ${files || "the branch"} and commit, then merge again.` };
  }
  return { kind: "ok", text: `Merged ${plural(result.commits ?? 0, "commit")} into ${result.target ?? "the target branch"}.` };
}
