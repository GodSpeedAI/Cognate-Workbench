// Journey J-COG-realitytrace: evidence that affects settlement (verification observations, world
// lineage, Sentinel findings) rides the existing RealityTrace outbox and is delivered live to the
// pinned SXR CLI — no second evidence system. FAILS (not skips) without the binary.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";

const SXR_BIN = process.env.SXR_BIN ?? join(import.meta.dir, "..", ".tmp", "realitytrace", "bin", "realitytrace");

describe("J-COG-realitytrace", () => {
  test("verification + lineage facts are delivered to RealityTrace with correlation ids", async () => {
    if (!existsSync(SXR_BIN)) throw new Error(`RealityTrace CLI not found at ${SXR_BIN}; run \`just setup-realitytrace\`.`);
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await client.invoke("settings.changePlugin", { plugins: { realitytrace: true } });
        const repo = join(home, "repo");
        await mkdir(repo, { recursive: true });
        await writeFile(join(repo, "a.txt"), "a");
        await client.invoke("case.open", { caseId: "R1", desiredOutcome: "evidence reaches RealityTrace" });
        const { criterionHash } = (await client.invoke("criterion.freeze", { caseId: "R1", spec: { version: 1, requiredChecks: ["unit"], observed: ["x"], unobserved: [], guardrails: [], protectedInvariants: [] } })) as { criterionHash: string };
        const base = (await client.invoke("world.freeze", { caseId: "R1", kind: "baseline", worldId: "local", root: repo, criterionHash })) as { worldHash: string };
        await writeFile(join(repo, "a.txt"), "b");
        const cand = (await client.invoke("world.freeze", { caseId: "R1", kind: "candidate", worldId: "local", root: repo, parentWorldHash: base.worldHash, criterionHash })) as { worldHash: string };
        await client.invoke("verification.run", { caseId: "R1", worldId: "local", root: repo, candidateHash: cand.worldHash, checks: [{ id: "unit", argv: ["false"] }] });

        const eventIds: string[] = [];
        for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) if (["verification.observed", "world.baseline.frozen", "world.candidate.frozen"].includes(e.eventType)) eventIds.push(e.eventId);
        expect(eventIds).toHaveLength(3);

        const deadline = Date.now() + 60_000;
        let statuses: readonly { eventId: string; state?: string; targetRef?: string | null }[] = [];
        for (;;) {
          statuses = ((await client.invoke("observation.status", { eventIds } as never)) as unknown as { statuses: typeof statuses }).statuses;
          if (statuses.length === 3 && statuses.every((s) => s.state === "accepted" || s.state === "duplicate")) break;
          if (Date.now() > deadline) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        expect(statuses.map((s) => s.state)).toEqual(["accepted", "accepted", "accepted"]);
        const record = (await client.invoke("observation.record", { targetRef: statuses[0]!.targetRef } as never)) as unknown as { correlation: { eventId?: string } | null };
        expect(record.correlation?.eventId).toBe(statuses[0]!.eventId);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);
});
