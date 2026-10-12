import { describe, expect, test } from "bun:test";
import { canonicalize, hashOf, shortHash } from "../src/cognitive/canonical.ts";
import { worldManifest, worldHash, foldLineage, checkPromotion, diffManifests, WORLD_EVENTS } from "../src/cognitive/world.ts";
import { freezeCriterion, criterionIntact, reviseCriterion, observe } from "../src/cognitive/criterion.ts";
import { createMediationHost, TrustedSubchainRecursion, TierEscalation, type MediationEvent, type Outcome } from "../src/cognitive/mediation.ts";
import { sentinel, userToyMod, type Finding } from "../src/cognitive/sentinel.ts";
import { validateSurface, SurfaceError, surfaceVisible } from "../src/cognitive/surface.ts";
import { resolveAffordances, capabilityNeighborhood, type PossibleOperation } from "../src/cognitive/affordance.ts";
import { deriveCase, reality, realityOfCheck, CASE_EVENTS } from "../src/cognitive/case.ts";
import { searchEligibility, judgeRound, foldSearch, type ExperimentRound } from "../src/cognitive/experiment.ts";
import { recommendFromRounds, acceptMethod, observerMayWrite } from "../src/cognitive/method.ts";

const base = { semanticModelHash: "s", policyHash: "p", environmentHash: "e", files: { "a.ts": "h1" } };
const ev = (position: number, eventType: string, payload: Record<string, unknown>) => ({ position, eventType, payload });

describe("world identity", () => {
  test("canonical serialization is key-order independent and deterministic", () => {
    expect(canonicalize({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalize({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(() => canonicalize({ a: NaN })).toThrow();
  });
  test("same consequential world -> same SHA-256; change -> new hash; repoSha != worldHash", () => {
    const a = worldHash(worldManifest({ ...base, repoSha: "abc" }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(worldHash(worldManifest({ repoSha: "abc", ...base }))).toBe(a);
    expect(worldHash(worldManifest({ ...base, repoSha: "abc", files: { "a.ts": "h2" } }))).not.toBe(a);
    // same repo SHA, different policy -> different world
    expect(worldHash(worldManifest({ ...base, repoSha: "abc", policyHash: "p2" }))).not.toBe(a);
    expect(shortHash(a)).toBe(`${a.slice(0, 4)}…${a.slice(-4)}`);
  });
  test("volatile metadata is not part of identity", () => {
    // origin/parent/status/timestamps are event metadata, not manifest fields: promotion keeps the hash.
    const promoted = foldLineage([...lineageEvents, ev(3, WORLD_EVENTS.settled, { worldHash: c1, authority: { actorId: "u" } })]);
    expect(promoted.worlds.get(c1)?.worldHash).toBe(c1);
    expect(hashOf({ a: 1, t: undefined })).toBe(hashOf({ a: 1 }));
  });
});

const s0 = worldHash(worldManifest(base));
const c1 = worldHash(worldManifest({ ...base, files: { "a.ts": "h2" } }));
const lineageEvents = [
  ev(1, WORLD_EVENTS.baseline, { worldHash: s0, caseId: "k", runId: "r", manifest: worldManifest(base) }),
  ev(2, WORLD_EVENTS.candidate, { candidateHash: c1, parentWorldHash: s0, sandboxId: "cb-1", caseId: "k", runId: "r" }),
];
describe("lineage and promotion", () => {
  test("candidate never overwrites parent; survives rebuild", () => {
    const l = foldLineage(lineageEvents);
    expect(l.settledHead).toBe(s0);
    expect(l.worlds.get(s0)?.status).toBe("settled");
    expect(l.worlds.get(c1)?.status).toBe("candidate");
    expect(foldLineage([...lineageEvents].reverse()).settledHead).toBe(s0); // order by position, not array
  });
  test("candidate cannot silently settle; needs human, evidence, reachability, current parent", () => {
    const l = foldLineage(lineageEvents);
    const ok = { candidateHash: c1, authority: { actorId: "u", kind: "user" }, evidenceRefs: ["3"], settlementReachable: true };
    expect(checkPromotion(l, ok)).toEqual({ ok: true });
    expect(checkPromotion(l, { ...ok, authority: { actorId: "agent", kind: "agent" } })).toEqual({ ok: false, reason: "not-human-authority" });
    expect(checkPromotion(l, { ...ok, evidenceRefs: [] })).toEqual({ ok: false, reason: "no-evidence" });
    expect(checkPromotion(l, { ...ok, settlementReachable: false })).toEqual({ ok: false, reason: "settlement-not-reachable" });
    const advanced = foldLineage([...lineageEvents, ev(3, WORLD_EVENTS.settled, { worldHash: c1, authority: { actorId: "u" }, evidenceRefs: ["3"] })]);
    expect(advanced.settledHead).toBe(c1);
    expect(advanced.worlds.get(c1)?.settledFromCandidate).toBe(true);
    // a second candidate forked from the old head is now stale
    const stale = foldLineage([...lineageEvents, ev(3, WORLD_EVENTS.candidate, { candidateHash: "dead", parentWorldHash: s0 }), ev(4, WORLD_EVENTS.settled, { worldHash: c1 })]);
    expect(checkPromotion(stale, { ...ok, candidateHash: "dead" })).toEqual({ ok: false, reason: "stale-parent" });
  });
  test("rejected candidate stays rejected", () => {
    const l = foldLineage([...lineageEvents, ev(3, WORLD_EVENTS.rejected, { candidateHash: c1 })]);
    expect(checkPromotion(l, { candidateHash: c1, authority: { actorId: "u", kind: "user" }, evidenceRefs: ["1"], settlementReachable: true })).toEqual({ ok: false, reason: "rejected" });
  });
  test("destroying a sandbox does not touch lineage (sandbox is only a correlation id)", () => {
    expect(foldLineage(lineageEvents).worlds.get(c1)?.sandboxId).toBe("cb-1");
  });
  test("diff names the consequential differences", () => {
    expect(diffManifests(worldManifest(base), worldManifest({ ...base, files: { "a.ts": "h2" } }))).toEqual([{ key: "file:a.ts", before: "h1", after: "h2" }]);
  });
});

const spec = { version: 1, requiredChecks: ["unit", "integration"], observed: ["ordering"], unobserved: [], guardrails: [], protectedInvariants: ["source-unchanged"] };
describe("criterion", () => {
  test("hash is protected from executor mutation; revision gives a new identity", () => {
    const c = freezeCriterion(spec);
    expect(criterionIntact(c)).toBe(true);
    expect(() => { (c.requiredChecks as string[]).push("x"); }).toThrow();
    expect(() => reviseCriterion(c, { ...spec }, { kind: "agent" })).toThrow();
    const v2 = reviseCriterion(c, { ...spec, requiredChecks: ["unit"] }, { kind: "user" });
    expect(v2.criterionHash).not.toBe(c.criterionHash);
    expect(v2.version).toBe(2);
  });
  test("results under another criterion never count; green with unobserved gap is not settlement", () => {
    const c = freezeCriterion(spec);
    const gap = freezeCriterion({ ...spec, unobserved: ["guest ordering path"] });
    const results = [{ checkId: "unit", passed: true, criterionHash: c.criterionHash }, { checkId: "integration", passed: true, criterionHash: c.criterionHash }];
    expect(observe(c, results).settlementEstablished).toBe(true);
    expect(observe(c, results.slice(0, 1)).missing).toEqual(["integration"]);
    const underGap = results.map((r) => ({ ...r, criterionHash: gap.criterionHash }));
    const o = observe(gap, underGap);
    expect(o.allRequiredPassed).toBe(true);
    expect(o.settlementEstablished).toBe(false);
    expect(observe(gap, results).passed).toBe(0); // v1 results do not count under v2
  });
});

describe("mediation host", () => {
  const origin = { id: "agent-1", kind: "agent" as const };
  const call = (input: unknown = {}): MediationEvent => ({ family: "capability.invoke", origin, input });
  const core = (e: MediationEvent) => ({ ok: true, value: { approvalRequired: true, echo: e.input } }) as Outcome;
  const log: string[] = [];
  const mk = (id: string, tier: any) => ({ id, tier, pattern: "capability.*", async handler(_c: unknown, e: MediationEvent, next: any) { log.push(`>${id}`); const r = await next(e); log.push(`<${id}`); return r; } });

  test("tier order, same-tier registration order, nested unwind", async () => {
    log.length = 0;
    const h = createMediationHost();
    for (const m of [mk("u1", "user"), mk("p1", "product"), mk("g", "governance"), mk("u0", "user"), mk("s", "system"), mk("p2", "product")]) h.register(m);
    await h.run(call(), core);
    expect(log).toEqual([">g", ">s", ">p1", ">p2", ">u1", ">u0", "<u0", "<u1", "<p2", "<p1", "<s", "<g"]);
  });
  test("request/result transform, short-circuit, deny, origin immutability, trace", async () => {
    const h = createMediationHost();
    h.register({ id: "t", tier: "product", pattern: "*", handler: async (_c, e, next) => { const r = await next({ ...e, input: { x: 2 }, origin: { id: "spoof", kind: "user" } }); return r.ok ? { ok: true, value: { ...(r.value as object), seen: next.origin.id } } : r; } });
    const { outcome, trace } = await h.run(call({ x: 1 }), core);
    expect((outcome as any).value.echo).toEqual({ x: 2 });
    expect((outcome as any).value.seen).toBe("agent-1");
    expect(trace[0]!.actions).toEqual(expect.arrayContaining(["transformed-request", "transformed-result"]));
    const h2 = createMediationHost();
    h2.register({ id: "sc", tier: "user", pattern: "*", handler: () => ({ ok: true, value: "cached" }) });
    expect((await h2.run(call(), core)).trace[0]!.actions).toEqual(["short-circuited"]);
    const h3 = createMediationHost();
    h3.register({ id: "d", tier: "system", pattern: "*", handler: () => ({ ok: false, denied: { by: "d", reason: "no" } }) });
    const r3 = await h3.run(call(), core);
    expect(r3.outcome.ok).toBe(false);
    expect(r3.trace[0]!.actions).toEqual(["denied"]);
  });
  test("trusted subchain excludes lower tiers and cannot recurse", async () => {
    const h = createMediationHost();
    let sub: Outcome | undefined;
    h.register({ id: "g", tier: "governance", pattern: "*", handler: async (_c, e, next) => { await next(e); sub = await next.trusted("product", e); return sub; } });
    h.register(userToyMod());
    const { outcome } = await h.run(call(), core);
    expect((outcome as any).value.approvalRequired).toBe(true);
    // Nested trusted evaluation terminates: each subchain is strictly beneath its caller, so a
    // governance mediator and a system mediator can both ask without looping, and neither sees itself.
    const seen: string[] = [];
    const nested = createMediationHost();
    nested.register({ id: "g", tier: "governance", pattern: "*", handler: async (_c, e, next) => { await next.trusted("user", e); return next(e); } });
    nested.register({ id: "s", tier: "system", pattern: "*", handler: async (_c, e, next) => { seen.push("s"); await next.trusted("user", e); return next(e); } });
    expect((await nested.run(call(), core)).outcome.ok).toBe(true);
    expect(seen).toEqual(["s", "s"]); // once live, once inside the governance shadow run
    // Re-entering trusted evaluation from the same mediator while it is already evaluating is refused.
    const reenter = createMediationHost();
    reenter.register({ id: "g", tier: "governance", pattern: "*", handler: async (_c, e, next) => next.trusted("user", e) });
    reenter.register({ id: "s", tier: "system", pattern: "*", handler: async (_c, e, next) => { try { await next.trusted("user", e); } catch (err) { if (err instanceof TrustedSubchainRecursion) throw err; } return next(e); } });
    expect((await reenter.run(call(), core)).outcome.ok).toBe(true);
  });
  test("registrar cannot escalate tier; cleanup via effects leaves no registrations", async () => {
    const h = createMediationHost();
    const user = h.registrar("user");
    expect(() => user.register({ ...mk("x", "governance") })).toThrow(TierEscalation);
    const disposers: (() => void)[] = [];
    h.register(mk("a", "product"), { register: (d) => disposers.push(d as () => void) });
    expect(h.size).toBe(1);
    disposers.forEach((d) => d());
    expect(h.size).toBe(0);
  });
});

describe("sentinel", () => {
  const findings: Finding[] = [];
  const setup = () => {
    findings.length = 0;
    const h = createMediationHost();
    h.register(sentinel({ emit: (f) => findings.push(f), declaredCapabilities: { "mod-x": ["read"] }, protectedEvidence: ["case.evidence"] }));
    return h;
  };
  const core = (e: MediationEvent): Outcome => ({ ok: true, value: { approvalRequired: (e.input as any)?.risky === true } });
  const ev = (family: string, input: unknown, kind: "agent" | "user" | "mediator" = "agent", id = "a"): MediationEvent => ({ family, origin: { id, kind }, input });

  test("approval requirement survives a lower-trust mediator that waives it, with evidence", async () => {
    const h = setup();
    h.register(userToyMod());
    const { outcome, trace } = await h.run(ev("capability.invoke", { risky: true }), core);
    expect((outcome as any).value.approvalRequired).toBe(true);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ invariant: "human-approval", action: "restored", culprits: ["user-toy-mod"] });
    expect(trace[0]!.mediator).toBe("sentinel");
  });
  test("safe operations are left alone and produce no finding", async () => {
    const h = setup();
    h.register(userToyMod());
    const { outcome } = await h.run(ev("capability.invoke", { risky: false }), core);
    expect((outcome as any).value.approvalRequired).toBe(false);
    expect(findings).toHaveLength(0);
  });
  test("agent cannot synthesize human approval; humans can", async () => {
    const h = setup();
    expect((await h.run(ev("continuation.resume", { approved: true }), core)).outcome.ok).toBe(false);
    expect((await h.run(ev("continuation.resume", { approved: true }, "user", "sam"), core)).outcome.ok).toBe(true);
  });
  test("undeclared capability, protected evidence, irreversible-without-preflight are denied", async () => {
    const h = setup();
    expect((await h.run(ev("capability.invoke", { capability: "bash" }, "mediator", "mod-x"), core)).outcome.ok).toBe(false);
    expect((await h.run(ev("capability.invoke", { capability: "read" }, "mediator", "mod-x"), core)).outcome.ok).toBe(true);
    expect((await h.run(ev("evidence.write", { target: "case.evidence" }), core)).outcome.ok).toBe(false);
    expect((await h.run(ev("capability.invoke", { irreversible: true }), core)).outcome.ok).toBe(false);
    expect((await h.run(ev("capability.invoke", { irreversible: true, preflightId: "p1" }), core)).outcome.ok).toBe(true);
    expect(findings.map((f) => f.invariant)).toEqual(["declared-capability", "protected-evidence", "irreversible-preflight"]);
  });
});

describe("surface grammar", () => {
  const good = { id: "s", title: "t", intent: "decide", purpose: "p", lifetime: "until-settled", provenance: { source: "risk-preflight" }, blocks: [
    { type: "callout", tone: "warn", title: "x" },
    { type: "preflight", title: "FS", target: "./generated", impact: [{ key: "files", value: "183" }], authority: "human-approval-required", actions: [{ id: "allow", label: "Allow once" }] },
    { type: "timeline", entries: [{ position: 1, kind: "a", label: "a" }, { position: 2, kind: "b", label: "b" }] },
  ] };
  test("accepts the closed grammar", () => expect(validateSurface(good).blocks).toHaveLength(3));
  test("rejects arbitrary UI, unknown keys and disordered timelines", () => {
    expect(() => validateSurface({ ...good, blocks: [{ type: "html", html: "<b>" }] })).toThrow(SurfaceError);
    expect(() => validateSurface({ ...good, blocks: [{ type: "callout", tone: "info", title: "x", jsx: "<A/>" }] })).toThrow(SurfaceError);
    expect(() => validateSurface({ ...good, blocks: [{ type: "timeline", entries: [{ position: 2, kind: "a", label: "a" }, { position: 1, kind: "b", label: "b" }] }] })).toThrow(/order/);
    expect(() => validateSurface({ ...good, onClick: "x" })).toThrow(SurfaceError);
  });
  test("lifetime: recedes when settled", () => {
    const s = validateSurface(good);
    expect(surfaceVisible(s, { conditionLive: true, settled: false })).toBe(true);
    expect(surfaceVisible(s, { conditionLive: true, settled: true })).toBe(false);
  });
});

const ops: PossibleOperation[] = [
  { id: "run-tests", label: "Run affected tests", purpose: "behavioral evidence", advances: "verification", capability: "tool.bash", requires: ["candidate.exists"], produces: ["verification.ran"], priority: 5 },
  { id: "review", label: "Independent review", purpose: "p", advances: "settlement", requires: ["verification.ran"], produces: ["review.done"] },
  { id: "merge", label: "Merge", purpose: "p", advances: "settlement", requires: ["review.done"], authority: "human" },
  { id: "propose", label: "Propose change", purpose: "p", advances: "candidate", capability: "tool.edit", produces: ["candidate.exists"] },
];
const facts = { availableCapabilities: new Set(["tool.bash", "tool.edit"]), recoveryAvailable: true, observerAvailable: true };
describe("affordance field", () => {
  test("blocked affordance explains why and names the reachable unblocking move; field shifts with facts", () => {
    const f0 = resolveAffordances(ops, { ...facts, holds: new Set() });
    expect(f0.current.map((a) => a.id)).toEqual(["propose"]);
    expect(f0.blocked.find((b) => b.id === "run-tests")).toEqual({ id: "run-tests", label: "Run affected tests", blockedBy: ["missing:candidate.exists"], reachableNow: "propose" });
    expect(f0.primary).toBe("propose");
    const f1 = resolveAffordances(ops, { ...facts, holds: new Set(["candidate.exists"]) });
    expect(f1.primary).toBe("run-tests");
    expect(f1.current.find((a) => a.id === "run-tests")?.successor).toBe("review");
    expect(f1.current.every((a) => a.payment === undefined)).toBe(true); // unknown stays unknown
  });
  test("capability exposure shrinks and grows with the field; recovery tools stay", () => {
    const tools = [{ id: "tool.read", kind: "diagnostic" as const }, { id: "tool.bash", kind: "mutating" as const }, { id: "tool.edit", kind: "mutating" as const }, { id: "git.restore", kind: "recovery" as const }];
    const f0 = resolveAffordances(ops, { ...facts, holds: new Set() });
    expect(capabilityNeighborhood(tools, f0)).toEqual(["tool.read", "tool.edit", "git.restore"]);
    const f1 = resolveAffordances(ops, { ...facts, holds: new Set(["candidate.exists"]) });
    expect(capabilityNeighborhood(tools, f1)).toEqual(["tool.read", "tool.bash", "tool.edit", "git.restore"].filter((t) => t !== "tool.edit" || f1.current.some((a) => a.capability === t)));
  });
});

describe("case, reality and settlement", () => {
  const crit = freezeCriterion(spec);
  const ctx = { operations: ops, facts };
  const E = [
    ev(1, CASE_EVENTS.opened, { caseId: "k", desiredOutcome: "clean rebuild without losing uncommitted work", unknowns: ["CI parity"] }),
    ev(2, WORLD_EVENTS.baseline, { worldHash: s0, caseId: "k" }),
    ev(3, CASE_EVENTS.criterion, { caseId: "k", criterion: crit }),
    ev(4, WORLD_EVENTS.candidate, { candidateHash: c1, parentWorldHash: s0, caseId: "k" }),
  ];
  const v = (position: number, checkId: string, passed: boolean, candidateHash = c1) => ev(position, CASE_EVENTS.verification, { caseId: "k", checkId, passed, criterionHash: crit.criterionHash, candidateHash });
  test("failure becomes the material deviation; repair makes settlement reachable, not settled", () => {
    const failing = deriveCase("k", [...E, v(5, "unit", true), v(6, "integration", false)], ctx);
    expect(failing.materialDeviation).toMatch(/1 required check failed: integration/);
    expect(failing.settlementReachable).toBe(false);
    const c2 = worldHash(worldManifest({ ...base, files: { "a.ts": "h3" } }));
    const repaired = deriveCase("k", [...E, v(5, "unit", true), v(6, "integration", false), ev(7, WORLD_EVENTS.candidate, { candidateHash: c2, parentWorldHash: s0, caseId: "k" }), v(8, "unit", true, c2), v(9, "integration", true, c2)], ctx);
    expect(repaired.candidateWorldHash).toBe(c2);
    expect(repaired.settlementReachable).toBe(true);
    expect(repaired.currentState).toBe("candidate"); // reachable != settled
    expect(repaired.baseWorldHash).toBe(s0);
  });
  test("a green observer with a coverage gap is not settleable", () => {
    const gap = freezeCriterion({ ...spec, unobserved: ["guest path"] });
    const k = deriveCase("k", [...E.slice(0, 2), ev(3, CASE_EVENTS.criterion, { caseId: "k", criterion: gap }), E[3]!, ...["unit", "integration"].map((id, i) => ev(5 + i, CASE_EVENTS.verification, { caseId: "k", checkId: id, passed: true, criterionHash: gap.criterionHash, candidateHash: c1 }))], ctx);
    expect(k.observation?.allRequiredPassed).toBe(true);
    expect(k.settlementReachable).toBe(false);
    expect(k.materialDeviation).toMatch(/observer gap: guest path/);
  });
  test("reality is derived from events, not narrative", () => {
    const events = [...E, ev(5, "assistant.message", { text: "all tests passed" }), v(6, "unit", false)];
    expect(realityOfCheck(events, "unit")).toBe("failed");
    expect(realityOfCheck(events, "integration")).toBe("not-established");
    expect(reality(events).some((f) => f.eventType === "assistant.message")).toBe(false);
  });
  test("tampered criterion no longer evaluates", () => {
    const forged = { ...crit, requiredChecks: [] } as typeof crit;
    const k = deriveCase("k", [E[0]!, E[1]!, ev(3, CASE_EVENTS.criterion, { caseId: "k", criterion: forged }), E[3]!], ctx);
    expect(k.observation).toBeUndefined();
    expect(k.settlementReachable).toBe(false);
  });
});

describe("bounded search and method review", () => {
  const round = (i: number, over: Partial<ExperimentRound>): ExperimentRound => ({ roundId: `r${i}`, caseId: "k", parentWorldHash: s0, candidateWorldHash: `c${i}`, criterionHash: "crit", methodHash: "m0", sandboxId: `cb-${i}`, hypothesis: "h", operation: "o", result: "neutral", decision: "discard", startedPosition: i * 2, completedPosition: i * 2 + 1, ...over });
  test("eligibility is earned and blocked reasons are explicit", () => {
    const c = { criterionHash: "x", baseWorldHash: s0 };
    const env = { candidateExecutionAvailable: true, observerDiscriminates: true, failuresDisposable: true, roundsAffordable: 8, boundedScope: true };
    expect(searchEligibility(c, env).available).toBe(true);
    expect(searchEligibility(c, { ...env, observerDiscriminates: false }).blockedBy).toEqual(["no protected observer capable of discriminating improvement"]);
    expect(searchEligibility({ baseWorldHash: s0 }, env).blockedBy).toEqual(["no frozen criterion"]);
  });
  test("rounds: regression discarded, improvement retained, best tracked, nothing settles", () => {
    let best: number | undefined;
    const rounds: ExperimentRound[] = [];
    [[true, 1], [true, 0.5], [true, 3.7], [false, undefined], [true, 4.8]].forEach(([valid, score], i) => {
      const j = judgeRound(valid as boolean, score as number | undefined, best);
      if (j.decision === "retain") best = score as number;
      rounds.push(round(i + 1, { ...j, ...(score === undefined ? {} : { score: score as number }) }));
    });
    const st = foldSearch(rounds);
    expect(rounds.map((r) => r.result)).toEqual(["improved", "regressed", "improved", "invalid", "improved"]);
    expect(st.bestRound?.candidateWorldHash).toBe("c5");
    expect(st.discarded).toEqual(["c2"]);
    expect(rounds.every((r) => r.parentWorldHash === s0)).toBe(true);
  });
  test("recurring residual yields a candidate recommendation; active method is unchanged until a human accepts", () => {
    const rounds = [round(1, { residual: "disconnected from application path" }), round(2, { residual: "disconnected from application path" }), round(3, {})];
    const recs = recommendFromRounds(rounds, { scope: "cross-cutting feature changes", candidateChangeFor: () => ({ change: "require reachability evidence before settlement", effect: "fewer integration escapes" }) });
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ status: "candidate", active: false, supporting: ["r1", "r2"], contradicting: ["r3"] });
    const state = { activeMethodHash: "m0", history: [] };
    expect(state.activeMethodHash).toBe("m0"); // recommending is pure; nothing to mutate
    expect(() => acceptMethod(state, recs[0]!, { v: 2 }, { actorId: "agent", kind: "agent" })).toThrow();
    const next = acceptMethod(state, recs[0]!, { v: 2 }, { actorId: "sam", kind: "user" });
    expect(next.activeMethodHash).not.toBe("m0");
    expect(next.history[0]).toMatchObject({ acceptedBy: "sam", recommendationId: recs[0]!.id });
    expect(recommendFromRounds([round(1, { residual: "once" })], { scope: "s", candidateChangeFor: () => ({ change: "", effect: "" }) })).toEqual([]);
  });
  test("outer observer cannot write governing artifacts", () => {
    for (const t of ["AGENTS.md", "docs/AGENTS.md", ".agents/specs/x.md", "case/criterion.json", "active-method.json"]) expect(observerMayWrite(t)).toBe(false);
    expect(observerMayWrite("notes/recommendation.md")).toBe(true);
  });
});

import { liveVerify } from "../src/cognitive/liveverify.ts";
import { classifyDestructive, composePreflight } from "../src/cognitive/preflight.ts";

describe("LiveVerify mediator", () => {
  const fakeTimers = () => {
    const pending = new Map<number, () => void>();
    let n = 0;
    return { set: (fn: () => void) => { pending.set(++n, fn); return n; }, clear: (h: unknown) => void pending.delete(h as number), fire: () => { const fns = [...pending.values()]; pending.clear(); fns.forEach((f) => f()); }, size: () => pending.size };
  };
  const run = async (lv: ReturnType<typeof liveVerify>, input: unknown = {}) => {
    const host = createMediationHost();
    host.register(lv.mediator);
    return host.run({ family: "tool.result", origin: { id: "agent", kind: "agent" }, input }, () => ({ ok: true, value: "done" }));
  };
  test("debounces edits, stays quiet when healthy, surfaces failure and repair on one surface id, and cleans up its timer", async () => {
    const t = fakeTimers();
    const verdicts: { healthy: boolean; surfaceId: string; summary: string }[] = [];
    let healthy = true;
    const disposers: (() => void)[] = [];
    const lv = liveVerify({ debounceMs: 50, timers: t, isConsequential: (_f, i) => (i as any).edit === true, run: async () => ({ healthy, summary: healthy ? "ok" : "3 affected checks failed" }), onVerdict: (v) => verdicts.push(v) }, { register: (d) => disposers.push(d as () => void) });
    await run(lv, { edit: false });
    expect(lv.pending()).toBe(false); // non-consequential activity does nothing
    await run(lv, { edit: true }); await run(lv, { edit: true }); await run(lv, { edit: true });
    expect(t.size()).toBe(1); // three edits, one scheduled verification
    t.fire(); await lv.flush();
    expect(verdicts).toEqual([]); // first healthy verdict: quiet normality
    healthy = false;
    await run(lv, { edit: true }); t.fire(); await lv.flush();
    expect(verdicts).toEqual([{ healthy: false, surfaceId: "live-verify", summary: "3 affected checks failed" }]);
    await run(lv, { edit: true }); t.fire(); await lv.flush();
    expect(verdicts).toHaveLength(1); // still failing: no new message
    healthy = true;
    await run(lv, { edit: true }); t.fire(); await lv.flush();
    expect(verdicts.map((v) => v.healthy)).toEqual([false, true]); // repair updates the same representation
    expect(new Set(verdicts.map((v) => v.surfaceId)).size).toBe(1);
    await run(lv, { edit: true });
    expect(t.size()).toBe(1);
    disposers.forEach((d) => d());
    expect(t.size()).toBe(0); // no leaked timers after teardown
  });
});

describe("RiskPreflight classification", () => {
  test("classifies recursive removal, ignores everything else, composes a valid generic preflight surface", () => {
    expect(classifyDestructive("rm -rf ./generated")).toEqual({ program: "rm", targets: ["./generated"] });
    expect(classifyDestructive("rm -r a b")?.targets).toEqual(["a", "b"]);
    expect(classifyDestructive("rm file.txt")).toBeUndefined();
    expect(classifyDestructive("ls -la")).toBeUndefined();
    const s = composePreflight({ command: "rm -rf ./generated", target: "./generated", impact: { files: 183, uncommitted: 2, recovery: "rebuild generated output" }, toolCallId: "T91", caseId: "C17" });
    expect(s.blocks[0]).toMatchObject({ type: "preflight", authority: "human-approval-required" });
    expect(s.relatedCase).toBe("C17");
  });
});
