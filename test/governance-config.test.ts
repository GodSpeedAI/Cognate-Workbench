// P02: SEA-Forge as the external authority — configuration rules and the containment precondition.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { externalAuthorityFromEnv, type ExternalAuthority } from "../src/capabilities/governance.ts";
import { LOCAL_OPERATOR, startServer } from "../src/server.ts";

const WORLD = `world:workbench@sha256:${"a".repeat(64)}`;
const full = { COGNATE_GOVERNANCE: "sea-forge", COGNATE_SEA_FORGE_SOCKET: "/tmp/sf.sock", COGNATE_WORLD_REF: WORLD, COGNATE_SEA_FORGE_OPERATOR: "operator" };

describe("external authority configuration", () => {
  test("unset means off", () => {
    expect(externalAuthorityFromEnv({})).toBeUndefined();
    expect(externalAuthorityFromEnv({ COGNATE_GOVERNANCE: "off" })).toBeUndefined();
  });

  test("an operator without sea-forge mode is refused, not ignored", () => {
    expect(() => externalAuthorityFromEnv({ COGNATE_SEA_FORGE_OPERATOR: "operator" })).toThrow(/refusing to guess/);
  });

  test("sea-forge mode needs a distinct operator actor", () => {
    const { COGNATE_SEA_FORGE_OPERATOR: _omit, ...withoutOperator } = full;
    expect(() => externalAuthorityFromEnv(withoutOperator)).toThrow(/COGNATE_SEA_FORGE_OPERATOR/);
    expect(() => externalAuthorityFromEnv({ ...full, COGNATE_SEA_FORGE_OPERATOR: "cognate-service" })).toThrow(/must differ/);
    expect(() => externalAuthorityFromEnv({ ...full, COGNATE_SEA_FORGE_OPERATOR: "bad actor!" })).toThrow(/COGNATE_SEA_FORGE_OPERATOR/);
  });

  test("a complete configuration names service, operator, socket and world, and polls for decisions", () => {
    const a = externalAuthorityFromEnv(full)!;
    expect(a.governance.mode).toBe("sea-forge");
    expect(a.governance.worldRef).toBe(WORLD);
    expect(a.governance.approvalPollMs).toBe(2_000);
    expect(a.socketPath).toBe("/tmp/sf.sock");
    expect(a.service).toEqual({ actor_id: "cognate-service", role: "service" });
    expect(a.operator).toEqual({ actor_id: "operator", role: "operator" });
  });
});

describe("startServer with an external authority", () => {
  test("refuses the uncontained-local posture (an agent could approve its own escalation)", async () => {
    const home = await mkdtemp(join(tmpdir(), "wb-gov-"));
    try {
      const authority = externalAuthorityFromEnv(full) as ExternalAuthority;
      await expect(startServer({ port: 0, home, executionPosture: "uncontained-local", externalAuthority: authority }))
        .rejects.toThrow(/requires COGNATE_EXECUTION_POSTURE=contained/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("governance is off by default and says so", async () => {
    const home = await mkdtemp(join(tmpdir(), "wb-gov-"));
    const app = await startServer({ port: 0, home, externalAuthority: null });
    try {
      expect(await app.runtime.service.invoke(LOCAL_OPERATOR, { capability: "governance.status", input: {} })).toEqual({ mode: "off" });
      await expect(app.runtime.service.invoke(LOCAL_OPERATOR, { capability: "governance.approvals.list", input: {} })).rejects.toThrow(/No external authority/);
    } finally {
      await app.stop();
      await rm(home, { recursive: true, force: true });
    }
  });
});
