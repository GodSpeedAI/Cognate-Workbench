import { describe, it, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { AuthorityPlane } from "../src/ui/workbench/AuthorityPlane";
import { CapabilityList } from "../src/ui/workbench/CapabilityList";
import type { AuthorityRow } from "../src/workbench/authority";
import type { BlockedRecord } from "../src/workbench/state";
import type { CapabilityContractDef, ImplementationBinding, CapabilityState } from "../src/workbench/types";
import { CAPABILITY_LIFECYCLE } from "../src/workbench/types";

describe("AuthorityPlane", () => {
  it("renders authority groups correctly", () => {
    const rows: AuthorityRow[] = [
      { group: "Filesystem", label: "workspace read", grant: "yes" },
      { group: "Filesystem", label: "workspace write", grant: "approval" },
      { group: "Shell", label: "run commands", grant: "no" },
    ];
    const html = renderToStaticMarkup(
      React.createElement(AuthorityPlane, {
        rows,
        blocked: [],
        elevated: [],
        canElevate: true,
        onElevate: () => {},
      })
    );

    expect(html).toContain("Filesystem");
    expect(html).toContain("Shell");
    expect(html).toContain("workspace read");
    expect(html).toContain("workspace write");
  });

  it("renders grant chips with correct words", () => {
    const rows: AuthorityRow[] = [
      { group: "Test", label: "yes grant", grant: "yes" },
      { group: "Test", label: "approval grant", grant: "approval" },
      { group: "Test", label: "no grant", grant: "no" },
      { group: "Test", label: "immutable grant", grant: "immutable" },
    ];
    const html = renderToStaticMarkup(
      React.createElement(AuthorityPlane, {
        rows,
        blocked: [],
        elevated: [],
        canElevate: false,
        onElevate: () => {},
      })
    );

    // Check for chip text content
    expect(html).toContain(">yes<");
    expect(html).toContain("ask first");
    expect(html).toContain(">no<");
    expect(html).toContain("immutable");
  });

  it("shows protected empty state when no protected evidence", () => {
    const rows: AuthorityRow[] = [
      { group: "Filesystem", label: "workspace read", grant: "yes" },
    ];
    const html = renderToStaticMarkup(
      React.createElement(AuthorityPlane, {
        rows,
        blocked: [],
        elevated: [],
        canElevate: false,
        onElevate: () => {},
      })
    );

    expect(html).toContain("No protected evidence");
    expect(html).toContain("Mark source data and tests as protected");
  });

  it("renders blocked writes list", () => {
    const blocked: BlockedRecord[] = [
      {
        id: "1",
        workspaceId: "ws1",
        tool: "shell",
        path: "secrets.json",
        pattern: "*.json",
        reason: "Protected evidence blocked",
      },
    ];
    const html = renderToStaticMarkup(
      React.createElement(AuthorityPlane, {
        rows: [],
        blocked,
        elevated: [],
        canElevate: false,
        onElevate: () => {},
      })
    );

    expect(html).toContain("Blocked writes");
    expect(html).toContain("shell");
    expect(html).toContain("secrets.json");
    expect(html).toContain("pattern");
  });

  it("shows elevated paths list", () => {
    const html = renderToStaticMarkup(
      React.createElement(AuthorityPlane, {
        rows: [],
        blocked: [],
        elevated: ["src/important.ts", "test/fixture.json"],
        canElevate: true,
        onElevate: () => {},
      })
    );

    expect(html).toContain("Elevated paths");
    expect(html).toContain("src/important.ts");
    expect(html).toContain("test/fixture.json");
  });

  it("hides elevate form when !canElevate", () => {
    const html = renderToStaticMarkup(
      React.createElement(AuthorityPlane, {
        rows: [],
        blocked: [],
        elevated: [],
        canElevate: false,
        onElevate: () => {},
      })
    );

    expect(html).toContain("Only a person can elevate a path");
    expect(html).not.toContain("Elevate this path");
  });

  it("shows elevate form when canElevate", () => {
    const html = renderToStaticMarkup(
      React.createElement(AuthorityPlane, {
        rows: [],
        blocked: [],
        elevated: [],
        canElevate: true,
        onElevate: () => {},
      })
    );

    expect(html).toContain("Elevate this path");
    expect(html).toContain("Exact path");
  });
});

describe("CapabilityList", () => {
  it("shows empty state when no capabilities", () => {
    const html = renderToStaticMarkup(
      React.createElement(CapabilityList, {
        capabilities: [],
        conflicts: [],
        canGrant: true,
        onAdvance: () => {},
        onSeed: () => {},
      })
    );

    expect(html).toContain("The capability catalog is empty");
    expect(html).toContain("Load the starter catalog");
  });

  it("groups capabilities by category", () => {
    const cap1: CapabilityContractDef = {
      id: "capability.test1",
      category: "Understand",
      purpose: "Test capability 1",
      consumes: [],
      produces: [],
      authority: ["inspect"],
      conflicts: [],
      complements: [],
      acceptance: [],
      owns: [],
    };
    const cap2: CapabilityContractDef = {
      id: "capability.test2",
      category: "Actualize",
      purpose: "Test capability 2",
      consumes: [],
      produces: [],
      authority: ["inspect"],
      conflicts: [],
      complements: [],
      acceptance: [],
      owns: [],
    };
    const binding1: ImplementationBinding = {
      capabilityId: "capability.test1",
      implementationId: "impl.test1",
      provider: "test",
      executorKind: "deterministic",
      setup: {},
    };
    const binding2: ImplementationBinding = {
      capabilityId: "capability.test2",
      implementationId: "impl.test2",
      provider: "test",
      executorKind: "llm",
      setup: {},
    };

    const html = renderToStaticMarkup(
      React.createElement(CapabilityList, {
        capabilities: [
          {
            def: cap1,
            implementations: [{ binding: binding1, state: "SPECIFIED" }],
          },
          {
            def: cap2,
            implementations: [{ binding: binding2, state: "SPECIFIED" }],
          },
        ],
        conflicts: [],
        canGrant: true,
        onAdvance: () => {},
        onSeed: () => {},
      })
    );

    expect(html).toContain(">Understand<");
    expect(html).toContain(">Actualize<");
    expect(html).toContain("test1");
    expect(html).toContain("test2");
  });

  it("renders lifecycle stepper with aria-current on current step", () => {
    const cap: CapabilityContractDef = {
      id: "capability.test",
      category: "Test",
      purpose: "Test",
      consumes: [],
      produces: [],
      authority: ["inspect"],
      conflicts: [],
      complements: [],
      acceptance: [],
      owns: [],
    };
    const binding: ImplementationBinding = {
      capabilityId: "capability.test",
      implementationId: "impl.test",
      provider: "test",
      executorKind: "deterministic",
      setup: {},
    };

    const html = renderToStaticMarkup(
      React.createElement(CapabilityList, {
        capabilities: [
          {
            def: cap,
            implementations: [{ binding, state: "REVIEWED" }],
          },
        ],
        conflicts: [],
        canGrant: true,
        onAdvance: () => {},
        onSeed: () => {},
      })
    );

    // Check that aria-current="step" appears for REVIEWED state (3rd step, 0-indexed as 2)
    expect(html).toContain("aria-current");
    // Check that complete steps show checkmarks
    expect(html).toContain("✓");
  });

  it("renders advance button with correct text", () => {
    const cap: CapabilityContractDef = {
      id: "capability.test",
      category: "Test",
      purpose: "Test",
      consumes: [],
      produces: [],
      authority: ["inspect"],
      conflicts: [],
      complements: [],
      acceptance: [],
      owns: [],
    };
    const binding: ImplementationBinding = {
      capabilityId: "capability.test",
      implementationId: "impl.test",
      provider: "test",
      executorKind: "deterministic",
      setup: {},
    };

    const html = renderToStaticMarkup(
      React.createElement(CapabilityList, {
        capabilities: [
          {
            def: cap,
            implementations: [{ binding, state: "SPECIFIED" }],
          },
        ],
        conflicts: [],
        canGrant: true,
        onAdvance: () => {},
        onSeed: () => {},
      })
    );

    expect(html).toContain("Advance to");
    expect(html).toContain("implementation available");
  });

  it("disables advance button with reason when !canGrant and next is approval state", () => {
    const cap: CapabilityContractDef = {
      id: "capability.test",
      category: "Test",
      purpose: "Test",
      consumes: [],
      produces: [],
      authority: ["inspect"],
      conflicts: [],
      complements: [],
      acceptance: [],
      owns: [],
    };
    const binding: ImplementationBinding = {
      capabilityId: "capability.test",
      implementationId: "impl.test",
      provider: "test",
      executorKind: "deterministic",
      setup: {},
    };

    const html = renderToStaticMarkup(
      React.createElement(CapabilityList, {
        capabilities: [
          {
            def: cap,
            implementations: [{ binding, state: "IMPLEMENTATION_AVAILABLE" }],
          },
        ],
        conflicts: [],
        canGrant: false,
        onAdvance: () => {},
        onSeed: () => {},
      })
    );

    expect(html).toContain("Only a person can grant this step");
  });

  it("shows conflict banner when conflicts exist", () => {
    const cap: CapabilityContractDef = {
      id: "capability.test",
      category: "Test",
      purpose: "Test",
      consumes: [],
      produces: [],
      authority: ["inspect"],
      conflicts: [],
      complements: [],
      acceptance: [],
      owns: ["surface1"],
    };
    const binding: ImplementationBinding = {
      capabilityId: "capability.test",
      implementationId: "impl.test",
      provider: "test",
      executorKind: "deterministic",
      setup: {},
    };

    const conflicts = [
      {
        surface: "surface1",
        capabilities: ["capability.test", "capability.other"],
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(CapabilityList, {
        capabilities: [
          {
            def: cap,
            implementations: [{ binding, state: "SPECIFIED" }],
          },
        ],
        conflicts,
        canGrant: true,
        onAdvance: () => {},
        onSeed: () => {},
      })
    );

    expect(html).toContain("Overlapping decision surfaces");
    expect(html).toContain("surface1");
  });

  it("displays implementation kind as chip", () => {
    const cap: CapabilityContractDef = {
      id: "capability.test",
      category: "Test",
      purpose: "Test",
      consumes: [],
      produces: [],
      authority: ["inspect"],
      conflicts: [],
      complements: [],
      acceptance: [],
      owns: [],
    };
    const binding: ImplementationBinding = {
      capabilityId: "capability.test",
      implementationId: "impl.test",
      provider: "test",
      executorKind: "llm",
      setup: {},
    };

    const html = renderToStaticMarkup(
      React.createElement(CapabilityList, {
        capabilities: [
          {
            def: cap,
            implementations: [{ binding, state: "SPECIFIED" }],
          },
        ],
        conflicts: [],
        canGrant: true,
        onAdvance: () => {},
        onSeed: () => {},
      })
    );

    expect(html).toContain("llm");
  });
});
