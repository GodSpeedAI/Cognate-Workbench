// Journey J-WB-grounded-feedback (V-005, V-010): feedback is a native change contract (target,
// preserve, change, verify), a repair is bounded to its target, and a focused metric never silently
// changes semantic scope.
import { describe, expect, test } from "bun:test";
import { bindsRepairScope, describeFocus, renderChangeContract, type GroundedFeedback } from "../src/workbench/grounded.ts";
import type { FeedbackRecord } from "../src/workbench/state.ts";
import { bootApp, inv, waitForRow, withTempHome } from "./wb-helpers.ts";

const fb: GroundedFeedback = {
  target: { selector: "#hero-title", file: "src/Hero.tsx", component: "Hero" },
  screenshotRef: "shots/hero-390.png",
  viewport: { width: 390, height: 844 },
  preserve: ["desktop composition", "approved typography", "booking CTA hierarchy"],
  change: "on phone width, place heading below mountain ridge",
  verify: ["CTA remains above fold"],
};

describe("J-WB-grounded-feedback", () => {
  test("V-005: an unbounded correction is refused; a grounded one is recorded and bounds the repair", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(inv(client, "feedback.record", { feedback: { ...fb, preserve: [] } })).rejects.toThrow(/preserve constraints required/);
        await expect(inv(client, "feedback.record", { feedback: { ...fb, verify: [] } })).rejects.toThrow(/verification target required/);
        await expect(inv(client, "feedback.record", { feedback: { ...fb, target: { selector: " " } } })).rejects.toThrow(/target selector required/);

        const { feedbackId } = (await inv(client, "feedback.record", { feedback: fb })) as { feedbackId: string };
        const row = await waitForRow<FeedbackRecord>(app, `feedback/${feedbackId}`);
        expect(row.feedback.viewport).toEqual({ width: 390, height: 844 });

        // The change contract is the native form, not prompt prose.
        expect(renderChangeContract(row.feedback)).toBe(
          ["Target", "#hero-title", "", "Preserve", "desktop composition", "approved typography", "booking CTA hierarchy", "", "Change", "on phone width, place heading below mountain ridge", "", "Verify", "390px viewport", "CTA remains above fold"].join("\n"),
        );
        // The repair stays inside the target; a file outside it is flagged.
        expect(bindsRepairScope(row.feedback, ["src/Hero.tsx", "src/Hero.module.css"])).toEqual({ bounded: true, outOfScope: [] });
        expect(bindsRepairScope(row.feedback, ["src/Hero.tsx", "src/tokens.css"])).toEqual({ bounded: false, outOfScope: ["src/tokens.css"] });
      } finally {
        await app.stop();
      }
    });
  }, 60_000);

  test("V-010: focusing a metric keeps its reference scope visible and offers a reset", () => {
    const whole = { label: "Net revenue", scope: "whole business", value: "$128,400" };
    const product = { label: "Net revenue", scope: "Product A", value: "$12,900" };
    const focused = describeFocus(whole, product);
    expect(focused.banner).toBe("Showing Product A · reference whole business: $128,400");
    expect(focused.reference).toEqual(whole);
    expect(focused.canReset).toBe(true);
    expect(describeFocus(whole).banner).toBe("Showing whole business");
    expect(describeFocus(whole).canReset).toBe(false);
    expect(() => describeFocus(whole, { ...product, scope: "whole business" })).toThrow();
  });
});
