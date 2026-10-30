// Queued follow-ups and steering status (plan T04).
//
// Two things live here, both deliberately free of React so they can be proven without a DOM:
//
// 1. The composer's parked-message queue. Today the composer holds a single `string`; this models a
//    FIFO of individually identifiable messages so several can be parked while a run streams and each
//    one can be cancelled or steered on its own.
// 2. The *honesty* rule for steering. The pre-T04 UI appended "it applies at the next step" at the
//    moment of sending — a claim nothing had confirmed. A steering message is only known to be applied
//    once a `workbench.steer.consumed` event arrives whose `ids` contains the id written into
//    `/steer`; matching is by id, never by "some steering happened", so one message's consumption can
//    never be credited to another.
//
// The donor (`.tmp/donor/pandacode/src/message-queue.ts`) models the queue itself but not the
// applied/pending distinction; that half is specific to this repo's durable event log.

/** A follow-up typed while an agent works, parked until the run settles. */
export interface QueuedMessage {
  readonly id: string;
  readonly text: string;
  readonly createdAt: number;
}

/** How a steering message stands, as far as the durable log actually confirms. */
export type SteerStatus = "pending" | "applied" | "not-applied" | "rejected";

/** One `updateState` write into a live run's `/steer`, tracked until the log settles it. */
export interface SteerAttempt {
  /** The id written into `/steer/-`; the only key a later `steer.consumed` can match. */
  readonly id: string;
  readonly text: string;
  readonly runId: string;
  readonly status: SteerStatus;
}

/** Append to the queue. Ids are unique, so a re-enqueue of the same id is a no-op rather than a duplicate row. */
export function enqueue(list: readonly QueuedMessage[], message: QueuedMessage): readonly QueuedMessage[] {
  if (list.some((m) => m.id === message.id)) return list;
  return [...list, message];
}

/** Remove one parked message by id. Unknown ids leave the queue untouched. */
export function remove(list: readonly QueuedMessage[], id: string): readonly QueuedMessage[] {
  return list.filter((m) => m.id !== id);
}

/** Take the oldest parked message (FIFO). */
export function shift(list: readonly QueuedMessage[]): { readonly next: QueuedMessage | undefined; readonly rest: readonly QueuedMessage[] } {
  const [next, ...rest] = list;
  if (next === undefined) return { next: undefined, rest: list };
  return { next, rest };
}

/**
 * Promote attempts to `applied` for the ids a `workbench.steer.consumed` event named.
 *
 * Anything not named keeps its current status — this is the whole point. A consumed event for one id
 * must not clear a sibling attempt, or the transcript would credit delivery to the wrong message.
 */
export function markConsumed(attempts: readonly SteerAttempt[], ids: readonly string[]): readonly SteerAttempt[] {
  if (ids.length === 0) return attempts;
  const consumed = new Set(ids);
  let changed = false;
  const next = attempts.map((a) => {
    if (a.status !== "pending" || !consumed.has(a.id)) return a;
    changed = true;
    return { ...a, status: "applied" as const };
  });
  return changed ? next : attempts;
}

/**
 * Settle attempts still pending when their run ends.
 *
 * Returns the updated attempts plus the text of every attempt that never got consumed, so the caller
 * can put it back in the composer rather than dropping what the person typed.
 */
export function settleRun(attempts: readonly SteerAttempt[], runId: string): {
  readonly attempts: readonly SteerAttempt[];
  readonly unapplied: readonly SteerAttempt[];
} {
  const unapplied: SteerAttempt[] = [];
  let changed = false;
  const next = attempts.map((a) => {
    if (a.runId !== runId || a.status !== "pending") return a;
    changed = true;
    unapplied.push(a);
    return { ...a, status: "not-applied" as const };
  });
  return { attempts: changed ? next : attempts, unapplied };
}

/**
 * The transcript line for a steering message.
 *
 * Only the `applied` case may claim the message was taken up. The `pending` wording states what is
 * true at that moment — the text reached the run and nothing has confirmed it yet — and every other
 * case says plainly that it did not apply.
 */
export function steerStatusLine(status: SteerStatus): string {
  switch (status) {
    case "pending":
      return "steering · sent to the running agent; waiting for it to be picked up.";
    case "applied":
      return "steering · applied at the next step.";
    case "not-applied":
      return "steering · not applied — the run ended first. The message is back in the composer.";
    case "rejected":
      return "steering · not sent — the agent did not accept it. The message is back in the composer.";
  }
}

/** The composer's queue summary. One message keeps the pre-T04 wording verbatim. */
export function queueNotice(count: number): string {
  if (count === 1) return "Queued — sends when the current run finishes";
  return `${count} messages queued — sent in order when the current run finishes`;
}
