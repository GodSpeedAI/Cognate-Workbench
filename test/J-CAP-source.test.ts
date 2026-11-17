// Journey J-CAP-source (capability-bundles T2, design §4.4; CUJ 8): a bundle directory on an SSH
// or WSL execution world is ingested THROUGH that world's filesystem port — no host filesystem
// read or watch of the remote location — and hashing, version-directory materialization,
// registration and loading then behave identically to a local-world install. Providers are
// parameterized over world kinds; the in-process memory world stands in for the transport
// (the abstraction is proven independently of any transport, as the execution suite does).
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryExecutionWorld } from "@godspeedai/cognate-execution";
import { materializeVersion, versionHashFor } from "../src/capabilities/bundleStore.ts";
import { BundleBackedPluginSource, ingestDirectorySource } from "../src/workbench/bundleSources.ts";
import { bootApp, enableCapabilityRuntime, inv, registerBundle, waitUntil, wbRows, withTempHome } from "./wb-helpers.ts";

const FILES = { "SKILL.md": "# Remote skill\n\nCompose before craft.", "skills/critique.md": "Critique rules first." } as const;
const manifest = { name: "Source Demo", purpose: "provider-backed source", skills: [{ name: "compose", entry: "SKILL.md", isEntryDocument: true }, { name: "critique", entry: "skills/critique.md" }], requirements: ["capability.invoke", "skill.load"] };

/** A memory world presenting as the given provider kind; counts content reads to prove bounds. */
function remoteWorld(kind: "ssh" | "wsl", files: Record<string, string>) {
  const root = "/remote/bundles/demo"; // exists on no host filesystem
  const dirs = new Set<string>([root]);
  for (const rel of Object.keys(files)) for (let i = rel.indexOf("/"); i !== -1; i = rel.indexOf("/", i + 1)) dirs.add(`${root}/${rel.slice(0, i)}`);
  const base = memoryExecutionWorld({ worldId: `${kind}-test`, directories: [...dirs], files: Object.fromEntries(Object.entries(files).map(([rel, text]) => [`${root}/${rel}`, text])) });
  let reads = 0;
  const world = {
    worldId: base.worldId, kind,
    fileSystem: { ...base.fileSystem, readText: async (p: string) => { reads += 1; return base.fileSystem.readText(p); } },
  };
  return { world, root, reads: () => reads };
}

describe("J-CAP-source", () => {
  for (const kind of ["ssh", "wsl"] as const) {
    test(`${kind}: ingestion yields the same version identity as a local install of the same bytes`, async () => {
      const scratch = await mkdtemp(join(tmpdir(), "cap-source-"));
      try {
        const { world, root } = remoteWorld(kind, FILES);
        const staged = await ingestDirectorySource(world as never, root, join(scratch, "staging"));
        expect(staged.files).toBe(2);
        expect(staged.worldKind).toBe(kind);
        const remote = await materializeVersion(join(scratch, "home-remote"), "capability.bundle.src", staged.dir);
        await staged.cleanup();

        const local = join(scratch, "local-src");
        await mkdir(join(local, "skills"), { recursive: true });
        for (const [rel, text] of Object.entries(FILES)) await writeFile(join(local, rel), text);
        const direct = await materializeVersion(join(scratch, "home-local"), "capability.bundle.src", local);

        expect(versionHashFor(remote.manifest)).toBe(versionHashFor(direct.manifest));
        expect(remote.manifest).toEqual(direct.manifest);
        // The staging directory is gone: nothing re-reads the source after registration (§4.4).
        expect(await Bun.file(join(staged.dir, "SKILL.md")).exists()).toBe(false);
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    });

    test(`${kind}: hostile sources are refused by the same ceilings, before content crosses the provider`, async () => {
      const scratch = await mkdtemp(join(tmpdir(), "cap-source-"));
      try {
        const big = remoteWorld(kind, { "big.md": "x".repeat(513 * 1024), "a.md": "a" });
        await expect(ingestDirectorySource(big.world as never, big.root, join(scratch, "s"))).rejects.toThrow(/exceeds 524288 bytes/);
        expect(big.reads()).toBe(0);
        const many = remoteWorld(kind, Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}.md`, "x"])));
        await expect(ingestDirectorySource(many.world as never, many.root, join(scratch, "s"))).rejects.toThrow(/exceeds 200 files/);
        const missing = remoteWorld(kind, FILES);
        await expect(ingestDirectorySource(missing.world as never, "/remote/does/not/exist", join(scratch, "s"))).rejects.toThrow(/not a directory/);
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    });
  }

  test("registration through a world: same version as a plain install, then activate and load identically", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await enableCapabilityRuntime(app, client);
        const source = join(home, "authoring", "src");
        await mkdir(join(source, "skills"), { recursive: true });
        for (const [rel, text] of Object.entries(FILES)) await writeFile(join(source, rel), text);

        const plain = await registerBundle(app, client, { capabilityId: "capability.bundle.plain", sourceDir: source, manifest });
        const viaWorld = await registerBundle(app, client, { capabilityId: "capability.bundle.world", sourceDir: source, executionWorldId: "local", manifest });
        expect(viaWorld.version).toBe(plain.version);
        const row = await waitUntil("world bundle row", async () => ((await wbRows(app)).get("bundle/capability.bundle.world") as { origin?: string; sourceWorldId?: string } | undefined));
        expect(row.origin).toBe("world:local");
        expect(row.sourceWorldId).toBe("local");

        await client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.world" });
        const loaded = await client.invoke("tool.skill_load", { capabilityId: "capability.bundle.world", skillId: "critique" }) as { ok: boolean; result?: { content: string } };
        expect(loaded.ok).toBe(true);
        expect(loaded.result?.content).toBe(FILES["skills/critique.md"]);

        // An unknown world refuses explicitly, and the refusal is recorded (validation_failed).
        await expect(inv(client, "capability.bundle.register", { capabilityId: "capability.bundle.nowhere", sourceDir: "/x", executionWorldId: "ssh-gone", manifest })).rejects.toThrow(/not connected/);
        await waitUntil("validation_failed fault", async () => [...(await wbRows(app))].find(([k]) => k.startsWith("fault/capability.validation_failed/capability.bundle.nowhere"))?.[1]);
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 90000);

  test("the PluginSource bridge lists registered bundles as inert legacy rows", () => {
    const source = new BundleBackedPluginSource(() => [{ capabilityId: "capability.bundle.a", name: "A", purpose: "alpha" }, { capabilityId: "capability.bundle.gone", uninstalled: true }]);
    const entries = source.list();
    expect(entries.map((e) => e.id)).toEqual(["capability.bundle.a"]);
    expect(entries[0]!.implementation.kind).toBe("none");
  });
});
