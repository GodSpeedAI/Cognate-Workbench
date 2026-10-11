// Journeys J-WB-workflow (V-002) and J-WB-capability-lifecycle (V-011): the workflow graph owns
// progression; capabilities are stable and implementations replaceable; build != install != enable.
import { describe, expect, test } from "bun:test";
import { readyNodes } from "../src/workbench/workflow.ts";
import type { BindingRecord, CapabilityRecord, WorkflowInstanceRecord } from "../src/workbench/state.ts";
import type { WorkflowDefinition } from "../src/workbench/types.ts";
import { SYSTEM, bootApp, rowsWithPrefix, seedWorkspaceOnly, waitForRow, waitUntil, wbRows, withTempHome, type AppServer, inv } from "./wb-helpers.ts";

const instance = (app: AppServer, id: string) => waitForRow<WorkflowInstanceRecord>(app, `instance/${id}`);
const def = async (app: AppServer, id: string) => (await wbRows(app)).get(`workflow/${id}`) as WorkflowDefinition;

describe("J-WB-workflow", () => {
  test("a node unlocks only when its dependencies are done with their evidence closed; failure retries without restarting upstream", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        expect(await inv(client, "workbench.seed", {})).toMatchObject({ seeded: true });
        await waitForRow(app, "workflow/wf.weekly-sales-report");
        await waitForRow(app, "workflow/wf.frontend-product-actualization");
        expect(await inv(client, "workbench.seed", {})).toMatchObject({ seeded: false }); // idempotent

        // An invalid workflow (a cycle) is refused with the cycle named.
        const bad: WorkflowDefinition = {
          id: "wf.bad", name: "bad", version: 1, outcome: "x",
          nodes: ["a", "b"].map((id) => ({ id, capability: "capability.code-repair", inputs: [], outputs: [], authority: "modify" as const, executorRole: "worker" as const, acceptance: [] })),
          edges: [{ from: "a", to: "b", mode: "needs", evidenceRequired: [], auto: true }, { from: "b", to: "a", mode: "needs", evidenceRequired: [], auto: true }],
        };
        await expect(inv(client, "workflow.define", { definition: bad })).rejects.toThrow(/[Cc]ycle detected: a -> b -> a/);

        const { instanceId } = (await inv(client, "workflow.instantiate", { workflowId: "wf.weekly-sales-report", workspaceId })) as { instanceId: string };
        let inst = await instance(app, instanceId);
        const wf = await def(app, "wf.weekly-sales-report");
        expect(readyNodes(wf, inst.status, inst.closed)).toEqual(["domain-rules"]);

        // A locked node cannot be started.
        await expect(inv(client, "workflow.node.advance", { instanceId, nodeId: "calculation", to: "running" })).rejects.toThrow(/not unlocked/);

        // Done without its evidence is refused (worker done != accepted).
        await inv(client, "workflow.node.advance", { instanceId, nodeId: "domain-rules", to: "running" });
        await expect(inv(client, "workflow.node.advance", { instanceId, nodeId: "domain-rules", to: "done" })).rejects.toThrow(/evidence not closed: domain/);
        await inv(client, "workflow.node.advance", { instanceId, nodeId: "domain-rules", to: "done", closedEvidence: ["domain"] });
        inst = await waitUntil("domain-rules done", async () => {
          const i = (await wbRows(app)).get(`instance/${instanceId}`) as WorkflowInstanceRecord;
          return i.status["domain-rules"] === "done" ? i : undefined;
        });
        expect(readyNodes(wf, inst.status, inst.closed)).toEqual(["calculation"]);

        // A failed node is retried without restarting upstream: domain-rules stays done.
        await inv(client, "workflow.node.advance", { instanceId, nodeId: "calculation", to: "running" });
        await inv(client, "workflow.node.advance", { instanceId, nodeId: "calculation", to: "failed" });
        await waitUntil("calculation failed", async () => ((await wbRows(app)).get(`instance/${instanceId}`) as WorkflowInstanceRecord).status.calculation === "failed");
        await inv(client, "workflow.node.advance", { instanceId, nodeId: "calculation", to: "pending" });
        await waitUntil("calculation retried", async () => ((await wbRows(app)).get(`instance/${instanceId}`) as WorkflowInstanceRecord).status.calculation === "pending");
        inst = await instance(app, instanceId);
        expect(inst.status["domain-rules"]).toBe("done");
        expect(readyNodes(wf, inst.status, inst.closed)).toEqual(["calculation"]);

        // The review gate must go through review before it can be done.
        await expect(inv(client, "workflow.node.advance", { instanceId, nodeId: "review", to: "done", closedEvidence: ["human"] })).rejects.toThrow(/not unlocked|review gate/);
      } finally {
        await app.stop();
      }
    });
  }, 60_000);

  test("V-002: swapping the implementation behind a capability leaves the contract and acceptance unchanged", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await inv(client, "workbench.seed", {});
        const capId = "capability.browser-journey-verification";
        const before = await waitForRow<CapabilityRecord>(app, `capability/${capId}`, (c) => c.activeImplementation === "impl.playwright");
        const jev = { capabilityId: capId, implementationId: "impl.jev", provider: "jev", executorKind: "deterministic" as const, setup: { runner: "jev" } };
        const result = (await inv(client, "skill.bind", { binding: jev, replaces: "impl.playwright" })) as { substitution: { compatible: boolean; unchanged: string[]; changed: string[] } };
        expect(result.substitution.compatible).toBe(true);
        expect(result.substitution.unchanged).toEqual(expect.arrayContaining(["journey-contract", "acceptance-criteria"]));
        expect(result.substitution.changed).toEqual(expect.arrayContaining(["implementation", "provider"]));
        const after = await waitForRow<CapabilityRecord>(app, `capability/${capId}`, (c) => c.activeImplementation === "impl.jev");
        expect(after.def).toEqual(before.def); // the contract is untouched

        // A deterministic verifier may not silently become an LLM.
        const llm = { ...jev, implementationId: "impl.llm-verifier", provider: "llm", executorKind: "llm" as const };
        await expect(inv(client, "skill.bind", { binding: llm, replaces: "impl.jev" })).rejects.toThrow(/incompatible substitution/);
      } finally {
        await app.stop();
      }
    });
  }, 60_000);
});

describe("J-WB-capability-lifecycle", () => {
  test("V-011: build, install, grant, enable and verify are separate steps; trust needs a person", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await inv(client, "workbench.seed", {});
        const capId = "capability.visual-polish";
        const key = `binding/${capId}/impl.impeccable-polish`;
        const state = async (want: string) => waitForRow<BindingRecord>(app, key, (b) => b.state === want);
        expect((await state("IMPLEMENTATION_AVAILABLE")).state).toBe("IMPLEMENTATION_AVAILABLE");

        // Skipping is refused and names the missing step.
        await expect(inv(client, "skill.lifecycle.advance", { capabilityId: capId, implementationId: "impl.impeccable-polish", to: "ENABLED" })).rejects.toThrow(/REVIEWED must come first|cannot go/);
        // Granting steps are human decisions.
        await expect(app.runtime.service.invoke(SYSTEM, { capability: "skill.lifecycle.advance", input: { capabilityId: capId, implementationId: "impl.impeccable-polish", to: "REVIEWED" } as never })).rejects.toThrow(/human decision/);

        for (const to of ["REVIEWED", "INSTALLED", "AUTHORITY_GRANTED", "ENABLED"] as const) {
          await inv(client, "skill.lifecycle.advance", { capabilityId: capId, implementationId: "impl.impeccable-polish", to });
          await state(to);
        }
        // Enabled is not verified: still not trusted. Verification is the last, separate step.
        await expect(inv(client, "skill.lifecycle.advance", { capabilityId: capId, implementationId: "impl.impeccable-polish", to: "VERIFIED" })).rejects.toThrow(/EXERCISED must come first|cannot go/);
        for (const to of ["EXERCISED", "VERIFIED", "AVAILABLE"] as const) {
          await inv(client, "skill.lifecycle.advance", { capabilityId: capId, implementationId: "impl.impeccable-polish", to });
          await state(to);
        }

        // Two capabilities that own the same decision surface cannot both be enabled.
        const fa = { capabilityId: "capability.frontend-actualization", implementationId: "impl.native-build", provider: "native", executorKind: "llm" as const, setup: {} };
        await inv(client, "skill.bind", { binding: fa });
        const faKey = `binding/${fa.capabilityId}/${fa.implementationId}`;
        // The fold of the bind must land before lifecycle.advance reads it (async fold on PostgreSQL).
        await waitForRow<BindingRecord>(app, faKey, (b) => b.state === "IMPLEMENTATION_AVAILABLE");
        for (const to of ["REVIEWED", "INSTALLED", "AUTHORITY_GRANTED"] as const) {
          await inv(client, "skill.lifecycle.advance", { capabilityId: fa.capabilityId, implementationId: fa.implementationId, to });
          await waitForRow<BindingRecord>(app, faKey, (b) => b.state === to);
        }
        await expect(inv(client, "skill.lifecycle.advance", { capabilityId: fa.capabilityId, implementationId: fa.implementationId, to: "ENABLED" })).rejects.toThrow(/conflicts on visual-implementation/);
        expect((await rowsWithPrefix<BindingRecord>(app, "binding/")).filter((b) => b.state === "AVAILABLE").length).toBe(1);
      } finally {
        await app.stop();
      }
    });
  }, 60_000);
});
