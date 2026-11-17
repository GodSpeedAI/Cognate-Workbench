// Capability-bundles tranche T2 (§5): descriptors, discovery budgets, and `tool.skill.load`.
//
// Discovery contract (§5.1): each capability contributes a bounded descriptor — id, version,
// one-line purpose, per-skill entry lines (name + when-to-use trigger), tool ids, and the
// composition-guide flag. Pinned budgets: per-capability <= 400 tokens (8 skill + 8 tool lines),
// aggregate section <= 4,000 tokens. Over-budget descriptors truncate AT REGISTRATION, visibly
// (a marker line) and recorded (`descriptorTruncated`) — never silently at load. The aggregate
// section omits whole capabilities beyond budget, deterministically (by id), and names the count.
//
// Loading (§5.2/§4.4): content is served ONLY from the immutable version directory, and only for
// skills the manifest declares (a closed vocabulary — no caller-supplied path is ever joined to
// the directory). Every load verifies the directory against its recorded content hash first;
// mismatch is a fail-closed `integrity` refusal the dispatcher turns into
// `capability.integrity_failed` + an `integrity` suspension. The authoring source is never read.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { BUNDLE_LIMITS, scanBundle, versionHashFor } from "./bundleStore.ts";

export const DESCRIPTOR_BUDGETS = { perCapabilityTokens: 400, aggregateTokens: 4000, maxSkillLines: 8, maxToolLines: 8 } as const;
/** Token upper bound that never under-counts (R4-4): the UTF-8 byte length. Every BPE token
 *  covers at least one byte, so tokens <= bytes for any text, ASCII or not. */
export const estimateTokens = (text: string): number => Buffer.byteLength(text, "utf8");

export interface BundleSkillDecl { readonly name: string; readonly entry: string; readonly isEntryDocument?: boolean; readonly trigger?: string }
export interface BundleToolDecl { readonly id: string; readonly description: string; readonly inputSchema: Record<string, unknown> }
export interface BundleManifestData {
  readonly name: string;
  readonly purpose: string;
  readonly skills: readonly BundleSkillDecl[];
  readonly tools?: readonly BundleToolDecl[];
  readonly requirements?: readonly string[];
  readonly conflicts?: readonly string[];
  readonly complements?: readonly string[];
  readonly owns?: readonly string[];
  readonly harness?: unknown;
}

export interface Descriptor {
  readonly capabilityId: string;
  readonly version: string;
  readonly text: string;
  readonly tokens: number;
  readonly truncated: boolean;
}

const TRUNCATION_MARKER = "  [descriptor truncated at the per-capability budget]";

export function buildDescriptor(capabilityId: string, version: string, manifest: BundleManifestData): Descriptor {
  const head = `- ${capabilityId} v${version.slice(0, 8)}: ${manifest.purpose}`;
  const skills = manifest.skills.slice(0, DESCRIPTOR_BUDGETS.maxSkillLines).map((s) =>
    `  skill ${s.name}${s.trigger ? ` — ${s.trigger}` : ""}${s.isEntryDocument ? " [composition guide: load it before first use]" : ""}`);
  const tools = (manifest.tools ?? []).slice(0, DESCRIPTOR_BUDGETS.maxToolLines).map((t) => `  tool ${t.id} — ${t.description}`);
  let truncated = manifest.skills.length > DESCRIPTOR_BUDGETS.maxSkillLines || (manifest.tools ?? []).length > DESCRIPTOR_BUDGETS.maxToolLines;
  const lines = [head, ...skills, ...tools];
  // The marker's own tokens are reserved inside the budget: the output never exceeds the limit.
  const fits = (): boolean => estimateTokens((truncated ? [...lines, TRUNCATION_MARKER] : lines).join("\n")) <= DESCRIPTOR_BUDGETS.perCapabilityTokens;
  while (!fits() && lines.length > 1) {
    lines.pop();
    truncated = true;
  }
  if (!fits()) {
    // Even the head line is over budget: cut the purpose text itself.
    truncated = true;
    let keep = lines[0]!.length;
    while (!fits() && keep > 0) {
      keep = Math.floor(keep * 0.9);
      lines[0] = lines[0]!.slice(0, keep);
    }
  }
  if (truncated) lines.push(TRUNCATION_MARKER);
  const text = lines.join("\n");
  return { capabilityId, version, text, tokens: estimateTokens(text), truncated };
}

export interface DescriptorSection {
  readonly text: string;
  readonly tokens: number;
  readonly included: readonly string[];
  readonly omitted: readonly string[];
}

/** Aggregate discovery section: whole descriptors in id order until the 4,000-token budget; the
 *  remainder is named, never dropped silently. */
export function assembleDescriptorSection(descriptors: readonly Descriptor[], budgetTokens: number = DESCRIPTOR_BUDGETS.aggregateTokens): DescriptorSection {
  const sorted = [...descriptors].sort((a, b) => (a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0));
  const included: Descriptor[] = [];
  const omitted: string[] = [];
  const notice = (n: number): string => `(${n} further capabilities omitted: aggregate descriptor budget of ${budgetTokens} tokens reached)`;
  const reserve = estimateTokens(`\n${notice(descriptors.length)}`); // room for the omitted-notice line, exact bound
  // R2-6: the budget counts the joining newlines too — measure the joined text, not a sum.
  for (const d of sorted) {
    if (estimateTokens([...included.map((i) => i.text), d.text].join("\n")) + reserve <= budgetTokens) included.push(d);
    else omitted.push(d.capabilityId);
  }
  const lines = included.map((d) => d.text);
  if (omitted.length > 0) lines.push(notice(omitted.length));
  const text = lines.join("\n");
  return { text, tokens: estimateTokens(text), included: included.map((d) => d.capabilityId), omitted };
}

/** Descriptor registry: builds each (capability, version) descriptor once and serves it. */
export class DescriptorRegistry {
  readonly #cache = new Map<string, Descriptor>();
  get(capabilityId: string, version: string, manifest: BundleManifestData): Descriptor {
    const key = `${capabilityId}@${version}`;
    let d = this.#cache.get(key);
    if (!d) {
      d = buildDescriptor(capabilityId, version, manifest);
      this.#cache.set(key, d);
    }
    return d;
  }
}

export interface LoadableBundle {
  readonly capabilityId: string;
  /** The content hash recorded at registration (`versionHashFor(manifest lines)`). */
  readonly versionHash: string;
  readonly dir: string;
  readonly manifest: BundleManifestData;
}

export type SkillLoadResult =
  | { readonly ok: true; readonly result: { readonly skillId: string; readonly name: string; readonly entry: string; readonly isEntryDocument: boolean; readonly version: string; readonly content: string } }
  | { readonly ok: false; readonly code: "not_found" | "integrity" | "bad_request"; readonly message: string; readonly retryable: false };

/** Verifies the version directory against its recorded hash (§4.4). Never reads the source. */
export async function verifyBundleIntegrity(dir: string, versionHash: string, manifest?: unknown): Promise<boolean> {
  try {
    const scanned = await scanBundle(dir);
    return versionHashFor(scanned.manifest, manifest) === versionHash;
  } catch {
    return false;
  }
}

export async function loadSkill(bundle: LoadableBundle, requested: unknown): Promise<SkillLoadResult> {
  const id = typeof requested === "string" ? requested : "";
  if (!id) return { ok: false, code: "bad_request", message: "skillId is required", retryable: false };
  // Closed vocabulary: a manifest skill by name or by its declared entry path — nothing else.
  const skill = bundle.manifest.skills.find((s) => s.name === id || s.entry === id);
  if (!skill) return { ok: false, code: "not_found", message: `skill ${id} is not declared by ${bundle.capabilityId}@${bundle.versionHash}`, retryable: false };
  // R2-5: verify and serve the SAME bytes. The directory scan must reproduce the recorded identity;
  // the entry is then read exactly once, bounded, hashed, compared with the verified digest, and
  // those very bytes are returned — never re-read after the check.
  const integrity = (): SkillLoadResult => ({ ok: false, code: "integrity", message: `${bundle.capabilityId}@${bundle.versionHash}: version directory failed its integrity check — load refused`, retryable: false });
  let digest: string | undefined;
  try {
    const scanned = await scanBundle(bundle.dir);
    if (versionHashFor(scanned.manifest, bundle.manifest) !== bundle.versionHash) return integrity();
    digest = scanned.manifest.find((line) => line.slice(0, line.lastIndexOf(":")) === skill.entry)?.slice(skill.entry.length + 1);
  } catch {
    return integrity();
  }
  if (!digest) return { ok: false, code: "not_found", message: `skill entry ${skill.entry} is missing from ${bundle.capabilityId}@${bundle.versionHash}`, retryable: false };
  let bytes: Buffer;
  try {
    bytes = await readFile(join(bundle.dir, skill.entry));
  } catch {
    return integrity();
  }
  if (bytes.byteLength > BUNDLE_LIMITS.maxFileBytes || createHash("sha256").update(bytes).digest("hex") !== digest) return integrity();
  return { ok: true, result: { skillId: id, name: skill.name, entry: skill.entry, isEntryDocument: skill.isEntryDocument === true, version: bundle.versionHash, content: bytes.toString("utf8") } };
}
