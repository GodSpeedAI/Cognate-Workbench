// Journey J-PREVIEW-register: a governed dev-server preview, end to end. Registration is
// explicit and ownership-carrying; readiness is probed before the preview is ready; an
// unreachable port is refused with the reason; the managed browser opens the registered URL;
// stopping ends the Workbench-owned server process with the terminal's group-kill discipline;
// archiving the owning session cleans the preview up; and an SSH world is reached by a real
// local forward over the world's own connection (direct-tcpip against the genuine ssh2 fixture
// server), never by a public bind.
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { bootApp, inv, seedWorkspaceOnly, waitUntil, withTempHome, wbRows } from "./wb-helpers.ts";
import { startSshFixture, type SshFixture } from "@godspeedai/cognate-execution-ssh/fixture";
import type { PreviewView } from "../src/preview/service.ts";
import type { PreviewRow } from "../src/workbench/state.ts";

const PASSWORD = "s3cret-pass-PREVIEW-9";

/** A free loopback port (allocate-and-release; the registration probe tolerates a slow start). */
async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = server.port!;
  await server.stop(true);
  return port;
}

/** Spawn a standalone "dev server" as its own process group (so the group-kill discipline bites). */
function spawnDevServer(port: number, marker: string) {
  const script = `Bun.serve({ port: Number(process.env.PV_PORT), fetch: () => new Response('<html><body><button>' + ${JSON.stringify(marker)} + '</button></body></html>', { headers: { 'content-type': 'text/html' } }) }); setInterval(() => {}, 10_000);`;
  return Bun.spawn(["bun", "-e", script], {
    env: { ...process.env, PV_PORT: String(port) },
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const previewRow = async (app: Awaited<ReturnType<typeof bootApp>>["app"], previewId: string): Promise<PreviewRow | undefined> => {
  const rows = await wbRows(app);
  return rows.get(`preview/${previewId}`) as PreviewRow | undefined;
};

describe("J-PREVIEW-register", () => {
  test("local world: explicit registration, readiness probe, browser opens it, stop kills the owned process", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const port = await freePort();
        const proc = spawnDevServer(port, "PREVIEW_OK_LOCAL");
        try {
          const view = (await inv(client, "preview.register", {
            url: `http://127.0.0.1:${port}/`,
            workspaceId,
            ownerSessionId: randomUUID(),
            pid: proc.pid,
          })) as unknown as PreviewView;
          expect(view.status).toBe("ready");
          expect(view.viewUrl).toBe(`http://127.0.0.1:${port}/`);

          // The durable record folds with ownership and the governed pid.
          const row = await waitUntil("preview row", async () => {
            const current = await previewRow(app, view.previewId);
            return current?.status === "ready" ? current : undefined;
          });
          expect(row.pid).toBe(proc.pid);
          expect(row.ownerSessionId).toBeDefined();

          // The managed browser opens the registered URL (the surface acceptance row).
          const browser = (await inv(client, "browser.open", { url: view.viewUrl })) as unknown as { sessionId: string };
          let seen = false;
          for (let attempt = 0; attempt < 20 && !seen; attempt++) {
            await Bun.sleep(250);
            const snap = String(await inv(client, "browser.snapshot", { sessionId: browser.sessionId }));
            seen = snap.includes("PREVIEW_OK_LOCAL");
          }
          expect(seen).toBe(true);
          await inv(client, "browser.close", { sessionId: browser.sessionId });

          // Stop ends the Workbench-owned process (group discipline).
          const stopped = (await inv(client, "preview.stop", { previewId: view.previewId })) as unknown as PreviewView;
          expect(stopped.status).toBe("stopped");
          await waitUntil("stopped row", async () => {
            const current = await previewRow(app, view.previewId);
            return current?.status === "stopped" && current.reason === "operator" ? current : undefined;
          });
          for (let attempt = 0; attempt < 30 && alive(proc.pid!); attempt++) await Bun.sleep(100);
          expect(alive(proc.pid!)).toBe(false);
        } finally {
          if (alive(proc.pid!)) proc.kill(9);
        }
      } finally {
        await app.stop();
      }
    });
  }, 90_000);

  test("an unreachable port is refused with the reason, and nothing is recorded", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await seedWorkspaceOnly(client, home);
        const port = await freePort();
        let refused = "";
        try {
          await inv(client, "preview.register", { url: `http://127.0.0.1:${port}/` });
        } catch (error) {
          refused = (error as Error).message;
        }
        expect(refused).toContain("never answered");
        const rows = await wbRows(app);
        expect([...rows.keys()].filter((key) => key.startsWith("preview/")).length).toBe(0);
      } finally {
        await app.stop();
      }
    });
  }, 45_000);

  test("archiving the owning session stops the preview and the process", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await seedWorkspaceOnly(client, home);
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const session = (await inv(client, "session.create", { workspaceId, requestId: randomUUID() })) as unknown as { sessionId: string };
        const port = await freePort();
        const proc = spawnDevServer(port, "PREVIEW_OK_OWNER");
        try {
          const view = (await inv(client, "preview.register", {
            url: `http://127.0.0.1:${port}/`,
            ownerSessionId: session.sessionId,
            pid: proc.pid,
          })) as unknown as PreviewView;
          expect(view.status).toBe("ready");

          await inv(client, "session.setArchived", { sessionId: session.sessionId, archived: true });
          await waitUntil("owner-stopped row", async () => {
            const current = await previewRow(app, view.previewId);
            return current?.status === "stopped" && current.reason === "owner ended" ? current : undefined;
          });
          for (let attempt = 0; attempt < 30 && alive(proc.pid!); attempt++) await Bun.sleep(100);
          expect(alive(proc.pid!)).toBe(false);
        } finally {
          if (alive(proc.pid!)) proc.kill(9);
        }
      } finally {
        await app.stop();
      }
    });
  }, 60_000);

  test("an SSH world's preview is reached through a real local forward; secrets stay out of the record", async () => {
    await withTempHome(async (home) => {
      const fixture: SshFixture = await startSshFixture({ users: { dev: { password: PASSWORD } } });
      const { app, client } = await bootApp(home);
      try {
        const probe = (await client.invoke("execution.world.probe", { host: "127.0.0.1", port: fixture.port })) as { fingerprint: string };
        const world = (await client.invoke("execution.world.connect", {
          kind: "ssh",
          label: "preview box",
          ssh: { host: "127.0.0.1", port: fixture.port, username: "dev", auth: { kind: "password", password: PASSWORD }, hostKeyFingerprint: probe.fingerprint },
        })) as { worldId: string };

        // The "remote" app: a listener on the fixture host (same machine here — the tunnel is
        // what's under test, and it is a genuine direct-tcpip channel through the SSH connection).
        const port = await freePort();
        const marker = "PREVIEW_OK_SSH";
        const remote = Bun.serve({ port, fetch: () => new Response(`<html><body><button>${marker}</button></body></html>`, { headers: { "content-type": "text/html" } }) });

        const view = (await inv(client, "preview.register", { url: `http://127.0.0.1:${port}/`, worldId: world.worldId })) as unknown as PreviewView;
        expect(view.worldKind).toBe("ssh");
        expect(view.originUrl).toBe(`http://127.0.0.1:${port}/`);
        // The view URL is a NEW local port — the forward, not the origin.
        expect(view.viewUrl).not.toBe(view.originUrl);
        const response = await fetch(view.viewUrl);
        expect(await response.text()).toContain(marker);

        // Durable record: the world and forwarded URL, no password material.
        const row = await waitUntil("ssh preview row", async () => {
          const current = await previewRow(app, view.previewId);
          return current?.status === "ready" && current.worldKind === "ssh" ? current : undefined;
        });
        expect(JSON.stringify(row)).not.toContain(PASSWORD);

        // Stop closes the forward: the view URL answers no more.
        await inv(client, "preview.stop", { previewId: view.previewId });
        let refused = false;
        for (let attempt = 0; attempt < 20 && !refused; attempt++) {
          await Bun.sleep(200);
          try {
            await fetch(view.viewUrl, { signal: AbortSignal.timeout(800) });
          } catch {
            refused = true;
          }
        }
        expect(refused).toBe(true);
        remote.stop(true);
      } finally {
        await fixture.close();
        await app.stop();
      }
    });
  }, 90_000);
});
