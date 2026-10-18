// Journey J-COG-attention: human attention becomes machine-readable semantic context without
// becoming authority or truth. The human focuses a failed verification row; the user types only
// "why did this fail?"; the agent resolves "this" through ui_context (no DOM, no screenshot, no
// prompt injection), explains the *recorded* failure, and asks the console for a timeline Surface.
// Focus switching changes the answer; inspection changes no authoritative state.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { bootAimock, withTempHome } from "./helpers.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";

const clientFor = (app: AppServer) => createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
const events = async (app: AppServer) => { const out: { position: number; eventType: string; payload: any }[] = []; for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) out.push({ position: e.position, eventType: e.eventType, payload: e.payload }); return out; };
const finish = async (app: AppServer, runId: string) => { for (let i = 0; i < 600; i++) { const r = await app.runtime.service.getRun(LOCAL_OPERATOR, { runId }); if (["completed", "failed", "cancelled"].includes(r.status)) return r; await new Promise((x) => setTimeout(x, 25)); } throw new Error("run did not finish"); };
const AUTHORITATIVE = new Set(["case.opened", "criterion.frozen", "world.baseline.frozen", "world.candidate.frozen", "world.settled", "verification.observed", "sentinel.finding"]);

describe("J-COG-attention", () => {
  test("'why did this fail?' resolves from focused evidence; switching focus switches the answer; inspection is read-only", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const app = await startServer({ devAuth: true, port: 0, home });
      const client = clientFor(app);
      try {
        const repo = join(home, "repo");
        await mkdir(repo, { recursive: true });
        await writeFile(join(repo, "a.txt"), "a");
        await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
        const { workspaceId } = (await client.invoke("workspace.select", { path: repo })) as { workspaceId: string };
        await client.invoke("case.open", { caseId: "C1", desiredOutcome: "behavior preserved" });
        const { criterionHash } = (await client.invoke("criterion.freeze", { caseId: "C1", spec: { version: 1, requiredChecks: ["unit", "integration"], observed: ["x"], unobserved: [], guardrails: [], protectedInvariants: [] } })) as { criterionHash: string };
        const base = (await client.invoke("world.freeze", { caseId: "C1", kind: "baseline", worldId: "local", root: repo, criterionHash })) as { worldHash: string };
        await writeFile(join(repo, "a.txt"), "changed");
        const cand = (await client.invoke("world.freeze", { caseId: "C1", kind: "candidate", worldId: "local", root: repo, parentWorldHash: base.worldHash, criterionHash })) as { worldHash: string };
        await client.invoke("verification.run", { caseId: "C1", worldId: "local", root: repo, candidateHash: cand.worldHash, checks: [
          { id: "unit", argv: ["bash", "-c", "echo 'expected 2 got 3' >&2; exit 1"] },
          { id: "integration", argv: ["bash", "-c", "echo 'timeout in guest path' >&2; exit 2"] },
        ] });
        const ver = (await events(app)).filter((e) => e.eventType === "verification.observed");
        const [posA, posB] = [ver.find((e) => e.payload.checkId === "unit")!.position, ver.find((e) => e.payload.checkId === "integration")!.position];
        const before = (await events(app)).filter((e) => AUTHORITATIVE.has(e.eventType));

        const ask = async (message: string) => {
          const sessionId = randomUUID();
          const run = await client.startRun("agent.coding", { sessionId, workspaceId, caseId: "C1", message } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
          const done = await finish(app, run.runId);
          expect(done.status).toBe("completed");
          return String((done.output as { text?: string }).text);
        };

        // nothing focused: the agent says so rather than guessing
        expect(await ask("why did this fail?")).toMatch(/Nothing is focused/);

        // focus failure A -> the human sends only "why did this fail?"
        await client.invoke("ui.focus.publish", { focus: { ref: `evidence:${posA}`, caseId: "C1", candidateWorldHash: cand.worldHash } });
        expect(await ask("why did this fail?")).toBe("It failed because the unit check recorded: expected 2 got 3.");
        const requested = (await client.invoke("ui.pending", {})) as { surfaces: { blocks: { type: string }[]; provenance: { source: string } }[]; focus: { ref: string } };
        expect(requested.surfaces[0]!.blocks[0]!.type).toBe("timeline"); // the page is asked to render it
        expect(requested.surfaces[0]!.provenance.source).toBe("ui.timeline");
        expect(requested.focus.ref).toBe(`evidence:${posA}`);

        // focus switch A -> B changes the agent-visible answer deterministically
        await client.invoke("ui.focus.publish", { focus: { ref: `evidence:${posB}`, caseId: "C1", candidateWorldHash: cand.worldHash } });
        expect(await ask("why did this fail?")).toBe("It failed because the integration check recorded: timeout in guest path.");

        // the context the agent received is the small neighbourhood, built from recorded facts
        const ctxResult = (await client.invoke("ui.context", {})) as { focused: boolean; neighborhood: any };
        expect(ctxResult.neighborhood).toMatchObject({ focused: `evidence:${posB}`, case: "case:C1", meaning: "integration failed", recorded: { exitCode: 2, tail: "timeout in guest path\n" } });
        expect(ctxResult.neighborhood.actions.map((a: any) => a.id)).toContain("retry_verification");
        expect(JSON.stringify(ctxResult)).not.toContain("<"); // no DOM

        // inspection/focus changed no authoritative state
        const after = (await events(app)).filter((e) => AUTHORITATIVE.has(e.eventType));
        expect(after).toEqual(before);

        // a mutating follow-up is not available through the attention path: settlement stays a human capability
        await expect(client.invoke("ui.request", { op: "focus", ref: "css:#row-5" })).rejects.toThrow();
      } finally {
        await app.stop();
        await aimock.stop();
      }
    });
  }, 120_000);
});
