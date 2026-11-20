// Journey J-COG-AFFORDANCE-field (CognitiveOS convergence 3 · #111): the bounded read capability
// that exposes a Case's current affordance field. Read-only by construction: it folds durable case
// events through the EXISTING resolver (`deriveCase` -> `resolveAffordances`) over the fixed
// `CASE_OPERATIONS` catalogue — no store, no second catalogue, no mutation. Blocked moves carry the
// resolver's own reasons, an unknown Case is refused, and an evaluated move named without an
// applicable Frozen Criterion is refused rather than reported as reachable.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { bootApp, withTempHome } from "./helpers.ts";

describe("J-COG-AFFORDANCE-field", () => {
  test("no criterion: eligible moves are current, the rest are blocked with resolver reasons; evaluated move without a criterion is refused", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const repo = join(home, "repo");
        await mkdir(repo, { recursive: true });
        await writeFile(join(repo, "a.txt"), "a");

        await client.invoke("case.open", { caseId: "F1", desiredOutcome: "expose the bounded affordance field" });
        const baseline = (await client.invoke("world.freeze", { caseId: "F1", kind: "baseline", worldId: "local", root: repo })) as { worldHash: string };
        expect(baseline.worldHash).toMatch(/^[0-9a-f]{64}$/);

        // -- no Frozen Criterion: only moves whose preconditions hold are current -------------------
        const field = (await client.invoke("affordance.field", { caseId: "F1" })) as any;
        expect(field.current.map((a: any) => a.id)).toEqual(["propose-change"]);
        expect(field.primary).toBe("propose-change"); // at most one dominant maneuver
        expect(field.current.filter((a: any) => a.id === field.primary)).toHaveLength(1);
        // The rest come from the existing resolver, with intelligible reasons and the unblocking move.
        const run = field.blocked.find((b: any) => b.id === "run-verification");
        expect(run.blockedBy).toEqual(expect.arrayContaining(["missing:candidate.exists", "missing:criterion.frozen"]));
        expect(run.reachableNow).toBe("propose-change");
        expect(field.blocked.find((b: any) => b.id === "settle").blockedBy).toContain("missing:verification.passed");
        expect(field.blocked.find((b: any) => b.id === "inspect-failure").blockedBy).toContain("missing:verification.failed");

        // -- refusals: unknown case; evaluated move with no applicable criterion; unbounded operation --
        await expect(client.invoke("affordance.field", { caseId: "ghost" })).rejects.toThrow(/unknown case ghost/);
        await expect(client.invoke("affordance.field", { caseId: "F1", operation: "run-verification" })).rejects.toThrow(/evaluated move and no frozen criterion/);
        await expect(client.invoke("affordance.field", { caseId: "F1", operation: "do-something-else" })).rejects.toThrow(/unknown operation do-something-else/);
        // A non-evaluated move resolves normally (the catalogue is the bound, not a caller list).
        expect(((await client.invoke("affordance.field", { caseId: "F1", operation: "propose-change" })) as any).primary).toBe("propose-change");
        // Capability unavailability is surfaced by the resolver, never invented here.
        const narrowed = (await client.invoke("affordance.field", { caseId: "F1", availableCapabilities: [] })) as any;
        expect(narrowed.current).toHaveLength(0);
        expect((narrowed.blocked.find((b: any) => b.id === "propose-change") as any).blockedBy).toContain("capability-unavailable:tool.edit");

        // -- with a Frozen Criterion the field matches case.derive exactly (one resolver, no fork) ---
        const { criterionHash } = (await client.invoke("criterion.freeze", { caseId: "F1", spec: { version: 1, requiredChecks: ["unit"], observed: [], unobserved: [], guardrails: [], protectedInvariants: [] } })) as { criterionHash: string };
        const withCriterion = (await client.invoke("affordance.field", { caseId: "F1" })) as any;
        expect((withCriterion.blocked.find((b: any) => b.id === "run-verification") as any).blockedBy).not.toContain("missing:criterion.frozen");
        const derived = (await client.invoke("case.derive", { caseId: "F1" })) as any;
        expect(withCriterion).toEqual(derived.case.field);
        // An evaluated move under an applicable criterion resolves rather than refusing.
        expect(((await client.invoke("affordance.field", { caseId: "F1", operation: "run-verification" })) as any).blocked.some((b: any) => b.id === "run-verification")).toBe(true);

        // -- authority: a passing candidate makes settle current with its human-authority requirement --
        await writeFile(join(repo, "a.txt"), "b");
        const candidate = (await client.invoke("world.freeze", { caseId: "F1", kind: "candidate", worldId: "local", root: repo, parentWorldHash: baseline.worldHash, criterionHash })) as { worldHash: string };
        await client.invoke("verification.run", { caseId: "F1", worldId: "local", root: repo, candidateHash: candidate.worldHash, checks: [{ id: "unit", argv: ["true"] }] });
        const settled = (await client.invoke("affordance.field", { caseId: "F1" })) as any;
        const settleMove = settled.current.find((a: any) => a.id === "settle");
        expect(settleMove?.authorityRequired).toBe(true);
        expect(settled.primary).toBe("run-verification"); // highest-priority eligible move, still just one
      } finally {
        await app.stop();
      }
    });
  }, 180_000);
});
