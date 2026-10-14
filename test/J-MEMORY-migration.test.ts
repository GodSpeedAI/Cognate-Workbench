import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { allowCapabilities } from "@godspeedai/cognate-kernel-api";
import { createRuntime, type Runtime } from "@godspeedai/cognate-runtime-bun";
import { openPostgresStore, resolvePg0Url } from "@godspeedai/cognate-store-postgres";
import { EXPERT_PARTITION_MAX_BYTES, EXPERT_PARTITION_THREAD_PREFIX, isExpertStateManifest, restoreExpertManifest, type ExpertStateManifest } from "../src/experts/persistence.ts";
import { readExperts } from "../src/experts/state.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { EXPERTS_THREAD, EXPERT_TOOLS, emptyExpertState, type ExpertState, type Team } from "../src/experts/types.ts";
import { expertsProjection } from "../src/projections/experts.ts";
import { postgresUrl, schemaFor, storeConfigFor } from "../src/store.ts";

const SYSTEM: Caller = { actor: { id: "system", kind: "system" }, tenant: "local" };
const LOCAL_OPERATOR: Caller = { actor: { id: "operator", kind: "user" }, tenant: "local" };

function expertState(): ExpertState {
  const state = emptyExpertState();
  const ids: string[] = [];
  for (let index = 0; index < 100; index++) {
    const id = index < 5
      ? ["product-manager", "builder", "critic", "verifier", "reviewer"][index]!
      : `migration-expert-${String(index - 5).padStart(3, "0")}`;
    ids.push(id);
    state.experts[id] = {
      id, name: `Migration Expert ${index}`, lifecycle: "active",
      definition: {
        id: `definition:${id}`, specialization: `Synthetic specialization ${index}`,
        instructions: `Synthetic legacy identity ${index}`, route: null,
        tools: [...EXPERT_TOOLS], contextBudget: 16_000, maxSteps: 12,
      },
    };
  }
  for (let index = 0; index < 20; index++) {
    const id = index === 0 ? "cognate-team" : `migration-team-${String(index - 1).padStart(3, "0")}`;
    const members = ids.slice(index * 5 % ids.length, index * 5 % ids.length + 5);
    const normalized = members.length === 5 ? members : [...members, ...ids.slice(0, 5 - members.length)];
    const team: Team = {
      id, name: `Migration Team ${index}`, lifecycle: "active",
      members: normalized.map((expertId, memberIndex) => ({
        expertId, role: memberIndex === 0 ? "orchestrator" : "specialist", tools: [...EXPERT_TOOLS],
      })),
      tools: [...EXPERT_TOOLS],
      limits: { maxDepth: 2, maxAssignments: 12, maxUnread: 20, maxRounds: 8 },
    };
    state.teams[id] = team;
  }
  const messageIds: string[] = [];
  for (let index = 0; index < 200; index++) messageIds.push(`legacy-message-${String(index).padStart(5, "0")}`);
  state.conversations["legacy-conversation"] = {
    id: "legacy-conversation", scope: "solo", expertId: ids[5]!, teamId: null,
    workspaceId: "migration-workspace", title: "Large legacy conversation", messageIds,
    assignmentIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
  state.audit = [{
    id: "private-audit-marker", capability: "private.capability", by: "audit-private-marker",
    actorKind: "expert", runId: "private-run-marker", causationId: null,
  }];
  state.receipts["seed:v1"] = { fingerprint: "seed:v1", result: { ok: true } };
  return state;
}

function pointer(value: string): string { return value.replace(/~/g, "~0").replace(/\//g, "~1"); }

function largeEntries(state: ExpertState) {
  for (let index = 0; index < 250; index++) {
    const id = `legacy-memory-${String(index).padStart(5, "0")}`;
    state.memory[id] = {
      id, expertId: index % 2 === 0 ? "builder" : "critic", teamId: index % 3 ? null : "cognate-team",
      scope: index % 3 ? "personal" : "team", kind: "observation",
      text: `legacy-memory-${index} ${"m".repeat(8_000)}`, sources: [`legacy-source-${index}`], pinned: index < 2, by: "migration-test",
    };
  }
  for (let index = 0; index < 200; index++) {
    const id = `legacy-message-${String(index).padStart(5, "0")}`;
    state.messages[id] = {
      id, conversationId: "legacy-conversation", assignmentId: null,
      sender: index % 2 ? { kind: "expert", id: "builder" } : { kind: "human", id: "operator" },
      recipientId: "builder", text: `legacy-message-${index} ${"x".repeat(16_000)}`,
      correlationId: `legacy-conversation:${index}`, causationId: null,
      delivery: "delivered", replyTo: null,
    };
  }
}

async function allEvents(service: RuntimeService): Promise<Set<string>> {
  const ids = new Set<string>();
  let position = 0;
  for (;;) {
    const page = await service.events(SYSTEM, { afterPosition: position });
    let read = 0;
    for await (const event of page) { ids.add(event.eventId); position = event.position; read++; }
    if (read < 500) break;
  }
  return ids;
}

async function partitionEvent(runtime: Runtime, threadId: string) {
  let afterPosition = 0;
  for (;;) {
    const page = await runtime.store.readAll({ afterPosition, limit: 500 });
    for (const event of page) {
      afterPosition = event.position;
      if (event.metadata?.threadId === threadId) return event;
    }
    if (page.length < 500) return undefined;
  }
}

test("J-MEMORY-MIGRATE: schema-1 history above 5 MiB prepares immutable partitions before root CAS and rebuilds safely", async () => {
  const home = await mkdtemp(join(tmpdir(), "cognate-experts-migration-"));
  const schema = schemaFor(home, "migration");
  const create = () => createRuntime({
    store: storeConfigFor(home, "migration"),
    policy: allowCapabilities("experts-migration-test", []),
    actions: { authorize: () => ({ allow: true, reason: "migration fixture" }) },
    agents: [],
    projections: [{ projection: expertsProjection, public: true }],
    system: SYSTEM.actor,
  });
  let runtime: Runtime | undefined;
  try {
    runtime = await create();
    const service = runtime.service;
    const initialRoot = await service.readSharedState(SYSTEM, { threadId: EXPERTS_THREAD });
    const legacy = expertState();
    const snapshot = await service.updateSharedState(SYSTEM, {
      threadId: EXPERTS_THREAD, update: { snapshot: legacy as never },
      expectedVersion: initialRoot.version, idempotencyKey: "J-MEMORY-MIGRATE:legacy-seed",
    });
    let version = snapshot.version;
    const staged = expertState();
    largeEntries(staged);
    const expectedBytes = Buffer.byteLength(JSON.stringify(staged));
    expect(expectedBytes).toBeGreaterThan(5 * 1024 * 1024);

    const memoryEntries = Object.entries(staged.memory);
    for (let offset = 0; offset < memoryEntries.length; offset += 120) {
      const patch = memoryEntries.slice(offset, offset + 120).map(([id, value]) => ({ op: "add" as const, path: `/memory/${pointer(id)}`, value: value as never }));
      const updated = await service.updateSharedState(SYSTEM, {
        threadId: EXPERTS_THREAD, update: { patch }, expectedVersion: version,
        idempotencyKey: `J-MEMORY-MIGRATE:memory:${offset}`,
      });
      version = updated.version;
    }
    const messageEntries = Object.entries(staged.messages);
    for (let offset = 0; offset < messageEntries.length; offset += 50) {
      const patch = messageEntries.slice(offset, offset + 50).map(([id, value]) => ({ op: "add" as const, path: `/messages/${pointer(id)}`, value: value as never }));
      const updated = await service.updateSharedState(SYSTEM, {
        threadId: EXPERTS_THREAD, update: { patch }, expectedVersion: version,
        idempotencyKey: `J-MEMORY-MIGRATE:message:${offset}`,
      });
      version = updated.version;
    }
    const oldEvents = await allEvents(service);
    const legacyCurrent = await service.readSharedState(SYSTEM, { threadId: EXPERTS_THREAD });
    expect(Buffer.byteLength(JSON.stringify(legacyCurrent.state))).toBeGreaterThan(5 * 1024 * 1024);

    const failBeforeRoot = {
      ...service,
      async updateSharedState(caller: Caller, request: Parameters<RuntimeService["updateSharedState"]>[1]) {
        if (request.threadId === EXPERTS_THREAD) throw new Error("injected failure before root manifest CAS");
        return service.updateSharedState(caller, request);
      },
    } satisfies RuntimeService;
    await expect(readExperts(failBeforeRoot, SYSTEM)).rejects.toThrow("injected failure before root manifest CAS");
    const stillLegacy = await service.readSharedState(SYSTEM, { threadId: EXPERTS_THREAD });
    expect((stillLegacy.state as { schema?: number }).schema).toBe(1);
    expect(Object.keys((stillLegacy.state as unknown as ExpertState).memory)).toHaveLength(250);

    const migrated = await readExperts(service, SYSTEM);
    expect(Object.keys(migrated.state.experts)).toHaveLength(100);
    expect(Object.keys(migrated.state.teams)).toHaveLength(20);
    expect(Object.keys(migrated.state.memory)).toHaveLength(250);
    expect(Object.keys(migrated.state.messages)).toHaveLength(200);
    expect(migrated.state.memory["legacy-memory-00000"]?.scope).toBe("team");
    expect(migrated.state.memory["legacy-memory-00001"]?.scope).toBe("personal");
    expect(migrated.state.inboxReceipts).toBeUndefined();

    const committedRoot = await service.readSharedState(SYSTEM, { threadId: EXPERTS_THREAD });
    expect(isExpertStateManifest(committedRoot.state)).toBe(true);
    const manifest = committedRoot.state as unknown as ExpertStateManifest;
    expect(Buffer.byteLength(JSON.stringify(manifest))).toBeLessThan(900 * 1024);
    const partitionEvents = (await allEvents(service)).size - oldEvents.size;
    expect(partitionEvents).toBeGreaterThan(1);

    await runtime.idle();
    const publicRows = await service.readProjection(LOCAL_OPERATOR, { name: "experts" });
    const current = publicRows.rows.find((row) => row.key === "current")?.value as ExpertState | undefined;
    expect(current).toBeDefined();
    expect(Object.keys(current!.experts)).toHaveLength(100);
    expect(current!.memory).toEqual({});
    expect(JSON.stringify(publicRows.rows)).not.toContain("legacy-memory-00000");
    expect(JSON.stringify(publicRows.rows)).not.toContain("m".repeat(100));
    expect(JSON.stringify(publicRows.rows)).not.toContain("audit-private-marker");
    expect(publicRows.rows.filter((row) => row.key.startsWith("partition/")).length).toBeGreaterThan(0);

    const missing = { ...manifest, partitions: [{
      section: "memory", path: "f", hash: "sha256:" + "0".repeat(64),
      threadId: `${EXPERT_PARTITION_THREAD_PREFIX}memory:f:sha256:${"0".repeat(64)}`,
    }] } as ExpertStateManifest;
    await expect(restoreExpertManifest({ ...service }, SYSTEM, missing)).rejects.toThrow("is missing");
    await expect(restoreExpertManifest({ ...service }, SYSTEM, {
      ...manifest, partitions: [manifest.partitions[0]!, manifest.partitions[0]!],
    })).rejects.toThrow("duplicate or overlapping partition paths");

    const messageReference = manifest.partitions.find((reference) => reference.section === "messages")!;
    const messageThread = await service.readSharedState(SYSTEM, { threadId: messageReference.threadId });
    expect(Buffer.byteLength(JSON.stringify(messageThread.state))).toBeLessThanOrEqual(EXPERT_PARTITION_MAX_BYTES);

    await runtime.close();
    runtime = await create();
    const recovered = await readExperts(runtime.service, SYSTEM);
    expect(Object.keys(recovered.state.memory)).toHaveLength(250);
    expect(Object.keys(recovered.state.messages)).toHaveLength(200);
    const eventsAfterRestart = await allEvents(runtime.service);
    for (const eventId of oldEvents) expect(eventsAfterRestart.has(eventId)).toBe(true);

    const experts = new ExpertsService(runtime.service, SYSTEM);
    const addMember = (expertId: string) => experts.mutate(LOCAL_OPERATOR.tenant, `J-MEMORY-MIGRATE:add:${expertId}`, { expertId }, (state) => {
      const team = state.teams["cognate-team"]!;
      if (!team.members.some((member) => member.expertId === expertId)) {
        team.members.push({ expertId, role: "specialist", tools: [...EXPERT_TOOLS] });
      }
      return team.members.length;
    });
    await Promise.all([addMember("migration-expert-000"), addMember("migration-expert-001")]);
    const concurrentState = await experts.state(LOCAL_OPERATOR.tenant);
    const teamMembers = concurrentState.teams["cognate-team"]!.members;
    expect(teamMembers.filter((member) => member.role === "orchestrator")).toHaveLength(1);
    expect(teamMembers.map((member) => member.expertId)).toContain("migration-expert-000");
    expect(teamMembers.map((member) => member.expertId)).toContain("migration-expert-001");

    await runtime.idle();
    const sourceEvent = await partitionEvent(runtime, messageReference.threadId);
    expect(sourceEvent).toBeDefined();
    await runtime.erase(sourceEvent!.eventId, "migration erasure test", SYSTEM.actor);
    await expect(readExperts(runtime.service, SYSTEM)).rejects.toThrow("failed content verification");
    await runtime.idle();
    const projectionAfterErase = await runtime.service.readProjection(LOCAL_OPERATOR, { name: "experts" });
    expect(projectionAfterErase.rows.some((row) => row.key === "current")).toBe(false);
    expect(projectionAfterErase.rows.some((row) => row.key === `partition/${messageReference.hash}`)).toBe(false);
  } finally {
    await runtime?.close().catch(() => {});
    const databaseUrl = process.env.COGNATE_POSTGRES_URL ?? await resolvePg0Url({ name: process.env.COGNATE_PG0_NAME ?? "cognate-dev" }).catch(() => postgresUrl());
    const opened = await openPostgresStore({ url: databaseUrl, schema }).catch(() => undefined);
    if (opened) {
      await opened.close().catch(() => {});
      await opened.dropSchema().catch(() => {});
    }
    await rm(home, { recursive: true, force: true });
  }
}, 120_000);
