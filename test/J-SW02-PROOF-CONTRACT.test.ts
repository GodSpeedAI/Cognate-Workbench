// J-SW02-PROOF-CONTRACT (readiness P05): the proof an agent's work is judged by comes from a SWE_SEED eval spec
// frozen by the operator's sha256, not from a typed command. Real Workbench, real `swe-seed`, real
// sea-forge-server (RealityTrace corroboration), real RealityTrace, real bubblewrap; only the model is mocked.
// Workbench runs with COGNATE_PROOF_SOURCE=swe_seed.
//   1. Declared from the contract, an approved edit that passes its command_check is settled, final; the record
//      names the spec, check and digest, and RealityTrace ran exactly the argv SWE_SEED exported.
//   2. A pin that is not the file's digest is refused and nothing is declared.
//   3. A check that is not a command_check is refused.
//   4. A typed proof is refused; one typed before swe_seed mode is not used to judge a run.
//   5. The agent's side rewriting the spec mid-run does not change the proof: the declared rule judges.
//   6. SWE_SEED's own `eval run --trusted` reaches the same verdicts.
// Opt-in: SWE_SEED_BIN plus the J-SW01 prerequisites.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import type { ProofSourceMode } from "../src/settlement/sweSeed.ts";
import { bootAimock } from "./helpers.ts";
import { gitWorkspace, liveSettlementEnabled, startLiveCell, treeDigest, until, type LiveCell } from "./liveSettlement.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";

const SWE = process.env.SWE_SEED_BIN;
const liveTest = liveSettlementEnabled && Boolean(SWE) ? test : test.skip;

/** A SWE_SEED eval spec whose `greeting` command_check runs `rule`; `readme` is a file check. */
const spec = (rule: string) => `id = "wb-greeting"
version = "1.0.0"
run_id = "sw02"
target_type = "repository"
target_path = "."
purpose = "the greeting the task asks for"
eval_classes = ["ProcessCompliance"]
pass_condition = "all required checks pass"
outputs = []

[[checks]]
id = "greeting"
eval_class = "ProcessCompliance"
check_type = "command_check"
rule = ${JSON.stringify(rule)}

[[checks]]
id = "readme"
eval_class = "ProcessCompliance"
check_type = "file_exists"
target = "README.md"
`;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** SWE_SEED's own verdict on a copy of `dir` (eval run writes its frozen sidecar, so never in the workspace). */
async function sweSeedVerdict(dir: string, specText: string): Promise<{ exit: number; greeting: string }> {
  const copy = await mkdtemp(join(tmpdir(), "wb-sw02-eval-"));
  try {
    await cp(dir, copy, { recursive: true });
    await writeFile(join(copy, "eval.toml"), specText);
    const p = Bun.spawnSync([SWE!, "eval", "run", "--spec", "eval.toml", "--trusted"], { cwd: copy });
    const result = JSON.parse(p.stdout.toString()) as { checks: { id: string; status: string }[] };
    return { exit: p.exitCode ?? -1, greeting: result.checks.find((c) => c.id === "greeting")!.status };
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
}

liveTest("J-SW02-PROOF-CONTRACT: the declared proof comes from a SWE_SEED contract frozen by digest", async () => {
  let cell: LiveCell | undefined;
  let app: AppServer | undefined;
  const aimock = await bootAimock();
  try {
    cell = await startLiveCell("wb-sw02");
    const { root, realitytrace, externalAuthority, containmentConfig } = cell;
    const home = join(root, "home");
    const boot = async (mode: ProofSourceMode) => {
      const a = await startServer({ devAuth: true, port: 0, home, containmentConfig, externalAuthority, realitytrace, sweSeed: { bin: SWE!, mode } });
      const c = createClient({ service: createRemoteRuntimeService(connectTransport(a.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
      await c.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock.port}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
      return { a, c };
    };
    let booted = await boot("swe_seed");
    app = booted.a;

    const workspace = async (name: string, rule: string) => {
      const dir = join(root, name);
      const specText = spec(rule);
      await gitWorkspace(dir, { "src/greet.ts": "export const greet = () => \"Hello\";\n", "README.md": "greeting\n", "eval.toml": specText });
      const { workspaceId } = await booted.c.invoke("workspace.contained.select", { path: dir }) as { workspaceId: string };
      return { dir, workspaceId, specText, pin: sha256(specText) };
    };
    /** An approved agent edit (Hello -> Howdy); `meanwhile` runs while the edit waits for approval. */
    const approvedEdit = async (workspaceId: string, meanwhile?: () => Promise<void>) => {
      const { a, c } = booted;
      const sessionId = randomUUID();
      const { runId } = await c.startRun("agent.coding", { sessionId, workspaceId, message: "[[scenario:edit]] change the greeting" } as never, { idempotencyKey: randomUUID(), correlationId: `session:${sessionId}` });
      await until(() => a.runtime.service.getRun(LOCAL_OPERATOR, { runId }).then((r) => r.status), (s) => s === "waiting", "the edit waits for approval");
      await meanwhile?.();
      const wait = (await a.runtime.service.listContinuations(LOCAL_OPERATOR, { runId, status: "OPEN" }))[0]!;
      await c.invoke("governance.approval.resolve", { approvalId: (wait.condition as { approvalId: string }).approvalId, resolution: "approved" });
      await until(() => a.runtime.service.getRun(LOCAL_OPERATOR, { runId }).then((r) => r.status), (s) => s === "completed", "the run completes");
      return runId;
    };
    const statusOf = async (runId: string) => booted.c.invoke("settlement.status", { runId }) as Promise<{ operations: Record<string, unknown>[]; evidence: Record<string, unknown>[] }>;
    const finalOf = (runId: string) => until(() => statusOf(runId), (s) => s.operations.length > 0 && s.operations.every((o) => o.final === true), `run ${runId} settles`, 120_000);
    const declarations = async (workspaceId: string) => {
      let n = 0;
      for await (const e of booted.a.runtime.service.events(LOCAL_OPERATOR, {})) if (e.eventType === "workbench.proof.declared" && (e.payload as { workspaceId?: string }).workspaceId === workspaceId) n++;
      return n;
    };

    // 1. Settled on the contract's proof. (Containment of the proof run is J-SW01's; this rule stays one SWE_SEED
    //    can also run uncontained, so step 6 compares like with like.)
    const rule = "grep -q Howdy src/greet.ts";
    const ok = await workspace("ws-settled", rule);
    const exported = Bun.spawnSync([SWE!, "eval", "proof", "--spec", "eval.toml", "--check", "greeting", "--sha256", ok.pin], { cwd: ok.dir });
    expect(exported.exitCode, exported.stdout.toString()).toBe(0);
    const swe = JSON.parse(exported.stdout.toString()) as { argv: string[]; cwd: string };
    const declared = await booted.c.invoke("workspace.proof.declare_contract", { workspaceId: ok.workspaceId, specPath: "eval.toml", specSha256: ok.pin, checkId: "greeting" }) as Record<string, unknown>;
    expect(declared.argv).toEqual(swe.argv);
    expect(declared.argv).toEqual(["sh", "-c", rule]);
    const source = { kind: "swe_seed_eval_spec", specPath: "eval.toml", specSha256: `sha256:${ok.pin}`, specId: "wb-greeting", specVersion: "1.0.0", checkId: "greeting" };
    expect(declared.source).toEqual(source);
    const settled = await finalOf(await approvedEdit(ok.workspaceId));
    expect(settled.operations).toHaveLength(1);
    expect(settled.operations[0]).toMatchObject({ capability: "tool.edit", status: "settled", final: true, exitCode: 0, proofSource: source });
    expect(settled.evidence[0]!.argv).toEqual(swe.argv);
    expect(settled.operations[0]!.targetDigest).toBe(await treeDigest(ok.dir));

    // 2. A pin that is not the file's digest: refused, nothing declared.
    const other = await workspace("ws-pin", "true");
    await expect(booted.c.invoke("workspace.proof.declare_contract", { workspaceId: other.workspaceId, specPath: "eval.toml", specSha256: sha256(other.specText + " "), checkId: "greeting" }))
      .rejects.toThrow(/spec_digest_mismatch/);
    // 3. A check that is not a command_check: refused.
    await expect(booted.c.invoke("workspace.proof.declare_contract", { workspaceId: other.workspaceId, specPath: "eval.toml", specSha256: other.pin, checkId: "readme" }))
      .rejects.toThrow(/not_command_check/);
    // 4. A typed proof: refused.
    await expect(booted.c.invoke("workspace.proof.declare", { workspaceId: other.workspaceId, argv: ["/bin/sh", "-c", "true"] }))
      .rejects.toThrow(/COGNATE_PROOF_SOURCE=swe_seed/);
    expect(await declarations(other.workspaceId)).toBe(0);

    // 5. The spec is weakened to `true` while the edit waits: the declared rule (Hola, which the edit does not
    //    write) still judges, so the work is rejected.
    const strict = await workspace("ws-tamper", "grep -q Hola src/greet.ts");
    await booted.c.invoke("workspace.proof.declare_contract", { workspaceId: strict.workspaceId, specPath: "eval.toml", specSha256: strict.pin, checkId: "greeting" });
    const tamperedRun = await approvedEdit(strict.workspaceId, () => writeFile(join(strict.dir, "eval.toml"), spec("true")));
    const rejected = await finalOf(tamperedRun);
    expect(rejected.operations[0]).toMatchObject({ status: "rejected", final: true, proofSource: { specSha256: `sha256:${strict.pin}`, checkId: "greeting" } });
    expect(rejected.evidence[0]!.argv).toEqual(["sh", "-c", "grep -q Hola src/greet.ts"]);
    expect(await readFile(join(strict.dir, "eval.toml"), "utf8")).toContain('rule = "true"');

    // 4b. A proof typed while any source was allowed does not judge a run under swe_seed.
    await booted.a.stop();
    booted = await boot("any");
    app = booted.a;
    const typed = await workspace("ws-typed", "true");
    await booted.c.invoke("workspace.proof.declare", { workspaceId: typed.workspaceId, argv: ["/bin/sh", "-c", "true"] });
    await booted.a.stop();
    booted = await boot("swe_seed");
    app = booted.a;
    const notAttempted = await finalOf(await approvedEdit(typed.workspaceId));
    expect(notAttempted.operations[0]).toMatchObject({ status: "not-attempted", final: true, proofSource: { kind: "operator_argv" } });
    expect(String(notAttempted.operations[0]!.reason)).toContain("SWE_SEED");
    expect(notAttempted.evidence).toHaveLength(0);

    // 6. SWE_SEED's own trusted run agrees with each settlement.
    expect(await sweSeedVerdict(ok.dir, ok.specText)).toEqual({ exit: 0, greeting: "Pass" });
    expect(await sweSeedVerdict(strict.dir, strict.specText)).toEqual({ exit: 1, greeting: "Fail" });
  } finally {
    if (app) await app.stop().catch(() => {});
    await aimock.stop();
    await cell?.stop();
  }
}, 600_000);
