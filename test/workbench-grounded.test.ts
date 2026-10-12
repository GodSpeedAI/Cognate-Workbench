import { describe, test, expect } from "bun:test";
import {
  validateGroundedFeedback,
  renderChangeContract,
  bindsRepairScope,
  describeFocus,
  type GroundedFeedback,
  type ScopedMetric,
} from "../src/workbench/grounded.ts";

describe("validateGroundedFeedback", () => {
  test("missing/blank target.selector", () => {
    const fb1 = {
      target: {},
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    } as unknown as Partial<GroundedFeedback>;

    const errors1 = validateGroundedFeedback(fb1);
    expect(errors1).toContain("target selector required");

    const fb2 = {
      target: { selector: "  " },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const errors2 = validateGroundedFeedback(fb2);
    expect(errors2).toContain("target selector required");
  });

  test("viewport width/height must be positive integers", () => {
    const fb1 = {
      target: { selector: ".hero" },
      viewport: { width: -1, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const errors1 = validateGroundedFeedback(fb1);
    expect(errors1.some((e) => e.includes("viewport width"))).toBe(true);

    const fb2 = {
      target: { selector: ".hero" },
      viewport: { width: 100, height: 0 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const errors2 = validateGroundedFeedback(fb2);
    expect(errors2.some((e) => e.includes("viewport height"))).toBe(true);

    const fb3 = {
      target: { selector: ".hero" },
      viewport: { width: 100.5, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const errors3 = validateGroundedFeedback(fb3);
    expect(errors3.some((e) => e.includes("viewport width"))).toBe(true);
  });

  test("preserve must be non-empty", () => {
    const fb1 = {
      target: { selector: ".hero" },
      viewport: { width: 100, height: 100 },
      preserve: [],
      change: "change",
      verify: ["v"],
    };

    const errors1 = validateGroundedFeedback(fb1);
    expect(errors1).toContain(
      "preserve constraints required — a repair must be bounded"
    );

    const fb2 = {
      target: { selector: ".hero" },
      viewport: { width: 100, height: 100 },
      preserve: undefined,
      change: "change",
      verify: ["v"],
    };

    const errors2 = validateGroundedFeedback(fb2);
    expect(errors2).toContain(
      "preserve constraints required — a repair must be bounded"
    );
  });

  test("blank change", () => {
    const fb1 = {
      target: { selector: ".hero" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "",
      verify: ["v"],
    };

    const errors1 = validateGroundedFeedback(fb1);
    expect(errors1).toContain("change cannot be blank");

    const fb2 = {
      target: { selector: ".hero" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "  ",
      verify: ["v"],
    };

    const errors2 = validateGroundedFeedback(fb2);
    expect(errors2).toContain("change cannot be blank");
  });

  test("verify must be non-empty", () => {
    const fb1 = {
      target: { selector: ".hero" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: [],
    };

    const errors1 = validateGroundedFeedback(fb1);
    expect(errors1).toContain("verification target required");

    const fb2 = {
      target: { selector: ".hero" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: undefined,
    };

    const errors2 = validateGroundedFeedback(fb2);
    expect(errors2).toContain("verification target required");
  });

  test("screenshotRef is optional", () => {
    const fbNoScreenshot = {
      target: { selector: ".hero" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const errors = validateGroundedFeedback(fbNoScreenshot);
    expect(errors).toHaveLength(0);
  });

  test("multiple errors returned", () => {
    const fb = {
      target: { selector: "" },
      viewport: { width: -1, height: -1 },
      preserve: [],
      change: "",
      verify: [],
    };

    const errors = validateGroundedFeedback(fb);
    expect(errors.length).toBeGreaterThan(1);
  });
});

describe("renderChangeContract", () => {
  test("exact layout with sections", () => {
    const fb: GroundedFeedback = {
      target: { selector: "#hero-title" },
      viewport: { width: 390, height: 844 },
      preserve: [
        "logo stays top-left",
        "nav links stay clickable",
        "footer contact info stays visible",
      ],
      change: "on phone width, place heading below mountain ridge",
      verify: ["CTA remains above fold"],
    };

    const contract = renderChangeContract(fb);

    expect(contract).toContain("Target\n#hero-title");
    expect(contract).toContain("Preserve");
    expect(contract).toContain("logo stays top-left");
    expect(contract).toContain("nav links stay clickable");
    expect(contract).toContain("footer contact info stays visible");
    expect(contract).toContain("Change\non phone width, place heading below mountain ridge");
    expect(contract).toContain("Verify");
    expect(contract).toContain("390px viewport");
    expect(contract).toContain("CTA remains above fold");
  });

  test("blank line between sections", () => {
    const fb: GroundedFeedback = {
      target: { selector: ".button" },
      viewport: { width: 800, height: 600 },
      preserve: ["clickable"],
      change: "add color",
      verify: ["visible"],
    };

    const contract = renderChangeContract(fb);
    const lines = contract.split("\n");

    const targetIdx = lines.findIndex((l) => l === "Target");
    const preserveIdx = lines.findIndex((l) => l === "Preserve");
    const changeIdx = lines.findIndex((l) => l === "Change");
    const verifyIdx = lines.findIndex((l) => l === "Verify");

    // There should be blank lines between sections
    expect(lines[targetIdx + 2]).toBe("");
    expect(lines[preserveIdx + 2]).toBe("");
    expect(lines[changeIdx + 2]).toBe("");
  });

  test("viewport as first line in Verify section", () => {
    const fb: GroundedFeedback = {
      target: { selector: ".hero" },
      viewport: { width: 1920, height: 1080 },
      preserve: ["a"],
      change: "change",
      verify: ["check1", "check2"],
    };

    const contract = renderChangeContract(fb);
    const lines = contract.split("\n");
    const verifyIdx = lines.findIndex((l) => l === "Verify");
    expect(lines[verifyIdx + 1]).toBe("1920px viewport");
    expect(lines[verifyIdx + 2]).toBe("check1");
    expect(lines[verifyIdx + 3]).toBe("check2");
  });
});

describe("bindsRepairScope", () => {
  test("bounded iff target.file or target.component given", () => {
    const fbNoFileNoComponent: GroundedFeedback = {
      target: { selector: ".hero" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const result1 = bindsRepairScope(fbNoFileNoComponent, [
      "file1.tsx",
      "file2.tsx",
    ]);
    expect(result1.bounded).toBe(false);
    expect(result1.outOfScope).toEqual(["file1.tsx", "file2.tsx"]);

    const fbWithFile: GroundedFeedback = {
      ...fbNoFileNoComponent,
      target: { ...fbNoFileNoComponent.target, file: "Hero.tsx" },
    };

    const result2 = bindsRepairScope(fbWithFile, ["Hero.tsx"]);
    expect(result2.bounded).toBe(true);
    expect(result2.outOfScope).toEqual([]);
  });

  test("file equals target.file exactly", () => {
    const fb: GroundedFeedback = {
      target: { selector: ".hero", file: "components/Hero.tsx" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const result = bindsRepairScope(fb, [
      "components/Hero.tsx",
      "components/other.ts",
    ]);
    expect(result.outOfScope).toEqual(["components/other.ts"]);

    const result2 = bindsRepairScope(fb, ["components/Hero.tsx"]);
    expect(result2.bounded).toBe(true);
  });

  test("path contains component name (case-insensitive)", () => {
    const fb: GroundedFeedback = {
      target: { selector: ".hero", component: "Hero" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const result = bindsRepairScope(fb, [
      "components/Hero.tsx",
      "utils/useHero.ts",
      "other.ts",
    ]);
    expect(result.bounded).toBe(false);
    expect(result.outOfScope).toEqual(["other.ts"]);

    const fbLowercase: GroundedFeedback = {
      target: { selector: ".hero", component: "hero" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const result2 = bindsRepairScope(fbLowercase, [
      "components/Hero.tsx",
      "utils/other.ts",
    ]);
    expect(result2.outOfScope).toEqual(["utils/other.ts"]);
  });

  test("sibling stylesheet named after target.file's basename", () => {
    const fb: GroundedFeedback = {
      target: { selector: ".hero", file: "components/Hero.tsx" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const result = bindsRepairScope(fb, [
      "components/Hero.tsx",
      "components/Hero.css",
      "components/Hero.module.css",
      "styles/other.css",
    ]);
    expect(result.bounded).toBe(false);
    expect(result.outOfScope).toEqual(["styles/other.css"]);
  });

  test("complex case: file + component with stylesheets", () => {
    const fb: GroundedFeedback = {
      target: { selector: ".button", file: "Button.tsx", component: "Button" },
      viewport: { width: 100, height: 100 },
      preserve: ["a"],
      change: "change",
      verify: ["v"],
    };

    const result = bindsRepairScope(fb, [
      "Button.tsx",
      "Button.css",
      "Button.module.css",
      "utils/useButton.ts",
      "other.ts",
    ]);
    expect(result.bounded).toBe(false);
    expect(result.outOfScope).toEqual(["other.ts"]);
  });
});

describe("describeFocus", () => {
  test("V-010: reference stays present", () => {
    const ref: ScopedMetric = { label: "Total Revenue", scope: "all", value: "$100k" };
    const focus: ScopedMetric = { label: "Product X", scope: "product", value: "$30k" };

    const view = describeFocus(ref, focus);
    expect(view.reference).toBe(ref);
  });

  test("banner with focus: 'Showing <focus.scope> · reference <reference.scope>: <reference.value>'", () => {
    const ref: ScopedMetric = { label: "Total", scope: "business", value: "$100k" };
    const focus: ScopedMetric = { label: "Product", scope: "product", value: "$30k" };

    const view = describeFocus(ref, focus);
    expect(view.banner).toBe("Showing product · reference business: $100k");
  });

  test("banner without focus: 'Showing <reference.scope>'", () => {
    const ref: ScopedMetric = { label: "Total", scope: "business", value: "$100k" };

    const view = describeFocus(ref);
    expect(view.banner).toBe("Showing business");
  });

  test("canReset = focus !== undefined", () => {
    const ref: ScopedMetric = { label: "Total", scope: "business", value: "$100k" };
    const focus: ScopedMetric = { label: "Product", scope: "product", value: "$30k" };

    const view1 = describeFocus(ref, focus);
    expect(view1.canReset).toBe(true);

    const view2 = describeFocus(ref);
    expect(view2.canReset).toBe(false);
  });

  test("throw Error if focus.scope === reference.scope", () => {
    const ref: ScopedMetric = { label: "Business", scope: "business", value: "$100k" };
    const focus: ScopedMetric = { label: "Business2", scope: "business", value: "$100k" };

    expect(() => describeFocus(ref, focus)).toThrow(
      Error
    );
    expect(() => describeFocus(ref, focus)).toThrow(
      "a focus must narrow to a different scope"
    );
  });

  test("focus must be defined when focus provided", () => {
    const ref: ScopedMetric = { label: "Total", scope: "business", value: "$100k" };
    const focus: ScopedMetric = { label: "Product", scope: "product", value: "$30k" };

    const view = describeFocus(ref, focus);
    expect(view.focus).toBe(focus);
  });

  test("focus is undefined when not provided", () => {
    const ref: ScopedMetric = { label: "Total", scope: "business", value: "$100k" };

    const view = describeFocus(ref);
    expect(view.focus).toBeUndefined();
  });
});
