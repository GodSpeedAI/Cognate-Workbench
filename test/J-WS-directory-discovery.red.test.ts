// RED CONTRACT — J-WS-directory-discovery.
// A workspace picker should suggest *directories in the chosen execution world* as the
// operator types. Completion is read-only; selecting a folder is a separate governed action.
// No hidden project-index daemon, no client-side host-filesystem access and no local fallback.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { bootApp, inv, withTempHome } from "./wb-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";

type DirectorySuggestion = { readonly name: string; readonly path: string; readonly kind: "directory" };
type DirectorySuggestionResult = { readonly suggestions: readonly DirectorySuggestion[]; readonly worldId: string };

describe("J-WS-directory-discovery — type-ahead workspace picker (RED)", () => {
  test("a partial absolute path lists matching existing folders, not files, without creating a workspace", async () => {
    await withTempHome(async home => {
      const browseRoot = await mkdtemp(join(tmpdir(), "cognate-picker-"));
      const { app, client } = await bootApp(home);
      try {
        await Promise.all([
          mkdir(join(browseRoot, "projects")),
          mkdir(join(browseRoot, "prototypes")),
          mkdir(join(browseRoot, "archives")),
          writeFile(join(browseRoot, "profile.json"), "{}"),
        ]);
        const result = (await inv(client, "workspace.directory.suggest", {
          worldId: "local", typedPath: join(browseRoot, "pro"), limit: 20,
        })) as DirectorySuggestionResult;
        expect(result.worldId).toBe("local");
        const names = result.suggestions.map(s => s.name);
        expect(names).toContain("projects");
        expect(names).toContain("prototypes");
        expect(names).not.toContain("archives");
        expect(names).not.toContain("profile.json");
        expect(result.suggestions.every(s => s.kind === "directory" && s.path.startsWith(browseRoot))).toBe(true);
        const rows = (await app.runtime.service.readProjection(
          LOCAL_OPERATOR,
          { name: "workspaces" },
        )).rows;
        expect(rows.filter(r => r.key.startsWith("record/"))).toHaveLength(0);
      } finally {
        await client.close();
        await app.stop();
        await rm(browseRoot, { recursive: true, force: true });
      }
    });
  }, 45_000);

  test("unknown execution world fails closed instead of suggesting local directories", async () => {
    await withTempHome(async home => {
      const { app, client } = await bootApp(home);
      try {
        await expect(inv(client, "workspace.directory.suggest", {
          worldId: "not-a-connected-world", typedPath: "/home/", limit: 10,
        })).rejects.toThrow(/world|unavailable|not found|unknown/i);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  }, 30_000);

  test("results have a bounded maximum, no file content or secret material, and deterministic directory-only ordering", async () => {
    await withTempHome(async home => {
      const browseRoot = await mkdtemp(join(tmpdir(), "cognate-picker-page-"));
      const { app, client } = await bootApp(home);
      try {
        await Promise.all(Array.from({ length: 25 }, (_, i) => mkdir(join(browseRoot, `proj-${String(i).padStart(2,"0")}`))));
        const result = (await inv(client, "workspace.directory.suggest", {
          worldId: "local", typedPath: join(browseRoot, "proj"), limit: 5,
        })) as DirectorySuggestionResult;
        expect(result.suggestions).toHaveLength(5);
        expect(result.suggestions.map(s => s.name)).toEqual(
          [...result.suggestions.map(s => s.name)].sort((a,b) => a.localeCompare(b)),
        );
        expect(JSON.stringify(result)).not.toContain("content");
      } finally {
        await client.close();
        await app.stop();
        await rm(browseRoot, { recursive: true, force: true });
      }
    });
  }, 45_000);
});
