// Journey J-COG-search: bounded candidate search + method review.
// A frozen parent world and criterion; several isolated candidate rounds; failed candidates are
// discarded and stay rejected; the best is retained but NEVER settled automatically; a recurring
// residual yields a candidate-only MethodRecommendation; the active methodHash moves only on an
// explicit human decision.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { foldLineage } from "../src/cognitive/world.ts";
import { foldSearch, type ExperimentRound } from "../src/cognitive/experiment.ts";
import { withTempHome } from "./helpers.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";

const clientFor = (app: AppServer) => createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
const events = async (app: AppServer) => { const out: { position: number; eventType: string; payload: any }[] = []; for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) out.push({ position: e.position, eventType: e.eventType, payload: e.payload }); return out; };

describe("J-COG-search", () => {
  test("bounded rounds, discard/retain, no auto-settlement, recommendation without promotion", async () => {
    await withTempHome(async (home) => {
      let app = await startServer({ port: 0, home });
      let client = clientFor(app);
      try {
        const repo = join(home, "repo");
        await mkdir(repo, { recursive: true });
        await writeFile(join(repo, "score.txt"), "1");
        await writeFile(join(repo, "guard.sh"), "test -f score.txt\n");
        await client.invoke("case.open", { caseId: "S1", desiredOutcome: "reduce rebuild failures" });
        const { criterionHash } = (await client.invoke("criterion.freeze", { caseId: "S1", spec: { version: 1, requiredChecks: ["score"], observed: ["rebuild"], unobserved: [], guardrails: ["guard.sh"], protectedInvariants: [] } })) as { criterionHash: string };
        const baseline = (await client.invoke("world.freeze", { caseId: "S1", kind: "baseline", worldId: "local", root: repo, criterionHash })) as { worldHash: string };
        const method0 = ((await client.invoke("method.active", {})) as { methodHash: string }).methodHash;

        // eligibility is earned: with a frozen criterion and baseline it is available
        const status = (await client.invoke("experiment.status", { caseId: "S1", maxRounds: 5 })) as { eligibility: { available: boolean } };
        expect(status.eligibility.available).toBe(true);

        const round = (roundId: string, apply: string, residual?: string, invariant = "bash guard.sh") =>
          client.invoke("experiment.round", { caseId: "S1", roundId, hypothesis: `h-${roundId}`, sourceRoot: repo, baselineHash: baseline.worldHash, applyArgv: ["bash", "-c", apply], scoreArgv: ["cat", "score.txt"], invariantArgv: invariant.split(" "), maxRounds: 5, ...(residual ? { residual } : {}) }) as Promise<{ result: string; decision: string; candidateHash: string }>;

        const r1 = await round("r1", "echo 4 > score.txt", "disconnected from application path");
        const r2 = await round("r2", "echo 2 > score.txt", "disconnected from application path"); // regression vs best
        const r3 = await round("r3", "rm score.txt", undefined);                                   // violates guard -> invalid
        const r4 = await round("r4", "echo 6 > score.txt");                                         // improvement
        expect([r1.result, r2.result, r3.result, r4.result]).toEqual(["improved", "regressed", "invalid", "improved"]);
        expect([r1.decision, r2.decision, r3.decision, r4.decision]).toEqual(["retain", "discard", "escalate", "retain"]);

        const evs = await events(app);
        const rounds = evs.filter((e) => e.eventType === "experiment.round.completed").map((e) => e.payload as ExperimentRound);
        expect(rounds.map((r) => r.roundId)).toEqual(["r1", "r2", "r3", "r4"]);
        expect(rounds.every((r) => r.parentWorldHash === baseline.worldHash && r.criterionHash === criterionHash && r.methodHash === method0)).toBe(true);
        expect(foldSearch(rounds).bestRound?.roundId).toBe("r4");

        // the parent was never mutated; nothing settled; discarded candidates stay rejected
        expect(await readFile(join(repo, "score.txt"), "utf8")).toBe("1");
        const lineage = foldLineage(evs);
        expect(lineage.settledHead).toBe(baseline.worldHash);
        expect(lineage.rejected.has(r2.candidateHash)).toBe(true);
        expect(lineage.worlds.get(r4.candidateHash)?.status).toBe("candidate");
        expect(evs.some((e) => e.eventType === "world.settled")).toBe(false);

        // budget is enforced
        await round("r5", "echo 7 > score.txt");
        await expect(round("r6", "echo 8 > score.txt")).rejects.toThrow(/budget/); // 5 rounds max

        // method review: candidate recommendation only; active method unchanged
        const review = (await client.invoke("method.review", { caseId: "S1", scope: "cross-cutting feature changes" })) as { recommendations: { id: string; status: string; active: boolean; supporting: string[]; contradicting: string[] }[]; activeMethodHash: string };
        expect(review.recommendations).toHaveLength(1);
        expect(review.recommendations[0]).toMatchObject({ status: "candidate", active: false, supporting: ["r1", "r2"] });
        expect(review.recommendations[0]!.contradicting.length).toBeGreaterThan(0);
        expect(((await client.invoke("method.active", {})) as { methodHash: string }).methodHash).toBe(method0);
        expect((await client.invoke("method.review", { caseId: "S1", scope: "x" })) as unknown).toBeDefined(); // idempotent: no duplicate recommendation events
        expect((await events(app)).filter((e) => e.eventType === "method.recommended")).toHaveLength(1);

        // restart: rounds, lineage and the unchanged active method reconstruct from events
        await app.stop();
        app = await startServer({ port: 0, home });
        client = clientFor(app);
        expect(((await client.invoke("method.active", {})) as { methodHash: string }).methodHash).toBe(method0);
        expect(foldSearch((await events(app)).filter((e) => e.eventType === "experiment.round.completed").map((e) => e.payload as ExperimentRound)).bestRound?.score).toBe(7);

        // only an explicit human decision moves the active method
        const accepted = (await client.invoke("method.accept", { recommendationId: review.recommendations[0]!.id, method: { v: 2, rule: "require reachability evidence" } })) as { methodHash: string };
        expect(accepted.methodHash).not.toBe(method0);
        expect(((await client.invoke("method.active", {})) as { methodHash: string }).methodHash).toBe(accepted.methodHash);
        expect((await events(app)).find((e) => e.eventType === "method.accepted")!.payload).toMatchObject({ previousMethodHash: method0, acceptedBy: LOCAL_OPERATOR.actor.id });
        // the criterion in force is unchanged by any of it
        const status2 = (await client.invoke("experiment.status", { caseId: "S1", maxRounds: 9 })) as { criterionHash: string };
        expect(status2.criterionHash).toBe(criterionHash);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);
});
