// P03: governed settlement configuration and the operator's declared proof.
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { validateProof, validateProofContract } from "../src/capabilities/settlement.ts";
import { exportSweSeedProof, sweSeedFromEnv } from "../src/settlement/sweSeed.ts";
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

describe("SWE_SEED as the proof source (P05)", () => {
  const pin = "a".repeat(64);

  test("configuration: default any; swe_seed needs an absolute binary; unknown modes are refused", () => {
    expect(sweSeedFromEnv({})).toEqual({ mode: "any" });
    expect(sweSeedFromEnv({ COGNATE_SWE_SEED_BIN: "/bin/swe-seed" })).toEqual({ bin: "/bin/swe-seed", mode: "any" });
    expect(sweSeedFromEnv({ COGNATE_SWE_SEED_BIN: "/bin/swe-seed", COGNATE_PROOF_SOURCE: "swe_seed" })).toEqual({ bin: "/bin/swe-seed", mode: "swe_seed" });
    expect(() => sweSeedFromEnv({ COGNATE_PROOF_SOURCE: "swe_seed" })).toThrow(/requires COGNATE_SWE_SEED_BIN/);
    expect(() => sweSeedFromEnv({ COGNATE_SWE_SEED_BIN: "swe-seed" })).toThrow(/absolute/);
    expect(() => sweSeedFromEnv({ COGNATE_PROOF_SOURCE: "operator" })).toThrow(/"any" or "swe_seed"/);
  });

  test("swe_seed mode without governed settlement is refused at startup", async () => {
    const home = await mkdtemp(join(tmpdir(), "wb-settle-"));
    try {
      await expect(startServer({ port: 0, home, externalAuthority: null, realitytrace: null, sweSeed: { bin: "/b", mode: "swe_seed" } }))
        .rejects.toThrow(/requires governed settlement/);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("a contract declaration names a relative spec, a check and a 64-hex pin", () => {
    expect(validateProofContract({ workspaceId: "w", specPath: "eval/spec.toml", specSha256: `sha256:${"A".repeat(64)}`, checkId: "tests-pass" }))
      .toEqual({ workspaceId: "w", specPath: "eval/spec.toml", specSha256: `sha256:${"a".repeat(64)}`, checkId: "tests-pass", timeoutS: 900 });
    const ok = { workspaceId: "w", specPath: "s.toml", specSha256: pin, checkId: "c" };
    const bad: unknown[] = [
      { ...ok, specPath: "/etc/spec.toml" }, { ...ok, specPath: "../s.toml" }, { ...ok, specPath: "" }, { ...ok, specPath: "a\0b" },
      { ...ok, specSha256: "a".repeat(63) }, { ...ok, specSha256: `md5:${pin}` }, { ...ok, specSha256: undefined },
      { ...ok, checkId: "" }, { ...ok, checkId: "--sha256" }, { ...ok, checkId: "a b" },
      { ...ok, timeoutS: 0 }, { ...ok, argv: ["true"] }, { specPath: "s.toml", specSha256: pin, checkId: "c" },
    ];
    for (const raw of bad) expect(() => validateProofContract(raw), JSON.stringify(raw)).toThrow();
  });

  /** A stand-in `swe-seed` that prints `answer` and exits `code`, recording its arguments. */
  async function fakeSweSeed(dir: string, answer: unknown, code = 0): Promise<string> {
    const bin = join(dir, "swe-seed");
    await writeFile(join(dir, "answer.json"), JSON.stringify(answer));
    await writeFile(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\npwd > "${dir}/cwd"\ncat "${dir}/answer.json"\nexit ${code}\n`);
    await chmod(bin, 0o755);
    return bin;
  }
  const good = (over: Record<string, unknown> = {}) => ({ schema: "swe_seed.eval_proof.v1", spec_id: "s", spec_version: "1", spec_sha256: `sha256:${pin}`, check_id: "c", required: true, argv: ["/bin/sh", "-c", "true"], cwd: ".", ...over });

  test("SWE_SEED's answer is used only if it names the pinned digest and the check asked for", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wb-swe-"));
    try {
      const ask = async (answer: unknown, code = 0) => exportSweSeedProof({ bin: await fakeSweSeed(dir, answer, code), root: dir, specPath: "s.toml", specSha256: pin, checkId: "c" });
      const proof = await ask(good());
      expect(proof).toEqual({ argv: ["/bin/sh", "-c", "true"], cwd: ".", source: { kind: "swe_seed_eval_spec", specPath: "s.toml", specSha256: `sha256:${pin}`, specId: "s", specVersion: "1", checkId: "c" } });
      expect((await readFile(join(dir, "args"), "utf8")).trim().split("\n")).toEqual(["eval", "proof", "--spec", "s.toml", "--check", "c", "--sha256", `sha256:${pin}`]);
      expect((await readFile(join(dir, "cwd"), "utf8")).trim()).toBe(await realpath(dir));

      await expect(ask({ error: "spec_digest_mismatch", message: "spec digest sha256:bbb does not equal the pin" }, 2)).rejects.toThrow(/spec_digest_mismatch/);
      await expect(ask(good({ spec_sha256: `sha256:${"b".repeat(64)}` }))).rejects.toThrow(/unexpected_answer/);
      await expect(ask(good({ check_id: "other" }))).rejects.toThrow(/unexpected_answer/);
      await expect(ask(good({ schema: "swe_seed.eval_proof.v2" }))).rejects.toThrow(/unexpected_answer/);
      await expect(ask(good({ argv: [] }))).rejects.toThrow(/unexpected_answer/);
      await expect(ask(good({ argv: ["/bin/sh", 1] }))).rejects.toThrow(/unexpected_answer/);
      await expect(ask("not json at all")).rejects.toThrow(/unexpected_answer|unreadable/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
