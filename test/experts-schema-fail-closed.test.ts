import { expect, test } from "bun:test";
import type { Caller } from "@godspeedai/cognate-runtime-api";
import { withExpertApp, collaborationResponder } from "./expert-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { readExpertRoot } from "../src/experts/state.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { EXPERTS_THREAD } from "../src/experts/types.ts";

const SYSTEM: Caller = { actor: { id: "system", kind: "system" }, tenant: LOCAL_OPERATOR.tenant };
const UNSUPPORTED = /Unsupported Experts state schema/;

// The valid v2 root shape (schema 2, logicalSchema 1, partitionVersion 2) with no partitions.
// Only the fields named by each test are varied, so a refusal can only come from that field.
function v2Manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 2,
    logicalSchema: 1,
    partitionVersion: 2,
    presentSections: ["experts", "teams", "conversations", "assignments", "messages", "memory", "receipts"],
    partitions: [],
    sectionFingerprints: {
      experts: `sha256:${"0".repeat(64)}`,
      teams: `sha256:${"0".repeat(64)}`,
      conversations: `sha256:${"0".repeat(64)}`,
      assignments: `sha256:${"0".repeat(64)}`,
      messages: `sha256:${"0".repeat(64)}`,
      memory: `sha256:${"0".repeat(64)}`,
      receipts: `sha256:${"0".repeat(64)}`,
    },
    ...overrides,
  };
}

test("EXPERTS-SCHEMA: a future-schema root is refused by the read path", async () => {
  await withExpertApp(collaborationResponder, async app => {
    const service = app.app.runtime.service;
    const current = await service.readSharedState(SYSTEM, { threadId: EXPERTS_THREAD });
    await service.updateSharedState(SYSTEM, {
      threadId: EXPERTS_THREAD, update: { snapshot: v2Manifest({ schema: 3 }) as never },
      expectedVersion: current.version, idempotencyKey: "EXPERTS-SCHEMA:future-schema",
    });
    await expect(readExpertRoot(service, SYSTEM)).rejects.toThrow(UNSUPPORTED);
  });
});

test("EXPERTS-SCHEMA: a v2 manifest with an unknown top-level field is refused by the read path", async () => {
  await withExpertApp(collaborationResponder, async app => {
    const service = app.app.runtime.service;
    const current = await service.readSharedState(SYSTEM, { threadId: EXPERTS_THREAD });
    await service.updateSharedState(SYSTEM, {
      threadId: EXPERTS_THREAD, update: { snapshot: v2Manifest({ futureTopLevelField: { x: 1 } }) as never },
      expectedVersion: current.version, idempotencyKey: "EXPERTS-SCHEMA:unknown-field",
    });
    await expect(readExpertRoot(service, SYSTEM)).rejects.toThrow(UNSUPPORTED);
  });
});

test("EXPERTS-SCHEMA: after a refused read, Experts writes refuse and leave shared state byte-for-byte unchanged", async () => {
  await withExpertApp(collaborationResponder, async app => {
    const service = app.app.runtime.service;
    const current = await service.readSharedState(SYSTEM, { threadId: EXPERTS_THREAD });
    await service.updateSharedState(SYSTEM, {
      threadId: EXPERTS_THREAD, update: { snapshot: v2Manifest({ schema: 3 }) as never },
      expectedVersion: current.version, idempotencyKey: "EXPERTS-SCHEMA:write-refusal",
    });
    await expect(readExpertRoot(service, SYSTEM)).rejects.toThrow(UNSUPPORTED);
    const before = await service.readSharedState(SYSTEM, { threadId: EXPERTS_THREAD });

    // Lowest real write function: ExpertsService.mutate -> mutateExperts, which reads the root first.
    const experts = new ExpertsService(service, SYSTEM);
    await expect(experts.mutate(LOCAL_OPERATOR.tenant, "EXPERTS-SCHEMA:mutate", { probe: true }, () => true)).rejects.toThrow(UNSUPPORTED);
    // Public API write path: an Expert save through the client must surface the same refusal.
    await expect(app.client.invoke("expert.save", {
      expertId: "builder", name: "Builder", specialization: "Builder", instructions: "x", tools: ["read"], route: null,
    } as never)).rejects.toThrow(UNSUPPORTED);

    const after = await service.readSharedState(SYSTEM, { threadId: EXPERTS_THREAD });
    expect(after.version).toBe(before.version);
    expect(JSON.stringify(after.state)).toBe(JSON.stringify(before.state));
  });
});
