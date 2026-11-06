// workspace.proof.current: the proof a workspace's agent runs are judged by now. Read-only, operator only.
// The latest PROOF_DECLARED for the workspace wins; an unknown workspace is refused; no declaration is null.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { PROOF_CURRENT, settlementComponent } from "../src/capabilities/settlement.ts";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";

describe("workspace.proof.current", () => {
  test("no declaration reads as null, with the configured proof source", async () => {
    await withTempHome(async (home) => {
      const dir = await mkdtemp(join(tmpdir(), "wb-proof-current-"));
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = (await client.invoke("workspace.select", { path: dir })) as { workspaceId: string };
        expect(await client.invoke("workspace.proof.current", { workspaceId })).toEqual({
          settlementActive: false,
          proofSource: "any",
          sweSeedConfigured: false,
          declared: null,
        });
      } finally {
        await app.stop();
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  test("the latest declaration for the workspace wins", async () => {
    await withTempHome(async (home) => {
      const dir = await mkdtemp(join(tmpdir(), "wb-proof-current-"));
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = (await client.invoke("workspace.select", { path: dir })) as { workspaceId: string };
        await client.invoke("workspace.proof.declare", { workspaceId, argv: ["true"] });
        await client.invoke("workspace.proof.declare", { workspaceId, argv: ["bun", "test"], timeoutS: 120 });
        const current = (await client.invoke("workspace.proof.current", { workspaceId })) as { declared: { argv: string[]; timeoutS: number; workspaceId: string } | null };
        expect(current.declared).not.toBeNull();
        expect(current.declared!.argv).toEqual(["bun", "test"]);
        expect(current.declared!.timeoutS).toBe(120);
        expect(current.declared!.workspaceId).toBe(workspaceId);
      } finally {
        await app.stop();
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  test("without a workspace it answers the settlement configuration alone; an empty id is refused", async () => {
    await withTempHome(async (home) => {
      const dir = await mkdtemp(join(tmpdir(), "wb-proof-current-"));
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = (await client.invoke("workspace.select", { path: dir })) as { workspaceId: string };
        await client.invoke("workspace.proof.declare", { workspaceId, argv: ["true"] });
        // A declaration exists, but with no workspace named none is returned.
        expect(await client.invoke("workspace.proof.current", {})).toEqual({
          settlementActive: false,
          proofSource: "any",
          sweSeedConfigured: false,
          declared: null,
        });
        await expect(client.invoke("workspace.proof.current", { workspaceId: "" })).rejects.toThrow(/non-empty string/);
      } finally {
        await app.stop();
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  test("an unknown workspace is refused, as declare refuses it", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("workspace.proof.current", { workspaceId: "no-such" })).rejects.toThrow(/unknown workspace no-such/);
      } finally {
        await app.stop();
      }
    });
  });

  test("a call from inside a run is refused", async () => {
    // A run's capability calls carry ctx.runId; the guard is the same one declare uses. Captured here from the
    // component so the refusal is exercised without starting an agent run.
    const handlers = new Map<string, (raw: unknown, ctx: unknown) => Promise<unknown>>();
    const component = settlementComponent({
      getService: () => {
        throw new Error("the service must not be reached from a run");
      },
      systemCaller: LOCAL_OPERATOR,
      getKnownWorkspaceIds: () => new Set(["w"]),
      active: false,
    });
    component.activate({
      provide: (contract: { readonly id: string }, handler: (raw: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(contract.id, handler),
    } as never);
    const handler = handlers.get(PROOF_CURRENT);
    expect(handler).toBeDefined();
    await expect(handler!({ workspaceId: "w" }, { actor: { kind: "user", id: "op" }, runId: "run-1" })).rejects.toThrow(/only a direct human operator/);
    await expect(handler!({ workspaceId: "w" }, { actor: { kind: "agent", id: "a" } })).rejects.toThrow(/only a direct human operator/);
  });
});
