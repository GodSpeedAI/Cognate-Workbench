// RealityTrace for governed settlement (readiness P03). RealityTrace, not the agent and not Workbench,
// runs the task's declared verifier and records what it observed. Workbench only reads back the
// evidence RealityTrace derived, to package it for SEA-Forge.
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SxrEvidenceRow } from "@godspeedai/cognate-realitytrace";

export interface RealityTraceSettings {
  /** Absolute path of the `realitytrace` binary. */
  readonly bin: string;
  /** RealityTrace's data and state homes. SEA-Forge must read the same ones to corroborate evidence. */
  readonly dataHome: string;
  readonly stateHome: string;
}

const ENV_BIN = "COGNATE_REALITYTRACE_BIN";
const ENV_DATA = "COGNATE_REALITYTRACE_DATA_HOME";
const ENV_STATE = "COGNATE_REALITYTRACE_STATE_HOME";

/** All three variables, or none. A partial configuration is an error, never a silent "off". */
export function realityTraceFromEnv(env: Readonly<Record<string, string | undefined>>): RealityTraceSettings | undefined {
  const [bin, dataHome, stateHome] = [env[ENV_BIN]?.trim(), env[ENV_DATA]?.trim(), env[ENV_STATE]?.trim()];
  if (!bin && !dataHome && !stateHome) return undefined;
  if (!bin || !dataHome || !stateHome) throw new Error(`settlement needs ${ENV_BIN}, ${ENV_DATA} and ${ENV_STATE} together`);
  for (const [name, value] of [[ENV_BIN, bin], [ENV_DATA, dataHome], [ENV_STATE, stateHome]] as const) {
    if (!value.startsWith("/")) throw new Error(`${name} must be an absolute path`);
  }
  return { bin, dataHome, stateHome };
}

/** The question every Workbench task proof answers, declared once per enrolled workspace. */
export const PROOF_QUESTION = {
  question_id: "workbench-task-proof",
  question_form: "is_true",
  question_type: "verification",
  target_entities: [],
  expected_answer_shape: "boolean",
} as const;
const PROOF_THRESHOLD = { threshold_id: "workbench-task-proof-threshold", minimum_relevance: "medium", minimum_reliability: "medium" } as const;

export interface DeclaredProof {
  readonly argv: readonly string[];
  /** Relative to the workspace root. */
  readonly cwd: string;
  readonly timeoutS: number;
}

export interface VerifiedProof {
  readonly repoId: string;
  readonly sxrRunId: string;
  readonly observationId: string;
  readonly exitCode: number | null;
  readonly targetDigest: string;
  readonly evidenceId: string;
  readonly row: SxrEvidenceRow;
  readonly question: Record<string, unknown>;
}

type Row = { readonly ledger_id: string; readonly append_ordinal: number; readonly record_kind: string; readonly payload: Record<string, unknown> };

export class RealityTraceCli {
  constructor(private readonly settings: RealityTraceSettings) {}

  async run(args: readonly string[]): Promise<unknown> {
    const proc = Bun.spawn([this.settings.bin, ...args, "--json"], {
      env: { XDG_DATA_HOME: this.settings.dataHome, XDG_STATE_HOME: this.settings.stateHome, PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/nonexistent" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    if (code !== 0) throw new Error(`realitytrace ${args.slice(0, 2).join(" ")} failed (${code}): ${err.trim().slice(0, 400)}`);
    try { return JSON.parse(out); }
    catch { throw new Error(`realitytrace ${args.slice(0, 2).join(" ")} answered invalid JSON`); }
  }

  async ledger(repoId: string): Promise<Row[]> {
    return await this.run(["ledger", "export", "--repo", repoId]) as Row[];
  }

  /** The repo enrolled at `root` (a git checkout), enrolling it once, with the proof question declared. */
  async ensureRepo(root: string): Promise<string> {
    const path = await realpath(root);
    const listed = await this.run(["repo", "list"]) as { repos?: { repo_id: string; filesystem_path: string }[] };
    let repoId = listed.repos?.find((r) => r.filesystem_path === path)?.repo_id;
    if (!repoId) repoId = (await this.run(["repo", "enroll", path]) as { repo_id: string }).repo_id;
    const rows = await this.ledger(repoId);
    const declared = (kind: string, id: string) => rows.some((r) => r.record_kind === kind && JSON.stringify(r.payload).includes(`"${id}"`));
    const dir = await mkdtemp(join(tmpdir(), "wb-rt-"));
    try {
      if (!declared("question.declared", PROOF_QUESTION.question_id)) {
        await writeFile(join(dir, "q.json"), JSON.stringify(PROOF_QUESTION));
        await this.run(["question", "declare", "--repo", repoId, "--file", join(dir, "q.json")]);
      }
      if (!declared("threshold.declared", PROOF_THRESHOLD.threshold_id)) {
        await writeFile(join(dir, "t.json"), JSON.stringify(PROOF_THRESHOLD));
        await this.run(["threshold", "declare", "--repo", repoId, "--question", PROOF_QUESTION.question_id, "--file", join(dir, "t.json")]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return repoId;
  }

  /**
   * RealityTrace runs the declared proof under `launcher` (Workbench's containment) and derives evidence
   * from the exit code. Returns the evidence row exactly as RealityTrace recorded it.
   */
  async verify(input: { readonly root: string; readonly snapshot: string; readonly proof: DeclaredProof; readonly launcher: readonly string[] }): Promise<VerifiedProof> {
    const repoId = await this.ensureRepo(input.root);
    const sxrRunId = (await this.run(["run", "begin", "--repo", repoId, "--snapshot", input.snapshot, "--question", PROOF_QUESTION.question_id, "--threshold", PROOF_THRESHOLD.threshold_id]) as { run_id: string }).run_id;
    await this.run(["plan", "create", "--run", sxrRunId, "--verifier", "command", "--target", "concept:workbench-task",
      "--argv-json", JSON.stringify(input.proof.argv), "--cwd", input.proof.cwd, "--timeout-s", String(input.proof.timeoutS),
      "--launcher-json", JSON.stringify(input.launcher)]);
    const observation = (await this.run(["verify", "run", "--run", sxrRunId]) as { observations: { observation_id: string; exit_code: number | null; target_digest: string; verifier_id: string }[] }).observations[0]!;
    if (observation.verifier_id !== "command") throw new Error(`RealityTrace ran verifier ${observation.verifier_id}, not the declared command`);
    const evidence = await this.run(["evidence", "create", "--run", sxrRunId, "--observation", observation.observation_id, "--derive"]) as { evidence_id: string; ledger_position: { ledger_id: string; append_ordinal: number } };
    const rows = await this.ledger(repoId);
    const at = rows.find((r) => r.ledger_id === evidence.ledger_position.ledger_id && r.append_ordinal === evidence.ledger_position.append_ordinal);
    const item = (at?.payload.evidence as Record<string, unknown>[] | undefined)?.find((e) => e.evidence_id === evidence.evidence_id);
    if (!at || at.record_kind !== "evidence.created" || !item) throw new Error(`RealityTrace did not record evidence ${evidence.evidence_id} where it said`);
    const questionRow = rows.find((r) => r.record_kind === "question.declared" && JSON.stringify(r.payload).includes(`"${PROOF_QUESTION.question_id}"`));
    const question = ((questionRow?.payload.questions as Record<string, unknown>[] | undefined) ?? []).find((q) => q.question_id === PROOF_QUESTION.question_id) ?? { ...PROOF_QUESTION };
    return {
      repoId, sxrRunId,
      observationId: observation.observation_id,
      exitCode: observation.exit_code,
      targetDigest: observation.target_digest,
      evidenceId: evidence.evidence_id,
      row: { evidence: item, position: { ledger_id: at.ledger_id, append_ordinal: at.append_ordinal } } as SxrEvidenceRow,
      question,
    };
  }
}
