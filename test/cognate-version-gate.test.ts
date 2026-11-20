// I0 version gate for the CognitiveOS convergence work (#109).
//
// Workbench consumes published @godspeedai/cognate-* packages, never monorepo
// source. This gate keeps the manifest, the lockfile-resolved install and the
// CaseContext contract on one version line, and it fails closed if the runtime
// that is actually installed cannot carry a case-anchored run.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { caseContextIssues } from "@godspeedai/cognate-runtime-api";

const root = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const cognateDeps = Object.entries(manifest.dependencies).filter(([name]) =>
  name.startsWith("@godspeedai/cognate-"),
);

function installedVersion(name: string): string {
  const pkg = JSON.parse(
    readFileSync(join(root, "node_modules", name, "package.json"), "utf8"),
  ) as { version: string };
  return pkg.version;
}

describe("Cognate version gate", () => {
  test("every Cognate dependency is pinned to one exact version", () => {
    expect(cognateDeps.length).toBeGreaterThan(0);
    const versions = new Set(cognateDeps.map(([, version]) => version));
    expect(versions.size).toBe(1);
    const [version] = [...versions];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("the installed tree matches the manifest pin", () => {
    for (const [name, pinned] of cognateDeps) {
      expect({ name, version: installedVersion(name) }).toEqual({ name, version: pinned });
    }
  });

  test("the installed runtime carries the CaseContext compatibility gate", () => {
    const pin = cognateDeps[0]?.[1] ?? "0.0.0";
    const [major = 0, minor = 0] = pin.split(".").map(Number);
    expect(major > 0 || minor >= 10).toBe(true);
    // The gate is executable, not a type-only claim: the installed package
    // exports the shape check the run boundary uses.
    expect(typeof caseContextIssues).toBe("function");
  });

  test("CaseContext validation accepts an evaluated context and refuses a missing episode", () => {
    const worldRef = `world:convergence@sha256:${"a".repeat(64)}`;
    expect(
      caseContextIssues({
        worldRef,
        semanticRef: "convergence::investigation",
        caseId: "case:1",
        planItemId: "item:1",
        role: "verifier",
        kind: "exploratory",
      }),
    ).toEqual([]);
    expect(
      caseContextIssues({
        worldRef,
        semanticRef: "convergence::investigation",
        caseId: "case:1",
        planItemId: "item:1",
        role: "verifier",
        kind: "evaluated",
      }),
    ).toContain("an evaluated run needs episodeRef");
  });
});
