import { expect, test } from "bun:test";
import { withExpertApp } from "./expert-helpers.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { mutateExperts } from "../src/experts/state.ts";
import { EXPERT_TOOLS, type ExpertMessage, type ExpertState } from "../src/experts/types.ts";

const SYSTEM = { actor: { id: "system", kind: "system" as const }, tenant: LOCAL_OPERATOR.tenant };

test("J-MEMORY-PAGINATE: capability pages keep stable bounded ordering and reject changed or stale scopes", async () => {
  await withExpertApp(async (route, request) => ({
    message: { role: "assistant", content: "done" }, toolCalls: [], finishReason: "stop", model: route.model,
  }), async app => {
    await app.client.invoke("experts.seed", {} as never);
    const conversationId = "pagination-solo-conversation";
    await mutateExperts(app.app.runtime.service, SYSTEM, "J-MEMORY-PAGINATE:fixture", { fixture: true }, (state: ExpertState) => {
      state.conversations[conversationId] = {
        id: conversationId, scope: "solo", expertId: "product-manager", teamId: null,
        workspaceId: app.workspaceId, title: "Pagination fixture", messageIds: [], assignmentIds: [],
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
      };
      state.conversations["pagination-private-team-conversation"] = {
        id: "pagination-private-team-conversation", scope: "private-team", expertId: "product-manager", teamId: "cognate-team",
        workspaceId: app.workspaceId, title: "Other private scope", messageIds: [], assignmentIds: [],
      };
      state.teams["pagination-other-team"] = {
        id: "pagination-other-team", name: "Other Team", lifecycle: "active",
        members: [{ expertId: "builder", role: "orchestrator", tools: [...EXPERT_TOOLS] }], tools: [...EXPERT_TOOLS],
        limits: { maxDepth: 2, maxAssignments: 8, maxUnread: 10, maxRounds: 6, maxConcurrentRuns: 2, admissionBatch: 1 },
      };
      for (let index = 1; index <= 205; index++) {
        const id = `pagination-message-${String(index).padStart(3, "0")}`;
        const message: ExpertMessage = {
          id, conversationId, assignmentId: null, sender: { kind: "human", id: "operator" },
          recipientId: "product-manager", text: `page-message-${index}`, correlationId: id,
          causationId: null, delivery: "delivered", replyTo: null, sequence: index,
        };
        state.messages[id] = message;
        state.conversations[conversationId]!.messageIds.push(id);
        const memoryId = `pagination-memory-${String(index).padStart(3, "0")}`;
        state.memory[memoryId] = {
          id: memoryId, expertId: "product-manager", teamId: null, scope: "personal", kind: "observation",
          text: `page-memory-${index}`, sources: ["fixture"], pinned: false, by: "operator",
        };
      }
      state.memory["pagination-other-expert"] = {
        id: "pagination-other-expert", expertId: "builder", teamId: null, scope: "personal", kind: "observation",
        text: "must-not-cross-expert", sources: ["fixture"], pinned: false, by: "operator",
      };
      return true;
    });

    const readPage = (cursor?: string) => app.client.invoke("expert.context", {
      conversationId, limit: 40, ...(cursor ? { cursor } : {}),
    } as never) as unknown as Promise<{ messages: ExpertMessage[]; nextCursor?: string }>;
    let page = await readPage();
    const seen: ExpertMessage[] = [...page.messages];
    expect(page.messages.map(message => message.sequence)).toEqual(Array.from({ length: 40 }, (_, i) => i + 166));
    while (page.nextCursor) {
      page = await readPage(page.nextCursor);
      seen.unshift(...page.messages);
    }
    expect(seen).toHaveLength(205);
    expect(new Set(seen.map(message => message.id)).size).toBe(205);
    expect(seen.map(message => message.sequence)).toEqual(Array.from({ length: 205 }, (_, i) => i + 1));

    const readMemory = (cursor?: string, query?: string) => app.client.invoke("expert.memory.read", {
      expertId: "product-manager", limit: 40, ...(cursor ? { cursor } : {}), ...(query ? { query } : {}),
    } as never) as unknown as Promise<{ records: { id: string; text: string }[]; nextCursor?: string }>;
    let memoryPage = await readMemory();
    const memoryIds = [...memoryPage.records.map(record => record.id)];
    expect(memoryPage.records).toHaveLength(40);
    expect(memoryPage.records.some(record => record.text === "must-not-cross-expert")).toBe(false);
    await expect(readMemory(memoryPage.nextCursor, "different query")).rejects.toThrow("does not match this read scope");
    const forgedPayload = JSON.parse(Buffer.from(memoryPage.nextCursor!, "base64url").toString("utf8")) as { boundary: string[] };
    forgedPayload.boundary = ["forged-record-id", "forged-record-id"];
    const forgedCursor = Buffer.from(JSON.stringify(forgedPayload), "utf8").toString("base64url");
    await expect(readMemory(forgedCursor)).rejects.toThrow("Invalid pagination cursor boundary");
    while (memoryPage.nextCursor) {
      memoryPage = await readMemory(memoryPage.nextCursor);
      memoryIds.push(...memoryPage.records.map(record => record.id));
    }
    expect(memoryIds).toHaveLength(205);
    expect(new Set(memoryIds).size).toBe(205);

    const stale = await readMemory();
    await mutateExperts(app.app.runtime.service, SYSTEM, "J-MEMORY-PAGINATE:advance", { advance: true }, state => {
      state.memory["pagination-newest"] = {
        id: "pagination-newest", expertId: "product-manager", teamId: null, scope: "personal", kind: "observation",
        text: "new record", sources: ["fixture"], pinned: false, by: "operator",
      };
      return true;
    });
    await expect(readMemory(stale.nextCursor)).rejects.toThrow("Pagination cursor is stale");

    const history = await app.client.invoke("expert.context", { list: true, scope: "solo", expertId: "product-manager", limit: 10 } as never) as { conversations: { id: string; messageCount: number }[] };
    expect(history.conversations).toContainEqual(expect.objectContaining({ id: conversationId, messageCount: 205 }));
    expect(history.conversations.some(conversation => conversation.id === "pagination-private-team-conversation")).toBe(false);
    expect(history.conversations[0]).not.toHaveProperty("messageIds");
    await expect(app.client.invoke("expert.memory.read", { expertId: "product-manager", teamId: "pagination-other-team", limit: 10 } as never)).rejects.toThrow("not a member of this Team");
  });
}, 60_000);
