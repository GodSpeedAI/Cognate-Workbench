// Journey J-COG-cleanup: the cognitive-navigation proof, end to end on the real runtime with aimock.
// Desired difference: remove generated output and rebuild without losing uncommitted work.
// baseline world -> forked candidate world -> agent proposes `rm -rf generated` -> a lower-trust
// mod tries to waive approval -> Sentinel preserves it -> semantic preflight Surface on a durable
// continuation -> restart while open -> human allows -> consequence recorded -> frozen checks fail ->
// repair -> checks pass -> settlement reachable (not settled) -> human settles -> lineage survives.
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { userToyMod } from "../src/cognitive/sentinel.ts";
import { validateSurface } from "../src/cognitive/surface.ts";
import { foldLineage } from "../src/cognitive/world.ts";
import { reality, realityOfCheck } from "../src/cognitive/case.ts";
import { bootAimock, withTempHome } from "./helpers.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";

const clientFor = (app: AppServer) => createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
type Client = ReturnType<typeof clientFor>;
const sh = async (cwd: string, cmd: string) => { const p = Bun.spawn(["bash", "-lc", cmd], { cwd, stdout: "pipe", stderr: "pipe" }); await p.exited; };
const until = async (check: () => Promise<boolean>, ms = 15_000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error("condition not met in time"); };
const finish = async (app: AppServer, runId: string) => { for (let i = 0; i < 600; i++) { const r = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId }); if (["completed", "failed", "cancelled"].includes(r.status)) return r; await new Promise((x) => setTimeout(x, 25)); } throw new Error("run did not finish"); };
const allEvents = async (app: AppServer) => { const out = []; for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) out.push({ position: e.position, eventType: e.eventType, payload: (e.payload ?? {}) as Record<string, unknown> }); return out; };

describe("J-COG-cleanup", () => {
  test("desired difference -> governed candidate -> verified -> human-settled, restart-safe", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const mods = { extraMediators: [userToyMod()] };
      let app = await startServer({ devAuth: true, port: 0, home, ...mods });
      let client: Client = clientFor(app);
      try {
        // -- fixture repo (settled world Sₙ) -----------------------------------------------------
        const repo = join(home, "repo");
        await mkdir(join(repo, "generated"), { recursive: true });
        await writeFile(join(repo, "generated/a.txt"), "a");
        await writeFile(join(repo, "generated/b.txt"), "b");
        await writeFile(join(repo, "rebuild.txt"), "BROKEN");
        await writeFile(join(repo, "check.sh"), "grep -q FIXED rebuild.txt && test ! -e generated/a.txt\n");
        await sh(repo, "git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm base");
        await writeFile(join(repo, "generated/c.txt"), "uncommitted-1");
        await writeFile(join(repo, "generated/b.txt"), "b-edited");

        await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
        await client.invoke("case.open", { caseId: "C1", desiredOutcome: "remove generated output and rebuild without losing uncommitted work", unknowns: ["CI parity"] });
        const { criterionHash } = (await client.invoke("criterion.freeze", { caseId: "C1", spec: { version: 1, requiredChecks: ["rebuild-ok"], observed: ["rebuild"], unobserved: [], guardrails: [], protectedInvariants: ["settled-world-unchanged"] } })) as { criterionHash: string };
        const baseline = (await client.invoke("world.freeze", { caseId: "C1", kind: "baseline", worldId: "local", root: repo, criterionHash })) as { worldHash: string };
        expect(baseline.worldHash).toMatch(/^[0-9a-f]{64}$/);

        // -- fork: the candidate executes in its own execution world ------------------------------
        const fork = (await client.invoke("world.fork", { sourceRoot: repo, sandboxId: "sbx-1" })) as { sandboxId: string; root: string };
        const { workspaceId } = (await client.invoke("workspace.select", { path: fork.root, worldId: fork.sandboxId })) as { workspaceId: string };

        // -- agent proposes the destructive change; mediation + preflight + durable continuation ---
        const sessionId = randomUUID();
        const run1 = await client.startRun("agent.coding", { sessionId, workspaceId, caseId: "C1", message: "[[scenario:cleanup]] clean generated output" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
        await until(async () => (await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run1.runId })).some((c) => c.status === "OPEN"));
        const open = (await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run1.runId })).find((c) => c.status === "OPEN")!;
        const surface = validateSurface((open.payload as { surface: unknown }).surface);
        const pre = surface.blocks[0] as unknown as { type: string; impact: { key: string; value: string }[]; authority: string };
        expect(pre.type).toBe("preflight");
        expect(pre.authority).toBe("human-approval-required"); // the toy mod tried to waive it; Sentinel preserved it
        expect(pre.impact).toEqual([{ key: "Files", value: "3" }, { key: "Uncommitted", value: "2" }]);
        const findings = (await allEvents(app)).filter((e) => e.eventType === "sentinel.finding");
        expect(findings).toHaveLength(1);
        expect(findings[0]!.payload).toMatchObject({ invariant: "human-approval", action: "restored", culprits: ["user-toy-mod"] });
        expect(await readdir(join(fork.root, "generated"))).toHaveLength(3); // nothing executed yet

        // -- restart while the continuation is open ----------------------------------------------
        await app.stop();
        app = await startServer({ devAuth: true, port: 0, home, ...mods });
        client = clientFor(app);
        await client.invoke("world.attach", { sandboxId: fork.sandboxId, root: fork.root });
        const reopened = (await app.runtime.service.listContinuations(LOCAL_OPERATOR, { runId: run1.runId })).find((c) => c.status === "OPEN");
        expect(reopened?.id).toBe(open.id);
        await client.resolveContinuation(reopened!.id, "resume", { approved: true });
        expect((await finish(app, run1.runId)).status).toBe("completed");

        // consequence: the fork changed, the settled world did not
        expect(await readdir(fork.root)).not.toContain("generated");
        expect(await readdir(repo)).toContain("generated");
        const again = (await client.invoke("world.freeze", { caseId: "C1", kind: "baseline", worldId: "local", root: repo, criterionHash })) as { worldHash: string };
        expect(again.worldHash).toBe(baseline.worldHash); // identical content -> identical identity

        // -- candidate freeze + frozen checks fail -> deviation + next move ----------------------
        const checks = [{ id: "rebuild-ok", argv: ["bash", "check.sh"] }];
        const c1 = (await client.invoke("world.freeze", { caseId: "C1", kind: "candidate", worldId: fork.sandboxId, root: fork.root, parentWorldHash: baseline.worldHash, sandboxId: fork.sandboxId, criterionHash })) as { worldHash: string };
        expect(c1.worldHash).not.toBe(baseline.worldHash);
        await client.invoke("verification.run", { caseId: "C1", worldId: fork.sandboxId, root: fork.root, candidateHash: c1.worldHash, checks });
        let derived = (await client.invoke("case.derive", { caseId: "C1" })) as { case: any; reality: any[] };
        expect(derived.case.materialDeviation).toMatch(/rebuild-ok/);
        expect(derived.case.settlementReachable).toBe(false);
        expect(derived.case.field.primary).toBe("inspect-failure");
        expect(derived.case.field.blocked.find((b: any) => b.id === "settle").blockedBy).toContain("missing:verification.passed");

        // -- repair, re-freeze, re-verify: settlement reachable, NOT settled ---------------------
        const run2 = await client.startRun("agent.coding", { sessionId: randomUUID(), workspaceId, caseId: "C1", message: "[[scenario:repair]] fix the rebuild" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${randomUUID()}` });
        expect((await finish(app, run2.runId)).status).toBe("completed");
        expect(await readFile(join(fork.root, "rebuild.txt"), "utf8")).toBe("FIXED");
        const c2 = (await client.invoke("world.freeze", { caseId: "C1", kind: "candidate", worldId: fork.sandboxId, root: fork.root, parentWorldHash: baseline.worldHash, sandboxId: fork.sandboxId, criterionHash })) as { worldHash: string };
        expect(c2.worldHash).not.toBe(c1.worldHash);
        await client.invoke("verification.run", { caseId: "C1", worldId: fork.sandboxId, root: fork.root, candidateHash: c2.worldHash, checks });
        derived = (await client.invoke("case.derive", { caseId: "C1" })) as { case: any; reality: any[] };
        expect(derived.case.settlementReachable).toBe(true);
        expect(derived.case.currentState).toBe("candidate");
        expect(derived.case.candidateWorldHash).toBe(c2.worldHash);
        expect(derived.case.optionalRemaining.map((o: any) => o.id)).toContain("fresh-context-critic");
        expect(foldLineage(await allEvents(app)).settledHead).toBe(baseline.worldHash);

        // -- authority: a stale/unknown candidate is refused; the human settles --------------------
        await expect(client.invoke("world.settle", { caseId: "C1", candidateHash: c1.worldHash })).rejects.toThrow(/refused/);
        await client.invoke("world.settle", { caseId: "C1", candidateHash: c2.worldHash });

        // -- restart: lineage, Case, Reality reconstruct from events ------------------------------
        await app.stop();
        app = await startServer({ devAuth: true, port: 0, home, ...mods });
        client = clientFor(app);
        const evs = await allEvents(app);
        const lineage = foldLineage(evs);
        expect(lineage.settledHead).toBe(c2.worldHash);
        expect(lineage.worlds.get(c2.worldHash)).toMatchObject({ status: "settled", parentWorldHash: baseline.worldHash, settledFromCandidate: true });
        expect(lineage.worlds.get(baseline.worldHash)?.status).toBe("settled");
        expect(realityOfCheck(evs, "rebuild-ok")).toBe("passed");
        const order = reality(evs).map((f) => f.eventType);
        const idx = (t: string, from = 0) => order.indexOf(t, from);
        expect(idx("world.baseline.frozen")).toBeLessThan(idx("sentinel.finding"));
        expect(idx("sentinel.finding")).toBeLessThan(idx("tool.approval.decided"));
        expect(idx("tool.approval.decided")).toBeLessThan(idx("world.candidate.frozen"));
        expect(order.lastIndexOf("world.settled")).toBe(order.length - 1);
        expect(reality(evs).some((f) => /assistant|message/.test(f.eventType))).toBe(false);
        derived = (await client.invoke("case.derive", { caseId: "C1" })) as { case: any; reality: any[] };
        expect(derived.case.currentState).toBe("settled");
        await client.invoke("world.discard", { sandboxId: fork.sandboxId, root: fork.root }).catch(() => undefined);
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 120_000);
});
