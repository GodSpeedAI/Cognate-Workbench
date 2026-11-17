// Capability-bundles tranche T2 (§3.2/§5.1): the run-start resolver and the live descriptor
// refresh. Every agent run source — UI turn, expert run, scheduled run, subagent child — asks this
// module, at run start, for its harness configuration; the answer is DERIVED from durable
// activation state on every call (never stored as a blob), so deactivating a capability restores
// the prior working configuration by replay.
//
//   * named instruction sections (closed vocabulary, `harnessPatches.ts`), composed in the §3.3
//     precedence and rendered alongside the bounded capability-discovery section;
//   * toolset override application through the existing `toolsForPreset` seam;
//   * `capability.harness.assembled` payloads BY REFERENCE: section / toolset / descriptor hashes
//     plus the delta against the base preset; full section text rides only the first assembly of a
//     changed section (bounds per-run log cost).
//
// The resolver never records: it runs inside a run's `ctx.invoke`, and a capability that started a
// recording run would queue behind the very run that called it (runs execute serially). It returns
// the records; the loop emits them (`ctx.emit`), exactly as it emits its other decision records.
//
// Failure semantics (§3.2): runtime enabled but the authority index unavailable at run start → the
// run REFUSES to start (fail-closed, recorded by the loop). Runtime disabled → a no-op result: no
// instructions, no override, no records — the pre-runtime behaviour, unchanged.
//
// Live discovery: `refreshDescriptors` compares the index's capability-event sequence number with
// the one the run last saw (one in-memory counter read per model step); only on change does it
// re-read the descriptor section, which is data — it carries no authority.
import type { Component, CapabilityContract, HandlerContext, SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Json } from "@godspeedai/cognate-events";
import type { AuthorityIndex, ActivationRow } from "../workbench/authorityIndex.ts";
import { DescriptorRegistry, assembleDescriptorSection, type BundleManifestData, type Descriptor } from "../capabilities/skillLoader.ts";
import { authorizeCapabilityOp, governingActivation, liveClamp, sessionOfRun } from "../workbench/authoritySelection.ts";
import { INSTRUCTION_SECTIONS, composeSections, effectiveToolset, orderSources, sha, validateHarness, hasHarness, type PatchSource } from "../workbench/harnessPatches.ts";

export interface ResolverRow { readonly key: string; readonly value: unknown }

export interface RunStartResolverDeps {
  readonly isEnabled: () => Promise<boolean>;
  /** The §1.5 deployment invariant, re-evaluated per call (default: satisfied). */
  readonly deploymentOk?: () => boolean;
  readonly getIndex: () => AuthorityIndex;
  readonly readRows: () => Promise<readonly ResolverRow[]>;
  /** Wall clock; injectable for tests of grant-expiry legs. */
  readonly now?: () => Date;
}

export interface ResolveInput {
  readonly runId?: string;
  readonly sessionId?: string;
  /** The run's responsible principal (R2-2): patches apply only when its grant ∩ the operator
   *  root's covers harness.modify. Absent = nothing is authorized to apply patches. */
  readonly actor?: { readonly id: string; readonly kind: string };
  readonly preset?: string;
  /** The base preset's tool names (`PRESET_TOOLS[preset]`) — the delta is computed against it. */
  readonly baseTools?: readonly string[];
}

export interface RecordedEvent { readonly type: string; readonly payload: Record<string, unknown> }

export type ResolveResult =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly refused: true; readonly reasonCode: string; readonly reason: string }
  | {
      readonly enabled: true;
      readonly refused?: false;
      /** Rendered instruction text ("" when nothing applies). */
      readonly instructions: string;
      /** The override's tool names for the run's preset, or null (base preset unchanged). */
      readonly toolset: readonly string[] | null;
      readonly sequence: number;
      readonly descriptorHash: string;
      /** The record the loop emits as `capability.harness.assembled`. */
      readonly assembled: RecordedEvent;
      /** `authority.decision.recorded` records for patches refused at assembly; the loop emits them. */
      readonly decisions?: readonly RecordedEvent[];
    };

export type RefreshResult =
  | { readonly changed: false; readonly sequence: number }
  | { readonly changed: true; readonly sequence: number; readonly text: string; readonly descriptorHash: string; readonly assembled: RecordedEvent };

const INDEX_READY_TIMEOUT_MS = 5000;

interface Eligible {
  readonly row: ActivationRow;
  readonly activatedAt: string;
  readonly manifest: BundleManifestData | undefined;
}

export function createRunStartResolver(deps: RunStartResolverDeps) {
  const deploymentOk = (): boolean => (deps.deploymentOk ? deps.deploymentOk() : true);
  const descriptors = new DescriptorRegistry();
  /** Section hashes whose full text has already been recorded (per process). */
  const recordedHashes = new Set<string>();

  const awaitIndex = async (): Promise<AuthorityIndex | undefined> => {
    try {
      const index = deps.getIndex();
      await Promise.race([index.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("authority index not ready")), INDEX_READY_TIMEOUT_MS).unref?.())]);
      return index;
    } catch {
      return undefined;
    }
  };

  const eligibleFor = async (index: AuthorityIndex, sessionId: string | undefined): Promise<readonly Eligible[]> => {
    const rows = new Map((await deps.readRows()).map((r) => [r.key, r.value] as const));
    const now = (deps.now ?? (() => new Date()))().getTime();
    const out: Eligible[] = [];
    const seen = new Set<string>();
    for (const candidate of index.activations.values()) {
      const slot = `${candidate.capabilityId}|${candidate.level}`;
      if (seen.has(slot)) continue;
      seen.add(slot);
      // R2-3: the SAME governing-row selection as the dispatcher — a session row that exists
      // governs (a suspended one blocks; it is never skipped in favour of the persistent row).
      const governing = governingActivation(index, candidate.capabilityId, candidate.level, sessionId, true);
      const row = governing.row;
      if (!row || row.state !== "active" || row.suspensionReasons.length > 0) continue;
      if (!liveClamp(index, row, now).ok) continue;
      const activation = rows.get(`activation/${row.capabilityId}/${row.level}${row.sessionId ? `/${row.sessionId}` : ""}`) as { activatedAt?: string } | undefined;
      const version = rows.get(`bundle-version/${row.capabilityId}/${row.version}`) as { manifest?: BundleManifestData | null } | undefined;
      out.push({ row, activatedAt: activation?.activatedAt ?? "", manifest: version?.manifest ?? undefined });
    }
    return out;
  };

  const descriptorSection = (eligible: readonly Eligible[]) => {
    const built: Descriptor[] = [];
    for (const e of eligible) if (e.manifest) built.push(descriptors.get(e.row.capabilityId, e.row.version, e.manifest));
    return assembleDescriptorSection(built);
  };

  const patchSources = (index: AuthorityIndex, eligible: readonly Eligible[], input: ResolveInput, decisions: RecordedEvent[]): PatchSource[] => {
    const out: PatchSource[] = [];
    const now = (deps.now ?? (() => new Date()))().getTime();
    const runId = input.runId;
    for (const e of eligible) {
      if (!e.manifest) continue;
      // Patches apply only inside the activation's ceiling: harness.modify must be covered.
      if (!e.row.ceiling.includes("harness.modify") && !e.row.ceiling.includes("*")) continue;
      let harness;
      try {
        harness = validateHarness(e.manifest.harness);
      } catch {
        continue; // re-validated on read: a declaration that no longer validates contributes nothing
      }
      if (!hasHarness(harness)) continue;
      // R2-2/R3: authorized by the one function — the responsible principal's live grant ∩ the live
      // root grant must cover harness.modify under the governing row.
      const refuse = (reasonCode: string, reason: string) => {
        decisions.push({ type: "authority.decision.recorded", payload: { decisionId: `harness-patch:${runId ?? "run"}:${e.row.capabilityId}`, point: "run-start", actorId: input.actor?.id ?? "unknown", actorKind: input.actor?.kind ?? "agent", capability: e.row.capabilityId, operation: "harness.apply", outcome: "refused", reasonCode, reason } });
      };
      if (!input.actor) { refuse("no-principal", "the run carries no responsible principal; harness patches are not applied"); continue; }
      const auth = authorizeCapabilityOp("harness.apply", { enabled: true, deploymentOk: deploymentOk(), index, actor: input.actor, runId, sessionId: input.sessionId, capabilityId: e.row.capabilityId, permission: "harness.modify", nowMs: now });
      if (!auth.ok) { refuse(auth.code, auth.reason); continue; }
      out.push({ capabilityId: e.row.capabilityId, version: e.row.version, level: e.row.level, ...(e.row.sessionId ? { sessionId: e.row.sessionId } : {}), activatedAt: e.activatedAt, harness });
    }
    return out;
  };

  const renderInstructions = (sections: Record<string, string>, descriptorText: string): string => {
    const parts: string[] = [];
    for (const name of INSTRUCTION_SECTIONS) if (sections[name]) parts.push(`## ${name}\n${sections[name]}`);
    if (descriptorText) parts.push(`## capabilities\nCapability bundles available through capability_invoke and skill_load (load a composition guide before first use):\n${descriptorText}`);
    return parts.join("\n\n");
  };

  return {
    async resolve(input: ResolveInput): Promise<ResolveResult> {
      const enabled = (await deps.isEnabled()) === true;
      const index = enabled ? await awaitIndex() : undefined;
      const gate = authorizeCapabilityOp("harness.resolve", { enabled, deploymentOk: deploymentOk(), index, actor: input.actor ?? { id: "system", kind: "agent" }, runId: input.runId, sessionId: input.sessionId, nowMs: Date.now() });
      if (!gate.ok && (gate.code === "runtime-disabled" || gate.code === "deployment-invariant")) return { enabled: false };
      if (!gate.ok || !index) return { enabled: true, refused: true, reasonCode: "index-unavailable", reason: "the capability authority index is unavailable — the run refuses to start (fail-closed, §3.2)" };
      const sequence = index.sequence();
      const eligible = await eligibleFor(index, input.sessionId);
      const decisions: RecordedEvent[] = [];
      const sources = orderSources(patchSources(index, eligible, input, decisions));
      const composed = composeSections({}, sources);
      const descriptor = descriptorSection(eligible);
      const base = input.baseTools ?? [];
      const effective = input.preset ? effectiveToolset(input.preset, base, sources) : base;
      const overridden = effective !== base;
      const sections: Record<string, { hash: string; chars: number }> = {};
      const sectionText: Record<string, string> = {};
      for (const name of INSTRUCTION_SECTIONS) {
        if (!composed[name]) continue;
        const hash = sha(composed[name]);
        sections[name] = { hash, chars: composed[name].length };
        if (!recordedHashes.has(hash)) {
          recordedHashes.add(hash);
          sectionText[name] = composed[name];
        }
      }
      const descriptorHash = sha(descriptor.text);
      const toolsetDelta = overridden
        ? { added: effective.filter((t) => !base.includes(t)).sort(), removed: base.filter((t) => !effective.includes(t)).sort(), hash: sha([...effective].sort().join(",")) }
        : { added: [], removed: [], hash: sha([...base].sort().join(",")) };
      const assembled: RecordedEvent = {
        type: "capability.harness.assembled",
        payload: {
          ...(input.runId ? { runId: input.runId } : {}),
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.preset ? { preset: input.preset } : {}),
          indexSequence: sequence,
          sections,
          sectionText,
          toolset: toolsetDelta,
          descriptor: { hash: descriptorHash, tokens: descriptor.tokens, included: descriptor.included, omitted: descriptor.omitted },
          contributors: sources.map((s) => ({ capabilityId: s.capabilityId, version: s.version, ...(s.sessionId ? { sessionId: s.sessionId } : {}) })),
        },
      };
      return {
        enabled: true,
        instructions: renderInstructions(composed as Record<string, string>, descriptor.text),
        toolset: overridden ? effective : null,
        sequence,
        descriptorHash,
        assembled,
        ...(decisions.length > 0 ? { decisions } : {}),
      };
    },

    /** Model-turn-boundary refresh: a counter comparison; the section is re-read only on change. */
    async refresh(input: { readonly runId?: string; readonly sessionId?: string; readonly actor?: { readonly id: string; readonly kind: string }; readonly sinceSequence: number }): Promise<RefreshResult> {
      // R3-7: refresh decides through the same function — disabled runtime or a failed deployment
      // invariant means no refresh at all.
      const enabled = (await deps.isEnabled()) === true;
      const index = enabled ? await awaitIndex() : undefined;
      const gate = authorizeCapabilityOp("harness.refresh", { enabled, deploymentOk: deploymentOk(), index, actor: input.actor ?? { id: "system", kind: "agent" }, runId: input.runId, sessionId: input.sessionId, nowMs: Date.now() });
      if (!gate.ok || !index) return { changed: false, sequence: input.sinceSequence };
      const sequence = index.sequence();
      if (sequence === input.sinceSequence) return { changed: false, sequence };
      const eligible = await eligibleFor(index, input.sessionId);
      const descriptor = descriptorSection(eligible);
      const descriptorHash = sha(descriptor.text);
      return {
        changed: true,
        sequence,
        text: descriptor.text,
        descriptorHash,
        assembled: {
          type: "capability.harness.assembled",
          payload: {
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            refresh: true,
            indexSequence: sequence,
            previousSequence: input.sinceSequence,
            descriptor: { hash: descriptorHash, tokens: descriptor.tokens, included: descriptor.included, omitted: descriptor.omitted },
          },
        },
      };
    },
  };
}

export type RunStartResolver = ReturnType<typeof createRunStartResolver>;

/** The resolver's kernel face: two read-only capabilities the loop reaches through `ctx.invoke`
 *  (so replay sees the same answer at the same step). Agent and system principals may call them;
 *  they return data and records, never authority. */
export function runStartResolverComponent(options: RunStartResolverDeps & { readonly getService: () => unknown; readonly tenant: string; readonly semanticRefs?: Readonly<Record<string, SemanticRef | undefined>> }): Component {
  const resolver = createRunStartResolver(options);
  const contracts: CapabilityContract[] = [
    { id: "capability.harness.resolve", version: "1.0.0", semanticRef: options.semanticRefs?.["capability.harness.resolve"] },
    { id: "capability.harness.refresh", version: "1.0.0", semanticRef: options.semanticRefs?.["capability.harness.refresh"] },
  ];
  return {
    id: "capability-runtime:run-start-resolver",
    provides: contracts,
    activate(fiber) {
      fiber.provide(contracts[0] as CapabilityContract, async (raw: unknown, ctx: HandlerContext) => {
        // R3-2: the session comes from the run context only; input `sessionId` is not read.
        const input = (raw ?? {}) as Omit<ResolveInput, "sessionId" | "actor">;
        const sessionId = await sessionOfRun(options.getService() as never, options.tenant, ctx.runId);
        return (await resolver.resolve({ ...input, runId: ctx.runId ?? input.runId, sessionId, actor: ctx.actor })) as unknown as Json;
      });
      fiber.provide(contracts[1] as CapabilityContract, async (raw: unknown, ctx: HandlerContext) => {
        const input = (raw ?? {}) as { sinceSequence?: number };
        const sessionId = await sessionOfRun(options.getService() as never, options.tenant, ctx.runId);
        return (await resolver.refresh({ sessionId, sinceSequence: Number(input.sinceSequence ?? 0), runId: ctx.runId, actor: ctx.actor })) as unknown as Json;
      });
    },
  };
}
