// J-AUTH-REBIND: the loopback server refuses non-loopback Host and Origin, so a page that
// DNS-rebinds its name to 127.0.0.1 can neither read the session-bearing bundle nor call the API.
// Teeth: before the guard, a foreign Host received /app.js containing the operator session token
// and a foreign-Origin RPC with that token returned 200 (godspeed-readiness S01, 2026-10-21).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { loopbackRefusal, startServer } from "../src/server.ts";

const h = (init: Record<string, string>) => new Headers(init);

test("J-AUTH-REBIND: loopbackRefusal accepts only loopback names", () => {
  for (const host of ["127.0.0.1:4100", "localhost:4100", "LOCALHOST", "[::1]:4100", "127.0.0.1"]) {
    expect(loopbackRefusal(h({ host }))).toBeUndefined();
  }
  expect(loopbackRefusal(h({ host: "127.0.0.1:4100", origin: "http://localhost:9000" }))).toBeUndefined();
  for (const host of ["attacker.example:4100", "127.0.0.1.attacker.example", "localhost.attacker.example", "0.0.0.0:4100", ""]) {
    expect(loopbackRefusal(h({ host }))?.status).toBe(421);
  }
  expect(loopbackRefusal(new Headers())?.status).toBe(421);
  expect(loopbackRefusal(h({ host: "127.0.0.1:4100", origin: "http://attacker.example" }))?.status).toBe(403);
  expect(loopbackRefusal(h({ host: "127.0.0.1:4100", origin: "null" }))?.status).toBe(403);
});

async function rawGet(port: number, path: string, host: string): Promise<string> {
  let buf = "";
  await new Promise<void>((resolve, reject) => {
    Bun.connect({
      hostname: "127.0.0.1", port,
      socket: {
        open(s) { s.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`); },
        data(_s, d) { buf += new TextDecoder().decode(d); },
        close() { resolve(); },
        error(_s, e) { reject(e); },
      },
    }).catch(reject);
  });
  return buf;
}

test("J-AUTH-REBIND: a rebinding origin cannot read the session bundle or use the token", async () => {
  const home = await mkdtemp(join(tmpdir(), "wb-auth-rebind-"));
  const app = await startServer({ port: 0, home });
  try {
    const port = Number(new URL(app.url).port);
    const token = app.operatorSessionToken;

    const own = await rawGet(port, "/app.js", `127.0.0.1:${port}`);
    expect(own.startsWith("HTTP/1.1 200")).toBe(true);
    expect(own.includes(token)).toBe(true); // control: the probe can see the token when it is served

    for (const path of ["/", "/app.js", "/health"]) {
      const foreign = await rawGet(port, path, `attacker.example:${port}`);
      expect(foreign.startsWith("HTTP/1.1 421")).toBe(true);
      expect(foreign.includes(token)).toBe(false);
    }

    const rpc = await fetch(`${app.url}/cognate.v1.RuntimeService/ReadProjection`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: "http://attacker.example" },
      body: JSON.stringify({ name: "settings" }),
    });
    expect(rpc.status).toBe(403);
  } finally {
    await app.stop();
    await rm(home, { recursive: true, force: true });
  }
}, 60_000);
