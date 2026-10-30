import { fingerprint, type Json } from "@godspeedai/cognate-events";
import { createHash } from "node:crypto";
import { ServiceError, type Caller, type RuntimeService } from "@godspeedai/cognate-runtime-api";
import type { ExpertState } from "./types.ts";

/** Internal shared-state threads are immutable once their hash-addressed snapshot is written. */
export const EXPERT_PARTITION_THREAD_PREFIX = "experts:partition:v1:";
// Leaves 256 KiB of headroom below the published 1 MiB event-envelope ceiling for envelope metadata.
export const EXPERT_PARTITION_MAX_BYTES = 768 * 1024;
const ROOT_MANIFEST_MAX_BYTES = 900 * 1024;
const LOGICAL_FIELDS = ["schema", "experts", "teams", "conversations", "assignments", "messages", "memory", "inboxReceipts", "audit", "receipts"] as const;
export const REQUIRED_SECTIONS = ["experts", "teams", "conversations", "assignments", "messages", "memory", "receipts"] as const;
export const OPTIONAL_SECTIONS = ["inboxReceipts", "audit"] as const;
const SECTIONS = new Set<string>([...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS]);
const SECTION_ORDER = [...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS];

export interface ExpertPartitionReference {
  readonly section: string;
  readonly path: string;
  readonly hash: string;
  readonly threadId: string;
}

export interface ExpertStateManifest {
  readonly schema: 2;
  readonly logicalSchema: 1;
  /** Partition directory v1 roots carry no section fingerprints; v2 roots carry one per present section. */
  readonly partitionVersion: 1 | 2;
  readonly presentSections: readonly string[];
  readonly partitions: readonly ExpertPartitionReference[];
  readonly sectionFingerprints?: Readonly<Record<string, string>>;
}

interface PartitionPayload {
  readonly schema: 1;
  readonly section: string;
  readonly path: string;
  readonly items: Readonly<Record<string, unknown>>;
  /** A redacted projection input. It is never used to restore authoritative state. */
  readonly publicItems?: Readonly<Record<string, unknown>>;
}

export function stateSections(state: ExpertState): Map<string, [string, unknown][]> {
  const keys = Object.keys(state);
  const unknown = keys.filter((key) => !(LOGICAL_FIELDS as readonly string[]).includes(key));
  if (unknown.length) throw new Error(`Unsupported Expert state fields (${unknown.join(", ")}); update the versioned partition schema before migration`);
  if (state.schema !== 1) throw new Error(`Unsupported logical Expert schema ${String(state.schema)}`);
  const sections = new Map<string, [string, unknown][]>();
  for (const section of REQUIRED_SECTIONS) {
    const value = state[section];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid Expert state section ${section}`);
    sections.set(section, Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
  }
  for (const section of OPTIONAL_SECTIONS) {
    const value = state[section];
    if (value === undefined) continue;
    if (section === "audit") {
      if (!Array.isArray(value)) throw new Error("Invalid Expert state section audit");
      sections.set(section, value.map((item, index) => [String(index).padStart(12, "0"), item]));
    } else {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid Expert state section ${section}`);
      sections.set(section, Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
  }
  return sections;
}

export function privateConversationIds(state: ExpertState): Set<string> {
  return new Set(Object.values(state.conversations).filter((conversation) => conversation.scope === "private-team").map((conversation) => conversation.id));
}

function publicItemsFor(privateIds: ReadonlySet<string>, section: string, items: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  if (section === "memory" || section === "receipts" || section === "audit") return {};
  const visible: [string, unknown][] = [];
  for (const [id, raw] of Object.entries(items)) {
    if (section === "conversations" && (raw as { scope?: string }).scope === "private-team") continue;
    if (section === "messages" && privateIds.has((raw as { conversationId?: string }).conversationId ?? "")) continue;
    if (section === "assignments") {
      if (privateIds.has((raw as { conversationId?: string }).conversationId ?? "")) continue;
      const assignment = structuredClone(raw) as { execution?: { context?: unknown[] } };
      if (assignment.execution) assignment.execution.context = [];
      visible.push([id, assignment]);
      continue;
    }
    visible.push([id, raw]);
  }
  const publicItems = Object.fromEntries(visible);
  return JSON.stringify(publicItems) === JSON.stringify(items) ? undefined : publicItems;
}

function chunkHash(payload: PartitionPayload): string {
  return fingerprint(JSON.parse(JSON.stringify(payload)) as Json);
}

const MANIFEST_FIELDS: ReadonlySet<string> = new Set(["schema", "logicalSchema", "partitionVersion", "presentSections", "partitions", "sectionFingerprints"]);

export function isExpertStateManifest(value: unknown): value is ExpertStateManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<ExpertStateManifest>;
  // Fail closed on fields this build does not know: a newer manifest may depend on them.
  if (Object.keys(manifest).some((key) => !MANIFEST_FIELDS.has(key))) return false;
  if (manifest.schema !== 2 || manifest.logicalSchema !== 1) return false;
  if (manifest.partitionVersion !== 1 && manifest.partitionVersion !== 2) return false;
  if (!Array.isArray(manifest.presentSections) || !Array.isArray(manifest.partitions)) return false;
  if (manifest.partitionVersion === 2 && (!manifest.sectionFingerprints || typeof manifest.sectionFingerprints !== "object" || Array.isArray(manifest.sectionFingerprints))) return false;
  if (manifest.partitionVersion === 1 && manifest.sectionFingerprints !== undefined) return false;
  return true;
}

export function partitionThreadId(reference: Pick<ExpertPartitionReference, "section" | "path" | "hash">): string {
  return `${EXPERT_PARTITION_THREAD_PREFIX}${reference.section}:${reference.path}:${reference.hash}`;
}

export function parsePartitionThreadId(threadId: string): { section: string; path: string; hash: string } | undefined {
  if (!threadId.startsWith(EXPERT_PARTITION_THREAD_PREFIX)) return undefined;
  const tail = threadId.slice(EXPERT_PARTITION_THREAD_PREFIX.length);
  const match = /^([^:]+):([0-9a-f]{0,64}):(sha256:[0-9a-f]{64})$/.exec(tail);
  if (!match) return undefined;
  const [, section, path, hash] = match;
  if (!SECTIONS.has(section!) || !/^(?:[0-9a-f]{0,64})$/.test(path!)) return undefined;
  return { section: section!, path: path!, hash: hash! };
}

/** Reject ambiguous directories before reading any child thread. Partition paths are a
 * prefix-free trie: a leaf can never overlap another leaf in the same section. */
export function validateExpertManifestReferences(manifest: ExpertStateManifest): void {
  const allowedSections = new Set<string>([...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS]);
  if (manifest.presentSections.some((section) => !allowedSections.has(section))
      || REQUIRED_SECTIONS.some((section) => !manifest.presentSections.includes(section))
      || new Set(manifest.presentSections).size !== manifest.presentSections.length) {
    throw new Error("Expert manifest contains unsupported or missing logical sections");
  }
  const paths = new Map<string, string[]>();
  for (const reference of manifest.partitions) {
    if (!reference || !SECTIONS.has(reference.section) || !manifest.presentSections.includes(reference.section)
        || partitionThreadId(reference) !== reference.threadId
        || !/^sha256:[0-9a-f]{64}$/.test(reference.hash) || !/^(?:[0-9a-f]{0,64})$/.test(reference.path)) {
      throw new Error("Expert manifest contains an invalid partition reference");
    }
    const sectionPaths = paths.get(reference.section) ?? [];
    if (sectionPaths.some((path) => path === reference.path || path.startsWith(reference.path) || reference.path.startsWith(path))) {
      throw new Error("Expert manifest contains duplicate or overlapping partition paths");
    }
    sectionPaths.push(reference.path);
    paths.set(reference.section, sectionPaths);
  }
  if (manifest.sectionFingerprints !== undefined) {
    if (manifest.partitionVersion !== 2) throw new Error("Expert manifest carries section fingerprints only in partition directory version 2");
    const fingerprintKeys = Object.keys(manifest.sectionFingerprints).sort();
    if (JSON.stringify(fingerprintKeys) !== JSON.stringify([...manifest.presentSections].sort())) {
      throw new Error("Expert manifest section fingerprints do not match its present sections");
    }
    for (const value of Object.values(manifest.sectionFingerprints)) {
      if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error("Expert manifest contains an invalid section fingerprint");
    }
  }
}

/** Content fingerprint of one logical section. Deterministic normalization matches the storage
 * envelope, so a fingerprint computed from restored rows equals one computed before publication. */
export function sectionFingerprintOf(section: string, entries: readonly [string, unknown][]): string {
  const sorted = [...entries].sort(([a], [b]) => a.localeCompare(b));
  return fingerprint(JSON.parse(JSON.stringify({ section, items: Object.fromEntries(sorted) })) as Json);
}

// Coalesce identical preparation requests within one process. The native immutable snapshot and
// root CAS remain the durable contract; this holds promises only, never private payloads or truth.
// It also avoids saturating published 0.2.0's pool with same-key transactional receipt replays.
// The adapter's underlying nested-pool defect is fixed and regression-tested upstream separately.
const preparing=new WeakMap<RuntimeService,Map<string,Promise<void>>>();
async function writeImmutablePartition(service: RuntimeService, caller: Caller, reference: ExpertPartitionReference, payload: PartitionPayload): Promise<void> {
  let entries=preparing.get(service);
  if(!entries){entries=new Map();preparing.set(service,entries);}
  const key=JSON.stringify([caller.tenant,caller.actor.kind,caller.actor.id,reference.threadId]);
  const existing=entries.get(key);
  if(existing)return existing;
  const pending=writeImmutablePartitionOnce(service,caller,reference,payload);
  entries.set(key,pending);
  try{await pending;}finally{if(entries.get(key)===pending)entries.delete(key);}
}

async function writeImmutablePartitionOnce(service: RuntimeService, caller: Caller, reference: ExpertPartitionReference, payload: PartitionPayload): Promise<void> {
  const existing = await service.readSharedState(caller, { threadId: reference.threadId });
  if (existing.version > 0) {
    if (chunkHash(existing.state as unknown as PartitionPayload) !== reference.hash) throw new Error(`Expert partition ${reference.hash} does not match its content address`);
    return;
  }
  try {
    const result = await service.updateSharedState(caller, {
      threadId: reference.threadId,
      update: { snapshot: payload as unknown as Json },
      expectedVersion: 0,
      idempotencyKey: `expert-partition:${reference.hash}`,
    });
    if (chunkHash(result.state as unknown as PartitionPayload) !== reference.hash) throw new Error(`Prepared Expert partition ${reference.hash} failed verification`);
  } catch (error) {
    if (error instanceof ServiceError && ["failed_precondition", "already_exists", "unavailable"].includes(error.code)) {
      const raced = await service.readSharedState(caller, { threadId: reference.threadId });
      if (raced.version > 0 && chunkHash(raced.state as unknown as PartitionPayload) === reference.hash) return;
    }
    throw error;
  }
}

async function readVerifiedPartition(service: RuntimeService, caller: Caller, reference: ExpertPartitionReference): Promise<PartitionPayload> {
  const result = await service.readSharedState(caller, { threadId: reference.threadId });
  if (result.version < 1) throw new Error(`Expert partition ${reference.hash} is missing`);
  const payload = result.state as unknown as PartitionPayload;
  if (chunkHash(payload) !== reference.hash) throw new Error(`Expert partition ${reference.hash} failed content verification`);
  if (payload.schema !== 1 || payload.section !== reference.section || payload.path !== reference.path
      || !payload.items || typeof payload.items !== "object" || Array.isArray(payload.items)) {
    throw new Error(`Expert partition ${reference.hash} has an invalid shape`);
  }
  return payload;
}

function partitionIdentity(id: string, reference: ExpertPartitionReference, section: string): boolean {
  return createHash("sha256").update(id).digest("hex").startsWith(reference.path);
}

/** Restore one logical section from the accepted manifest. Every touched partition is verified
 * against its content address and the section is verified against its manifest fingerprint. */
export async function restoreExpertSectionEntries(service: RuntimeService, caller: Caller, manifest: ExpertStateManifest, section: string): Promise<[string, unknown][]> {
  validateExpertManifestReferences(manifest);
  if (!SECTIONS.has(section)) throw new Error(`Unknown Expert state section ${section}`);
  if (!manifest.presentSections.includes(section)) return [];
  const entries: [string, unknown][] = [];
  const seen = new Set<string>();
  for (const reference of manifest.partitions) {
    if (reference.section !== section) continue;
    const payload = await readVerifiedPartition(service, caller, reference);
    for (const [id, value] of Object.entries(payload.items)) {
      if (seen.has(id)) throw new Error(`Expert manifest contains duplicate ${section} identity ${id}`);
      if (!partitionIdentity(id, reference, section)) throw new Error(`Expert ${section} identity ${id} is assigned to the wrong partition path`);
      seen.add(id);
      entries.push([id, structuredClone(value)]);
    }
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  const expectedFingerprint = manifest.sectionFingerprints?.[section];
  if (expectedFingerprint !== undefined && sectionFingerprintOf(section, entries) !== expectedFingerprint) {
    throw new Error(`Expert section ${section} failed its manifest fingerprint verification`);
  }
  return entries;
}

/** Trie-directed point reads: locate each record's leaf through the manifest's nibble trie and
 * read only those leaves. Large histories stay bounded by the requested ids, not the aggregate. */
export async function readExpertRecords(service: RuntimeService, caller: Caller, manifest: ExpertStateManifest, section: string, ids: readonly string[]): Promise<Map<string, unknown>> {
  validateExpertManifestReferences(manifest);
  if (!SECTIONS.has(section)) throw new Error(`Unknown Expert state section ${section}`);
  const results = new Map<string, unknown>();
  const present = manifest.presentSections.includes(section);
  const byThread = new Map<string, { reference: ExpertPartitionReference; ids: Set<string> }>();
  for (const id of ids) {
    results.set(id, undefined);
    if (!present || typeof id !== "string" || !id) continue;
    const digest = createHash("sha256").update(id).digest("hex");
    const reference = manifest.partitions.find((candidate) => candidate.section === section && digest.startsWith(candidate.path));
    if (!reference) continue;
    const group = byThread.get(reference.threadId) ?? { reference, ids: new Set<string>() };
    group.ids.add(id);
    byThread.set(reference.threadId, group);
  }
  for (const { reference, ids } of byThread.values()) {
    const payload = await readVerifiedPartition(service, caller, reference);
    for (const id of ids) {
      const value = payload.items[id];
      if (value === undefined) continue;
      if (!partitionIdentity(id, reference, section)) throw new Error(`Expert ${section} identity ${id} is assigned to the wrong partition path`);
      results.set(id, structuredClone(value));
    }
  }
  return results;
}

export async function restoreExpertManifest(service: RuntimeService, caller: Caller, manifest: ExpertStateManifest): Promise<ExpertState> {
  validateExpertManifestReferences(manifest);
  const state = { schema: 1 } as unknown as ExpertState;
  for (const section of manifest.presentSections) {
    const entries = await restoreExpertSectionEntries(service, caller, manifest, section);
    if (section === "audit") {
      state.audit = entries.map(([, value]) => value as NonNullable<ExpertState["audit"]>[number]);
    } else {
      (state as unknown as Record<string, unknown>)[section] = Object.fromEntries(entries);
    }
  }
  for (const section of REQUIRED_SECTIONS) (state as unknown as Record<string, unknown>)[section] ??= {};
  return state;
}

export function publicPartition(payload: PartitionPayload): Json {
  const items = payload.section === "audit" ? {} : payload.publicItems ?? payload.items;
  return { schema: payload.schema, section: payload.section, path: payload.path, items: items as Json };
}

async function partitionSectionLeaves(service: RuntimeService, caller: Caller, section: string, entries: readonly [string, unknown][], privateIds: ReadonlySet<string>, existing: ReadonlyMap<string, string>, path = "", depth = 0): Promise<ExpertPartitionReference[]> {
  const items = Object.fromEntries(entries);
  const base = { schema: 1 as const, section, path, items };
  const publicItems = publicItemsFor(privateIds, section, items);
  const payload: PartitionPayload = publicItems === undefined ? base : { ...base, publicItems };
  if (Buffer.byteLength(JSON.stringify(payload)) <= EXPERT_PARTITION_MAX_BYTES) {
    const hash = chunkHash(payload);
    const reference = { section, path, hash, threadId: partitionThreadId({ section, path, hash }) };
    // An unchanged leaf was already verified while its section was restored from the accepted
    // root, so publication reuses its content address without reading the thread again.
    if (existing.get(path) !== hash) await writeImmutablePartition(service, caller, reference, payload);
    return [reference];
  }
  if (depth >= 16) throw new Error(`Expert ${section} partition cannot be bounded below ${EXPERT_PARTITION_MAX_BYTES} bytes`);
  const groups = new Map<string, [string, unknown][]>();
  for (const entry of entries) {
    const nibble = createHash("sha256").update(entry[0]).digest("hex")[depth]!;
    const group = groups.get(nibble) ?? [];
    group.push(entry);
    groups.set(nibble, group);
  }
  if (groups.size < 2) throw new Error(`Expert ${section} partition cannot be split below ${EXPERT_PARTITION_MAX_BYTES} bytes`);
  const result: ExpertPartitionReference[] = [];
  for (const [nibble, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    result.push(...await partitionSectionLeaves(service, caller, section, group, privateIds, existing, `${path}${nibble}`, depth + 1));
  }
  return result;
}

/** Publish a v2 manifest from the sections this mutation actually holds. Sections whose content
 * fingerprint still matches the accepted root are carried forward by content address without
 * re-serializing their leaves; only changed sections are re-partitioned, and only their changed
 * leaves are written. The global root CAS remains the single publication point. */
export async function prepareExpertManifestUpdate(service: RuntimeService, caller: Caller, previous: { manifest?: ExpertStateManifest }, provided: ReadonlyMap<string, readonly [string, unknown][]>, privateConversationIds?: ReadonlySet<string>): Promise<ExpertStateManifest> {
  const previousManifest = previous.manifest;
  const previousFingerprints = previousManifest?.sectionFingerprints;
  const previousReferences = new Map<string, ExpertPartitionReference[]>();
  for (const reference of previousManifest?.partitions ?? []) {
    const list = previousReferences.get(reference.section) ?? [];
    list.push(reference);
    previousReferences.set(reference.section, list);
  }
  for (const section of provided.keys()) {
    if (!SECTIONS.has(section)) throw new Error(`Unsupported Expert state section ${section}`);
  }
  const sections = new Set<string>([...(previousManifest?.presentSections ?? []), ...provided.keys()]);
  for (const section of REQUIRED_SECTIONS) {
    if (!sections.has(section)) throw new Error(`Expert manifest is missing the required section ${section}`);
  }
  let privateIds = privateConversationIds;
  if (privateIds === undefined && [...provided.keys()].some((section) => ["conversations", "messages", "assignments"].includes(section))) {
    if (!previousManifest) throw new Error("Expert partition sanitization requires authoritative conversation scopes");
    const conversations = await restoreExpertSectionEntries(service, caller, previousManifest, "conversations");
    privateIds = new Set(conversations.filter(([, value]) => (value as { scope?: string }).scope === "private-team").map(([id]) => id));
  }
  const partitions: ExpertPartitionReference[] = [];
  const fingerprints: Record<string, string> = {};
  for (const section of SECTION_ORDER) {
    if (!sections.has(section)) continue;
    const entries = provided.get(section);
    if (entries !== undefined) {
      const sectionFingerprint = sectionFingerprintOf(section, entries);
      fingerprints[section] = sectionFingerprint;
      if (previousFingerprints?.[section] === sectionFingerprint) {
        partitions.push(...(previousReferences.get(section) ?? []));
        continue;
      }
      const existing = new Map((previousReferences.get(section) ?? []).map((reference) => [reference.path, reference.hash]));
      partitions.push(...await partitionSectionLeaves(service, caller, section, entries, privateIds ?? new Set<string>(), existing));
    } else {
      if (!previousManifest) throw new Error(`Expert section ${section} cannot be carried forward without an accepted manifest`);
      if (previousFingerprints?.[section] === undefined) throw new Error(`Expert section ${section} cannot be carried forward without a verified section fingerprint`);
      fingerprints[section] = previousFingerprints[section];
      partitions.push(...(previousReferences.get(section) ?? []));
    }
  }
  partitions.sort((a, b) => a.section.localeCompare(b.section) || a.path.localeCompare(b.path));
  const manifest: ExpertStateManifest = {
    schema: 2, logicalSchema: 1, partitionVersion: 2,
    presentSections: SECTION_ORDER.filter((section) => sections.has(section)),
    partitions, sectionFingerprints: fingerprints,
  };
  validateExpertManifestReferences(manifest);
  const bytes = Buffer.byteLength(JSON.stringify(manifest));
  if (bytes > ROOT_MANIFEST_MAX_BYTES) throw new Error(`Expert manifest would be ${bytes} bytes; refusing above the 900 KiB root-event safety boundary`);
  return manifest;
}

export async function prepareExpertManifest(service: RuntimeService, caller: Caller, state: ExpertState): Promise<ExpertStateManifest> {
  return prepareExpertManifestUpdate(service, caller, {}, stateSections(state), privateConversationIds(state));
}
