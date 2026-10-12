import { describe, it, expect } from "bun:test";
import {
  emptyInbox,
  enqueue,
  drainStep,
  drainTurn,
  foldInbox,
  pendingCount,
  steeringReflection,
  type Inbox,
} from "../src/workbench/steering.ts";
import type { InboxMessage } from "../src/workbench/types.ts";

describe("steering", () => {
  describe("emptyInbox", () => {
    it("returns an inbox with empty queues", () => {
      const inbox = emptyInbox();
      expect(inbox.nextTurn.length).toBe(0);
      expect(inbox.nextStep.length).toBe(0);
    });

    it("produces frozen arrays", () => {
      const inbox = emptyInbox();
      expect(Object.isFrozen(inbox.nextTurn)).toBe(true);
      expect(Object.isFrozen(inbox.nextStep)).toBe(true);
    });
  });

  describe("enqueue", () => {
    it("adds steer-now message to nextStep", () => {
      const inbox = emptyInbox();
      const msg: InboxMessage = {
        id: "msg-1",
        mode: "steer-now",
        text: "Change the approach",
      };

      const updated = enqueue(inbox, msg);
      expect(updated.nextStep.length).toBe(1);
      expect(updated.nextStep[0]).toBe(msg);
      expect(updated.nextTurn.length).toBe(0);
    });

    it("adds queue-next message to nextTurn", () => {
      const inbox = emptyInbox();
      const msg: InboxMessage = {
        id: "msg-1",
        mode: "queue-next",
        text: "Process this next",
      };

      const updated = enqueue(inbox, msg);
      expect(updated.nextTurn.length).toBe(1);
      expect(updated.nextTurn[0]).toBe(msg);
      expect(updated.nextStep.length).toBe(0);
    });

    it("rejects blank text with error", () => {
      const inbox = emptyInbox();
      const msg: InboxMessage = {
        id: "msg-1",
        mode: "queue-next",
        text: "   ",
      };

      expect(() => enqueue(inbox, msg)).toThrow("blank text");
    });

    it("rejects empty string with error", () => {
      const inbox = emptyInbox();
      const msg: InboxMessage = {
        id: "msg-1",
        mode: "steer-now",
        text: "",
      };

      expect(() => enqueue(inbox, msg)).toThrow("blank text");
    });

    it("treats duplicate id as no-op (idempotent)", () => {
      let inbox = emptyInbox();
      const msg: InboxMessage = {
        id: "unique-id",
        mode: "steer-now",
        text: "Important message",
      };

      inbox = enqueue(inbox, msg);
      expect(inbox.nextStep.length).toBe(1);

      // Try to add the same id again
      const sameId = enqueue(inbox, msg);
      expect(sameId).toBe(inbox); // Returns the exact same inbox object
      expect(sameId.nextStep.length).toBe(1); // No duplicate added
    });

    it("detects duplicate id in nextTurn queue", () => {
      let inbox = emptyInbox();
      const msg1: InboxMessage = {
        id: "dup-id",
        mode: "queue-next",
        text: "First message",
      };

      inbox = enqueue(inbox, msg1);

      const msg2: InboxMessage = {
        id: "dup-id",
        mode: "queue-next",
        text: "Different text",
      };

      const result = enqueue(inbox, msg2);
      expect(result).toBe(inbox); // No-op
      expect(inbox.nextTurn.length).toBe(1);
    });

    it("detects duplicate id across different queues", () => {
      let inbox = emptyInbox();
      const msg1: InboxMessage = {
        id: "cross-dup",
        mode: "steer-now",
        text: "In step queue",
      };

      inbox = enqueue(inbox, msg1);

      const msg2: InboxMessage = {
        id: "cross-dup",
        mode: "queue-next",
        text: "In turn queue",
      };

      const result = enqueue(inbox, msg2);
      expect(result).toBe(inbox); // No-op even though modes differ
    });

    it("preserves existing messages when enqueuing new one", () => {
      let inbox = emptyInbox();

      const msg1: InboxMessage = {
        id: "msg-1",
        mode: "steer-now",
        text: "First",
      };
      const msg2: InboxMessage = {
        id: "msg-2",
        mode: "steer-now",
        text: "Second",
      };

      inbox = enqueue(inbox, msg1);
      inbox = enqueue(inbox, msg2);

      expect(inbox.nextStep.length).toBe(2);
      expect(inbox.nextStep[0]).toBe(msg1);
      expect(inbox.nextStep[1]).toBe(msg2);
    });

    it("produces frozen arrays after enqueue", () => {
      const inbox = emptyInbox();
      const msg: InboxMessage = {
        id: "msg-1",
        mode: "queue-next",
        text: "Test",
      };

      const updated = enqueue(inbox, msg);
      expect(Object.isFrozen(updated.nextTurn)).toBe(true);
      expect(Object.isFrozen(updated.nextStep)).toBe(true);
    });
  });

  describe("drainStep", () => {
    it("returns all steer-now messages (FIFO)", () => {
      let inbox = emptyInbox();

      const msg1: InboxMessage = {
        id: "step-1",
        mode: "steer-now",
        text: "First steer",
      };
      const msg2: InboxMessage = {
        id: "step-2",
        mode: "steer-now",
        text: "Second steer",
      };

      inbox = enqueue(inbox, msg1);
      inbox = enqueue(inbox, msg2);

      const result = drainStep(inbox);
      expect(result.inject.length).toBe(2);
      expect(result.inject[0]).toBe(msg1);
      expect(result.inject[1]).toBe(msg2);
    });

    it("clears nextStep after draining", () => {
      let inbox = emptyInbox();
      const msg: InboxMessage = {
        id: "step-1",
        mode: "steer-now",
        text: "Steer",
      };

      inbox = enqueue(inbox, msg);
      const result = drainStep(inbox);

      expect(result.inbox.nextStep.length).toBe(0);
    });

    it("preserves nextTurn when draining nextStep (V-004)", () => {
      let inbox = emptyInbox();

      const steerMsg: InboxMessage = {
        id: "steer-1",
        mode: "steer-now",
        text: "Steering change",
      };
      const turnMsg: InboxMessage = {
        id: "turn-1",
        mode: "queue-next",
        text: "Queued turn",
      };

      inbox = enqueue(inbox, steerMsg);
      inbox = enqueue(inbox, turnMsg);

      const result = drainStep(inbox);
      expect(result.inbox.nextTurn.length).toBe(1);
      expect(result.inbox.nextTurn[0]).toBe(turnMsg);
    });

    it("returns empty inject for empty nextStep", () => {
      const inbox = emptyInbox();
      const result = drainStep(inbox);

      expect(result.inject.length).toBe(0);
      expect(result.inbox.nextStep.length).toBe(0);
    });
  });

  describe("drainTurn", () => {
    it("returns first queued message (FIFO)", () => {
      let inbox = emptyInbox();

      const msg1: InboxMessage = {
        id: "turn-1",
        mode: "queue-next",
        text: "First turn",
      };
      const msg2: InboxMessage = {
        id: "turn-2",
        mode: "queue-next",
        text: "Second turn",
      };

      inbox = enqueue(inbox, msg1);
      inbox = enqueue(inbox, msg2);

      const result = drainTurn(inbox);
      expect(result.next).toBe(msg1);
    });

    it("pops only the first message", () => {
      let inbox = emptyInbox();

      const msg1: InboxMessage = {
        id: "turn-1",
        mode: "queue-next",
        text: "First",
      };
      const msg2: InboxMessage = {
        id: "turn-2",
        mode: "queue-next",
        text: "Second",
      };

      inbox = enqueue(inbox, msg1);
      inbox = enqueue(inbox, msg2);

      const result = drainTurn(inbox);
      expect(result.inbox.nextTurn.length).toBe(1);
      expect(result.inbox.nextTurn[0]).toBe(msg2);
    });

    it("returns undefined when nextTurn is empty", () => {
      const inbox = emptyInbox();
      const result = drainTurn(inbox);

      expect(result.next).toBeUndefined();
      expect(result.inbox).toBe(inbox); // Returns same inbox
    });

    it("preserves nextStep when draining nextTurn", () => {
      let inbox = emptyInbox();

      const steerMsg: InboxMessage = {
        id: "steer-1",
        mode: "steer-now",
        text: "Steer",
      };
      const turnMsg: InboxMessage = {
        id: "turn-1",
        mode: "queue-next",
        text: "Turn",
      };

      inbox = enqueue(inbox, steerMsg);
      inbox = enqueue(inbox, turnMsg);

      const result = drainTurn(inbox);
      expect(result.inbox.nextStep.length).toBe(1);
      expect(result.inbox.nextStep[0]).toBe(steerMsg);
    });
  });

  describe("foldInbox", () => {
    it("rebuilds inbox from enqueued events", () => {
      const events = [
        {
          type: "enqueued" as const,
          message: {
            id: "msg-1",
            mode: "queue-next" as const,
            text: "First",
          },
        },
        {
          type: "enqueued" as const,
          message: {
            id: "msg-2",
            mode: "steer-now" as const,
            text: "Second",
          },
        },
      ];

      const inbox = foldInbox(events);
      expect(inbox.nextTurn.length).toBe(1);
      expect(inbox.nextStep.length).toBe(1);
    });

    it("removes messages by id using consumed events", () => {
      const events = [
        {
          type: "enqueued" as const,
          message: {
            id: "msg-1",
            mode: "queue-next" as const,
            text: "Message",
          },
        },
        {
          type: "consumed" as const,
          id: "msg-1",
        },
      ];

      const inbox = foldInbox(events);
      expect(inbox.nextTurn.length).toBe(0);
    });

    it("removes from correct queue by id", () => {
      const events = [
        {
          type: "enqueued" as const,
          message: {
            id: "step-msg",
            mode: "steer-now" as const,
            text: "Steer",
          },
        },
        {
          type: "consumed" as const,
          id: "step-msg",
        },
      ];

      const inbox = foldInbox(events);
      expect(inbox.nextStep.length).toBe(0);
    });

    it("handles empty event list", () => {
      const inbox = foldInbox([]);
      expect(inbox.nextTurn.length).toBe(0);
      expect(inbox.nextStep.length).toBe(0);
    });
  });

  describe("pendingCount", () => {
    it("counts messages in both queues", () => {
      let inbox = emptyInbox();

      const msg1: InboxMessage = {
        id: "msg-1",
        mode: "steer-now",
        text: "Steer",
      };
      const msg2: InboxMessage = {
        id: "msg-2",
        mode: "queue-next",
        text: "Turn",
      };

      inbox = enqueue(inbox, msg1);
      inbox = enqueue(inbox, msg2);

      expect(pendingCount(inbox)).toBe(2);
    });

    it("returns 0 for empty inbox", () => {
      const inbox = emptyInbox();
      expect(pendingCount(inbox)).toBe(0);
    });

    it("counts only nextTurn when nextStep is empty", () => {
      let inbox = emptyInbox();
      const msg: InboxMessage = {
        id: "msg-1",
        mode: "queue-next",
        text: "Turn",
      };

      inbox = enqueue(inbox, msg);
      expect(pendingCount(inbox)).toBe(1);
    });

    it("counts only nextStep when nextTurn is empty", () => {
      let inbox = emptyInbox();
      const msg: InboxMessage = {
        id: "msg-1",
        mode: "steer-now",
        text: "Steer",
      };

      inbox = enqueue(inbox, msg);
      expect(pendingCount(inbox)).toBe(1);
    });
  });

  describe("steeringReflection", () => {
    it("generates prefix text for single message", () => {
      const msgs: InboxMessage[] = [
        {
          id: "msg-1",
          mode: "steer-now",
          text: "Focus on performance",
        },
      ];

      const reflection = steeringReflection(msgs);
      expect(reflection).toBe("[user steering] Focus on performance");
    });

    it("generates multi-line text for multiple messages", () => {
      const msgs: InboxMessage[] = [
        {
          id: "msg-1",
          mode: "steer-now",
          text: "First instruction",
        },
        {
          id: "msg-2",
          mode: "steer-now",
          text: "Second instruction",
        },
      ];

      const reflection = steeringReflection(msgs);
      const lines = reflection.split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("[user steering] First instruction");
      expect(lines[1]).toBe("[user steering] Second instruction");
    });

    it("returns empty string for empty message list", () => {
      const reflection = steeringReflection([]);
      expect(reflection).toBe("");
    });

    it("preserves message text exactly", () => {
      const msgs: InboxMessage[] = [
        {
          id: "msg-1",
          mode: "queue-next",
          text: "Use reactive patterns to improve responsiveness",
        },
      ];

      const reflection = steeringReflection(msgs);
      expect(reflection).toContain(
        "Use reactive patterns to improve responsiveness"
      );
    });
  });

  describe("V-004: steering changes active trajectory", () => {
    it("steer-now during run yields at next boundary via drainStep", () => {
      let inbox = emptyInbox();

      // During a run: enqueue a steer-now message
      const steerMsg: InboxMessage = {
        id: "steer-during-run",
        mode: "steer-now",
        text: "Change direction mid-run",
      };
      inbox = enqueue(inbox, steerMsg);

      // At next step boundary: drain
      const { inject, inbox: afterDrain } = drainStep(inbox);

      // The steer message was injected exactly once
      expect(inject.length).toBe(1);
      expect(inject[0]).toBe(steerMsg);

      // And cleared from the inbox
      expect(afterDrain.nextStep.length).toBe(0);
    });

    it("steer-now does not affect nextTurn queue", () => {
      let inbox = emptyInbox();

      const turnMsg: InboxMessage = {
        id: "turn-1",
        mode: "queue-next",
        text: "Queued for next turn",
      };
      const steerMsg: InboxMessage = {
        id: "steer-1",
        mode: "steer-now",
        text: "Steer now",
      };

      inbox = enqueue(inbox, turnMsg);
      inbox = enqueue(inbox, steerMsg);

      const { inbox: afterDrain } = drainStep(inbox);

      // nextTurn is untouched
      expect(afterDrain.nextTurn.length).toBe(1);
      expect(afterDrain.nextTurn[0]).toBe(turnMsg);
    });
  });
});
