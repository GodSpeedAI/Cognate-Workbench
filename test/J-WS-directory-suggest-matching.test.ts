// J-WS-directory-discovery: tiered matching, home-relative input, symlinks and the protected-home notice.
import { mkdtemp, mkdir, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { bootApp, inv, withTempHome } from "./wb-helpers.ts";
import { matchFragment } from "../src/capabilities/workspaceDirectorySuggest.ts";

type Result = {
  suggestions: { name: string; path: string; kind: string; display: string }[];
  worldId: string; resolvedParent: string; truncated: boolean; notice?: string;
};

async function withTree(run: (ctx: { userHome: string; suggest: (typed: string, limit?: number) => Promise<Result> }) => Promise<void>) {
  await withTempHome(async home => {
    const userHome = await realpath(await mkdtemp(join(tmpdir(), "cognate-suggest-home-")));
    const previous = process.env.HOME;
    process.env.HOME = userHome;
    const { app, client } = await bootApp(home);
    try {
      for (const d of ["projects", "projects/cognate-workbench", "projects/CamelCaseApp", "projects/my_proj_x", "projects/archive", "projects/.hidden", "Prototypes", "other/deep"]) {
        await mkdir(join(userHome, d), { recursive: true });
      }
      await writeFile(join(userHome, "projects", "profile.json"), "{}");
      await symlink(join(userHome, "other", "deep"), join(userHome, "projects", "linked-deep"));
      await symlink(join(userHome, "nope"), join(userHome, "projects", "broken-link"));
      await symlink(join(userHome, "projects", "profile.json"), join(userHome, "projects", "file-link"));
      await run({ userHome, suggest: (typedPath, limit) => inv(client, "workspace.directory.suggest", { worldId: "local", typedPath, ...(limit ? { limit } : {}) }) as unknown as Promise<Result> });
    } finally {
      process.env.HOME = previous;
      await client.close();
      await app.stop();
      await rm(userHome, { recursive: true, force: true });
    }
  });
}

describe("matchFragment tiers", () => {
  test("prefix < word boundary < substring < fuzzy; case-insensitive; no match", () => {
    expect(matchFragment("Projects", "pro")?.tier).toBe(0);
    expect(matchFragment("my_proj_x", "proj")?.tier).toBe(1);
    expect(matchFragment("CamelCaseApp", "case")?.tier).toBe(1);
    expect(matchFragment("xxprojxx", "proj")?.tier).toBe(2);
    expect(matchFragment("cognate-workbench", "cgw")?.tier).toBe(3);
    expect(matchFragment("cognate-workbench", "zzz")).toBeUndefined();
  });
});

describe("workspace.directory.suggest — matching and input forms", () => {
  test("~/ prefix expansion, tier ordering, case-insensitivity, display and dot-dir hiding", async () => {
    await withTree(async ({ userHome, suggest }) => {
      const r = await suggest("~/projects/pr");
      expect(r.resolvedParent).toBe(join(userHome, "projects"));
      expect(r.suggestions.map(s => s.name)).toEqual(["my_proj_x"]);
      const caps = await suggest("~/PRO");
      expect(caps.suggestions.map(s => s.name)).toEqual(["projects", "Prototypes"]);
      expect(caps.suggestions[0]!.display).toBe("~/projects");
      expect(caps.suggestions[0]!.path).toBe(join(userHome, "projects"));
      const all = await suggest("~/projects/");
      const names = all.suggestions.map(s => s.name);
      expect(names).not.toContain(".hidden");
      expect(names).not.toContain("profile.json");
      expect((await suggest("~/projects/.")).suggestions.map(s => s.name)).toEqual([".hidden"]);
    });
  }, 60_000);

  test("fuzzy, word-boundary and substring tiers sort in order; bare fragment resolves against home", async () => {
    await withTree(async ({ suggest }) => {
      expect((await suggest("projects/cgw")).suggestions.map(s => s.name)).toEqual(["cognate-workbench"]);
      expect((await suggest("~/projects/case")).suggestions.map(s => s.name)).toEqual(["CamelCaseApp"]);
      const bare = await suggest("proj");
      expect(bare.suggestions.map(s => s.name)).toEqual(["projects"]);
      const empty = await suggest("");
      expect(empty.suggestions.map(s => s.name)).toEqual(["other", "projects", "Prototypes"].sort((a, b) => a.localeCompare(b)));
    });
  }, 60_000);

  test("symlinks to directories are included, broken links and links to files are not; duplicate separators and .. collapse", async () => {
    await withTree(async ({ userHome, suggest }) => {
      const r = await suggest(`${userHome}//projects/./../projects/`);
      const names = r.suggestions.map(s => s.name);
      expect(names).toContain("linked-deep");
      expect(names).not.toContain("broken-link");
      expect(names).not.toContain("file-link");
      expect(r.resolvedParent).toBe(join(userHome, "projects"));
      const limited = await suggest("~/projects/", 2);
      expect(limited.suggestions).toHaveLength(2);
      expect(limited.truncated).toBe(true);
    });
  }, 60_000);

  test("a missing folder is an empty result with a notice, not an error", async () => {
    await withTree(async ({ suggest }) => {
      const r = await suggest("~/nowhere/x");
      expect(r.suggestions).toEqual([]);
      expect(r.notice).toMatch(/does not exist/);
    });
  }, 60_000);
});

describe("workspace.directory.suggest — protected application home", () => {
  test("listing inside the Workbench's own home returns an empty result with a notice", async () => {
    await withTempHome(async home => {
      const { app, client } = await bootApp(home);
      try {
        const r = (await inv(client, "workspace.directory.suggest", { worldId: "local", typedPath: `${home}/`, limit: 10 })) as unknown as Result;
        expect(r.suggestions).toEqual([]);
        expect(r.notice).toMatch(/protected/);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  }, 30_000);
});
