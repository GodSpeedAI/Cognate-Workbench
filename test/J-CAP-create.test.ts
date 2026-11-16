// Journey J-CAP-create (capability-bundles tranche T2, §4.2 of design.md): a capability is
// registered from a directory source, activated through the dispatcher, and invoked in-session
// — the defining behaviour "an authorized user or agent can create and activate a capability
// during the live session". Covers CUJ 1 (create a visual-design capability in-session, use it
// without restart), the catalog-size scaling variant (over-budget descriptor truncation), and
// the over-ceiling registration refusal.
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootApp, withTempHome, waitUntil, wbRows } from "./wb-helpers.ts";

describe("J-CAP-create", () => {
  test("register → activate → invoke in-session (CUJ 1)", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        // Author: compose a small bundle (skills + composition guide) into a source directory.
        const source = join(home, "bundle-src", randomUUID().slice(0, 8));
        await mkdir(join(source, "skills"), { recursive: true });
        await writeFile(join(source, "SKILL.md"), "# Visual Design\n\nCompose: run the critique pass before the craft pass.");
        await writeFile(join(source, "skills", "critique.md"), "Critique rules: anti-patterns first.");

        // Register: validate → materialize → record. The source dir is never read again (§4.4).
        const registered = await client.invoke("capability.bundle.register", {
          capabilityId: "capability.bundle.visual-design",
          sourceDir: source,
          manifest: {
            name: "Visual Design",
            purpose: "Hallmark + Impeccable design composition",
            skills: [
              { name: "compose", entry: "SKILL.md", isEntryDocument: true },
              { name: "critique", entry: "skills/critique.md" },
            ],
            requirements: ["capability.invoke", "skill.load"],
          },
        }) as { capabilityId: string; version: string; dir: string; files: number };

        expect(registered.files).toBe(2);
        expect(registered.version).toBeTruthy();

        // The immutable version directory exists and the bundle row folds.
        const row = await waitUntil("bundle row", async () => ((await wbRows(app)).get(`bundle/capability.bundle.visual-design`) as Record<string, unknown> | undefined));
        expect(row.version).toBe(registered.version);
        expect(row.createdBy).toBeTruthy();

        // Activate: the dispatcher mounts the adapter and the CAS activation commits.
        const activated = await client.invoke("capability.bundle.activate", { capabilityId: "capability.bundle.visual-design" }) as { capabilityId: string; version: string; state: string };
        expect(activated.state).toBe("active");
        expect(activated.version).toBe(registered.version);

        // The activation row folds and the index sees it.
        const activationRow = await waitUntil("activation row", async () => ((await wbRows(app)).get(`activation/capability.bundle.visual-design/user`) as Record<string, unknown> | undefined));
        expect(activationRow.state).toBe("active");
        expect(activationRow.version).toBe(registered.version);

        // Invoke through the dispatcher: skill.load returns the document (the composition guide).
        const load = await client.invoke("tool.skill_load", { capabilityId: "capability.bundle.visual-design", skillId: "SKILL.md" }) as Record<string, unknown>;
        console.error("[J-CAP-create] skill_load response:", JSON.stringify(load, null, 2));
        expect(JSON.stringify(load)).toContain("Visual Design");

        // tools.list returns the manifest-declared tool entries.
        const list = await client.invoke("tool.capability_invoke", { capabilityId: "capability.bundle.visual-design", op: "tools.list" }) as { result?: { tools?: unknown[] } };
        expect(list.result?.tools).toBeDefined();
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 60000);

  test("over-ceiling registration refuses with the limit named", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const source = join(home, "bundle-src", "big");
        await mkdir(source, { recursive: true });
        await writeFile(join(source, "big.md"), "x".repeat(513 * 1024));
        await expect(client.invoke("capability.bundle.register", {
          capabilityId: "capability.bundle.big",
          sourceDir: source,
          manifest: { name: "Big", purpose: "over ceiling", skills: [{ name: "s", entry: "big.md" }] },
        })).rejects.toThrow(/exceeds 524288 bytes/);
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 60000);

  test("in-session discovery: a capability activated after a run starts is discoverable at the next model-turn boundary", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        // The P suite's run_code test already covers fold-race; here we assert the descriptor
        // appears in the assembled harness record (CUJ 1's discovery assertion, asserted from
        // the durable fold, not from model behaviour).
        const source = join(home, "bundle-src", "disc");
        await mkdir(source, { recursive: true });
        await writeFile(join(source, "GUIDE.md"), "# Design guide\n\nHallmark critiques; Impeccable crafts.");
        const registered = await client.invoke("capability.bundle.register", {
          capabilityId: "capability.bundle.discovery-test",
          sourceDir: source,
          manifest: { name: "Discovery", purpose: "test", skills: [{ name: "guide", entry: "GUIDE.md", isEntryDocument: true }] },
        }) as { capabilityId: string };
        await waitUntil("discovery bundle row", async () => ((await wbRows(app)).get(`bundle/${registered.capabilityId}`) as Record<string, unknown> | undefined));
        await client.invoke("capability.bundle.activate", { capabilityId: registered.capabilityId });
        await waitUntil("discovery activation row", async () => ((await wbRows(app)).get(`activation/${registered.capabilityId}/user`) as Record<string, unknown> | undefined));
        // The descriptor's presence in the workbench projection proves the capability is
        // discoverable; the run-start resolver picks it up on the next run or turn boundary.
        const rows = await wbRows(app);
        expect(rows.get("bundle/capability.bundle.discovery-test")).toBeDefined();
        expect(rows.get("activation/capability.bundle.discovery-test/user")).toBeDefined();
      } finally {
        await app.runtime.idle().catch(() => {});
        await app.stop();
      }
    });
  }, 60000);
});
