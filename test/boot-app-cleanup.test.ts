import { expect, test } from "bun:test";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bootApp, withTempHome } from "./helpers.ts";

async function expectClientStopped(home: string) {
  const { app, client } = await bootApp(home);
  const port = Number(new URL(app.url).port);
  await app.stop();
  let requests = 0;
  const listener = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch() {
      requests++;
      return new Response("not found", { status: 404 });
    },
  });
  try {
    // The reconnecting client retries on this interval if it was left alive.
    await Bun.sleep(3000);
    expect(requests).toBe(0);
  } finally {
    await client.close();
    await listener.stop(true);
  }
}

test("stopping an in-process test app closes its client before port reuse", async () => {
  await withTempHome(async (home) => {
    await expectClientStopped(home);
  });
}, 20000);

test("stopping a sidecar test app closes its client before port reuse", async () => {
  await withTempHome(async (home) => {
    const sidecar = join(home, "sidecar");
    await writeFile(sidecar, `#!/usr/bin/env bun
Bun.serve({ port: Number(process.env.PORT), hostname: "127.0.0.1", fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/health") return Response.json({ ok: true });
  if (path === "/app.js") return new Response('"wbs1.test-fixture"');
  return new Response("not found", { status: 404 });
} });
`);
    await chmod(sidecar, 0o700);
    const previous = process.env.COGNATE_TEST_SIDECAR;
    try {
      process.env.COGNATE_TEST_SIDECAR = sidecar;
      await expectClientStopped(home);
    } finally {
      if (previous === undefined) delete process.env.COGNATE_TEST_SIDECAR;
      else process.env.COGNATE_TEST_SIDECAR = previous;
    }
  });
}, 20000);
