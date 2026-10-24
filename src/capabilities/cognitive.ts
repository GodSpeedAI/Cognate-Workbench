// Cognitive-navigation capabilities (local harness proof; candidates for core promotion are listed
// in docs/known-gaps.md). They sit on `@godspeedai/cognate-execution` (files/processes in a named world) and the
// durable event log (`agent.cognitive` records facts). Nothing here keeps its own store: the Case,
// Reality and lineage are folds of events, so a restart reconstructs them.
//
//   case.open / criterion.freeze      declare the desired difference and freeze its observer
//   world.freeze                      baseline | candidate manifest -> worldHash (SHA-256) + lineage
//   world.fork / world.discard        a disposable execution world forked from a settled world
//   verification.run                  run the frozen criterion's checks; the *process result* is the fact
//   case.derive                       CaseProjection + Reality, folded from events
//   world.settle                      human-only promotion of a candidate to the settled world
//   risk.assess                       mediation (Sentinel + RiskPreflight [+ extra mods]) for one operation
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localExecutionWorld } from "@godspeedai/cognate-execution";
import type { ExecInput, ExecResult, ExecutionWorldRegistry, ListInput, ListResult, ReadInput, ReadResult } from "@godspeedai/cognate-execution";
import type { Json } from "@godspeedai/cognate-events";
import type { CapabilityLease, Component, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { AGENT_COGNITIVE } from "../agents/agentCognitive.ts";
import { hashOf } from "../cognitive/canonical.ts";
import { checkPromotion, foldLineage, worldHash, worldManifest, WORLD_EVENTS, type WorldManifest } from "../cognitive/world.ts";
import { freezeCriterion, type CriterionSpec, type FrozenCriterion } from "../cognitive/criterion.ts";
import { CASE_EVENTS, deriveCase, reality, type CaseEvent, type CaseProjection } from "../cognitive/case.ts";
import type { PossibleOperation } from "../cognitive/affordance.ts";
import { createMediationHost, type MediatorSpec, type Outcome } from "../cognitive/mediation.ts";
import { sentinel, type Finding } from "../cognitive/sentinel.ts";
import { classifyDestructive, riskPreflight, type Impact } from "../cognitive/preflight.ts";
import type { Surface } from "../cognitive/surface.ts";
import { judgeRound, searchEligibility, foldSearch, type ExperimentRound } from "../cognitive/experiment.ts";
import { acceptMethod, recommendFromRounds } from "../cognitive/method.ts";
import { contextOf, createFocusStore, parseRef, surfaceFor, type FocusContext, type SemanticOp } from "../cognitive/focus.ts";

const IGNORED = new Set([".git", "node_modules"]);

/** The operations a coding Case may offer. Pure data; the resolver decides which are reachable. */
export const CASE_OPERATIONS: readonly PossibleOperation[] = [
  { id: "propose-change", label: "Propose change in a candidate world", purpose: "produce a candidate", advances: "the desired outcome", capability: "tool.edit", produces: ["candidate.exists"], requires: ["baseline.frozen"], priority: 3 },
  { id: "run-verification", label: "Run frozen checks", purpose: "behavioral evidence", advances: "verification", capability: "tool.bash", requires: ["candidate.exists", "criterion.frozen"], produces: ["verification.ran"], priority: 5 },
  { id: "inspect-failure", label: "Inspect first failing check", purpose: "locate the material deviation", advances: "repair", capability: "tool.read", requires: ["verification.failed"], priority: 6 },
  { id: "settle", label: "Settle candidate", purpose: "promote candidate to the settled world", advances: "settlement", requires: ["verification.passed"], authority: "human" },
];

export interface CognitiveOptions {
  readonly getService: () => RuntimeService;
  readonly systemCaller: Caller;
  readonly registry: ExecutionWorldRegistry;
  /** Where disposable fork directories live. */
  readonly forkRoot?: string;
  /** Extra lower-trust mediators (e.g. a user toy mod in tests). Registered under the host's user tier only. */
  readonly extraMediators?: readonly MediatorSpec[];
  /** Per-capability IDM bindings; preferred over the legacy component-wide anchor. */
  readonly semanticRefs?: Readonly<Record<string, SemanticRef>>;
  /** Legacy single-anchor option retained for external and test callers. */
  readonly semanticRef?: SemanticRef;
}

type Lease = CapabilityLease;
async function call<I, O>(lease: Lease, input: I, ctx: HandlerContext): Promise<O> {
  const result = await lease.invoke(input, ctx);
  if (result.ok) return result.value as O;
  const failure = result.failure;
  if (failure.kind === "failed") throw failure.error;
  throw new Error(`capability ${lease.contract.id} failed: ${failure.kind}`);
}

async function waitDone(service: RuntimeService, caller: Caller, runId: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const run = await service.getRun(caller, { runId });
    if (run.status === "completed") return;
    if (run.status === "failed" || run.status === "cancelled") throw new Error(`cognitive record failed: run ${runId} ${run.status}`);
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`cognitive record timed out: ${runId}`);
}

export function cognitiveComponent(options: CognitiveOptions): Component {
  const ids = ["case.open", "criterion.freeze", "world.freeze", "world.fork", "world.attach", "world.discard", "verification.run", "case.derive", "world.settle", "risk.assess", "case.observe", "ui.focus.publish", "ui.context", "ui.request", "ui.pending", "experiment.round", "experiment.status", "method.review", "method.accept", "method.active"];
  const contract = (id: string) => ({
    id,
    version: "1.0.0",
    semanticRef: options.semanticRefs?.[id] ?? options.semanticRef,
  });
  const forkBase = options.forkRoot ?? tmpdir();
  // Ephemeral attention bridge: the page publishes the human's FocusContext; an agent may ask the
  // page to render a Surface. In-memory by design — never an event, lost on restart, never truth.
  const focusStore = createFocusStore();
  let pendingRequests: { readonly id: string; readonly surface: Surface; readonly focus?: string }[] = [];

  async function record(eventType: string, payload: Record<string, unknown>): Promise<void> {
    const service = options.getService();
    const { runId } = await service.startRun(options.systemCaller, { agent: AGENT_COGNITIVE, input: { eventType, payload } as unknown as Json, idempotencyKey: randomUUID() });
    await waitDone(service, options.systemCaller, runId);
  }
  async function events(caller: Caller): Promise<CaseEvent[]> {
    const out: CaseEvent[] = [];
    for await (const e of options.getService().events(caller, {})) out.push({ position: e.position, eventType: e.eventType, payload: (e.payload ?? {}) as Record<string, unknown> });
    return out;
  }
  const callerOf = (ctx: HandlerContext): Caller => ({ actor: ctx.actor, tenant: ctx.tenant });

  return {
    id: "cognitive:capabilities",
    provides: ids.map(contract),
    requires: {
      resolve: { capability: "filesystem.resolve" },
      read: { capability: "filesystem.readText" },
      list: { capability: "filesystem.list" },
      exec: { capability: "process.exec" },
    },
    activate(fiber) {
      const dep = fiber.dependencies;

      async function manifestOf(worldId: string, root: string, extra: { criterionHash?: string; methodHash?: string }, ctx0: HandlerContext): Promise<WorldManifest> {
        const files: Record<string, string> = {};
        const walk = async (rel: string, ctx: HandlerContext): Promise<void> => {
          const { path } = await call<{ worldId: string; root: string; path: string }, { path: string }>(dep.resolve!, { worldId, root, path: rel || "." }, ctx);
          const { entries } = await call<ListInput, ListResult>(dep.list!, { worldId, path }, ctx);
          for (const entry of entries) {
            if (IGNORED.has(entry.name)) continue;
            const childRel = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.kind === "directory") await walk(childRel, ctx);
            else if (entry.kind === "file") {
              const abs = (await call<{ worldId: string; root: string; path: string }, { path: string }>(dep.resolve!, { worldId, root, path: childRel }, ctx)).path;
              const { content } = await call<ReadInput, ReadResult>(dep.read!, { worldId, path: abs }, ctx);
              files[childRel] = createHash("sha256").update(content).digest("hex");
            }
          }
        };
        await walk("", ctx0);
        const repo = await call<ExecInput, ExecResult>(dep.exec!, { worldId, argv: ["git", "rev-parse", "HEAD"], cwd: root }, ctx0).catch(() => undefined);
        return worldManifest({
          files,
          ...(repo?.exitCode === 0 ? { repoSha: repo.stdout.trim() } : {}),
          semanticModelHash: hashOf("deepseek-harness-model"),
          policyHash: hashOf("deepseek-harness-app-policy"),
          environmentHash: hashOf({ worldKind: options.registry.get(worldId).kind }),
          ...extra,
        });
      }
      const withCtx = <I, O>(fn: (input: I, ctx: HandlerContext) => Promise<O>) => async (raw: unknown, ctx: HandlerContext): Promise<O> => {
        return fn(raw as I, ctx);
      };

      fiber.provide(contract("case.open"), withCtx(async (i: { caseId: string; desiredOutcome: string; unknowns?: string[]; checks?: { id: string; argv: string[] }[] }) => {
        // `checks` map criterion check ids to the commands that observe them (declared up front, before any executor acts).
        await record("case.opened", { caseId: i.caseId, desiredOutcome: i.desiredOutcome, unknowns: i.unknowns ?? [], ...(i.checks ? { checks: i.checks as unknown as Json } : {}) });
        return { caseId: i.caseId };
      }));

      fiber.provide(contract("criterion.freeze"), withCtx(async (i: { caseId: string; spec: CriterionSpec }) => {
        const criterion = freezeCriterion(i.spec);
        await record("criterion.frozen", { caseId: i.caseId, criterion: criterion as unknown as Json });
        return { criterionHash: criterion.criterionHash };
      }));

      fiber.provide(contract("world.freeze"), withCtx(async (i: { caseId: string; kind: "baseline" | "candidate"; worldId: string; root: string; parentWorldHash?: string; sandboxId?: string; criterionHash?: string; methodHash?: string; runId?: string }, ctx) => {
        const manifest = await manifestOf(i.worldId, i.root, { ...(i.criterionHash ? { criterionHash: i.criterionHash } : {}), ...(i.methodHash ? { methodHash: i.methodHash } : {}) }, ctx);
        const hash = worldHash(manifest);
        if (i.kind === "baseline") await record(WORLD_EVENTS.baseline, { worldHash: hash, manifest: manifest as unknown as Json, caseId: i.caseId, ...(i.runId ? { runId: i.runId } : {}) });
        else await record(WORLD_EVENTS.candidate, { candidateHash: hash, parentWorldHash: i.parentWorldHash ?? null, manifest: manifest as unknown as Json, caseId: i.caseId, ...(i.sandboxId ? { sandboxId: i.sandboxId } : {}), ...(i.runId ? { runId: i.runId } : {}) });
        return { worldHash: hash };
      }));

      fiber.provide(contract("world.fork"), withCtx(async (i: { sourceRoot: string; sandboxId?: string }) => {
        // Local-directory fork provider. It is NOT CubeSandbox: isolation is a copied directory
        // under its own execution world id. The lineage events, not this directory, are the truth.
        const sandboxId = i.sandboxId ?? `sbx-${randomUUID().slice(0, 8)}`;
        const dir = await mkdtemp(join(forkBase, `${sandboxId}-`));
        await cp(i.sourceRoot, dir, { recursive: true });
        options.registry.register(localExecutionWorld({ worldId: sandboxId, metadata: { isolation: "directory-copy", provider: "local-fork", cubeSandbox: "absent", root: dir } }));
        return { sandboxId, root: dir };
      }));

      fiber.provide(contract("world.attach"), withCtx(async (i: { sandboxId: string; root: string }) => {
        // After a restart the in-memory fork provider is gone (fail closed). Re-attaching is an
        // explicit act over a directory that still exists; lineage never depended on it.
        if (!options.registry.has(i.sandboxId)) options.registry.register(localExecutionWorld({ worldId: i.sandboxId, metadata: { isolation: "directory-copy", provider: "local-fork", cubeSandbox: "absent", root: i.root } }));
        return { attached: i.sandboxId };
      }));

      fiber.provide(contract("world.discard"), withCtx(async (i: { sandboxId: string; root: string }) => {
        await options.registry.unregister(i.sandboxId);
        await rm(i.root, { recursive: true, force: true });
        return { discarded: i.sandboxId };
      }));

      fiber.provide(contract("verification.run"), withCtx(async (i: { caseId: string; worldId: string; root: string; candidateHash: string; checks: { id: string; argv: string[] }[] }, ctx) => {
        const evs = await events(callerOf(ctx));
        const criterion = [...evs].reverse().find((e) => e.eventType === CASE_EVENTS.criterion && e.payload.caseId === i.caseId)?.payload.criterion as FrozenCriterion | undefined;
        if (!criterion) throw new Error("verification.run: no frozen criterion for this case");
        const results: { checkId: string; passed: boolean }[] = [];
        for (const check of i.checks) {
          if (!criterion.requiredChecks.includes(check.id)) throw new Error(`verification.run: ${check.id} is not in the frozen criterion`);
          const r = await call<ExecInput, ExecResult>(dep.exec!, { worldId: i.worldId, argv: check.argv, cwd: i.root, timeoutMs: 60_000 }, ctx);
          const passed = r.exitCode === 0 && !r.timedOut;
          await record(CASE_EVENTS.verification, { caseId: i.caseId, checkId: check.id, passed, criterionHash: criterion.criterionHash, candidateHash: i.candidateHash, exitCode: r.exitCode, tail: (r.stdout + r.stderr).slice(-400) });
          results.push({ checkId: check.id, passed });
        }
        return { results };
      }));

      // LiveVerify core: after a consequential change, freeze the candidate world and run the Case's
      // declared checks. Quiet when nothing changed; the *process results* are the recorded facts.
      fiber.provide(contract("case.observe"), withCtx(async (i: { caseId: string; worldId: string; root: string }, ctx) => {
        const evs = await events(callerOf(ctx));
        const opened = evs.find((e) => e.eventType === CASE_EVENTS.opened && e.payload.caseId === i.caseId);
        const checks = (opened?.payload.checks as { id: string; argv: string[] }[] | undefined) ?? [];
        const crit = [...evs].reverse().find((e) => e.eventType === CASE_EVENTS.criterion && e.payload.caseId === i.caseId)?.payload.criterion as FrozenCriterion | undefined;
        const lineage = foldLineage(evs);
        if (checks.length === 0 || !crit || !lineage.settledHead) return { observed: false };
        const manifest = await manifestOf(i.worldId, i.root, { criterionHash: crit.criterionHash }, ctx);
        const hash = worldHash(manifest);
        const baseline = lineage.worlds.get(lineage.settledHead)?.manifest;
        if (baseline && worldHash({ ...baseline, criterionHash: crit.criterionHash }) === hash) return { observed: false, reason: "unchanged from settled world" };
        // Facts are returned, not recorded here: this runs inside an agent run, which emits them itself
        // (`ctx.emit`) so the agent stays deterministic and never waits on a child run.
        const facts: { eventType: string; payload: Record<string, unknown> }[] = [];
        if (!lineage.worlds.has(hash)) facts.push({ eventType: WORLD_EVENTS.candidate, payload: { candidateHash: hash, parentWorldHash: lineage.settledHead, manifest: manifest as unknown as Json, caseId: i.caseId } });
        let healthy = true;
        for (const check of checks) {
          const r = await call<ExecInput, ExecResult>(dep.exec!, { worldId: i.worldId, argv: check.argv, cwd: i.root, timeoutMs: 60_000 }, ctx);
          const passed = r.exitCode === 0 && !r.timedOut;
          healthy = healthy && passed;
          facts.push({ eventType: CASE_EVENTS.verification, payload: { caseId: i.caseId, checkId: check.id, passed, criterionHash: crit.criterionHash, candidateHash: hash, exitCode: r.exitCode, tail: (r.stdout + r.stderr).slice(-400) } });
        }
        return { observed: true, candidateHash: hash, healthy, facts: facts as unknown as Json };
      }));

      fiber.provide(contract("case.derive"), withCtx(async (i: { caseId: string; availableCapabilities?: string[] }, ctx) => {
        const evs = await events(callerOf(ctx));
        const projection: CaseProjection = deriveCase(i.caseId, evs, {
          operations: CASE_OPERATIONS,
          facts: { availableCapabilities: new Set(i.availableCapabilities ?? ["tool.edit", "tool.bash", "tool.read"]), recoveryAvailable: true, observerAvailable: true },
          optional: [{ id: "fresh-context-critic", label: "Fresh-context critic", payment: "unknown" }],
        });
        const recs = evs.filter((e) => e.eventType === "method.recommended").map((e) => e.payload);
        const accepted = new Set(evs.filter((e) => e.eventType === "method.accepted").map((e) => e.payload.recommendationId));
        const search = foldSearch(roundsOf(evs, i.caseId));
        const lineage = foldLineage(evs);
        return {
          case: projection as unknown as Json,
          reality: reality(evs) as unknown as Json,
          evidence: evs.filter((e) => e.eventType === CASE_EVENTS.verification && e.payload.caseId === i.caseId && e.payload.candidateHash === projection.candidateWorldHash).map((e) => ({ position: e.position, checkId: String(e.payload.checkId), passed: e.payload.passed === true })) as unknown as Json,
          search: { rounds: search.rounds.map((r) => ({ roundId: r.roundId, candidateWorldHash: r.candidateWorldHash, result: r.result, decision: r.decision, ...(r.score === undefined ? {} : { score: r.score }) })), best: (search.bestRound?.candidateWorldHash ?? null) as Json, criterionHash: (projection.criterionHash ?? null) as Json } as unknown as Json,
          method: { activeMethodHash: activeMethod(evs), recommendations: recs.filter((r) => !accepted.has(r.id)) } as unknown as Json,
          settledHead: (lineage.settledHead ?? null) as Json,
        };
      }));

      fiber.provide(contract("world.settle"), withCtx(async (i: { caseId: string; candidateHash: string }, ctx) => {
        // Settlement is a human act. A call from inside an agent run is never human authority,
        // however the run was started.
        if (ctx.runId) throw new Error("world.settle: settlement is a human act and cannot be invoked from a run");
        const evs = await events(callerOf(ctx));
        const projection = deriveCase(i.caseId, evs, { operations: CASE_OPERATIONS, facts: { availableCapabilities: new Set(), recoveryAvailable: true, observerAvailable: true } });
        const lineage = foldLineage(evs);
        const decision = checkPromotion(lineage, {
          candidateHash: i.candidateHash,
          authority: { actorId: ctx.actor.id, kind: ctx.actor.kind },
          evidenceRefs: projection.candidateWorldHash === i.candidateHash ? projection.evidencePositions.map(String) : [],
          settlementReachable: projection.candidateWorldHash === i.candidateHash && projection.settlementReachable,
        });
        if (!decision.ok) throw new Error(`world.settle refused: ${decision.reason}`);
        await record(WORLD_EVENTS.settled, { worldHash: i.candidateHash, parentWorldHash: lineage.worlds.get(i.candidateHash)?.parentWorldHash ?? null, caseId: i.caseId, evidenceRefs: projection.evidencePositions.map(String), authority: { actorId: ctx.actor.id, kind: ctx.actor.kind } });
        return { settled: i.candidateHash };
      }));

      const focusEnv = async (ctx: HandlerContext) => ({ events: await events(callerOf(ctx)), caseContext: { operations: CASE_OPERATIONS, facts: { availableCapabilities: new Set(["tool.edit", "tool.bash", "tool.read"]), recoveryAvailable: true, observerAvailable: true } } });

      fiber.provide(contract("ui.focus.publish"), withCtx(async (i: { focus: FocusContext | null }) => {
        focusStore.set(i.focus ?? undefined);
        return { ok: true };
      }));

      fiber.provide(contract("ui.context"), withCtx(async (_i: Record<string, never>, ctx) => {
        // Smallest useful neighbourhood around the human's current attention; never the whole Case.
        const f = focusStore.get();
        return { focused: f !== undefined, neighborhood: (f ? contextOf(f, await focusEnv(ctx)) ?? null : null) as unknown as Json };
      }));

      fiber.provide(contract("ui.request"), withCtx(async (i: { op: "inspect" | "timeline" | "compare" | "focus"; ref?: string; left?: string; right?: string }, ctx) => {
        // Representation request only: builds a Surface from recorded facts and queues it for the
        // page. No mutation of case, lineage, criterion or evidence is possible through this path.
        const f = focusStore.get();
        const need = (r: string | undefined): any => (r && parseRef(r) ? r : f?.ref);
        const env = await focusEnv(ctx);
        if (i.op === "focus") {
          if (!i.ref || !parseRef(i.ref)) throw new Error("ui.request: focus needs a semantic ref");
          focusStore.set({ ref: i.ref as FocusContext["ref"], ...(f?.caseId ? { caseId: f.caseId } : {}) });
          return { focused: i.ref };
        }
        const op: SemanticOp = i.op === "compare" ? { op: "compare", left: need(i.left), right: need(i.right) } : { op: i.op, ref: need(i.ref) };
        const surface = surfaceFor(op, env, f?.caseId);
        pendingRequests = [...pendingRequests.filter((r) => r.id !== surface.id), { id: surface.id, surface }];
        return { requested: surface.id };
      }));

      fiber.provide(contract("ui.pending"), withCtx(async () => {
        const taken = pendingRequests;
        pendingRequests = [];
        const f = focusStore.get();
        return { surfaces: taken.map((r) => r.surface) as unknown as Json, focus: (f ?? null) as unknown as Json };
      }));

      const DEFAULT_METHOD = hashOf("method:v0");
      const activeMethod = (evs: CaseEvent[]): string => ([...evs].reverse().find((e) => e.eventType === "method.accepted")?.payload.methodHash as string | undefined) ?? DEFAULT_METHOD;
      const roundsOf = (evs: CaseEvent[], caseId: string): ExperimentRound[] => evs.filter((e) => e.eventType === "experiment.round.completed" && e.payload.caseId === caseId).map((e) => e.payload as unknown as ExperimentRound);

      fiber.provide(contract("method.active"), withCtx(async (_i: Record<string, never>, ctx) => ({ methodHash: activeMethod(await events(callerOf(ctx))) })));

      fiber.provide(contract("experiment.status"), withCtx(async (i: { caseId: string; maxRounds: number }, ctx) => {
        const evs = await events(callerOf(ctx));
        const c = deriveCase(i.caseId, evs, { operations: CASE_OPERATIONS, facts: { availableCapabilities: new Set(), recoveryAvailable: true, observerAvailable: true } });
        const rounds = roundsOf(evs, i.caseId);
        const eligibility = searchEligibility(c, { candidateExecutionAvailable: options.registry.has("local"), observerDiscriminates: (c.observation?.total ?? 0) > 0 || !!c.criterionHash, failuresDisposable: true, roundsAffordable: Math.max(0, i.maxRounds - rounds.length), boundedScope: i.maxRounds > 0 });
        const st = foldSearch(rounds);
        return { eligibility: eligibility as unknown as Json, rounds: rounds.length, best: (st.bestRound?.candidateWorldHash ?? null) as Json, criterionHash: (c.criterionHash ?? null) as Json, methodHash: activeMethod(evs) };
      }));

      fiber.provide(contract("experiment.round"), withCtx(async (i: { caseId: string; roundId: string; hypothesis: string; sourceRoot: string; baselineHash: string; applyArgv: string[]; scoreArgv: string[]; invariantArgv?: string[]; maxRounds: number; residual?: string }, ctx) => {
        const evs = await events(callerOf(ctx));
        const crit = [...evs].reverse().find((e) => e.eventType === CASE_EVENTS.criterion && e.payload.caseId === i.caseId)?.payload.criterion as FrozenCriterion | undefined;
        const lineage = foldLineage(evs);
        const prior = roundsOf(evs, i.caseId);
        if (!crit) throw new Error("experiment.round: no frozen criterion — bounded search is not available");
        if (lineage.settledHead !== i.baselineHash) throw new Error("experiment.round: parent is not the current settled world");
        if (prior.length >= i.maxRounds) throw new Error("experiment.round: round budget exhausted");
        const sandboxId = `sbx-${i.roundId}`;
        const started = evs.length ? evs[evs.length - 1]!.position : 0;
        const dir = await mkdtemp(join(forkBase, `${sandboxId}-`));
        await cp(i.sourceRoot, dir, { recursive: true });
        options.registry.register(localExecutionWorld({ worldId: sandboxId, metadata: { isolation: "directory-copy", provider: "local-fork", cubeSandbox: "absent", root: dir } }));
        let result: ReturnType<typeof judgeRound>;
        let score: number | undefined;
        let candidateHash = "";
        try {
          const run = (argv: string[]) => call<ExecInput, ExecResult>(dep.exec!, { worldId: sandboxId, argv, cwd: dir, timeoutMs: 60_000 }, ctx);
          const applied = await run(i.applyArgv);
          candidateHash = worldHash(await manifestOf(sandboxId, dir, { criterionHash: crit.criterionHash }, ctx));
          const scored = applied.exitCode === 0 ? await run(i.scoreArgv) : undefined;
          const inv = i.invariantArgv ? await run(i.invariantArgv) : { exitCode: 0 };
          score = scored && scored.exitCode === 0 ? Number.parseFloat(scored.stdout.trim()) : undefined;
          const valid = applied.exitCode === 0 && inv.exitCode === 0 && score !== undefined && Number.isFinite(score);
          const best = foldSearch(prior).bestRound?.score;
          result = judgeRound(valid, valid ? score : undefined, best);
        } finally {
          await options.registry.unregister(sandboxId);
          await rm(dir, { recursive: true, force: true });
        }
        await record(WORLD_EVENTS.candidate, { candidateHash, parentWorldHash: i.baselineHash, caseId: i.caseId, sandboxId });
        if (result.decision !== "retain") await record(WORLD_EVENTS.rejected, { candidateHash, caseId: i.caseId });
        const round: ExperimentRound = { roundId: i.roundId, caseId: i.caseId, parentWorldHash: i.baselineHash, candidateWorldHash: candidateHash, criterionHash: crit.criterionHash, methodHash: activeMethod(evs), sandboxId, hypothesis: i.hypothesis, operation: i.applyArgv.join(" "), result: result.result, decision: result.decision, ...(score !== undefined && Number.isFinite(score) ? { score } : {}), ...(i.residual ? { residual: i.residual } : {}), startedPosition: started, completedPosition: started + 1 };
        await record("experiment.round.completed", round as unknown as Record<string, unknown>);
        return { result: result.result, decision: result.decision, candidateHash };
      }));

      fiber.provide(contract("method.review"), withCtx(async (i: { caseId: string; scope: string }, ctx) => {
        // The outer observer's whole authority: read rounds, write a *candidate* recommendation.
        const evs = await events(callerOf(ctx));
        const recs = recommendFromRounds(roundsOf(evs, i.caseId), { scope: i.scope, candidateChangeFor: (residual) => ({ change: `before settlement, require evidence addressing: ${residual}`, effect: "reduce recurrence of this residual" }) });
        for (const r of recs) if (!evs.some((e) => e.eventType === "method.recommended" && e.payload.id === r.id)) await record("method.recommended", r as unknown as Record<string, unknown>);
        return { recommendations: recs as unknown as Json, activeMethodHash: activeMethod(evs) };
      }));

      fiber.provide(contract("method.accept"), withCtx(async (i: { recommendationId: string; method: Json }, ctx) => {
        if (ctx.runId) throw new Error("method.accept: promotion is a human act and cannot be invoked from a run");
        const evs = await events(callerOf(ctx));
        const rec = evs.find((e) => e.eventType === "method.recommended" && e.payload.id === i.recommendationId)?.payload as unknown as import("../cognitive/method.ts").MethodRecommendation | undefined;
        if (!rec) throw new Error("method.accept: unknown recommendation");
        const next = acceptMethod({ activeMethodHash: activeMethod(evs), history: [] }, rec, i.method, { actorId: ctx.actor.id, kind: ctx.actor.kind });
        await record("method.accepted", { recommendationId: rec.id, methodHash: next.activeMethodHash, previousMethodHash: activeMethod(evs), acceptedBy: ctx.actor.id });
        return { methodHash: next.activeMethodHash };
      }));

      fiber.provide(contract("risk.assess"), withCtx(async (i: { worldId: string; root: string; command: string; tool: string; toolCallId: string; caseId?: string; origin?: { id: string; kind: "agent" | "user" } }, ctx) => {
        const findings: Finding[] = [];
        const host = createMediationHost();
        host.register(sentinel({ emit: (f) => findings.push(f) }));
        host.register(riskPreflight(async (_command, targets): Promise<Impact> => {
          const run = (argv: string[]) => call<ExecInput, ExecResult>(dep.exec!, { worldId: i.worldId, argv, cwd: i.root }, ctx);
          const count = await run(["bash", "-lc", `find ${targets.map((t) => JSON.stringify(t)).join(" ")} -type f 2>/dev/null | wc -l`]);
          const dirty = await run(["bash", "-lc", `git status --porcelain -- ${targets.map((t) => JSON.stringify(t)).join(" ")} 2>/dev/null | wc -l`]);
          return { files: Number(count.stdout.trim()) || 0, uncommitted: Number(dirty.stdout.trim()) || 0, recovery: "tracked files restore from git; untracked/uncommitted changes in the target are not recoverable" };
        }));
        for (const m of options.extraMediators ?? []) host.register(m);
        const { outcome, trace } = await host.run(
          { family: "capability.invoke", origin: i.origin ?? { id: "agent.coding", kind: "agent" }, input: { tool: i.tool, command: i.command, toolCallId: i.toolCallId, caseId: i.caseId } },
          // Shadow-safe core: a pure classification, no side effects.
          (event): Outcome => ({ ok: true, value: { approvalRequired: classifyDestructive(String((event.input as { command?: string }).command ?? "")) !== undefined } }),
        );
        const value = outcome.ok ? (outcome.value as { approvalRequired: boolean; surface?: Surface }) : { approvalRequired: true };
        return { approvalRequired: value.approvalRequired, ...(value.surface ? { surface: value.surface as unknown as Json } : {}), findings: findings as unknown as Json, trace: trace as unknown as Json, denied: !outcome.ok };
      }));
    },
  };
}
