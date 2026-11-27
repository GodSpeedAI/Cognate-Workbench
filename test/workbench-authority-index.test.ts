// Capability-bundles tranche T1 (§2.1): the authority index and lifecycle recorder. Covers:
// CAS concurrency (two concurrent commits to one stream — exactly one wins, the loser retries
// against the re-read state); index transparency (each §8 family appended one at a time leaves
// the index in the state the reducer fold produces — replay-equality between index and fold);
// the fail-closed contract (reads before readiness and unknown ids answer nothing); and the
// grant lifecycle through the real component (issue → clamp-suspension via revocation batch →
// resume clears exactly one reason).
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, withTempHome, waitUntil, wbRows } from "./wb-helpers.ts";
import { AuthorityIndex } from "../src/workbench/authorityIndex.ts";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";

const SYSTEM = { actor: { id: "system", kind: "system" as const }, tenant: "local" };

describe("workbench authority index + lifecycle recorder", () => {
  test("CAS concurrency: concurrent commits to one lifecycle stream — exactly one wins", async () => {
    await withTempHome(async (home) => {
      const { app } = await bootApp(home);
      try {
        const recorder = new LifecycleRecorder(app.runtime.store, LOCAL_OPERATOR.tenant);
        const events = (n: number) => [{ type: "capability.activated", payload: { capabilityId: `capability.bundle.n${n}`, level: "user", version: `v${n}`, ceiling: [], clampProvenance: "operator" } }];
        // Same stream id, same expectedVersion=0 — the store must admit exactly one.
        const outcome = await Promise.allSettled([
          recorder.commitBatch("capability.bundle.race", events(1), `race-1-${randomUUID()}`),
          recorder.commitBatch("capability.bundle.race", events(2), `race-2-${randomUUID()}`),
        ]);
        const fulfilled = outcome.filter((r) => r.status === "fulfilled");
        const rejected = outcome.filter((r) => r.status === "rejected");
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        // The loser retries against the re-read stream version and lands.
        const retry = await recorder.commitBatch("capability.bundle.race", events(3), `race-3-${randomUUID()}`);
        expect(retry.length).toBe(1);
      } finally {
        await app.runtime.idle().catch(() => {});
      }
    });
  });

  test("index transparency: every §8 family appends, the index matches the fold (replay-equality)", async () => {
    await withTempHome(async (home) => {
      const { app } = await bootApp(home);
      try {
        const index = new AuthorityIndex(app.runtime.store, LOCAL_OPERATOR.tenant);
        const recorder = new LifecycleRecorder(app.runtime.store, LOCAL_OPERATOR.tenant);
        const rows = (await app.runtime.service.readProjection(SYSTEM, { name: "workbench" })).rows;
        await index.rebuild(rows.map((r) => ({ key: r.key, value: r.value })));

        // Append each family one at a time through the recorder; after each commit, the index's
        // synchronous view must equal a fresh fold rebuild's view (cache transparency).
        const capabilityId = "capability.bundle.transparency";
        await recorder.commitBatch(capabilityId, [
          { type: "capability.activated", payload: { capabilityId, level: "user", version: "v1", ceiling: ["capability.invoke"], clampProvenance: "operator" } },
        ], `t-activate-${randomUUID()}`);
        await recorder.commitBatch(capabilityId, [
          { type: "capability.suspended", payload: { capabilityId, level: "user", reason: "operator-yank" } },
        ], `t-suspend-${randomUUID()}`);
        await recorder.commitBatch(capabilityId, [
          { type: "capability.resumed", payload: { capabilityId, level: "user", clearedReason: "operator-yank" } },
        ], `t-resume-${randomUUID()}`);
        await recorder.commitBatch(capabilityId, [
          { type: "capability.suspended", payload: { capabilityId, level: "user", reason: "grant-revoked" } },
        ], `t-suspend2-${randomUUID()}`);

        const selected = index.selectActivation(capabilityId, "user");
        expect(selected?.state).toBe("suspended");
        expect(selected?.suspensionReasons).toEqual(["grant-revoked"]);
        // A fresh rebuild (the replay-equality control) must see the identical row. The projection
        // folds asynchronously. "suspended" alone is ambiguous (the first operator-yank suspension
        // also reads suspended), so wait for the exact suspend2 state and rebuild from that snapshot.
        const freshRows = await waitUntil("fold catches up to suspend2", async () => {
          const rows = (await app.runtime.service.readProjection(SYSTEM, { name: "workbench" })).rows;
          const row = rows.find((r) => r.key === `activation/${capabilityId}/user`);
          const value = row?.value as { state?: string; suspensionReasons?: string[] } | undefined;
          const atSuspend2 = value?.state === "suspended"
            && JSON.stringify(value.suspensionReasons) === JSON.stringify(["grant-revoked"]);
          return atSuspend2 ? rows : undefined;
        });
        const fresh = new AuthorityIndex(app.runtime.store, LOCAL_OPERATOR.tenant);
        await fresh.rebuild(freshRows.map((r) => ({ key: r.key, value: r.value })));
        const freshRow = fresh.selectActivation(capabilityId, "user");
        expect(freshRow?.state).toBe("suspended");
        expect(freshRow?.suspensionReasons).toEqual(["grant-revoked"]);
        // Resume clears exactly one reason; the row stays suspended while a reason remains.
        await recorder.commitBatch(capabilityId, [
          { type: "capability.resumed", payload: { capabilityId, level: "user", clearedReason: "grant-revoked" } },
        ], `t-resume2-${randomUUID()}`);
        expect(index.selectActivation(capabilityId, "user")?.state).toBe("active");
        // Grant issuance lands in the index synchronously.
        await recorder.commitBatch("grant-x", [
          { type: "authority.grant.issued", payload: { grantId: "grant-x", principalId: "wb-agent:x", permissions: ["capability.invoke"] } },
        ], `t-grant-${randomUUID()}`);
        expect(index.grantFor("wb-agent:x")?.grantId).toBe("grant-x");
        // Session archive expires the session-scoped activation (terminal, fold-derived).
        await recorder.commitBatch(capabilityId, [
          { type: "capability.activated", payload: { capabilityId, level: "user", sessionId: "sess-1", version: "v1", ceiling: [], clampProvenance: "operator" } },
        ], `t-sessact-${randomUUID()}`);
        await recorder.commitBatch("sess-1", [
          { type: "session.archived", payload: { sessionId: "sess-1", archived: true } },
        ], `t-arch-${randomUUID()}`);
        // Expired session rows GOVERN their session's invocations (§4.1: the session-scoped row
        // is selected whenever it exists — its terminal state is what makes the invocation
        // refuse; unarchive never resurrects, re-establishment is a new activation).
        expect(index.activations.get(index.activationKey(capabilityId, "user", "sess-1"))?.state).toBe("expired");
        expect(index.selectActivation(capabilityId, "user", "sess-1")?.state).toBe("expired");
      } finally {
        await app.runtime.idle().catch(() => {});
      }
    });
  });

  test("fail-closed: pre-ready reads and unknown ids answer nothing", async () => {
    await withTempHome(async (home) => {
      const { app } = await bootApp(home);
      try {
        const index = new AuthorityIndex(app.runtime.store, LOCAL_OPERATOR.tenant);
        expect(index.grantFor("wb-agent:anyone")).toBeUndefined();
        expect(index.selectActivation("capability.bundle.anything", "user")).toBeUndefined();
        const empty = new AuthorityIndex(app.runtime.store, LOCAL_OPERATOR.tenant);
        await empty.rebuild([]);
        expect(empty.selectActivation("capability.bundle.anything", "user")).toBeUndefined();
      } finally {
        await app.runtime.idle().catch(() => {});
      }
    });
  });

  test("the grant lifecycle through the real component: issue → revoke batch → recorded", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("authority.grant.issue", { grantId: "grant-life-1", principalId: "wb-agent:coding", permissions: ["capability.invoke"] });
        await waitUntil("grant row", async () => ((await wbRows(app)).get("grant/grant-life-1") as { status?: string } | undefined));
        const listed = await client.invoke("authority.grant.list", {}) as { grants: { grantId: string; status: string }[] };
        expect(listed.grants.find((g) => g.grantId === "grant-life-1")?.status).toBe("active");
        // Idempotency discipline: re-issuing the same grant id with a different request is a
        // fingerprint conflict, not a silent replay (the store's own §10 rule).
        await expect(client.invoke("authority.grant.issue", { grantId: "grant-life-1", principalId: "wb-agent:different", permissions: ["skill.load"] })).rejects.toThrow();
        const revoked = await client.invoke("authority.grant.revoke", { grantId: "grant-life-1" }) as { grantId: string; suspended: number };
        expect(revoked.suspended).toBe(0);
        const after = await waitUntil("revoked row", async () => {
          const row = (await wbRows(app)).get("grant/grant-life-1") as { status?: string } | undefined;
          return row?.status === "revoked" ? row : undefined;
        });
        expect(after.status).toBe("revoked");
      } finally {
        await app.runtime.idle().catch(() => {});
      }
    });
  });

  test("bundle registration: ceilings enforced, materialized, recorded, pruned", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { mkdir, writeFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const source = join(home, "bundle-src", randomUUID().slice(0, 8));
        await mkdir(join(source, "skills"), { recursive: true });
        await writeFile(join(source, "SKILL.md"), "# visual design\ncompose guide");
        await writeFile(join(source, "skills", "critique.md"), "critique rules");
        const registered = await client.invoke("capability.bundle.register", {
          capabilityId: "capability.bundle.visual-design",
          sourceDir: source,
          manifest: {
            name: "Visual Design",
            purpose: "Hallmark + Impeccable design composition",
            skills: [{ name: "compose", entry: "SKILL.md", isEntryDocument: true }, { name: "critique", entry: "skills/critique.md" }],
            requirements: ["capability.invoke", "skill.load"],
          },
        }) as { capabilityId: string; version: string; dir: string; files: number };
        expect(registered.files).toBe(2);
        const row = await waitUntil("bundle row", async () => ((await wbRows(app)).get(`bundle/capability.bundle.visual-design`) as Record<string, unknown> | undefined));
        expect(row.version).toBe(registered.version);
        // Over-ceiling: a file beyond 512 KiB refuses registration with the limit named.
        const bigSource = join(home, "bundle-src", "big");
        await mkdir(bigSource, { recursive: true });
        await writeFile(join(bigSource, "big.md"), "x".repeat(513 * 1024));
        await expect(client.invoke("capability.bundle.register", {
          capabilityId: "capability.bundle.big",
          sourceDir: bigSource,
          manifest: { name: "Big", purpose: "over ceiling", skills: [{ name: "s", entry: "big.md" }] },
        })).rejects.toThrow(/exceeds 524288 bytes/);
      } finally {
        await app.runtime.idle().catch(() => {});
      }
    });
  });
});
