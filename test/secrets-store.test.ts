// J-SECRETS-storage: native secret store scoping, backend selection and file migration, driven by a
// fake backend so every platform and failure mode is exercised on any host. The last block is a real
// round-trip against the host's secret store and skips itself when no store is available.
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migrateFileSecrets, nativeSecretStore, openSecretStore, secretBackendLabel, secretScope, secretStore, SECRET_SERVICE, type NativeSecretBackend } from "../src/secrets.ts";

function fakeBackend(overrides: Partial<NativeSecretBackend> = {}) {
  const data = new Map<string, string>();
  const key = (o: { service: string; name: string }) => `${o.service}\u0000${o.name}`;
  const backend: NativeSecretBackend = {
    async get(o) { return data.get(key(o)) ?? null; },
    async set(o) { data.set(key(o), o.value); },
    async delete(o) { return data.delete(key(o)); },
    ...overrides,
  };
  return { backend, data };
}

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "secrets-test-")); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

describe("nativeSecretStore", () => {
  test("put/get/delete round-trip under the service and a per-home scope", async () => {
    const { backend, data } = fakeBackend();
    const store = nativeSecretStore({ scope: "abc", backend });
    await store.put("model-provider:x", "sk-1");
    expect(await store.get("model-provider:x")).toBe("sk-1");
    expect([...data.keys()]).toEqual([`${SECRET_SERVICE}\u0000abc/model-provider:x`]);
    await store.delete("model-provider:x");
    expect(await store.get("model-provider:x")).toBeUndefined();
  });

  test("two data homes never collide", async () => {
    const { backend } = fakeBackend();
    const a = nativeSecretStore({ scope: secretScope("/data/a"), backend });
    const b = nativeSecretStore({ scope: secretScope("/data/b"), backend });
    expect(secretScope("/data/a")).toMatch(/^[0-9a-f]{12}$/);
    expect(secretScope("/data/a")).not.toBe(secretScope("/data/b"));
    await a.put("k", "A");
    expect(await b.get("k")).toBeUndefined();
    await b.put("k", "B");
    expect(await a.get("k")).toBe("A");
  });

  test("an empty value deletes, matching Bun's semantics", async () => {
    const { backend } = fakeBackend();
    const store = nativeSecretStore({ scope: "s", backend });
    await store.put("k", "v");
    await store.put("k", "");
    expect(await store.get("k")).toBeUndefined();
  });
});

describe("openSecretStore selection", () => {
  test("native when the probe succeeds, with no leftover probe entry", async () => {
    const { backend, data } = fakeBackend();
    const opened = await openSecretStore(home, {}, { backend, platform: "win32" });
    expect(opened.backend).toBe("credential-manager");
    expect(opened.reason).toBeUndefined();
    expect(data.size).toBe(0);
    await opened.store.put("k", "v");
    expect(await opened.store.get("k")).toBe("v");
    expect(existsSync(join(home, "secrets.json"))).toBe(false);
  });

  test.each([["darwin", "keychain"], ["win32", "credential-manager"], ["linux", "secret-service"]] as const)("%s maps to %s", async (platform, kind) => {
    expect((await openSecretStore(home, {}, { backend: fakeBackend().backend, platform })).backend).toBe(kind);
  });

  test("probe failure falls back to the file with a reason and never throws", async () => {
    const { backend } = fakeBackend({ async set() { throw new Error("org.freedesktop.secrets was not provided by any .service files"); } });
    const opened = await openSecretStore(home, {}, { backend, platform: "linux" });
    expect(opened.backend).toBe("file");
    expect(opened.reason).toContain("no usable Secret Service on this Linux session");
    await opened.store.put("k", "v");
    expect(JSON.parse(await readFile(join(home, "secrets.json"), "utf8"))).toEqual({ k: "v" });
    expect((await stat(join(home, "secrets.json"))).mode & 0o777).toBe(0o600);
  });

  test("a hanging store times out into the file fallback", async () => {
    const { backend } = fakeBackend({ set: () => new Promise<void>(() => {}) });
    const opened = await openSecretStore(home, {}, { backend, platform: "linux", probeTimeoutMs: 50 });
    expect(opened.backend).toBe("file");
    expect(opened.reason).toContain("timed out");
  });

  test("a probe that reads back the wrong value falls back", async () => {
    const { backend } = fakeBackend({ async get() { return "other"; } });
    expect((await openSecretStore(home, {}, { backend, platform: "darwin" })).backend).toBe("file");
  });

  test("COGNATE_SECRET_STORE=file forces the file even when native works", async () => {
    const opened = await openSecretStore(home, { COGNATE_SECRET_STORE: "file" }, { backend: fakeBackend().backend, platform: "linux" });
    expect(opened.backend).toBe("file");
    expect(opened.reason).toBe("COGNATE_SECRET_STORE=file");
  });

  test("COGNATE_SECRET_STORE=native fails loudly when unavailable; unknown values are rejected", async () => {
    const { backend } = fakeBackend({ async set() { throw new Error("no daemon"); } });
    await expect(openSecretStore(home, { COGNATE_SECRET_STORE: "native" }, { backend, platform: "linux" })).rejects.toThrow(/unavailable/);
    await expect(openSecretStore(home, { COGNATE_SECRET_STORE: "vault" })).rejects.toThrow(/must be 'native' or 'file'/);
  });

  test("labels never call the file encrypted", () => {
    expect(secretBackendLabel("file")).toBe("Protected file (owner-only permissions)");
    expect(secretBackendLabel("secret-service")).toBe("Secret Service (libsecret)");
    expect(secretBackendLabel("keychain")).toBe("macOS Keychain");
    expect(secretBackendLabel("credential-manager")).toBe("Windows Credential Manager");
  });
});

describe("migration from secrets.json", () => {
  const seed = async () => writeFile(join(home, "secrets.json"), JSON.stringify({ "model-provider:a": "sk-a", "world:b": "pw-b" }), { mode: 0o600 });

  test("copies, verifies, then removes the file; second start is a no-op", async () => {
    await seed();
    const { backend } = fakeBackend();
    const lines: string[] = [];
    const opened = await openSecretStore(home, {}, { backend, platform: "linux", log: (l) => lines.push(l) });
    expect(opened.backend).toBe("secret-service");
    expect(opened.migration).toEqual({ migrated: 2, fileRemoved: true });
    expect(existsSync(join(home, "secrets.json"))).toBe(false);
    expect(await opened.store.get("model-provider:a")).toBe("sk-a");
    expect(await opened.store.get("world:b")).toBe("pw-b");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("sk-a");
    expect(lines[0]).not.toContain("pw-b");
    const again = await openSecretStore(home, {}, { backend, platform: "linux", log: (l) => lines.push(l) });
    expect(again.migration).toBeUndefined();
    expect(lines).toHaveLength(1);
  });

  test("a read-back mismatch aborts and keeps the file intact", async () => {
    await seed();
    const original = await readFile(join(home, "secrets.json"), "utf8");
    const { backend } = fakeBackend({ async get() { return "corrupted"; } });
    const target = nativeSecretStore({ scope: "s", backend });
    await expect(migrateFileSecrets({ filePath: join(home, "secrets.json"), target })).rejects.toThrow(/read-back mismatch/);
    expect(await readFile(join(home, "secrets.json"), "utf8")).toBe(original);
  });

  test("a write failure midway keeps the file, and a retry completes", async () => {
    await seed();
    let calls = 0;
    const { backend, data } = fakeBackend();
    const flaky: NativeSecretBackend = { ...backend, async set(o) { if (++calls === 2) throw new Error("locked"); return backend.set(o); } };
    const target = (b: NativeSecretBackend) => nativeSecretStore({ scope: "s", backend: b });
    await expect(migrateFileSecrets({ filePath: join(home, "secrets.json"), target: target(flaky) })).rejects.toThrow("locked");
    expect(existsSync(join(home, "secrets.json"))).toBe(true);
    expect(data.size).toBe(1);
    expect(await migrateFileSecrets({ filePath: join(home, "secrets.json"), target: target(backend) })).toEqual({ migrated: 2, fileRemoved: true });
    expect(existsSync(join(home, "secrets.json"))).toBe(false);
  });

  test("a failed migration at open time falls back to the file instead of losing keys", async () => {
    await seed();
    const { backend } = fakeBackend();
    let probing = true;
    const failing: NativeSecretBackend = { ...backend, async get(o) { return probing ? backend.get(o) : "bad"; }, async delete(o) { const r = await backend.delete(o); probing = false; return r; } };
    const opened = await openSecretStore(home, {}, { backend: failing, platform: "linux", log: () => {} });
    expect(opened.backend).toBe("file");
    expect(opened.reason).toContain("migration to the native store failed");
    expect(await opened.store.get("model-provider:a")).toBe("sk-a");
  });

  test("a missing file migrates nothing", async () => {
    const target = nativeSecretStore({ scope: "s", backend: fakeBackend().backend });
    expect(await migrateFileSecrets({ filePath: join(home, "secrets.json"), target })).toEqual({ migrated: 0, fileRemoved: false });
  });
});

describe("file store", () => {
  test("unchanged contract: mode 0600, put/get/delete", async () => {
    const store = secretStore(join(home, "secrets.json"));
    await store.put("k", "v");
    expect(await store.get("k")).toBe("v");
    expect((await stat(join(home, "secrets.json"))).mode & 0o777).toBe(0o600);
    await store.delete("k");
    expect(await store.get("k")).toBeUndefined();
  });
});

// Real host round-trip. Runs only where the OS secret store works (macOS, Windows, Linux with a
// Secret Service session); skipped with a message elsewhere, e.g. WSL without a keyring daemon.
const hostProbe = await openSecretStore(await mkdtemp(join(tmpdir(), "secrets-probe-")), { COGNATE_SECRET_STORE: "" }, { probeTimeoutMs: 4000 });
const hostNative = hostProbe.backend !== "file";
if (!hostNative) console.log(`secrets-store: skipping real native round-trip: ${hostProbe.reason}`);

describe.skipIf(!hostNative)("real OS secret store", () => {
  test("round-trips through Bun.secrets and cleans up", async () => {
    const scoped = await mkdtemp(join(tmpdir(), "secrets-real-"));
    try {
      const opened = await openSecretStore(scoped, { COGNATE_SECRET_STORE: "native" });
      expect(opened.backend).not.toBe("file");
      await opened.store.put("test:key", "real-value-1");
      expect(await opened.store.get("test:key")).toBe("real-value-1");
      await opened.store.delete("test:key");
      expect(await opened.store.get("test:key")).toBeUndefined();
    } finally {
      await rm(scoped, { recursive: true, force: true });
    }
  });
});
