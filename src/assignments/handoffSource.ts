// WP-23 (J-CASE-ASSIGNMENT-handoff): what a host offers for Hand off. The case keeper approves the
// Brief and Budget and delegates the case assignment under a link; the host offering it supplies
// the approved inputs. A capability resolves them from here on the server — a request only names a
// candidate and never carries the assignment: caller-supplied authority fails closed.
import type { Assignment, CaseContext } from "@godspeedai/cognate-runtime-api";

/** One approved case assignment awaiting delegation, with what a bound run needs. */
export interface HandoffCandidate {
  readonly id: string;
  readonly assignment: Assignment;
  /** The case context the bound run is opened with; its case and step equal the assignment's. */
  readonly caseContext: CaseContext;
  /** The delegation link's expiry when one governs the assignment: a later resume is refused after it. */
  readonly linkExpiresAt?: string;
}

export interface HandoffSource {
  /** The approved assignments currently awaiting delegation. */
  list(): Promise<readonly HandoffCandidate[]>;
  /** One candidate by id; `undefined` when the source no longer offers it. */
  get(id: string): Promise<HandoffCandidate | undefined>;
}

/** What the candidates read hands the UI: the approved Brief, Budget and ids, never the case context. */
export function handoffCandidateView(candidate: HandoffCandidate): { readonly id: string; readonly assignment: Assignment } {
  return { id: candidate.id, assignment: candidate.assignment };
}
