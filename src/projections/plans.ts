// Public projection `plans`: one row per session, keyed `${tenant}/${sessionId}` (same keying
// convention as `sessions.ts`). Folds `plan.mode.changed`, `plan.todos.updated`,
// `plan.review.requested`, `plan.review.decided` — the app events `agent.coding` emits for journey
// `J-E-plan` (canonical-journey-catalog.md `j_e_plan`; `.sea/interaction/interaction-model.sea`'s
// `Entity "PlanMode"`). Read by `plan.state` (`src/capabilities/planState.ts`, for `agent.coding`'s
// own turn-start check) and by the UI (`useProjection("plans")`) for the To-dos widget, the plan
// review card, and the sidebar's "Plan awaiting review <title>" prefix.
import type { Json } from "@godspeedai/cognate-events";
import type { Projection } from "@godspeedai/cognate-projections";

export interface TodoItem {
  readonly content: string;
  readonly status: string;
}

export interface PlanReview {
  readonly status: "pending" | "approved" | "changes_requested";
  readonly toolCallId: string;
  readonly heading: string;
  readonly markdown: string;
}

export interface PlanState {
  readonly sessionId: string;
  readonly on: boolean;
  readonly todos: readonly TodoItem[];
  readonly review?: PlanReview;
}

function emptyState(sessionId: string): PlanState {
  return { sessionId, on: false, todos: [] };
}

export const plansProjection: Projection = {
  name: "plans",
  version: "1.0.0",
  apply(event, state) {
    if (event.eventType === "plan.mode.changed") {
      const payload = event.payload as { readonly sessionId: string; readonly on: boolean };
      const key = `${event.tenant}/${payload.sessionId}`;
      const existing = (state.get(key) as unknown as PlanState) ?? emptyState(payload.sessionId);
      // Keep the last review around after mode turns off (approved/changes_requested) so the
      // completed-session "Open plan: <title>" affordance (13c) can still reference it; only a
      // fresh `plan.review.requested` replaces it.
      const next: PlanState = { ...existing, on: payload.on };
      return [{ key, value: next as unknown as Json }];
    }
    if (event.eventType === "plan.todos.updated") {
      const payload = event.payload as unknown as { readonly sessionId: string; readonly todos: readonly TodoItem[] };
      const key = `${event.tenant}/${payload.sessionId}`;
      const existing = (state.get(key) as unknown as PlanState) ?? emptyState(payload.sessionId);
      const next: PlanState = { ...existing, todos: payload.todos };
      return [{ key, value: next as unknown as Json }];
    }
    if (event.eventType === "plan.review.requested") {
      const payload = event.payload as {
        readonly sessionId: string;
        readonly toolCallId: string;
        readonly heading: string;
        readonly markdown: string;
      };
      const key = `${event.tenant}/${payload.sessionId}`;
      const existing = (state.get(key) as unknown as PlanState) ?? emptyState(payload.sessionId);
      const next: PlanState = {
        ...existing,
        review: { status: "pending", toolCallId: payload.toolCallId, heading: payload.heading, markdown: payload.markdown },
      };
      return [{ key, value: next as unknown as Json }];
    }
    if (event.eventType === "plan.review.decided") {
      const payload = event.payload as { readonly sessionId: string; readonly toolCallId: string; readonly approved: boolean };
      const key = `${event.tenant}/${payload.sessionId}`;
      const existing = (state.get(key) as unknown as PlanState) ?? emptyState(payload.sessionId);
      if (!existing.review || existing.review.toolCallId !== payload.toolCallId) return [];
      const next: PlanState = {
        ...existing,
        review: { ...existing.review, status: payload.approved ? "approved" : "changes_requested" },
      };
      return [{ key, value: next as unknown as Json }];
    }
    return [];
  },
};
