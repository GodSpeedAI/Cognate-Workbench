import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { RuntimeService, Caller } from "@godspeedai/cognate-runtime-api";
import type { HandlerContext } from "@godspeedai/cognate-kernel-api";
import { withExpertApp, collaborationResponder } from "./expert-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { mutateExperts, readExperts, readExpertRoot } from "../src/experts/state.ts";
import { ExpertsService } from "../src/experts/service.ts";
import { EXPERT_PARTITION_THREAD_PREFIX, isExpertStateManifest, restoreExpertSectionEntries, type ExpertStateManifest } from "../src/experts/persistence.ts";
import { EXPERTS_THREAD, type ExpertMessage, type ExpertState } from "../src/experts/types.ts";

const SYSTEM: Caller = { actor: { id: "system", kind: "system" }, tenant: LOCAL_OPERATOR.tenant };

const CONVERSATION_ID = "scoped-large-conversation";
const OTHER_CONVERSATION_ID = "scoped-other-conversation";
const MESSAGE_COUNT = 240;
const OTHER_MESSAGE_COUNT = 60;
const MEMORY_COUNT = 320;

function sectionOfThreadId(threadId: string): string | undefined {
  if (!threadId.startsWith(EXPERT_PARTITION_THREAD_PREFIX)) return undefined;
  return threadId.slice(EXPERT_PARTITION_THREAD_PREFIX.length).split(":")[0];
}

async function seedFixture(state: ExpertState, workspaceId: string): Promise<void> {
  state.conversations[CONVERSATION_ID] = {
    id: CONVERSATION_ID, scope: "solo", expertId: "product-manager", teamId: null, workspaceId,
    title: "Scoped large conversation", messageIds: [], assignmentIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  };
  state.conversations[OTHER_CONVERSATION_ID] = {
    id: OTHER_CONVERSATION_ID, scope: "solo", expertId: "builder", teamId: null, workspaceId,
    title: "Scoped other conversation", messageIds: [], assignmentIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
  };
  for (let index = 1; index <= MESSAGE_COUNT; index++) {
    const id = `scoped-message-${String(index).padStart(4, "0")}`;
    const message: ExpertMessage = {
      id, conversationId: CONVERSATION_ID, assignmentId: null, sender: { kind: "human", id: "operator" },
      recipientId: "product-manager", text: `scoped message body ${index} ${"y".repeat(4000)}`, correlationId: id,
      causationId: null, delivery: "delivered", replyTo: null, sequence: index,
    };
    state.messages[id] = message;
    state.conversations[CONVERSATION_ID]!.messageIds.push(id);
  }
  for (let index = 1; index <= OTHER_MESSAGE_COUNT; index++) {
    const id = `scoped-other-message-${String(index).padStart(4, "0")}`;
    const message: ExpertMessage = {
      id, conversationId: OTHER_CONVERSATION_ID, assignmentId: null, sender: { kind: "human", id: "operator" },
      recipientId: "builder", text: `other message body ${index}`, correlationId: id,
      causationId: null, delivery: "delivered", replyTo: null, sequence: index,
    };
    state.messages[id] = message;
    state.conversations[OTHER_CONVERSATION_ID]!.messageIds.push(id);
  }
  for (let index = 1; index <= MEMORY_COUNT; index++) {
    const id = `scoped-memory-${String(index).padStart(4, "0")}`;
    state.memory[id] = {
      id, expertId: index % 7 ? "product-manager" : "builder", teamId: null, scope: "personal", kind: "observation",
      text: `scoped memory ${index}`, sources: ["fixture"], pinned: false, by: "operator",
    };
  }
}

function countingService(base: RuntimeService, reads: Map<string, number>, writes: Map<string, number>): RuntimeService {
  return {
    ...base,
    async readSharedState(caller: Caller, request: Parameters<RuntimeService["readSharedState"]>[1]) {
      reads.set(request.threadId, (reads.get(request.threadId) ?? 0) + 1);
      return base.readSharedState(caller, request);
    },
    async updateSharedState(caller: Caller, request: Parameters<RuntimeService["updateSharedState"]>[1]) {
      writes.set(request.threadId, (writes.get(request.threadId) ?? 0) + 1);
      return base.updateSharedState(caller, request);
    },
  } satisfies RuntimeService;
}

const operatorContext = () => ({
  tenant: LOCAL_OPERATOR.tenant, actor: { id: LOCAL_OPERATOR.actor.id, kind: "user" },
  runId: undefined, causationId: null, correlationId: "J-MEMORY-SCOPED",
}) as unknown as HandlerContext;

test("J-MEMORY-SCOPED: conversation, memory and mutation paths read and write only the sections they touch", async () => {
  await withExpertApp(collaborationResponder, async app => {
    await app.client.invoke("experts.seed", {} as never);
    await mutateExperts(app.app.runtime.service, SYSTEM, "J-MEMORY-SCOPED:fixture", { fixture: true }, state => {
      seedFixture(state, app.workspaceId);
      return true;
    });

    const reads = new Map<string, number>();
    const writes = new Map<string, number>();
    const base = app.app.runtime.service;
    const experts = new ExpertsService(countingService(base, reads, writes), SYSTEM);
    const ctx = operatorContext();

    const partitionReads = (predicate: (section: string) => boolean) =>
      [...reads.entries()].filter(([threadId]) => { const section = sectionOfThreadId(threadId); return section !== undefined && predicate(section); });

    // A bounded history page: the conversation record and only its messages' leaves are read.
    let page = await experts.command("expert.context", { conversationId: CONVERSATION_ID, limit: 50 }, ctx) as {
      messages: ExpertMessage[]; nextCursor?: string; messageCount: number;
    };
    expect(page.messageCount).toBe(MESSAGE_COUNT);
    expect(page.messages).toHaveLength(50);
    expect(page.messages.map(message => message.sequence)).toEqual(Array.from({ length: 50 }, (_, index) => index + 191));
    expect(partitionReads(section => !["conversations", "messages", "assignments"].includes(section))).toHaveLength(0);
    // Page reads are bounded by the page size, not by the conversation, section or aggregate size.
    expect(partitionReads(() => true).length).toBeLessThanOrEqual(50 + 4);
    expect(reads.get(EXPERTS_THREAD) ?? 0).toBeLessThanOrEqual(2);

    const seen: ExpertMessage[] = [...page.messages];
    let pages = 1;
    while (page.nextCursor) {
      page = await experts.command("expert.context", { conversationId: CONVERSATION_ID, limit: 50, cursor: page.nextCursor }, ctx) as typeof page;
      seen.unshift(...page.messages);
      pages++;
      expect(partitionReads(section => !["conversations", "messages", "assignments"].includes(section))).toHaveLength(0);
    }
    expect(pages).toBe(Math.ceil(MESSAGE_COUNT / 50));
    expect(seen).toHaveLength(MESSAGE_COUNT);
    expect(new Set(seen.map(message => message.id)).size).toBe(MESSAGE_COUNT);
    expect(seen.map(message => message.sequence)).toEqual(Array.from({ length: MESSAGE_COUNT }, (_, index) => index + 1));

    // A memory read touches only the memory section's partitions.
    reads.clear(); writes.clear();
    const memoryPage = await experts.command("expert.memory.read", { expertId: "product-manager", limit: 100 }, ctx) as { records: { id: string }[]; nextCursor?: string };
    expect(memoryPage.records.length).toBe(100);
    expect(partitionReads(section => section !== "memory")).toHaveLength(0);

    // A mutation that changes one memory record writes exactly that changed leaf plus the root.
    reads.clear(); writes.clear();
    await experts.mutate(LOCAL_OPERATOR.tenant, "J-MEMORY-SCOPED:memory-add", { kind: "memory" }, state => {
      state.memory["scoped-new-memory"] = {
        id: "scoped-new-memory", expertId: "product-manager", teamId: null, scope: "personal", kind: "observation",
        text: "new scoped record", sources: ["fixture"], pinned: false, by: "operator",
      };
      return true;
    });
    const partitionWrites = [...writes.entries()].filter(([threadId]) => sectionOfThreadId(threadId) !== undefined);
    // Exactly the changed memory leaf and the command's receipt leaf are written; every other
    // section is carried forward by verified content address without a single leaf write.
    expect(partitionWrites).toHaveLength(2);
    expect(new Set(partitionWrites.map(([threadId]) => sectionOfThreadId(threadId)))).toEqual(new Set(["memory", "receipts"]));
    expect(writes.get(EXPERTS_THREAD)).toBe(1);

    // The accepted root is a fingerprinted v2 directory over every logical section.
    const root = await readExpertRoot(base, SYSTEM);
    expect(root.kind).toBe("manifest");
    if (root.kind !== "manifest") return;
    expect(root.manifest.partitionVersion).toBe(2);
    expect(new Set(root.manifest.presentSections).size).toBe(root.manifest.presentSections.length);
    for (const section of root.manifest.presentSections) expect(root.manifest.sectionFingerprints?.[section]).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Restart preserves the scoped paths and the accepted directory.
    await app.restart();
    const restarted = new ExpertsService(app.app.runtime.service, SYSTEM);
    const afterRestart = await restarted.command("expert.context", { conversationId: CONVERSATION_ID, limit: 50 }, operatorContext()) as { messages: ExpertMessage[] };
    expect(afterRestart.messages).toHaveLength(50);
    expect(afterRestart.messages[0]!.id).toBe(`scoped-message-${String(MESSAGE_COUNT - 49).padStart(4, "0")}`);
    const recovered = await readExperts(app.app.runtime.service, SYSTEM);
    expect(Object.keys(recovered.state.memory)).toHaveLength(MEMORY_COUNT + 1);

    // Aliased section directories fail fingerprint verification before any row is served.
    const aliased: ExpertStateManifest = { ...root.manifest, sectionFingerprints: { ...root.manifest.sectionFingerprints, memory: root.manifest.sectionFingerprints!["experts"]! } };
    expect(isExpertStateManifest(aliased)).toBe(true);
    await expect(restoreExpertSectionEntries(app.app.runtime.service, SYSTEM, aliased, "memory")).rejects.toThrow("failed its manifest fingerprint verification");

    // An erased partition source fails the scoped read closed and invalidates the public projection.
    const probeDigest = createHash("sha256").update("scoped-message-0001").digest("hex");
    const messageReference = root.manifest.partitions.find(reference => reference.section === "messages" && probeDigest.startsWith(reference.path));
    expect(messageReference).toBeDefined();
    let afterPosition = 0;
    let sourceEvent;
    for (;;) {
      const events = await app.app.runtime.store.readAll({ afterPosition, limit: 500 });
      for (const event of events) {
        afterPosition = event.position;
        if (event.metadata?.threadId === messageReference!.threadId) sourceEvent = event;
      }
      if (events.length < 500 || sourceEvent) break;
    }
    expect(sourceEvent).toBeDefined();
    await app.app.runtime.erase(sourceEvent!.eventId, "J-MEMORY-SCOPED erasure", SYSTEM.actor);
    await expect(new ExpertsService(app.app.runtime.service, SYSTEM).command("expert.context", { conversationId: CONVERSATION_ID, limit: 50 }, operatorContext())).rejects.toThrow();
    await app.app.runtime.idle();
    const projection = await app.app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "experts" });
    expect(projection.rows.some(row => row.key === "current")).toBe(false);
    expect(projection.rows.some(row => row.key === `partition/${messageReference!.hash}`)).toBe(false);
  });
}, 180_000);
