// A frozen evaluation criterion. `executor != evaluator authority`: once frozen, the object is
// deep-frozen and bound to its hash; a revision is a new criterion with a new hash and requires a
// human authority. Observer coverage is part of the criterion, so a green run states what it proves.
import { hashOf } from "./canonical.ts";

export interface CriterionSpec {
  readonly version: number;
  /** Check ids that must pass. */
  readonly requiredChecks: readonly string[];
  /** Consequences these checks observe. */
  readonly observed: readonly string[];
  /** Consequences that matter but no check observes. Non-empty => settlement is not established. */
  readonly unobserved: readonly string[];
  readonly guardrails: readonly string[];
  readonly protectedInvariants: readonly string[];
}

export interface FrozenCriterion extends CriterionSpec {
  readonly criterionHash: string;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

export function freezeCriterion(spec: CriterionSpec): FrozenCriterion {
  const copy = JSON.parse(JSON.stringify(spec)) as CriterionSpec;
  return deepFreeze({ ...copy, criterionHash: hashOf(copy) });
}

/** True only if `criterion` still hashes to its recorded hash (detects tampering through any alias). */
export function criterionIntact(criterion: FrozenCriterion): boolean {
  const { criterionHash, ...spec } = criterion;
  return hashOf(spec) === criterionHash;
}

export function reviseCriterion(prior: FrozenCriterion, next: Omit<CriterionSpec, "version">, authority: { readonly kind: string }): FrozenCriterion {
  if (authority.kind !== "user") throw new Error("criterion revision requires human authority");
  return freezeCriterion({ ...next, version: prior.version + 1 });
}

export interface CheckResult {
  readonly checkId: string;
  readonly passed: boolean;
  /** The criterion this result was produced under. A result under another hash never counts. */
  readonly criterionHash: string;
}

export interface Observation {
  readonly passed: number;
  readonly total: number;
  readonly failed: readonly string[];
  readonly missing: readonly string[];
  readonly allRequiredPassed: boolean;
  readonly observed: readonly string[];
  readonly unobserved: readonly string[];
  /** Green does not imply settlement: coverage gaps keep this false. */
  readonly settlementEstablished: boolean;
}

export function observe(criterion: FrozenCriterion, results: readonly CheckResult[]): Observation {
  const latest = new Map<string, boolean>();
  for (const r of results) if (r.criterionHash === criterion.criterionHash) latest.set(r.checkId, r.passed);
  const failed = criterion.requiredChecks.filter((id) => latest.get(id) === false);
  const missing = criterion.requiredChecks.filter((id) => !latest.has(id));
  const passed = criterion.requiredChecks.filter((id) => latest.get(id) === true).length;
  const allRequiredPassed = failed.length === 0 && missing.length === 0;
  return {
    passed,
    total: criterion.requiredChecks.length,
    failed,
    missing,
    allRequiredPassed,
    observed: criterion.observed,
    unobserved: criterion.unobserved,
    settlementEstablished: allRequiredPassed && criterion.unobserved.length === 0,
  };
}
