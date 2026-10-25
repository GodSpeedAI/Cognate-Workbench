/**
 * A restart must not revive what the previous process issued. The durable ledgers (device records and
 * identity sessions) outlive the process; the pairing generation does not. A new MobileRemote over the
 * same store must open a generation above every stored one, revoke the stale device and its session,
 * refuse the old cookie, and keep start() idempotent while running.
 */
import { describe, expect, test } from "bun:test";
import { ServiceError } from "@godspeedai/cognate-runtime-api";
import { MobileRemote, REMOTE_COOKIE, REMOTE_SESSION_TTL_MS } from "../src/remote/mobile.ts";
import { mutateRemoteState, readRemoteState, type RemoteDevice } from "../src/remote/state.ts";
import { ensureIdentity, issueSession } from "../src/auth/identity.ts";

const SYSTEM = { tenant: "local", actor: { id: "system", kind: "system" } } as const;

/** A shared-state store with the compare-and-set semantics the ledgers rely on. Nothing else is needed. */
function memoryService() {
  const threads = new Map<string, { state: unknown; version: number }>();
  return {
    readSharedState: async (_caller: unknown, { threadId }: { threadId: string }) => threads.get(threadId) ?? { state: {}, version: 0 },
    updateSharedState: async (_caller: unknown, { threadId, update, expectedVersion }: { threadId: string; update: { snapshot: unknown }; expectedVersion: number }) => {
      const current = threads.get(threadId) ?? { state: {}, version: 0 };
      if (current.version !== expectedVersion) {
        throw new ServiceError("failed_precondition", "version moved");
      }
      const next = { state: update.snapshot, version: current.version + 1 };
      threads.set(threadId, next);
      return next;
    },
  };
}

function hostOver(service: ReturnType<typeof memoryService>, operatorIdentityId: string) {
  return { service, system: SYSTEM, operatorIdentityId, assets: async () => ({ js: "", css: "" }) } as never;
}

const portOf = (remote: MobileRemote) => (remote as unknown as { port: number }).port;

const device = (port: number, cookie: string | undefined, path: string) =>
  new Request(`http://localhost:${port}${path}`, { headers: { host: `localhost:${port}`, ...(cookie ? { cookie } : {}) } });

describe("restart", () => {
  test("a new process over the same store refuses the old device cookie and revokes its session", async () => {
    const service = memoryService();
    const identity = await ensureIdentity(service as never, SYSTEM, { tenant: "local", actorId: "operator" });
    const first = new MobileRemote(hostOver(service, identity.id), { port: 0 });
    await first.start();
    const oldGeneration = first.pairing.generation;

    // A paired phone from the first process: an active device record and its identity session.
    const issued = await issueSession(service as never, SYSTEM, { identityId: identity.id, ttlMs: REMOTE_SESSION_TTL_MS, cause: "test" });
    await mutateRemoteState(service as never, SYSTEM, (draft) => {
      const record: RemoteDevice = { id: "device-old", label: "Old phone", credentialId: "cred-old", publicKey: "", signCount: 0, generation: oldGeneration, sid: issued.session.sid, pairedAt: new Date().toISOString(), lastSeenAt: null, revokedAt: null };
      draft.devices[record.id] = record;
    });
    const cookie = `${REMOTE_COOKIE}=${issued.token}`;
    expect((await first.handle(device(portOf(first), cookie, "/m/api/device"))).status).toBe(200);

    // The process dies without stopping: the second process starts over the same stored ledgers.
    const second = new MobileRemote(hostOver(service, identity.id), { port: 0 });
    try {
      await second.start();
      expect(second.pairing.generation).toBeGreaterThan(oldGeneration);
      const refused = await second.handle(device(portOf(second), cookie, "/m/api/device"));
      expect(refused.status).toBe(401);
      expect((await second.status()).state).toBe("waiting");

      const { state } = await readRemoteState(service as never, SYSTEM);
      expect(state.devices["device-old"]?.revokedAt).not.toBeNull();
      expect(state.devices["device-old"]?.sid).toBeNull();
    } finally {
      await second.stop();
      await first.stop();
    }
  });

  test("start while running changes nothing: same generation, same link", async () => {
    const service = memoryService();
    const identity = await ensureIdentity(service as never, SYSTEM, { tenant: "local", actorId: "operator" });
    const remote = new MobileRemote(hostOver(service, identity.id), { port: 0 });
    try {
      const before = await remote.start();
      const again = await remote.start();
      expect(again.generation).toBe(before.generation);
      expect(again.link).toBe(before.link);
    } finally {
      await remote.stop();
    }
  });
});
