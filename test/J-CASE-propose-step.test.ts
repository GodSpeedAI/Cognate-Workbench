// Journey J-CASE-propose-step (Horizon stage 4): an agent in the workshop proposes a follow-up
// step; it goes to the case keeper as `case_add_item` over the SEA-Forge socket.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proposeStep, caseProposeStepComponent } from "../src/capabilities/caseProposeStep.ts";
import type { ExternalAuthority } from "../src/capabilities/governance.ts";
import { SeaForgeAuthority } from "@godspeedai/cognate-runtime-bun";

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

function fakeKeeper(reply: (frame: Record<string, unknown>) => Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "case-keeper-"));
  const socketPath = join(dir, "sea.sock");
  const frames: Record<string, unknown>[] = [];
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      data(socket, chunk) {
        const frame = JSON.parse(new TextDecoder().decode(chunk).trim()) as Record<string, unknown>;
        frames.push(frame);
        socket.write(`${JSON.stringify(reply(frame))}\n`);
      },
    },
  });
  cleanup.push(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });
  return { socketPath, frames };
}

const authorityFor = (socketPath: string): ExternalAuthority => ({
  governance: { mode: "sea-forge" } as ExternalAuthority["governance"],
  socketPath,
  service: { actor_id: "cognate-service", role: "service" },
  operator: { actor_id: "operator", role: "operator" },
  timeoutMs: 1_000,
  client: new SeaForgeAuthority({ socketPath }),
});

const proposal = { caseId: "case_1", assignmentId: "assign:case_1:step_1", planItemId: "step_9", name: "Fix the parser", endpointRef: "agent.local" };

describe("J-CASE-propose-step", () => {
  test("agent proposal arrives as a step with proposed_by set", async () => {
    const keeper = fakeKeeper((f) => ({ ok: true, case_id: f.case_id, plan_item_id: (f.item as { plan_item_id: string }).plan_item_id, proposed_by: (f.actor as { actor_id: string }).actor_id }));
    const result = await proposeStep(authorityFor(keeper.socketPath), proposal);
    expect(result).toEqual({ caseId: "case_1", planItemId: "step_9", proposedBy: "cognate-service" });
    expect(keeper.frames).toHaveLength(1);
    expect(keeper.frames[0]).toEqual({
      verb: "case_add_item",
      case_id: "case_1",
      item: { plan_item_id: "step_9", name: "Fix the parser", item_kind: "agent_task", operations: [{ kind: "agent_task", endpoint_ref: "agent.local", instruction: "Fix the parser", max_turns: 8 }], settlement_criteria: {} },
      policy: "policy.yaml",
      request_id: "propose:assign:case_1:step_1:step_9",
      actor: { actor_id: "cognate-service", role: "service" },
    });
    expect(keeper.frames[0]).not.toHaveProperty("on_behalf_of");
    expect((keeper.frames[0]!.item as Record<string, unknown>).proposed_by).toBeUndefined();
  });

  test("a retried proposal sends the same request_id", async () => {
    const keeper = fakeKeeper((f) => ({ ok: true, proposed_by: (f.actor as { actor_id: string }).actor_id }));
    const authority = authorityFor(keeper.socketPath);
    await proposeStep(authority, proposal);
    await proposeStep(authority, proposal);
    expect(keeper.frames).toHaveLength(2);
    expect(keeper.frames[0]!.request_id).toBe(keeper.frames[1]!.request_id);
  });

  test("case keeper unreachable gives a plain error, nothing queued silently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "case-keeper-gone-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const authority = authorityFor(join(dir, "missing.sock"));
    await expect(proposeStep(authority, proposal)).rejects.toThrow(/case keeper is not reachable.*not sent/);
    await expect(proposeStep(undefined, proposal)).rejects.toThrow(/no case keeper is configured/);
  });

  test("the capability refuses a call outside an agent run", async () => {
    let handler: ((raw: unknown, ctx: { runId?: string }) => Promise<unknown>) | undefined;
    caseProposeStepComponent({ authority: undefined }).activate({ provide: (_c: unknown, h: never) => { handler = h; } } as never);
    await expect(handler!(proposal, {})).rejects.toThrow(/only an agent run/);
  });
});
