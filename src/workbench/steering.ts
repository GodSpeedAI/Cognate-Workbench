// Steering inbox: two queues (steer now at the next step boundary, queue next for the next turn). The two-queue idea follows the deepseek-harness reference's agent inbox (nextStep/nextTurn; see donor-manifest.json); re-implemented, nothing copied.
import type { InboxMessage } from "./types.ts";

/** Agent inbox with two distinct queues: immediate steering and deferred turns. */
export interface Inbox {
  readonly nextTurn: readonly InboxMessage[];
  readonly nextStep: readonly InboxMessage[];
}

/** Create an empty inbox. */
export function emptyInbox(): Inbox {
  return {
    nextTurn: Object.freeze([]),
    nextStep: Object.freeze([]),
  };
}

/** Add a message to the inbox. Rejects blank text and duplicate ids (idempotent). */
export function enqueue(inbox: Inbox, msg: InboxMessage): Inbox {
  // Reject blank text
  if (msg.text.trim().length === 0) {
    throw new Error("Cannot enqueue message with blank text");
  }

  // Check for duplicate id in both queues
  const allIds = new Set<string>();
  for (const m of inbox.nextTurn) {
    allIds.add(m.id);
  }
  for (const m of inbox.nextStep) {
    allIds.add(m.id);
  }

  if (allIds.has(msg.id)) {
    // Idempotent: return the same inbox unchanged
    return inbox;
  }

  // Route by mode
  if (msg.mode === "steer-now") {
    const nextStep = Object.freeze([...inbox.nextStep, msg]);
    return {
      nextTurn: inbox.nextTurn,
      nextStep,
    };
  } else {
    // mode === "queue-next"
    const nextTurn = Object.freeze([...inbox.nextTurn, msg]);
    return {
      nextTurn,
      nextStep: inbox.nextStep,
    };
  }
}

/** Drain all steer-now messages (FIFO) for injection into the current trajectory. */
export function drainStep(inbox: Inbox): {
  readonly inject: readonly InboxMessage[];
  readonly inbox: Inbox;
} {
  return {
    inject: inbox.nextStep,
    inbox: {
      nextTurn: inbox.nextTurn,
      nextStep: Object.freeze([]),
    },
  };
}

/** Drain the first queued turn message (FIFO). */
export function drainTurn(inbox: Inbox): {
  readonly next: InboxMessage | undefined;
  readonly inbox: Inbox;
} {
  if (inbox.nextTurn.length === 0) {
    return {
      next: undefined,
      inbox,
    };
  }

  const [first, ...rest] = inbox.nextTurn;
  return {
    next: first,
    inbox: {
      nextTurn: Object.freeze(rest),
      nextStep: inbox.nextStep,
    },
  };
}

/** Rebuild inbox from durable events (enqueued / consumed). */
export function foldInbox(
  events: readonly { readonly type: "enqueued" | "consumed"; readonly message?: InboxMessage; readonly id?: string }[]
): Inbox {
  let result = emptyInbox();

  for (const event of events) {
    if (event.type === "enqueued" && event.message) {
      result = enqueue(result, event.message);
    } else if (event.type === "consumed" && event.id) {
      // Remove by id from both queues
      const nextTurn = Object.freeze(
        result.nextTurn.filter((m) => m.id !== event.id)
      );
      const nextStep = Object.freeze(
        result.nextStep.filter((m) => m.id !== event.id)
      );
      result = { nextTurn, nextStep };
    }
  }

  return result;
}

/** Count pending messages in both queues. */
export function pendingCount(inbox: Inbox): number {
  return inbox.nextTurn.length + inbox.nextStep.length;
}

/** Generate text for model injection reflecting the steering messages. */
export function steeringReflection(msgs: readonly InboxMessage[]): string {
  if (msgs.length === 0) {
    return "";
  }

  if (msgs.length === 1) {
    const msg = msgs[0]!;
    return `[user steering] ${msg.text}`;
  }

  // Multiple messages: each on its own line with prefix
  const lines = msgs.map((msg) => `[user steering] ${msg.text}`);
  return lines.join("\n");
}
