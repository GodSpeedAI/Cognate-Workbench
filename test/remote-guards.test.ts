/**
 * Request guards on the phone listener, exercised without a runtime: a stub service answers only the
 * shared-state reads the controller makes when it starts. Covers Host (DNS rebinding), Origin and
 * content type on POST, the strict headers, refused pairing and sign-in without a session, and the
 * listener closing on stop.
 */
import { describe, expect, test } from "bun:test";
import { MobileRemote } from "../src/remote/mobile.ts";

const stubService = {
  readSharedState: async () => ({ state: {}, version: 0 }),
  updateSharedState: async () => ({ state: {}, version: 1 }),
} as never;

async function started(): Promise<{ remote: MobileRemote; port: number }> {
  const remote = new MobileRemote(
    { service: stubService, system: { tenant: "local", actor: { id: "system", kind: "system" } }, operatorIdentityId: "identity-test", assets: async () => ({ js: "", css: "" }) },
    { port: 0 },
  );
  await remote.start();
  const port = (remote as unknown as { port: number }).port;
  return { remote, port };
}

const at = (port: number, path: string, init: RequestInit & { host?: string } = {}) => {
  const { host, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (host) headers.set("host", host);
  return new Request(`http://localhost:${port}${path}`, { ...rest, headers });
};

describe("phone listener guards", () => {
  test("a non-local Host is refused on every route, including the shell (DNS rebinding)", async () => {
    const { remote, port } = await started();
    try {
      expect((await remote.handle(at(port, "/m", { host: "evil.example" }))).status).toBe(421);
      expect((await remote.handle(at(port, "/m/api/snapshot", { host: "evil.example" }))).status).toBe(421);
      expect((await remote.handle(at(port, "/m/api/pair/redeem", { host: "evil.example", method: "POST" }))).status).toBe(421);
    } finally {
      await remote.stop();
    }
  });

  test("the shell is served with a nonce CSP, no framing, no referrer and no store", async () => {
    const { remote, port } = await started();
    try {
      const response = await remote.handle(at(port, "/m", { host: `localhost:${port}` }));
      expect(response.status).toBe(200);
      const csp = response.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9_-]+'/);
      expect(csp).not.toContain("unsafe-inline'; script");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.text()).toContain('src="/m/app.js"');
    } finally {
      await remote.stop();
    }
  });

  test("POST needs the same origin and a JSON body; anything else is refused before any work", async () => {
    const { remote, port } = await started();
    try {
      const json = { "content-type": "application/json" };
      const foreign = await remote.handle(at(port, "/m/api/pair/redeem", { host: `localhost:${port}`, method: "POST", headers: { ...json, origin: "https://evil.example" }, body: "{}" }));
      expect(foreign.status).toBe(403);
      const plain = await remote.handle(at(port, "/m/api/pair/redeem", { host: `localhost:${port}`, method: "POST", headers: { origin: `http://localhost:${port}`, "content-type": "text/plain" }, body: "{}" }));
      expect(plain.status).toBe(415);
    } finally {
      await remote.stop();
    }
  });

  test("a wrong or missing pairing secret is refused as invalid, and a snapshot without a session is unauthenticated", async () => {
    const { remote, port } = await started();
    try {
      const origin = `http://localhost:${port}`;
      const json = { "content-type": "application/json", origin };
      const wrong = await remote.handle(at(port, "/m/api/pair/redeem", { host: `localhost:${port}`, method: "POST", headers: json, body: JSON.stringify({ secret: "x".repeat(43) }) }));
      expect(wrong.status).toBe(400);
      expect(await wrong.json()).toEqual({ error: "invalid" });
      const snapshot = await remote.handle(at(port, "/m/api/snapshot", { host: `localhost:${port}` }));
      expect(snapshot.status).toBe(401);
      expect(snapshot.headers.get("set-cookie")).toContain("__Host-wb_remote=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict");
    } finally {
      await remote.stop();
    }
  });

  test("stop closes the listener: nothing answers on the port afterwards", async () => {
    const { remote, port } = await started();
    await remote.stop();
    await expect(fetch(`http://127.0.0.1:${port}/m`)).rejects.toThrow();
  });
});
