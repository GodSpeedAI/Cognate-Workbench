// P03: governed settlement configuration and the operator's declared proof.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { validateProof } from "../src/capabilities/settlement.ts";
import { realityTraceFromEnv } from "../src/settlement/realitytrace.ts";
import { LOCAL_OPERATOR, startServer } from "../src/server.ts";

describe("RealityTrace settlement configuration", () => {
  test("unset means off; a partial or relative configuration is refused", () => {
    expect(realityTraceFromEnv({})).toBeUndefined();
    expect(() => realityTraceFromEnv({ COGNATE_REALITYTRACE_BIN: "/usr/bin/realitytrace" })).toThrow(/together/);
    expect(() => realityTraceFromEnv({ COGNATE_REALITYTRACE_BIN: "realitytrace", COGNATE_REALITYTRACE_DATA_HOME: "/d", COGNATE_REALITYTRACE_STATE_HOME: "/s" })).toThrow(/absolute/);
    expect(realityTraceFromEnv({ COGNATE_REALITYTRACE_BIN: "/b", COGNATE_REALITYTRACE_DATA_HOME: "/d", COGNATE_REALITYTRACE_STATE_HOME: "/s" })).toEqual({ bin: "/b", dataHome: "/d", stateHome: "/s" });
  });

  test("settlement without SEA-Forge governance is refused at startup", async () => {
    const home = await mkdtemp(join(tmpdir(), "wb-settle-"));
    try {
      await expect(startServer({ port: 0, home, externalAuthority: null, realitytrace: { bin: "/b", dataHome: "/d", stateHome: "/s" } }))
        .rejects.toThrow(/requires COGNATE_GOVERNANCE=sea-forge/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("without settlement the status says so and an operator still sees an empty record", async () => {
    const home = await mkdtemp(join(tmpdir(), "wb-settle-"));
    const app = await startServer({ port: 0, home, externalAuthority: null, realitytrace: null });
    try {
      expect(app.settlement).toBeUndefined();
      expect(await app.runtime.service.invoke(LOCAL_OPERATOR, { capability: "settlement.status", input: {} })).toEqual({ active: false, operations: [], evidence: [] });
    } finally {
      await app.stop();
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("the declared proof", () => {
  test("a valid declaration gets defaults", () => {
    expect(validateProof({ workspaceId: "w", argv: ["bun", "test"] })).toEqual({ workspaceId: "w", argv: ["bun", "test"], cwd: ".", timeoutS: 900 });
  });

  test("anything the proof could use to escape or overreach is refused", () => {
    const bad: unknown[] = [
      { workspaceId: "w", argv: [] },
      { workspaceId: "w", argv: [""] },
      { workspaceId: "w", argv: ["x\0y"] },
      { workspaceId: "w", argv: ["bun"], cwd: "/etc" },
      { workspaceId: "w", argv: ["bun"], cwd: "../other" },
      { workspaceId: "w", argv: ["bun"], cwd: "a/../../b" },
      { workspaceId: "w", argv: ["bun"], timeoutS: 0 },
      { workspaceId: "w", argv: ["bun"], timeoutS: 3601 },
      { workspaceId: "w", argv: ["bun"], timeoutS: 1.5 },
      { workspaceId: "w", argv: ["bun"], launcher: ["sudo"] },
      { argv: ["bun"] },
    ];
    for (const raw of bad) expect(() => validateProof(raw), JSON.stringify(raw)).toThrow();
  });

  test("only a direct human operator may declare it", async () => {
    const home = await mkdtemp(join(tmpdir(), "wb-settle-"));
    const app = await startServer({ port: 0, home, externalAuthority: null, realitytrace: null });
    try {
      const system = { tenant: LOCAL_OPERATOR.tenant, actor: { kind: "system" as const, id: "cognate-workbench" } };
      await expect(app.runtime.service.invoke(system, { capability: "workspace.proof.declare", input: { workspaceId: "w", argv: ["true"] } }))
        .rejects.toThrow(/only a direct human operator/);
      await expect(app.runtime.service.invoke(LOCAL_OPERATOR, { capability: "workspace.proof.declare", input: { workspaceId: "no-such", argv: ["true"] } }))
        .rejects.toThrow(/unknown workspace/);
    } finally {
      await app.stop();
      await rm(home, { recursive: true, force: true });
    }
  });
});
