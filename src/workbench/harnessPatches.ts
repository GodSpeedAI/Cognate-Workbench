// Capability-bundles tranche T2 (§3.1/§3.3): harness-modification records — the two v1 surfaces.
//
//   * Agent instructions: named sections introduced by the run-start resolver; a patch declares
//     `{section, operation: append|replace, payload}` against a section from a CLOSED vocabulary.
//   * Toolset override: a per-existing-preset record consumed through the `toolsForPreset` seam.
//
// Admission, approvals, grants, identity, containment posture, the core entries and governance
// surfaces are NOT surfaces: a patch naming one is refused with an explicit reason, never
// silently ignored. Overlap regime (§3.3), one per surface: instruction patches COMPOSE in
// deterministic precedence (operator base, persistent activations in activation order, then
// session-scoped activations in activation order; `replace` supersedes earlier patches, last
// applied wins); toolset overrides are EXCLUSIVE per preset — two capabilities overriding the
// same preset refuse co-activation, reported through the same `detectConflicts` the skill-OS uses.
// Composed harness state is derived on every resolution (never stored), so deactivating the
// offending capability restores the prior configuration by replay.
import { createHash } from "node:crypto";
import { detectConflicts, type Conflict } from "./skillOs.ts";
import type { CapabilityContractDef } from "./types.ts";

/** The closed instruction-section vocabulary (the resolver's named sections, in render order). */
export const INSTRUCTION_SECTIONS = ["conventions", "workflow", "tooling", "style"] as const;
export type InstructionSection = (typeof INSTRUCTION_SECTIONS)[number];

/** Names a patch may never target: refused with this reason rather than as "unknown section". */
const NON_SURFACES: ReadonlySet<string> = new Set([
  "admission", "approvals", "approval", "grants", "grant", "identity", "containment", "posture",
  "core", "governance", "authority", "safety", "policy",
]);

export const PRESETS = ["standard", "ptc", "minimal"] as const;
/** The standing dispatcher ids every preset keeps (§2.4): an override may never drop them. */
export const DISPATCHER_TOOLS = ["capability_invoke", "skill_load"] as const;
/** Every tool name a preset can carry today — an override may select only among these. */
export const KNOWN_TOOLS: ReadonlySet<string> = new Set([
  "read", "edit", "bash", "todo_write", "exit_plan_mode", "subagent", "run_code", ...DISPATCHER_TOOLS,
]);

export const HARNESS_LIMITS = { maxPatches: 8, maxOverrides: 3, maxPayloadChars: 4000 } as const;

export interface InstructionPatch {
  readonly section: InstructionSection;
  readonly operation: "append" | "replace";
  readonly payload: string;
}
export interface ToolsetOverride {
  readonly preset: (typeof PRESETS)[number];
  readonly tools: readonly string[];
}
export interface HarnessDeclaration {
  readonly instructionPatches: readonly InstructionPatch[];
  readonly toolsetOverrides: readonly ToolsetOverride[];
}

export class HarnessPatchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export const EMPTY_HARNESS: HarnessDeclaration = { instructionPatches: [], toolsetOverrides: [] };

export function hasHarness(declaration: HarnessDeclaration | undefined): boolean {
  return !!declaration && (declaration.instructionPatches.length > 0 || declaration.toolsetOverrides.length > 0);
}

/** Validates a bundle's declared harness surfaces; throws HarnessPatchError naming the refusal. */
export function validateHarness(raw: unknown): HarnessDeclaration {
  if (raw === undefined || raw === null) return EMPTY_HARNESS;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new HarnessPatchError("harness-shape", "harness must be an object");
  const input = raw as { instructionPatches?: unknown; toolsetOverrides?: unknown };
  const patches = (input.instructionPatches ?? []) as unknown;
  const overrides = (input.toolsetOverrides ?? []) as unknown;
  if (!Array.isArray(patches) || !Array.isArray(overrides)) throw new HarnessPatchError("harness-shape", "instructionPatches and toolsetOverrides must be arrays");
  if (patches.length > HARNESS_LIMITS.maxPatches) throw new HarnessPatchError("harness-limit", `at most ${HARNESS_LIMITS.maxPatches} instruction patches`);
  if (overrides.length > HARNESS_LIMITS.maxOverrides) throw new HarnessPatchError("harness-limit", `at most ${HARNESS_LIMITS.maxOverrides} toolset overrides`);
  const instructionPatches: InstructionPatch[] = patches.map((p) => {
    const patch = p as { section?: unknown; operation?: unknown; payload?: unknown };
    const section = String(patch.section ?? "");
    if (NON_SURFACES.has(section)) throw new HarnessPatchError("not-a-surface", `section "${section}" is not a modifiable surface (admission, approvals, grants, identity, containment, core entries and governance are never harness surfaces)`);
    if (!(INSTRUCTION_SECTIONS as readonly string[]).includes(section)) throw new HarnessPatchError("unknown-section", `unknown instruction section "${section}" (known: ${INSTRUCTION_SECTIONS.join(", ")})`);
    if (patch.operation !== "append" && patch.operation !== "replace") throw new HarnessPatchError("bad-operation", `instruction patch operation must be append or replace, not ${String(patch.operation)}`);
    if (typeof patch.payload !== "string" || patch.payload.trim().length === 0) throw new HarnessPatchError("bad-payload", "instruction patch payload must be a non-empty string");
    if (patch.payload.length > HARNESS_LIMITS.maxPayloadChars) throw new HarnessPatchError("harness-limit", `instruction patch payload exceeds ${HARNESS_LIMITS.maxPayloadChars} characters`);
    return { section: section as InstructionSection, operation: patch.operation, payload: patch.payload };
  });
  const seenPresets = new Set<string>();
  const toolsetOverrides: ToolsetOverride[] = overrides.map((o) => {
    const override = o as { preset?: unknown; tools?: unknown };
    const preset = String(override.preset ?? "");
    if (!(PRESETS as readonly string[]).includes(preset)) throw new HarnessPatchError("unknown-preset", `toolset override targets unknown preset "${preset}" (known: ${PRESETS.join(", ")})`);
    if (seenPresets.has(preset)) throw new HarnessPatchError("duplicate-preset", `a bundle may override preset "${preset}" at most once`);
    seenPresets.add(preset);
    if (!Array.isArray(override.tools) || override.tools.some((t) => typeof t !== "string")) throw new HarnessPatchError("bad-tools", "toolset override tools must be an array of tool names");
    const tools = [...new Set(override.tools as string[])];
    for (const tool of tools) if (!KNOWN_TOOLS.has(tool)) throw new HarnessPatchError("unknown-tool", `toolset override names unknown tool "${tool}"`);
    for (const required of DISPATCHER_TOOLS) if (!tools.includes(required)) throw new HarnessPatchError("core-entry-dropped", `toolset override may not drop the standing dispatcher tool "${required}"`);
    if (tools.includes("run_code") && preset !== "ptc") throw new HarnessPatchError("privilege-escalation", `toolset override may not add run_code to preset "${preset}" (privileged execution belongs to ptc only)`);
    return { preset: preset as ToolsetOverride["preset"], tools };
  });
  return { instructionPatches, toolsetOverrides };
}

/** The `owns` surfaces a harness declaration claims (exclusive per preset; instructions compose). */
export function harnessOwns(declaration: HarnessDeclaration): readonly string[] {
  return declaration.toolsetOverrides.map((o) => `harness.toolset:${o.preset}`);
}

/** §3.3 conflict check, expressed through the skill-OS `detectConflicts` over minimal contract
 *  defs. `candidate` is the capability about to activate or repoint; `live` the other live ones. */
export function detectHarnessConflicts(
  candidate: { readonly capabilityId: string; readonly owns: readonly string[]; readonly conflicts: readonly string[]; readonly harness: HarnessDeclaration },
  live: readonly { readonly capabilityId: string; readonly owns: readonly string[]; readonly conflicts: readonly string[]; readonly harness: HarnessDeclaration }[],
): Conflict[] {
  const def = (c: typeof candidate): CapabilityContractDef => ({
    id: c.capabilityId, owner: "bundle", category: "bundle", purpose: "bundle", consumes: [], produces: [], authority: [],
    conflicts: c.conflicts, complements: [], acceptance: [], owns: [...c.owns, ...harnessOwns(c.harness)],
  } as CapabilityContractDef);
  const others = live.filter((l) => l.capabilityId !== candidate.capabilityId);
  const active = [candidate.capabilityId, ...others.map((o) => o.capabilityId)];
  return detectConflicts([def(candidate), ...others.map(def)], active).filter((c) => c.capabilities.includes(candidate.capabilityId));
}

export interface PatchSource {
  readonly capabilityId: string;
  readonly version: string;
  readonly level: "user" | "workspace" | "workgroup" | string;
  readonly sessionId?: string;
  readonly activatedAt: string;
  readonly harness: HarnessDeclaration;
}

/** §3.3 deterministic precedence: persistent activations in activation order, then session-scoped
 *  activations in activation order (operator configuration is the base the sections start from). */
export function orderSources(sources: readonly PatchSource[]): readonly PatchSource[] {
  const key = (s: PatchSource) => `${s.sessionId ? "1" : "0"}|${s.activatedAt}|${s.capabilityId}`;
  return [...sources].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export type ComposedSections = Readonly<Record<InstructionSection, string>>;

export function composeSections(base: Partial<Record<InstructionSection, string>>, ordered: readonly PatchSource[]): ComposedSections {
  const out: Record<InstructionSection, string> = { conventions: "", workflow: "", tooling: "", style: "" };
  for (const name of INSTRUCTION_SECTIONS) out[name] = base[name] ?? "";
  for (const source of ordered) {
    for (const patch of source.harness.instructionPatches) {
      out[patch.section] = patch.operation === "replace" ? patch.payload : out[patch.section] ? `${out[patch.section]}\n${patch.payload}` : patch.payload;
    }
  }
  return out;
}

/** The effective tool list for a preset: the sole override when one exists (exclusivity makes
 *  "which" unambiguous; a second override for the same preset is ignored defensively — the
 *  activation-time conflict check is what refuses it). */
export function effectiveToolset(preset: string, base: readonly string[], ordered: readonly PatchSource[]): readonly string[] {
  for (const source of ordered) {
    const override = source.harness.toolsetOverrides.find((o) => o.preset === preset);
    if (override) return override.tools;
  }
  return base;
}

export function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** `capability.harness.patched` payload: one record per capability whose patches are now (or no
 *  longer) part of the effective configuration. Evidence only — never folded into state. */
export function patchedRecord(source: Pick<PatchSource, "capabilityId" | "version" | "sessionId" | "harness">, change: "applied" | "removed"): { type: "capability.harness.patched"; payload: Record<string, unknown> } {
  return {
    type: "capability.harness.patched",
    payload: {
      capabilityId: source.capabilityId, version: source.version, change,
      ...(source.sessionId ? { sessionId: source.sessionId } : {}),
      sections: source.harness.instructionPatches.map((p) => ({ section: p.section, operation: p.operation, hash: sha(p.payload) })),
      toolsetOverrides: source.harness.toolsetOverrides.map((o) => ({ preset: o.preset, hash: sha([...o.tools].sort().join(",")) })),
    },
  };
}
