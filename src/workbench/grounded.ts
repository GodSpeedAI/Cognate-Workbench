export interface GroundedFeedback {
  readonly target: {
    readonly selector: string;
    readonly file?: string;
    readonly component?: string;
  };
  readonly screenshotRef?: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly preserve: readonly string[];
  readonly change: string;
  readonly verify: readonly string[];
}

export function validateGroundedFeedback(
  fb: Partial<GroundedFeedback>
): string[] {
  const errors: string[] = [];

  // Check target.selector
  if (!fb.target?.selector || fb.target.selector.trim() === "") {
    errors.push("target selector required");
  }

  // Check viewport width/height
  if (fb.viewport) {
    if (
      typeof fb.viewport.width !== "number" ||
      !Number.isInteger(fb.viewport.width) ||
      fb.viewport.width <= 0
    ) {
      errors.push("viewport width must be a positive integer");
    }
    if (
      typeof fb.viewport.height !== "number" ||
      !Number.isInteger(fb.viewport.height) ||
      fb.viewport.height <= 0
    ) {
      errors.push("viewport height must be a positive integer");
    }
  }

  // Check preserve is non-empty
  if (!fb.preserve || fb.preserve.length === 0) {
    errors.push("preserve constraints required — a repair must be bounded");
  }

  // Check change is not blank
  if (!fb.change || fb.change.trim() === "") {
    errors.push("change cannot be blank");
  }

  // Check verify is non-empty
  if (!fb.verify || fb.verify.length === 0) {
    errors.push("verification target required");
  }

  return errors;
}

export function renderChangeContract(fb: GroundedFeedback): string {
  const lines: string[] = [];

  lines.push("Target");
  lines.push(fb.target.selector);
  lines.push("");

  lines.push("Preserve");
  for (const item of fb.preserve) {
    lines.push(item);
  }
  lines.push("");

  lines.push("Change");
  lines.push(fb.change);
  lines.push("");

  lines.push("Verify");
  lines.push(`${fb.viewport.width}px viewport`);
  for (const item of fb.verify) {
    lines.push(item);
  }

  return lines.join("\n");
}

export function bindsRepairScope(
  fb: GroundedFeedback,
  touchedFiles: readonly string[]
): { readonly bounded: boolean; readonly outOfScope: readonly string[] } {
  // If neither file nor component given, not bounded
  if (!fb.target.file && !fb.target.component) {
    return {
      bounded: false,
      outOfScope: Array.from(touchedFiles),
    };
  }

  const outOfScope: string[] = [];

  for (const file of touchedFiles) {
    let isInScope = false;

    // Check if file exactly matches target.file
    if (fb.target.file && file === fb.target.file) {
      isInScope = true;
    }

    // Check if file path contains component name (case-insensitive)
    if (fb.target.component) {
      if (file.toLowerCase().includes(fb.target.component.toLowerCase())) {
        isInScope = true;
      }
    }

    // Check if file is a sibling stylesheet named after target.file's basename
    if (fb.target.file) {
      const parts = fb.target.file.split("/");
      const baseName = parts[parts.length - 1];
      const dir = parts.slice(0, -1).join("/");

      if (baseName) {
        const baseNameWithoutExt = baseName.split(".")[0];
        // Check for sibling stylesheet in same directory with same base name
        const expectedCss = dir ? `${dir}/${baseNameWithoutExt}.css` : `${baseNameWithoutExt}.css`;
        const expectedModuleCss = dir ? `${dir}/${baseNameWithoutExt}.module.css` : `${baseNameWithoutExt}.module.css`;

        if (file === expectedCss || file === expectedModuleCss) {
          isInScope = true;
        }
      }
    }

    if (!isInScope) {
      outOfScope.push(file);
    }
  }

  const bounded = outOfScope.length === 0;

  return {
    bounded,
    outOfScope,
  };
}

export interface ScopedMetric {
  readonly label: string;
  readonly scope: string;
  readonly value: string;
}

export interface FocusView {
  readonly reference: ScopedMetric;
  readonly focus: ScopedMetric | undefined;
  readonly banner: string;
  readonly canReset: boolean;
}

export function describeFocus(
  reference: ScopedMetric,
  focus?: ScopedMetric
): FocusView {
  if (focus && focus.scope === reference.scope) {
    throw new Error(
      "a focus must narrow to a different scope"
    );
  }

  let banner: string;
  if (focus) {
    banner = `Showing ${focus.scope} · reference ${reference.scope}: ${reference.value}`;
  } else {
    banner = `Showing ${reference.scope}`;
  }

  return {
    reference,
    focus,
    banner,
    canReset: focus !== undefined,
  };
}
