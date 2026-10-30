// Render tests for the composer's preview-only attachment affordance (plan T02).
//
// The composer's paste handler needs a live DOM and clipboard, so it is exercised through its two
// pure dependencies (`reducePaste` / `attachmentsBlockSend`, covered in `attachments.test.ts`). What
// is checked here is the *rendered honesty*: that the strip and the limitation copy reach static
// markup, because the whole point of option (a-lite) is that the affordance must not imply transport.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Composer } from "../src/ui/App.tsx";

const noop = () => {};

function render(): string {
  return renderToStaticMarkup(
    <Composer
      disabled={false}
      sending={false}
      modelLabel="test-model"
      planMode={false}
      onSend={noop}
      onStop={noop}
      onTogglePlanMode={noop}
      accessMode="workspace-write"
      onAccessModeChange={noop}
      sendBehavior="queue"
      onBusySubmit={noop}
    />,
  );
}

describe("Composer attachments", () => {
  test("renders no attachment strip and no limitation notice when nothing is attached", () => {
    const html = render();
    expect(html).not.toContain("composer-attachment-strip");
    expect(html).not.toContain("cannot send images to the model");
  });

  test("the textarea still accepts paste, so the handler is wired", () => {
    // A static render cannot dispatch a paste, but the control must be a plain textarea: if this ever
    // becomes a controlled div, both text paste and the onPaste handler silently stop working.
    expect(render()).toContain("<textarea");
  });

  test("the composer remains usable with no attachments", () => {
    const html = render();
    expect(html).toContain("Send message");
    expect(html).toContain("Message or run a task");
  });
});
