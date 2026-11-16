// Journey J-WS-files-browse: read-only workspace file listing and reading for the inspector.
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { bootApp, inv, withTempHome } from "./wb-helpers.ts";
import { SYSTEM } from "./wb-helpers.ts";

interface Entry { name: string; path: string; kind: string; size?: number }
interface ListResult { workspaceId: string; root: string; path: string; entries: Entry[]; truncated: boolean }
interface ReadResult { workspaceId: string; path: string; size: number; text?: string; binary: boolean; truncated: boolean; language?: string }

async function withWorkspace(fn: (ctx: { client: Awaited<ReturnType<typeof bootApp>>["client"]; app: Awaited<ReturnType<typeof bootApp>>["app"]; workspaceId: string; dir: string; home: string }) => Promise<void>) {
  await withTempHome(async (home) => {
    const { app, client } = await bootApp(home);
    try {
      // Outside the app home: a workspace inside the protected home is (rightly) not browseable.
      const base = await mkdtemp(join(tmpdir(), "cognate-files-"));
      const dir = join(base, "ws-files");
      await mkdir(join(dir, "src", "deep"), { recursive: true });
      await mkdir(join(dir, ".git"), { recursive: true });
      await mkdir(join(dir, "Zeta"), { recursive: true });
      await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
      await writeFile(join(dir, ".env.example"), "A=1\n");
      await writeFile(join(dir, "README.md"), "# hello\n");
      await writeFile(join(dir, "banana.txt"), "b");
      await writeFile(join(dir, "Apple.txt"), "a");
      await writeFile(join(dir, "src", "main.ts"), "export const x = 1;\n");
      await writeFile(join(dir, "src", "deep", "n.py"), "print(1)\n");
      await writeFile(join(dir, "blob.bin"), Buffer.from([1, 2, 0, 3, 4]));
      await writeFile(join(dir, "big.txt"), "x".repeat(600 * 1024));
      const outside = join(base, "outside");
      await mkdir(outside);
      await writeFile(join(outside, "secret.txt"), "top secret");
      await symlink(outside, join(dir, "escape-dir"));
      await symlink(join(outside, "secret.txt"), join(dir, "escape-file"));
      const { workspaceId } = (await inv(client, "workspace.select", { path: dir })) as { workspaceId: string };
      await app.runtime.idle();
      try {
        await fn({ client, app, workspaceId, dir, home });
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    } finally {
      await client.close();
      await app.stop();
    }
  });
}

describe("J-WS-files-browse", () => {
  test("lists the root: directories first, case-insensitive, .git hidden, dotfiles kept, symlinks flagged", async () => {
    await withWorkspace(async ({ client, workspaceId, dir }) => {
      const r = (await inv(client, "workspace.files.list", { workspaceId })) as unknown as ListResult;
      expect(r.root).toBe(dir);
      expect(r.path).toBe("");
      expect(r.truncated).toBe(false);
      const names = r.entries.map((e) => e.name);
      expect(names).not.toContain(".git");
      expect(names).toContain(".env.example");
      const firstFile = names.findIndex((n) => !["src", "Zeta", "escape-dir"].includes(n));
      expect(names.slice(0, 2)).toEqual(["src", "Zeta"].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
      expect(firstFile).toBeGreaterThanOrEqual(2);
      expect(names.indexOf("Apple.txt")).toBeLessThan(names.indexOf("banana.txt"));
      expect(r.entries.find((e) => e.name === "escape-dir")?.kind).toBe("symlink");
      const readme = r.entries.find((e) => e.name === "README.md")!;
      expect(readme).toMatchObject({ kind: "file", path: "README.md", size: 8 });
    });
  }, 60_000);

  test("lists a subdirectory with relative paths", async () => {
    await withWorkspace(async ({ client, workspaceId }) => {
      const r = (await inv(client, "workspace.files.list", { workspaceId, path: "src" })) as unknown as ListResult;
      expect(r.path).toBe("src");
      expect(r.entries.map((e) => [e.name, e.path, e.kind])).toEqual([["deep", "src/deep", "directory"], ["main.ts", "src/main.ts", "file"]]);
    });
  }, 60_000);

  test("reads text with language, flags binary and truncation", async () => {
    await withWorkspace(async ({ client, workspaceId }) => {
      const ts = (await inv(client, "workspace.file.read", { workspaceId, path: "src/main.ts" })) as unknown as ReadResult;
      expect(ts).toMatchObject({ path: "src/main.ts", text: "export const x = 1;\n", binary: false, truncated: false, language: "typescript" });
      const bin = (await inv(client, "workspace.file.read", { workspaceId, path: "blob.bin" })) as unknown as ReadResult;
      expect(bin.binary).toBe(true);
      expect(bin.text).toBeUndefined();
      expect(bin.size).toBe(5);
      const big = (await inv(client, "workspace.file.read", { workspaceId, path: "big.txt" })) as unknown as ReadResult;
      expect(big.truncated).toBe(true);
      expect(big.size).toBe(600 * 1024);
      expect(big.text!.length).toBe(512 * 1024);
      expect(big.language).toBe("text");
    });
  }, 60_000);

  test("refuses traversal, absolute paths, escaping symlinks, .git, unknown workspace and missing files", async () => {
    await withWorkspace(async ({ client, workspaceId, dir }) => {
      const fails = async (cap: string, input: unknown, re: RegExp) => {
        const err = await inv(client, cap, input).then(() => undefined, (e: unknown) => e as Error);
        expect(err?.message ?? "").toMatch(re);
      };
      await fails("workspace.file.read", { workspaceId, path: "../outside/secret.txt" }, /leaves the workspace root/);
      await fails("workspace.file.read", { workspaceId, path: "src/../../x" }, /leaves the workspace root/);
      await fails("workspace.files.list", { workspaceId, path: ".." }, /leaves the workspace root/);
      await fails("workspace.file.read", { workspaceId, path: join(dir, "README.md") }, /absolute paths/);
      await fails("workspace.files.list", { workspaceId, path: "/etc" }, /absolute paths/);
      await fails("workspace.file.read", { workspaceId, path: "escape-file" }, /outside the workspace root/);
      await fails("workspace.files.list", { workspaceId, path: "escape-dir" }, /outside the workspace root/);
      await fails("workspace.file.read", { workspaceId, path: ".git/HEAD" }, /\.git/);
      await fails("workspace.file.read", { workspaceId, path: "nope.txt" }, /no such file/);
      await fails("workspace.files.list", { workspaceId, path: "README.md" }, /not a folder/);
      await fails("workspace.files.list", { workspaceId: "does-not-exist" }, /unknown workspace/);
      await fails("workspace.file.read", { workspaceId: "does-not-exist", path: "a" }, /unknown workspace/);
    });
  }, 60_000);

  test("refuses a workspace rooted inside the protected application home", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const dir = join(home, "inside");
        await mkdir(dir);
        const { workspaceId } = (await inv(client, "workspace.select", { path: dir })) as { workspaceId: string };
        await app.runtime.idle();
        const err = await inv(client, "workspace.files.list", { workspaceId }).then(() => undefined, (e: unknown) => e as Error);
        expect(err?.message ?? "").toMatch(/protected/);
      } finally {
        await client.close();
        await app.stop();
      }
    });
  }, 60_000);

  test("is read-only and operator-only: no write capability, system actor refused", async () => {
    await withWorkspace(async ({ app, client, workspaceId }) => {
      const err = await inv(client, "workspace.file.write", { workspaceId, path: "x", text: "y" }).then(() => undefined, (e: unknown) => e as Error);
      expect(err).toBeDefined();
      const sys = await app.runtime.service.invoke(SYSTEM, { capability: "workspace.file.read", input: { workspaceId, path: "README.md" } } as never)
        .then(() => undefined, (e: unknown) => e as Error);
      expect(sys?.message ?? "").toMatch(/only a direct human operator/);
    });
  }, 60_000);
});
