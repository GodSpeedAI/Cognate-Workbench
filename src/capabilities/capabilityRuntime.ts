// Capability-bundles tranche T2 (§2.1B/§2.5): the dispatcher — the SOLE route to bundle
// functionality. Boot-allowlisted; constructs app-owned adapter components and Kernel.mounts
// them (hot-swap discipline, 30 s explicit timeout — the dispatcher's own choice), registers
// typed interpreters into a VERSION-KEYED handler table via the activate closure, and enforces
// the §1.4 authority decision per invocation with the propagated caller principal. Bundle-
// authored code never runs in-process: the adapters interpret bundle DATA (tool schemas, skill
// documents, descriptor metadata); executable handlers (T3) are spawned, contained processes.
//
// Adapter invariants (§2.1B): every interpreter registration pairs with a fiber.effects disposer
// (a failed activation must leave the table empty — asserted by test); no `requires`; no slow
// work inside activate (hash verification happens before the mount); invocation racing
// activation receives the structured unavailable refusal.
//
// Per-call deadline: 60 s default, capability-declarable to 300 s (§2.1B) — the drain invariant
// requires call termination; expiry returns the structured deadline_exceeded envelope and
// decrements the per-version in-flight counter. Disposal follows the counter, never precedes it
// (no kernel drain primitive exists — the counter is net-new, §10.3).
//
// Decision (§1.4), implemented once in `decide`: runtime enabled (§1.7 marker) ∧ not the system
// caller ∧ index available ∧ the SELECTED activation row active with no suspension reasons ∧
// required ⊆ ceiling ∧ required ⊆ invoking actor's grant (live: unexpired, unrevoked) ∧ the
// clamp grant intact. Every refusal and every allow is recorded (`authority.decision.recorded`).
// Hot reload (§4.2.6): the index (commit-synchronous) names the governing version; the new
// version's handle is mounted and verified BEFORE the `repointed` commit, so the first
// invocation after the commit is served by the new handle, while calls that took their snapshot
// earlier finish on the old one, which is disposed only after its counter drains.
import type { Component, CapabilityContract, SemanticRef, Kernel, ComponentHandle } from "@godspeedai/cognate-kernel-api";
import type { Json } from "@godspeedai/cognate-events";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import Ajv from "ajv";
import type { LifecycleRecorder } from "../workbench/lifecycleRecorder.ts";
import type { AuthorityIndex, ActivationRow } from "../workbench/authorityIndex.ts";
import { detectHarnessConflicts, hasHarness, patchedRecord, validateHarness, EMPTY_HARNESS, type HarnessDeclaration } from "../workbench/harnessPatches.ts";
import { loadSkill, verifyBundleIntegrity, type BundleManifestData, type LoadableBundle } from "./skillLoader.ts";
import { LOCAL_ROOT_ID } from "./authorityGrants.ts";
import { createRuntimeMutex } from "../workbench/runtimeMutex.ts";
import { authorizeCapabilityOp, permissionCovered, principalForActor, sessionOfRun, type Actor, type Authorization, type CapabilityOp, type Failure } from "../workbench/authoritySelection.ts";
import { randomUUID } from "node:crypto";

export interface DispatcherInterpreterInput {
  readonly op: "tools.list" | "tool.invoke" | "skill.load";
  readonly tool?: string;
  readonly arguments?: Record<string, unknown>;
  readonly skillId?: string;
}

type InterpreterResult =
  | { readonly ok: true; readonly result: Json }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly retryable: boolean };

export interface DispatcherInterpreter {
  (input: DispatcherInterpreterInput, actor: { id: string; kind: string }, deadlineMs: number): Promise<InterpreterResult>;
}

interface HandlerEntry {
  readonly capabilityId: string;
  readonly version: string;
  readonly sessionId: string | undefined;
  readonly bundle: LoadableBundle;
  readonly interpreter: DispatcherInterpreter;
  readonly scopeId: string;
  handle: ComponentHandle | undefined;
  inFlight: number;
}

const DEFAULT_DEADLINE_MS = 60_000;
const MAX_DEADLINE_MS = 300_000;
const MOUNT_TIMEOUT_MS = 30_000;

/** Test seams (never wired in production boots): observation/fault points inside the dispatcher. */
export interface CapabilityRuntimeHooks {
  /** Runs inside the adapter's activate closure; a throw is a kernel activation failure. */
  readonly beforeMount?: (info: { capabilityId: string; version: string }) => void | Promise<void>;
  /** Runs after the invocation snapshot is taken, before the interpreter — holds a call in flight. */
  readonly beforeInterpret?: (info: { capabilityId: string; version: string; op: string }) => void | Promise<void>;
  /** Runs after a replacement is mounted and before its pre-state check and `repointed` commit. */
  readonly beforeRepointCommit?: (info: { capabilityId: string; from: string; to: string }) => void | Promise<void>;
}

export interface CapabilityRuntimeOptions {
  /** Lazy accessors: constructed in the createRuntime options list, before the runtime exists. */
  readonly getKernel: () => Kernel;
  readonly getRootScope: () => import("@godspeedai/cognate-kernel-api").Scope;
  readonly getService: () => RuntimeService;
  readonly tenant: string;
  /** The lifecycleRecorder (§1.5): activation commits go through it, not the normal path. */
  readonly getRecorder: () => LifecycleRecorder;
  readonly getIndex?: () => AuthorityIndex;
  /** §1.7: the durable enablement marker. Absent or unreadable = the runtime refuses (fail-closed). */
  readonly isEnabled?: () => Promise<boolean>;
  /** Record path for enforcement decisions (§8: point A refusals always; bundle-path allows). */
  readonly recordDecision: (event: { readonly type: string; readonly payload: Json }) => Promise<void>;
  readonly semanticRefs?: Readonly<Record<string, SemanticRef | undefined>>;
  /** Boot-rebuilt rows the dispatcher mounts from (fold-first/mount-second, §4.2.8). */
  readonly activeSet: readonly { capabilityId: string; version: string; dir: string }[];
  readonly hooks?: CapabilityRuntimeHooks;
  /** The shared runtime mutex (activation, deactivation, uninstall, grant issue/revoke). */
  readonly mutex?: import("../workbench/runtimeMutex.ts").RuntimeMutex;
  /** The §1.5 deployment invariant, re-evaluated per decision (default: satisfied). */
  readonly deploymentOk?: () => boolean;
  /** The injected clock: every expiry decision compares against it (default: wall clock). */
  readonly now?: () => Date;
}

type Ctx = { actor: Actor; runId?: string };

const DEFAULT_REQUIREMENTS: readonly string[] = ["capability.invoke", "skill.load"];
const keyOf = (capabilityId: string, version: string, sessionId?: string): string => `${capabilityId}|${sessionId ?? ""}@${version}`;

export function capabilityRuntimeComponent(options: CapabilityRuntimeOptions): Component {
  const nowMs = (): number => (options.now ?? (() => new Date()))().getTime();
  const expired = (expiresAt: string | undefined): boolean => expiresAt !== undefined && new Date(expiresAt).getTime() <= nowMs();
  const contracts: CapabilityContract[] = [
    { id: "tool.capability_invoke", version: "1.0.0", semanticRef: options.semanticRefs?.["tool.capability_invoke"] },
    { id: "tool.skill_load", version: "1.0.0", semanticRef: options.semanticRefs?.["tool.skill_load"] },
    { id: "capability.bundle.activate", version: "1.0.0", semanticRef: options.semanticRefs?.["capability.bundle.activate"] },
    { id: "capability.bundle.deactivate", version: "1.0.0", semanticRef: options.semanticRefs?.["capability.bundle.deactivate"] },
  ];
  const ajv = new Ajv({ strict: false });
  const table = new Map<string, HandlerEntry>(); // key: capabilityId@version (version-keyed)

  function interpreterFor(bundle: LoadableBundle): DispatcherInterpreter {
    const tools = bundle.manifest.tools ?? [];
    const validators = new Map(tools.map((t) => [t.id, ajv.compile(t.inputSchema)] as const));
    return async (input) => {
      if (input.op === "tools.list") {
        return { ok: true, result: { tools: tools.map((t) => ({ id: `${bundle.capabilityId}.${t.id}`, description: t.description, inputSchema: t.inputSchema })) } as unknown as Json };
      }
      if (input.op === "skill.load") {
        const loaded = await loadSkill(bundle, input.skillId);
        return loaded.ok ? { ok: true, result: loaded.result as unknown as Json } : { ok: false, code: loaded.code, message: loaded.message, retryable: false };
      }
      if (input.op === "tool.invoke") {
        const given = input.tool ?? "";
        const name = given.startsWith(`${bundle.capabilityId}.`) ? given.slice(bundle.capabilityId.length + 1) : given;
        const validate = validators.get(name);
        if (!validate) return { ok: false, code: "unknown_tool", message: `${bundle.capabilityId} declares no tool ${given}`, retryable: false };
        if (!validate(input.arguments ?? {})) {
          return { ok: false, code: "schema_invalid", message: `arguments for ${name} violate the declared schema: ${ajv.errorsText(validate.errors)}`, retryable: false };
        }
        // Executable handlers are spawned, contained processes (T3). Data bundles carry none.
        return { ok: false, code: "no_executable_handler", message: `${bundle.capabilityId}.${name} has no executable handler in this release`, retryable: false };
      }
      return { ok: false, code: "unknown_operation", message: `unknown dispatcher operation ${String(input.op)}`, retryable: false };
    };
  }

  const mountInterpreter = async (bundle: LoadableBundle, sessionId?: string): Promise<HandlerEntry> => {
    const version = bundle.versionHash;
    const key = keyOf(bundle.capabilityId, version, sessionId);
    const scopeId = `cap-runtime:${bundle.capabilityId}:${sessionId ?? "persistent"}:${version}`;
    const entry: HandlerEntry = { capabilityId: bundle.capabilityId, version, sessionId, bundle, interpreter: interpreterFor(bundle), scopeId, handle: undefined, inFlight: 0 };
    const adapter: Component = {
      id: scopeId,
      async activate(fiber) {
        // Disposer paired with the registration: a failed activation or a teardown leaves no row.
        fiber.effects.register(async () => {
          if (table.get(key) === entry) table.delete(key);
        });
        await options.hooks?.beforeMount?.({ capabilityId: bundle.capabilityId, version });
        // No fiber.provide — handlers are never kernel-resolved (§2.3 row 4).
        table.set(key, entry);
      },
    };
    const handle = await options.getKernel().mount(adapter, options.getRootScope().child({ id: scopeId }));
    try {
      await handle.waitFor("ACTIVE", MOUNT_TIMEOUT_MS);
    } catch (error) {
      await handle.dispose("mount failed before activation").catch(() => {});
      if (table.get(key) === entry) table.delete(key);
      throw error;
    }
    entry.handle = handle;
    return entry;
  };

  /** Drain-then-dispose (§4.2.6): the handle goes only after the in-flight counter reaches zero. */
  const retire = (entry: HandlerEntry): void => {
    const check = setInterval(() => {
      if (entry.inFlight <= 0) {
        clearInterval(check);
        void entry.handle?.dispose("version drained").catch(() => {});
      }
    }, 50);
    void check.unref?.();
  };

  return {
    id: "capability-runtime:dispatcher",
    provides: contracts,
    activate(fiber) {
      const provide = <I, O>(id: string, handler: (input: I, ctx: Ctx) => Promise<O>) =>
        fiber.provide(contracts.find((c) => c.id === id) as CapabilityContract, async (raw: unknown, ctx) => handler(raw as I, ctx as never));

      const readRows = async (): Promise<ReadonlyMap<string, unknown>> => {
        const rows = (await options.getService().readProjection({ actor: { id: "system", kind: "system" }, tenant: options.tenant }, { name: "workbench" })).rows;
        return new Map(rows.map((r) => [r.key, r.value] as const));
      };
      const manifestOf = (rows: ReadonlyMap<string, unknown>, capabilityId: string, version: string): BundleManifestData | undefined =>
        (rows.get(`bundle-version/${capabilityId}/${version}`) as { manifest?: BundleManifestData | null } | undefined)?.manifest ?? undefined;

      // Records go through the recorder; concurrent commits on one capability's stream race on
      // the CAS version, so a record retries (the decision is evidence — it must not be lost).
      const record = async (type: string, payload: Record<string, unknown>): Promise<void> => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            await options.recordDecision({ type, payload: payload as unknown as Json });
            return;
          } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
          }
        }
        throw lastError;
      };
      const recordDecision = (capabilityId: string, operation: string | undefined, actor: Actor, outcome: "refused" | "allowed", reasonCode: string, reason: string, extra: Record<string, unknown> = {}) =>
        record("authority.decision.recorded", { decisionId: randomUUID(), point: "dispatcher", actorId: actor.id, actorKind: actor.kind, capability: capabilityId, ...(operation ? { operation } : {}), outcome, reasonCode, reason, ...extra });
      const commit = (capabilityId: string, events: readonly { type: string; payload: Record<string, unknown> }[], key: string) =>
        options.getRecorder().commitBatch(capabilityId, events, `${key}:${randomUUID()}`);

      // Boot-mount the active set (fold-first/mount-second; §4.2.8).
      void (async () => {
        if (options.activeSet.length === 0) return;
        const rows = await readRows();
        for (const active of options.activeSet) {
          try {
            const manifest = manifestOf(rows, active.capabilityId, active.version);
            if (!manifest) throw new Error("no manifest row for the active version");
            await mountInterpreter({ capabilityId: active.capabilityId, versionHash: active.version, dir: active.dir, manifest });
          } catch (error) {
            await recordDecision(active.capabilityId, undefined, { id: "system", kind: "system" }, "refused", "mount-failed", String(error instanceof Error ? error.message : error)).catch(() => {});
          }
        }
      })().catch(() => {});

      const sessionOf = (ctx: Ctx): Promise<string | undefined> => sessionOfRun(options.getService() as never, options.tenant, ctx.runId);

      /** The async prerequisites of ANY authorization: enablement, deployment invariant, index
       *  readiness, and the run's session (from the run context only). The decision itself is
       *  `authorizeCapabilityOp`, evaluated synchronously over committed index state. */
      interface Prep { enabled: boolean; deploymentOk: boolean; index: AuthorityIndex | undefined; sessionId: string | undefined }
      const prepare = async (ctx: Ctx): Promise<Prep> => {
        let enabled = false;
        try {
          enabled = (await options.isEnabled?.()) === true;
        } catch {
          enabled = false;
        }
        let index = options.getIndex?.();
        if (index) {
          try {
            await index.ready;
          } catch {
            index = undefined;
          }
        }
        return { enabled, deploymentOk: options.deploymentOk ? options.deploymentOk() : true, index, sessionId: await sessionOf(ctx) };
      };
      const check = (op: CapabilityOp, prep: Prep, ctx: Ctx, capabilityId: string | undefined, permission: string | undefined): Authorization =>
        authorizeCapabilityOp(op, { enabled: prep.enabled, deploymentOk: prep.deploymentOk, index: prep.index, actor: ctx.actor, runId: ctx.runId, sessionId: prep.sessionId, capabilityId, permission, nowMs: nowMs() });
      const principalOf = principalForActor;

      const dispatch = async (entry: HandlerEntry, input: DispatcherInterpreterInput, actor: Actor, deadlineMs: number): Promise<InterpreterResult> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await options.hooks?.beforeInterpret?.({ capabilityId: entry.capabilityId, version: entry.version, op: input.op });
          return await Promise.race([
            entry.interpreter(input, actor, deadlineMs),
            new Promise<InterpreterResult>((resolve) => { timer = setTimeout(() => resolve({ ok: false, code: "deadline_exceeded", message: `call exceeded the ${deadlineMs}ms deadline`, retryable: false }), deadlineMs); }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      /** §4.4: fail-closed load + `capability.integrity_failed` + reason-`integrity` suspension. */
      const integrityFault = async (entry: HandlerEntry, index: AuthorityIndex): Promise<void> => {
        const row = index.selectActivation(entry.capabilityId, "user");
        const events: { type: string; payload: Record<string, unknown> }[] = [
          { type: "capability.integrity_failed", payload: { capabilityId: entry.capabilityId, version: entry.version, reason: "version directory failed its recorded content hash" } },
        ];
        if (row && row.state === "active" && !row.suspensionReasons.includes("integrity")) {
          events.push({ type: "capability.suspended", payload: { capabilityId: entry.capabilityId, level: row.level, ...(row.sessionId ? { sessionId: row.sessionId } : {}), reason: "integrity" } });
        }
        await commit(entry.capabilityId, events, `integrity:${entry.capabilityId}:${entry.version}`).catch(() => {});
      };

      const invokeFlow = async (
        input: { capabilityId?: string },
        ctx: Ctx,
        permission: string,
        operation: string | undefined,
        run: DispatcherInterpreterInput,
      ): Promise<Record<string, unknown>> => {
        const capabilityId = String(input.capabilityId ?? "");
        const prep = await prepare(ctx);
        // ---- synchronous critical section: decision, snapshot, counter (no await inside) ----
        const auth = check(permission === "skill.load" ? "skill.load" : "invoke", prep, ctx, capabilityId, permission);
        let failure: Failure | undefined = auth.ok ? undefined : auth;
        const mounted = auth.ok ? table.get(keyOf(capabilityId, auth.row!.version, auth.row!.sessionId)) : undefined;
        if (auth.ok && !mounted) failure = { ok: false, code: "unmounted", reason: `capability ${capabilityId} version ${auth.row!.version} is committed active but has no mounted handler` };
        if (failure) {
          await recordDecision(capabilityId, operation, ctx.actor, "refused", failure.code, failure.reason);
          const unavailable = failure.code === "unmounted" || failure.code === "runtime-disabled" || failure.code === "index-unavailable" || failure.code === "deployment-invariant";
          return { ok: false, code: unavailable ? "unavailable" : "refused", message: failure.reason, retryable: failure.code === "unmounted", reasonCode: failure.code, decidingPoint: "dispatcher" };
        }
        const decision = { grantId: (auth as { grant: { grantId: string } }).grant.grantId };
        const g = { index: (auth as { index: AuthorityIndex }).index };
        const entry = mounted!;
        entry.inFlight += 1;
        // ---- end critical section ----
        try {
          await recordDecision(capabilityId, operation, ctx.actor, "allowed", "within-ceiling-and-grant", `${permission} covered by ceiling and grant ${decision.grantId}`, { version: entry.version });
          const result = await dispatch(entry, run, ctx.actor, Math.min(DEFAULT_DEADLINE_MS, MAX_DEADLINE_MS));
          if (!result.ok) {
            await recordDecision(capabilityId, operation, ctx.actor, "refused", result.code, result.message, { version: entry.version });
            if (result.code === "integrity") await integrityFault(entry, g.index);
          }
          return { ...result, version: entry.version, decidingPoint: "dispatcher" };
        } finally {
          entry.inFlight -= 1;
        }
      };

      provide("tool.capability_invoke", async (input: { capabilityId: string; op?: string; tool?: string; arguments?: Record<string, unknown> }, ctx) => {
        const op = (input.op ?? "tool.invoke") as DispatcherInterpreterInput["op"];
        if (op !== "tools.list" && op !== "tool.invoke" && op !== "skill.load") {
          const reason = `unknown dispatcher operation ${String(op)} (closed vocabulary: tools.list, tool.invoke, skill.load)`;
          await recordDecision(String(input.capabilityId ?? ""), String(op), ctx.actor, "refused", "unknown-operation", reason);
          return { ok: false, code: "unknown_operation", message: reason, retryable: false, decidingPoint: "dispatcher" };
        }
        return invokeFlow(input, ctx, op === "skill.load" ? "skill.load" : "capability.invoke", input.tool, { op, tool: input.tool, arguments: input.arguments, skillId: input.tool });
      });

      provide("tool.skill_load", async (input: { capabilityId: string; skillId: string }, ctx) =>
        invokeFlow(input, ctx, "skill.load", input.skillId, { op: "skill.load", skillId: input.skillId }));

      // ---- activation, replacement, deactivation (§4.2.4/§4.2.6) --------------------------------

      const bundleFor = async (capabilityId: string): Promise<{ bundle: LoadableBundle; harness: HarnessDeclaration; requirements: readonly string[] } | undefined> => {
        const rows = await readRows();
        const latest = rows.get(`bundle/${capabilityId}`) as { versionHash?: string; dir?: string; uninstalled?: boolean } | undefined;
        if (!latest?.versionHash || latest.uninstalled) return undefined;
        const manifest = manifestOf(rows, capabilityId, latest.versionHash);
        if (!manifest) return undefined;
        const dir = (rows.get(`bundle-version/${capabilityId}/${latest.versionHash}`) as { dir?: string } | undefined)?.dir ?? latest.dir ?? "";
        return { bundle: { capabilityId, versionHash: latest.versionHash, dir, manifest }, harness: validateHarness(manifest.harness), requirements: manifest.requirements?.length ? manifest.requirements : DEFAULT_REQUIREMENTS };
      };

      /** Live harness/ownership declarations of every OTHER non-terminal activation (§3.3 input). */
      const liveSources = async (index: AuthorityIndex, except: string) => {
        const rows = await readRows();
        const out: { capabilityId: string; owns: readonly string[]; conflicts: readonly string[]; harness: HarnessDeclaration }[] = [];
        const seen = new Set<string>();
        for (const row of index.activations.values()) {
          if (row.capabilityId === except || seen.has(row.capabilityId) || (row.state !== "active" && row.state !== "suspended")) continue;
          const manifest = manifestOf(rows, row.capabilityId, row.version);
          if (!manifest) continue;
          seen.add(row.capabilityId);
          out.push({ capabilityId: row.capabilityId, owns: manifest.owns ?? [], conflicts: manifest.conflicts ?? [], harness: validateHarness(manifest.harness) });
        }
        return out;
      };

      /** Who may activate, and what ceiling results: requirements ∩ actor grant ∩ operator root.
       *  The permission checks (bundle.activate on actor AND root) are `authorizeCapabilityOp`'s. */
      const authorize = (ctx: Ctx, prep: Prep, requirements: readonly string[], harness: HarnessDeclaration): { ok: true; ceiling: string[]; clampProvenance: string } | Failure => {
        const auth = check("activate", prep, ctx, undefined, "bundle.activate");
        if (!auth.ok) return auth;
        const grant = auth.grant!;
        const root = auth.root!;
        const ceiling = requirements.filter((r) => permissionCovered(grant.permissions, r) && permissionCovered(root.permissions, r));
        const clipped = requirements.filter((r) => permissionCovered(grant.permissions, r) && !permissionCovered(root.permissions, r));
        if (clipped.length > 0) return { ok: false, code: "beyond-operator", reason: `the operator root's permissions do not cover ${clipped.join(", ")}, which the bundle requires` };
        if (ceiling.length === 0) return { ok: false, code: "beyond-operator", reason: "the intersection of the bundle's requirements, the actor's grant and the operator root's permissions is empty" };
        if (hasHarness(harness) && !ceiling.includes("harness.modify")) return { ok: false, code: "harness-not-covered", reason: "the bundle declares harness surfaces but the actor's grant does not cover harness.modify" };
        return { ok: true, ceiling, clampProvenance: auth.principalId === LOCAL_ROOT_ID ? "operator" : grant.grantId };
      };

      const patchedEvents = (capabilityId: string, version: string, sessionId: string | undefined, harness: HarnessDeclaration, change: "applied" | "removed") =>
        hasHarness(harness) ? [patchedRecord({ capabilityId, version, ...(sessionId ? { sessionId } : {}), harness }, change)] : [];

      // R3-6: activation and deactivation run one at a time (valid under the §1.5 single-writer
      // invariant), so conflict detection, authorization and the commit see one consistent state.
      const mutex = options.mutex ?? createRuntimeMutex();
      const serial = <T,>(fn: () => Promise<T>): Promise<T> => mutex.run(fn);

      provide("capability.bundle.activate", (input: { capabilityId: string; sessionId?: string }, ctx: Ctx) => serial(async () => {
        const capabilityId = String(input.capabilityId ?? "");
        const sessionId = typeof input.sessionId === "string" && input.sessionId ? input.sessionId : undefined;
        const refuse = async (code: string, reason: string, faultType?: string, version?: string): Promise<never> => {
          await recordDecision(capabilityId, "activate", ctx.actor, "refused", code, reason);
          if (faultType) await commit(capabilityId, [{ type: faultType, payload: { capabilityId, ...(version ? { version } : {}), reason: `${code}: ${reason}` } }], `fault:${capabilityId}`).catch(() => {});
          throw new Error(`capability.bundle.activate: ${reason}`);
        };
        const prep0 = await prepare(ctx);
        const first = check("activate", prep0, ctx, capabilityId, "bundle.activate");
        if (!first.ok) return refuse(first.code, first.reason);
        const g = { index: first.index };
        const found = await bundleFor(capabilityId);
        if (!found) throw new Error(`capability.bundle.activate: ${capabilityId} is not a registered, installed bundle`);
        const { bundle, harness, requirements } = found;
        const authority = authorize(ctx, prep0, requirements, harness);
        if (!authority.ok) return refuse(authority.code, authority.reason);
        const slot = g.index.activationKey(capabilityId, "user", sessionId);
        const existing = g.index.activations.get(slot);
        const live = existing && (existing.state === "active" || existing.state === "suspended") ? existing : undefined;
        if (live?.state === "suspended") return refuse("suspended", `activation of ${capabilityId} is suspended (${live.suspensionReasons.join(", ")}); resumption is an explicit act, activation does not clear it`);
        if (live && live.version === bundle.versionHash) return { capabilityId, version: live.version, state: "active", unchanged: true };
        const replacing = live !== undefined;
        const failType = replacing ? "capability.repoint_failed" : "capability.activation_failed";

        // §3.3: conflict detection runs at the activation commit AND the repoint commit.
        const conflicts = detectHarnessConflicts(
          { capabilityId, owns: bundle.manifest.owns ?? [], conflicts: bundle.manifest.conflicts ?? [], harness },
          await liveSources(g.index, capabilityId),
        );
        if (conflicts.length > 0) return refuse("conflict", `co-activation refused: ${conflicts.map((c) => `${c.surface} (${c.capabilities.join(" vs ")})`).join("; ")}`, failType, bundle.versionHash);

        // §4.4: the directory must match its recorded hash before it is mounted.
        if (!(await verifyBundleIntegrity(bundle.dir, bundle.versionHash, bundle.manifest))) return refuse("integrity", `version ${bundle.versionHash} of ${capabilityId} failed its integrity check`, failType, bundle.versionHash);

        let entry: HandlerEntry;
        try {
          entry = await mountInterpreter(bundle, sessionId);
        } catch (error) {
          return refuse("mount-failed", `mount of ${capabilityId}@${bundle.versionHash} failed: ${error instanceof Error ? error.message : String(error)}`, failType, bundle.versionHash);
        }
        // After mount, before commit: any abort disposes the mounted handle (§4.3).
        const abort = async (code: string, reason: string): Promise<never> => {
          if (table.get(keyOf(capabilityId, bundle.versionHash, sessionId)) === entry) table.delete(keyOf(capabilityId, bundle.versionHash, sessionId));
          await entry.handle?.dispose("aborted before commit").catch(() => {});
          return refuse(code, reason, failType, bundle.versionHash);
        };
        if (live) await options.hooks?.beforeRepointCommit?.({ capabilityId, from: live.version, to: bundle.versionHash });
        // CAS pre-state validation against the re-read index (§4.2).
        const now = g.index.activations.get(slot);
        if (live && (!now || now.state !== "active" || now.version !== live.version)) return abort("pre-state-changed", `the activation changed during replacement (now ${now?.state ?? "absent"}${now ? ` at ${now.version}` : ""}); the last known-good version stands`);
        if (!live && now && (now.state === "active" || now.state === "suspended")) return abort("pre-state-changed", "another activation committed concurrently");
        // R2-4: authorization is re-checked AT the commit, not trusted from the start of the
        // activation (mounting awaits): enablement, the activator's grant, the root grant and
        // expiry, evaluated synchronously against the index immediately before the commit call.
        // Inside the serialized section: conflicts are re-evaluated against live state, then the
        // grants are re-read (prepare + check are evaluated against the index now).
        const conflictsNow = detectHarnessConflicts(
          { capabilityId, owns: bundle.manifest.owns ?? [], conflicts: bundle.manifest.conflicts ?? [], harness },
          await liveSources(g.index, capabilityId),
        );
        if (conflictsNow.length > 0) return abort("conflict", `co-activation refused at commit: ${conflictsNow.map((c) => `${c.surface} (${c.capabilities.join(" vs ")})`).join("; ")}`);
        // R4-1: the bundle must STILL be installed, with this version present, inside the critical
        // section (uninstall holds the same mutex, so it cannot interleave from here to the commit).
        const rowsNow = await readRows();
        const latestNow = rowsNow.get(`bundle/${capabilityId}`) as { uninstalled?: boolean } | undefined;
        if (!latestNow || latestNow.uninstalled || !manifestOf(rowsNow, capabilityId, bundle.versionHash)) return abort("not-installed", `${capabilityId}@${bundle.versionHash} is no longer installed — activation aborted before commit`);
        // R4-2: the LAST step before the commit — prepare, authorize, commit; nothing awaited between.
        const fresh = await prepare(ctx);
        const recheck = authorize(ctx, fresh, requirements, harness);
        if (!recheck.ok) return abort(recheck.code, `activation authorization stale at commit: ${recheck.reason}`);
        try {
          const head = live
            ? { type: "capability.repointed", payload: { capabilityId, level: "user", from: live.version, to: bundle.versionHash, ...(sessionId ? { sessionId } : {}) } }
            : { type: "capability.activated", payload: { capabilityId, level: "user", version: bundle.versionHash, ceiling: recheck.ceiling, clampProvenance: recheck.clampProvenance, ...(sessionId ? { sessionId } : {}) } };
          await commit(capabilityId, [head, ...patchedEvents(capabilityId, bundle.versionHash, sessionId, harness, "applied")], live ? "repoint" : "activate");
        } catch (error) {
          return abort("commit-failed", `the ${live ? "repoint" : "activation"} commit failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        // The commit's own await is the residual window (grants live on other streams): verify once
        // more and, if authority vanished meanwhile, suspend at once and record.
        const post = authorize(ctx, await prepare(ctx), requirements, harness);
        if (!post.ok) {
          await commit(capabilityId, [{ type: "capability.suspended", payload: { capabilityId, level: "user", ...(sessionId ? { sessionId } : {}), reason: "grant-revoked" } }], "post-commit-suspend").catch(() => {});
          await recordDecision(capabilityId, "activate", ctx.actor, "refused", post.code, `authorization lapsed during the activation commit: ${post.reason}`);
          throw new Error(`capability.bundle.activate: authorization lapsed during the activation commit (${post.reason}); the activation was suspended`);
        }
        // Commit visible: the new handle serves from now on; the old one drains, then goes.
        if (live) {
          const old = table.get(keyOf(capabilityId, live.version, sessionId));
          if (old) retire(old);
        }
        return { capabilityId, version: entry.version, state: "active", ...(live ? { repointedFrom: live.version } : {}) };
      }));

      provide("capability.bundle.deactivate", (input: { capabilityId: string; sessionId?: string }, ctx: Ctx) => serial(async () => {
        const capabilityId = String(input.capabilityId ?? "");
        const sessionId = typeof input.sessionId === "string" && input.sessionId ? input.sessionId : undefined;
        // R3-5: deactivation is authorized like every other operation: bundle.deactivate on the
        // actor's live grant ∩ the live root grant (the operator outside a run IS the root grant).
        const auth = check("deactivate", await prepare(ctx), ctx, capabilityId, "bundle.deactivate");
        if (!auth.ok) {
          await recordDecision(capabilityId, "deactivate", ctx.actor, "refused", auth.code, auth.reason);
          throw new Error(`capability.bundle.deactivate: ${auth.reason}`);
        }
        const index = auth.index;
        const row = index.activations.get(index.activationKey(capabilityId, "user", sessionId));
        if (!row || (row.state !== "active" && row.state !== "suspended")) throw new Error(`capability.bundle.deactivate: ${capabilityId} has no live activation`);
        // R4-3: only THIS activation's handlers (its scope: persistent or session) are removed.
        const entries = [...table.values()].filter((e) => e.capabilityId === capabilityId && e.sessionId === sessionId);
        const busy = entries.reduce((n, e) => n + e.inFlight, 0);
        if (busy > 0) throw new Error(`capability.bundle.deactivate: ${capabilityId} has ${busy} in-flight call(s) — drain first`);
        let harness: HarnessDeclaration = EMPTY_HARNESS;
        try {
          harness = validateHarness(manifestOf(await readRows(), capabilityId, row.version)?.harness);
        } catch { /* a declaration that no longer validates contributed nothing */ }
        // R4-2: re-authorize as the LAST step before the commit (the projection read above awaited).
        const last = check("deactivate", await prepare(ctx), ctx, capabilityId, "bundle.deactivate");
        if (!last.ok) {
          await recordDecision(capabilityId, "deactivate", ctx.actor, "refused", last.code, `authorization lapsed before the deactivation commit: ${last.reason}`);
          throw new Error(`capability.bundle.deactivate: ${last.reason}`);
        }
        await commit(capabilityId, [
          { type: "capability.deactivated", payload: { capabilityId, level: "user", ...(sessionId ? { sessionId } : {}) } },
          ...patchedEvents(capabilityId, row.version, sessionId, harness, "removed"),
        ], "deactivate");
        for (const e of entries) {
          table.delete(keyOf(e.capabilityId, e.version, e.sessionId));
          retire(e);
        }
        return { capabilityId, state: "dormant" };
      }));
    },
  };
}
