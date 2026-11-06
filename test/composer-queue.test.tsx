// T04: the composer's queued-message list.
//
// Static markup only — this repo has no DOM-testing dependency (see evidence/T02). What markup can
// prove is the structure the behaviours depend on: every parked message is its own numbered row, each
// has its own remove control, and order is visible. The FIFO dispatch itself is proven in
// `test/steer-queue.test.ts`.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../src/ui/App.tsx";
import { queueNotice, type QueuedMessage } from "../src/steerQueue.ts";

const noop = () => {};

function queued(...texts: readonly string[]): readonly QueuedMessage[] {
  return texts.map((text, i) => ({ id: `q${i + 1}`, text, createdAt: i }));
}

function render(messages: readonly QueuedMessage[], onSteerQueued?: (m: QueuedMessage) => void): string {
  return renderToStaticMarkup(
    <Composer
      disabled={false}
      sending
      modelLabel="gpt-x"
      planMode={false}
      onSend={noop}
      onStop={noop}
      onTogglePlanMode={noop}
      accessMode="workspace-write"
      onAccessModeChange={noop}
      sendBehavior="queue"
      onBusySubmit={noop}
      queued={messages}
      onCancelQueued={noop}
      onSteerQueued={onSteerQueued}
    />,
  );
}

describe("Composer queue", () => {
  test("no queue, no panel — the idle composer is unchanged", () => {
    const html = render([]);
    expect(html).not.toContain("composer-queue-list");
  });

  test("TEETH: two parked messages render as two individually removable rows, in order", () => {
    const html = render(queued("first thing", "second thing"));
    expect(html).toContain('role="list"');
    expect(html).toContain('aria-label="Queued messages"');
    // Both texts are present...
    expect(html).toContain("first thing");
    expect(html).toContain("second thing");
    // ...and each is its own row with its own numbered remove control, so cancelling one cannot
    // ambiguously target the other.
    expect(html).toContain('aria-label="Remove queued message 1"');
    expect(html).toContain('aria-label="Remove queued message 2"');
    // Order is visible, because order is the promise.
    expect(html.indexOf("first thing")).toBeLessThan(html.indexOf("second thing"));
  });

  test("the summary uses the multi-message wording, not the single-message one", () => {
    const two = render(queued("a", "b"));
    expect(two).toContain(queueNotice(2));
    expect(two).not.toContain(queueNotice(1));
    // The single case keeps the pre-T04 sentence exactly.
    expect(render(queued("a"))).toContain("Queued — sends when the current run finishes");
  });

  test("Steer appears only when the composer is given a steer handler", () => {
    expect(render(queued("a"), noop)).toContain('aria-label="Steer queued message 1 into the running turn"');
    // Without a live run there is nothing to steer into, so the control must not be offered.
    expect(render(queued("a"))).not.toContain("Steer queued message");
  });

  test("a multi-line message previews its first line but keeps the whole text in the title", () => {
    const html = render(queued("first line\nsecond line"));
    // React writes the newline through literally (no `&#x0A;` entity), so the title keeps the full text.
    expect(html).toContain('title="first line\nsecond line"');
    // The row itself shows only the first line...
    expect(html).toContain(">first line</span>");
    expect(html).not.toContain(">first line\nsecond line</span>");
    // ...and the newline must not split it into two rows.
    expect(html.match(/composer-queue-row/g)?.length).toBe(1);
  });

  test("rows are keyed by id, so an identical duplicate still renders twice", () => {
    // Two messages with the same text are two distinct queue entries; collapsing them would lose one.
    const html = render([
      { id: "q1", text: "same", createdAt: 0 },
      { id: "q2", text: "same", createdAt: 1 },
    ]);
    expect(html.match(/composer-queue-row/g)?.length).toBe(2);
    expect(html).toContain('aria-label="Remove queued message 2"');
  });
});
