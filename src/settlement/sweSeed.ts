// SWE_SEED as the source of the declared proof (readiness P05). The operator names an eval spec in the
// workspace, its sha256 and a `command_check`; SWE_SEED (the owner of the contract format) checks the digest
// and exports the proof exactly as it would run it. Workbench parses nothing of SWE_SEED's format.

export const ENV_SWE_SEED_BIN = "COGNATE_SWE_SEED_BIN";
export const ENV_PROOF_SOURCE = "COGNATE_PROOF_SOURCE";

/** `any`: the operator may type a proof or take it from SWE_SEED. `swe_seed`: only a SWE_SEED contract. */
export type ProofSourceMode = "any" | "swe_seed";

export interface SweSeedSettings {
  /** Absolute path of the pinned `swe-seed` binary, or undefined when SWE_SEED is not configured. */
  readonly bin?: string;
  readonly mode: ProofSourceMode;
}

/** Where a declared proof came from; recorded on the declaration and on every settlement record. */
export interface SweSeedProofSource {
  readonly kind: "swe_seed_eval_spec";
  readonly specPath: string;
  readonly specSha256: string;
  readonly specId: string;
  readonly specVersion: string;
  readonly checkId: string;
}

export function sweSeedFromEnv(env: Readonly<Record<string, string | undefined>>): SweSeedSettings {
  const bin = env[ENV_SWE_SEED_BIN]?.trim() || undefined;
  const raw = env[ENV_PROOF_SOURCE]?.trim() || "any";
  if (raw !== "any" && raw !== "swe_seed") throw new Error(`${ENV_PROOF_SOURCE} must be "any" or "swe_seed"`);
  if (bin && !bin.startsWith("/")) throw new Error(`${ENV_SWE_SEED_BIN} must be an absolute path`);
  if (raw === "swe_seed" && !bin) throw new Error(`${ENV_PROOF_SOURCE}=swe_seed requires ${ENV_SWE_SEED_BIN}`);
  return { ...(bin ? { bin } : {}), mode: raw };
}

/** A pin is 64 hex digits, optionally prefixed `sha256:`; normalised to `sha256:<lowercase hex>`. */
export function normaliseSha256(pin: unknown): string {
  if (typeof pin !== "string") throw new Error("specSha256 must be a string");
  const hex = pin.startsWith("sha256:") ? pin.slice("sha256:".length) : pin;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("specSha256 must be 64 hex digits, optionally prefixed sha256:");
  return `sha256:${hex.toLowerCase()}`;
}

export class SweSeedProofError extends Error {
  constructor(readonly code: string, message: string) {
    super(`SWE_SEED refused the proof (${code}): ${message}`);
  }
}

export interface ExportedProof {
  readonly argv: string[];
  readonly cwd: string;
  readonly source: SweSeedProofSource;
}

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * Ask SWE_SEED for the proof `checkId` declares in the spec at `specPath` (relative to `root`), pinned to
 * `specSha256`. The answer is accepted only if it names the pinned digest and the check asked for.
 */
export async function exportSweSeedProof(input: { readonly bin: string; readonly root: string; readonly specPath: string; readonly specSha256: string; readonly checkId: string; readonly timeoutMs?: number }): Promise<ExportedProof> {
  const pin = normaliseSha256(input.specSha256);
  const proc = Bun.spawn([input.bin, "eval", "proof", "--spec", input.specPath, "--check", input.checkId, "--sha256", pin], {
    cwd: input.root,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), input.timeoutMs ?? 30_000);
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]).finally(() => clearTimeout(timer));
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(out) as Record<string, unknown>;
  } catch {
    throw new SweSeedProofError("unreadable_answer", `exit ${code}: ${(err || out).trim().slice(0, 400)}`);
  }
  if (code !== 0) throw new SweSeedProofError(String(parsed.error ?? "failed"), String(parsed.message ?? `exit ${code}`).slice(0, 400));
  const argv = parsed.argv;
  if (
    parsed.schema !== "swe_seed.eval_proof.v1" || parsed.spec_sha256 !== pin || parsed.check_id !== input.checkId
    || !Array.isArray(argv) || argv.length === 0 || !argv.every(str) || !str(parsed.cwd) || !str(parsed.spec_id) || !str(parsed.spec_version)
  ) {
    throw new SweSeedProofError("unexpected_answer", JSON.stringify(parsed).slice(0, 400));
  }
  return {
    argv: argv as string[],
    cwd: parsed.cwd as string,
    source: { kind: "swe_seed_eval_spec", specPath: input.specPath, specSha256: pin, specId: parsed.spec_id as string, specVersion: parsed.spec_version as string, checkId: input.checkId },
  };
}
