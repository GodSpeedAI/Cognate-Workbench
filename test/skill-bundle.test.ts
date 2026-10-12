import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const skills = [
  ".agents/skills/building-with-cognate/SKILL.md",
  ".agents/skills/deriving-interaction-domain-models/SKILL.md",
  ".agents/skills/domainforge-sea/SKILL.md",
] as const;

test("all Cognate development skills and their entrypoints remain present", () => {
  for (const skill of skills) {
    expect(existsSync(skill)).toBe(true);
    expect(readFileSync(skill, "utf8").length).toBeGreaterThan(200);
  }
  expect(existsSync(".sea/interaction/interaction-model.sea")).toBe(true);
  expect(existsSync("domain/index.ts")).toBe(true);
});

test("all relative Markdown links inside the bundled skills resolve locally", () => {
  const root = ".agents/skills";
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of new Bun.Glob("**/*.md").scanSync({ cwd: dir })) files.push(resolve(dir, entry));
  };
  walk(root);
  const missing: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1]?.trim()?.split("#")[0]?.split(/\s/)[0];
      if (!target || target.startsWith("#") || /^[a-z]+:/i.test(target)) continue;
      if (!existsSync(resolve(dirname(file), decodeURIComponent(target)))) missing.push(`${file}: ${target}`);
    }
  }
  expect(missing).toEqual([]);
});

test("Workbench consumes versioned published Cognate packages, not workspace aliases", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
  const libs = Object.entries(pkg.dependencies).filter(([name]) => name.startsWith("@godspeedai/cognate-"));
  expect(libs.length).toBeGreaterThan(10);
  for (const [name, range] of libs) {
    expect(range.startsWith("workspace:")).toBe(false);
    expect(range.startsWith("file:")).toBe(false);
    expect(range.startsWith("link:")).toBe(false);
    expect(range).toMatch(/^\d+\.\d+\.\d+$/);
  }
});
