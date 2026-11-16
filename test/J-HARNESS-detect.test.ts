// Journey J-HARNESS-detect: host-side detection of external agent-harness CLIs. Fake binaries on a
// temp PATH prove found / not-installed / hidden-unless-verified; a smoke test runs the real host
// (only `--version` is ever run; no model, no login) and asserts the shape.
import { describe, expect, test } from "bun:test";
import { chmodSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootHarnessApp, makeFakeHost } from "./harness-helpers.ts";
import { bootApp, withTempHome } from "./helpers.ts";

interface ListResult {
  readonly harnesses: readonly { readonly id: string; readonly label: string; readonly installed: boolean; readonly path?: string; readonly version?: string; readonly protocol: string; readonly supportsApprovals: boolean; readonly permissionModes: readonly { readonly id: string }[]; readonly installHint: { readonly url: string }; readonly signInHint: string; readonly reasonUnavailable?: string }[];
  readonly host: { readonly platform: string; readonly detectedOn: string; readonly cached: boolean };
}

describe("J-HARNESS-detect", () => {
  test("fake binaries on a temp PATH are found with version and protocol; missing ones report an install hint; unverified ones stay hidden", async () => {
    const host = await makeFakeHost(["claude", "codex", "opencode", "gemini"]);
    // A `qwen` whose --help does not print an ACP flag must stay hidden.
    const qwen = join(host.binDir, "qwen");
    await writeFile(qwen, "#!/bin/sh\necho 'qwen: nothing to see'\n");
    chmodSync(qwen, 0o755);
    await withTempHome(async (home) => {
      const { app, client } = await bootHarnessApp(home, host);
      try {
        const list = (await client.invoke("agent.harness.list", {})) as unknown as ListResult;
        expect(list.host.detectedOn).toBe("server-host");
        expect(list.host.platform).toBe(process.platform);
        const byId = new Map(list.harnesses.map((h) => [h.id, h]));
        const claude = byId.get("claude")!;
        expect(claude.installed).toBe(true);
        expect(claude.path).toBe(join(host.binDir, "claude"));
        expect(claude.version).toBe("claude 1.2.3 (fake)");
        expect(claude.protocol).toBe("claude-stream-json");
        expect(claude.supportsApprovals).toBe(true);
        expect(claude.permissionModes.map((m) => m.id)).toContain("full");
        expect(byId.get("codex")?.protocol).toBe("codex-app-server");
        expect(byId.get("opencode")?.protocol).toBe("acp");
        const kimi = byId.get("kimi")!;
        expect(kimi.installed).toBe(false);
        expect(kimi.reasonUnavailable).toContain("not found");
        expect(kimi.installHint.url).toStartWith("https://");
        expect(kimi.signInHint.length).toBeGreaterThan(0);
        expect(byId.get("gemini")?.installed).toBe(true); // --help prints --experimental-acp
        expect(byId.has("qwen")).toBe(false); // --help prints no ACP flag: hidden
        // 60 s cache, refresh bypasses it.
        expect(((await client.invoke("agent.harness.list", {})) as unknown as ListResult).host.cached).toBe(true);
        expect(((await client.invoke("agent.harness.list", { refresh: true })) as unknown as ListResult).host.cached).toBe(false);
      } finally {
        await app.stop();
      }
    });
  });

  test("real host smoke: list has the documented shape (only --version is ever run)", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const list = (await client.invoke("agent.harness.list", { refresh: true })) as unknown as ListResult;
        expect(list.harnesses.length).toBeGreaterThan(5);
        for (const h of list.harnesses) {
          expect(typeof h.id).toBe("string");
          expect(typeof h.installed).toBe("boolean");
          expect(["claude-stream-json", "codex-app-server", "acp"]).toContain(h.protocol);
          expect(h.permissionModes.length).toBeGreaterThan(0);
          expect(typeof h.signInHint).toBe("string");
          if (h.installed) expect(typeof h.path).toBe("string");
          else expect(typeof h.reasonUnavailable).toBe("string");
        }
        expect(list.host.platform).toBe(process.platform);
      } finally {
        await app.stop();
      }
    });
  }, 30000);
});
