// Journey J-WB-parallelism (V-006, V-007): concurrency is recommended from the dependency graph,
// not from a worker count. Independent components get separate ownership; shared tokens keep work
// sequential or architect-owned, with the shared resource named.
import { describe, expect, test } from "bun:test";
import type { ParallelPlan, WorkUnit } from "../src/workbench/parallelism.ts";
import { bootApp, inv, withTempHome } from "./wb-helpers.ts";

const unit = (id: string, over: Partial<WorkUnit>): WorkUnit => ({ id, ownedFiles: [], reads: [], tokens: [], rules: [], dependsOn: [], ...over });
const plan = async (client: Parameters<typeof inv>[0], units: WorkUnit[], maxConcurrency?: number) => (await inv(client, "parallelism.plan", { units, ...(maxConcurrency ? { maxConcurrency } : {}) })) as unknown as ParallelPlan;

describe("J-WB-parallelism", () => {
  test("V-006 and V-007", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        // V-006: two independent components get separate ownership in one group.
        const safe = await plan(client, [unit("worker-a", { ownedFiles: ["src/Hero.tsx"], tokens: ["hero"] }), unit("worker-b", { ownedFiles: ["src/Footer.tsx"], tokens: ["footer"] })]);
        expect(safe.recommendation).toBe("Parallel-safe");
        expect(safe.groups).toEqual([["worker-a", "worker-b"]]);
        expect(safe.architectOwned).toEqual([]);

        // V-007: both touch the shared stylesheet/tokens: warn, keep sequential, name the shared resource.
        const unsafe = await plan(client, [unit("worker-a", { ownedFiles: ["src/Hero.tsx"], tokens: ["styles.css"] }), unit("worker-b", { ownedFiles: ["src/Footer.tsx"], tokens: ["styles.css"] })]);
        expect(unsafe.recommendation).toMatch(/Shared dependency/);
        expect(unsafe.architectOwned).toContain("token:styles.css");
        expect(unsafe.sequential).toEqual(["worker-a", "worker-b"]);
        expect(unsafe.groups.every((g) => g.length === 1)).toBe(true);
        expect(unsafe.pairs[0]?.reasons.join(" ")).toContain("styles.css");

        // Provider quota: a concurrency limit splits an otherwise safe group.
        const limited = await plan(client, [unit("a", { ownedFiles: ["a"] }), unit("b", { ownedFiles: ["b"] }), unit("c", { ownedFiles: ["c"] })], 2);
        expect(limited.groups.map((g) => g.length)).toEqual([2, 1]);

        // A dependency orders units into later groups.
        const ordered = await plan(client, [unit("integrate", { ownedFiles: ["x"], dependsOn: ["a"] }), unit("a", { ownedFiles: ["a"] })]);
        const at = (id: string) => ordered.groups.findIndex((g) => g.includes(id));
        expect(at("a")).toBeLessThan(at("integrate"));
      } finally {
        await app.stop();
      }
    });
  }, 60_000);
});
