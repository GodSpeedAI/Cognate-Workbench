// Journey J-COG-liveverify: LiveVerify end to end. Inside a Case that declared its checks, an agent
// edit causes the candidate world to be frozen and the checks to run with no manual step; a failure
// moves the Case's deviation and next move; the repair re-verifies; settlement becomes reachable.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, bootAimock, withTempHome } from "./helpers.ts";

describe("J-COG-liveverify", () => {
  test("agent edit -> automatic candidate freeze + verification -> deviation -> repair -> reachable", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const { app, client } = await bootApp(home);
      try {
        const repo = join(home, "repo");
        await mkdir(repo, { recursive: true });
        await writeFile(join(repo, "rebuild.txt"), "BROKEN");
        await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
        const { workspaceId } = (await client.invoke("workspace.select", { path: repo })) as { workspaceId: string };
        await client.invoke("case.open", { caseId: "L1", desiredOutcome: "rebuild output is correct", checks: [{ id: "rebuild-ok", argv: ["bash", "-c", "grep -q FIXED rebuild.txt"] }] });
        const { criterionHash } = (await client.invoke("criterion.freeze", { caseId: "L1", spec: { version: 1, requiredChecks: ["rebuild-ok"], observed: ["rebuild"], unobserved: [], guardrails: [], protectedInvariants: [] } })) as { criterionHash: string };
        await client.invoke("world.freeze", { caseId: "L1", kind: "baseline", worldId: "local", root: repo, criterionHash });

        const types = async () => { const out: string[] = []; for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) out.push(e.eventType); return out; };
        const turn = async (message: string) => {
          const sessionId = randomUUID();
          const run = await client.startRun("agent.coding", { sessionId, workspaceId, caseId: "L1", message } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
          for (let i = 0; i < 600; i++) { const r = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId: run.runId }); if (r.status === "completed") return; if (r.status === "failed") throw new Error("run failed: " + JSON.stringify(r).slice(0, 700)); await new Promise((x) => setTimeout(x, 25)); }
          throw new Error("timeout");
        };
        const derive = async () => (await client.invoke("case.derive", { caseId: "L1" })) as { case: any };

        expect((await types()).includes("verification.observed")).toBe(false); // nothing observed before any change

        await turn("[[scenario:break]] change the rebuild file");
        let d = await derive();
        expect(d.case.materialDeviation).toMatch(/1 required check failed: rebuild-ok/);
        expect(d.case.field.primary).toBe("inspect-failure");
        expect(d.case.settlementReachable).toBe(false);
        const failedHash = d.case.candidateWorldHash;

        await turn("[[scenario:mend]] fix it");
        d = await derive();
        expect(d.case.candidateWorldHash).not.toBe(failedHash);
        expect(d.case.materialDeviation).toBeUndefined();
        expect(d.case.settlementReachable).toBe(true);
        expect(d.case.currentState).toBe("candidate"); // reachable, not settled
        const t = await types();
        expect(t.filter((x) => x === "verification.observed")).toHaveLength(2);
        expect(t.includes("world.settled")).toBe(false);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 90_000);
});
