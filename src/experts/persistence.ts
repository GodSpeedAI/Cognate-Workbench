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
const REQUIRED_SECTIONS = ["experts", "teams", "conversations", "assignments", "messages", "memory", "receipts"] as const;
const OPTIONAL_SECTIONS = ["inboxReceipts", "audit"] as const;
const SECTIONS = new Set<string>([...REQUIRED_SECTIONS, ...OPTIONAL_SECTIONS]);

export interface ExpertPartitionReference {
  readonly section: string;
  readonly path: string;
  readonly hash: string;
  readonly threadId: string;
}

export interface ExpertStateManifest {
  readonly schema: 2;
  readonly logicalSchema: 1;
  readonly partitionVersion: 1;
  readonly presentSections: readonly string[];
  readonly partitions: readonly ExpertPartitionReference[];
}

interface PartitionPayload {
  readonly schema: 1;
  readonly section: string;
  readonly path: string;
  readonly items: Readonly<Record<string, unknown>>;
  /** A redacted projection input. It is never used to restore authoritative state. */
  readonly publicItems?: Readonly<Record<string, unknown>>;
}

function stateSections(state: ExpertState): Map<string, [string, unknown][]> {
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

function privateConversationIds(state: ExpertState): Set<string> {
  return new Set(Object.values(state.conversations).filter((conversation) => conversation.scope === "private-team").map((conversation) => conversation.id));
}

function publicItemsFor(state: ExpertState, section: string, items: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  if (section === "memory" || section === "receipts" || section === "audit") return {};
  const privateConversations = privateConversationIds(state);
  const visible: [string, unknown][] = [];
  for (const [id, raw] of Object.entries(items)) {
    if (section === "conversations" && (raw as { scope?: string }).scope === "private-team") continue;
    if (section === "messages" && privateConversations.has((raw as { conversationId?: string }).conversationId ?? "")) continue;
    if (section === "assignments") {
      if (privateConversations.has((raw as { conversationId?: string }).conversationId ?? "")) continue;
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

export function isExpertStateManifest(value: unknown): value is ExpertStateManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<ExpertStateManifest>;
  return manifest.schema === 2 && manifest.logicalSchema === 1 && manifest.partitionVersion === 1
    && Array.isArray(manifest.presentSections) && Array.isArray(manifest.partitions);
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

async function partitionEntries(section: string, entries: readonly [string, unknown][], state: ExpertState, path = "", depth = 0): Promise<{ reference: ExpertPartitionReference; payload: PartitionPayload }[]> {
  const items = Object.fromEntries(entries);
  const base = { schema: 1 as const, section, path, items };
  const publicItems = publicItemsFor(state, section, items);
  const payload: PartitionPayload = publicItems === undefined ? base : { ...base, publicItems };
  if (Buffer.byteLength(JSON.stringify(payload)) <= EXPERT_PARTITION_MAX_BYTES) {
    const hash = chunkHash(payload);
    const reference = { section, path, hash, threadId: partitionThreadId({ section, path, hash }) };
    return [{ reference, payload }];
  }
  if (depth >= 16) throw new Error(`Expert ${section} partition cannot be bounded below ${EXPERT_PARTITION_MAX_BYTES} bytes`);
  const groups = new Map<string, [string, unknown][]>();
  for (const entry of entries) {
    const nibble = createHashNibble(entry[0], depth);
    const group = groups.get(nibble) ?? [];
    group.push(entry);
    groups.set(nibble, group);
  }
  if (groups.size < 2) throw new Error(`Expert ${section} partition cannot be split below ${EXPERT_PARTITION_MAX_BYTES} bytes`);
  const result = [];
  for (const [nibble, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    result.push(...await partitionEntries(section, group, state, `${path}${nibble}`, depth + 1));
  }
  return result;
}

function createHashNibble(id: string, index: number): string {
  return createHash("sha256").update(id).digest("hex")[index]!;
}

export async function prepareExpertManifest(service: RuntimeService, caller: Caller, state: ExpertState): Promise<ExpertStateManifest> {
  const sections = stateSections(state);
  const partitions: ExpertPartitionReference[] = [];
  const prepared: { reference: ExpertPartitionReference; payload: PartitionPayload }[] = [];
  for (const [section, entries] of sections) {
    prepared.push(...await partitionEntries(section, entries, state));
  }
  // Child snapshots are immutable and independently addressable. Prepare them concurrently;
  // the caller still publishes the single root manifest only after all writes verify.
  await Promise.all(prepared.map(({ reference, payload }) => writeImmutablePartition(service, caller, reference, payload)));
  partitions.push(...prepared.map(({ reference }) => reference));
  partitions.sort((a, b) => a.section.localeCompare(b.section) || a.path.localeCompare(b.path));
  const manifest: ExpertStateManifest = {
    schema: 2, logicalSchema: 1, partitionVersion: 1,
    presentSections: [...sections.keys()], partitions,
  };
  const bytes = Buffer.byteLength(JSON.stringify(manifest));
  if (bytes > ROOT_MANIFEST_MAX_BYTES) throw new Error(`Expert manifest would be ${bytes} bytes; refusing above the 900 KiB root-event safety boundary`);
  return manifest;
}

export async function restoreExpertManifest(service: RuntimeService, caller: Caller, manifest: ExpertStateManifest): Promise<ExpertState> {
  validateExpertManifestReferences(manifest);
  const merged = new Map<string, [string, unknown][]>();
  const seenIds = new Map<string, Set<string>>();
  for (const reference of manifest.partitions) {
    const result = await service.readSharedState(caller, { threadId: reference.threadId });
    if (result.version < 1) throw new Error(`Expert partition ${reference.hash} is missing`);
    const payload = result.state as unknown as PartitionPayload;
    if (chunkHash(payload) !== reference.hash) throw new Error(`Expert partition ${reference.hash} failed content verification`);
    if (payload.schema !== 1 || payload.section !== reference.section || payload.path !== reference.path
        || !payload.items || typeof payload.items !== "object" || Array.isArray(payload.items)) {
      throw new Error(`Expert partition ${reference.hash} has an invalid shape`);
    }
    const sectionIds = seenIds.get(reference.section) ?? new Set<string>();
    for (const id of Object.keys(payload.items)) {
      if (sectionIds.has(id)) throw new Error(`Expert manifest contains duplicate ${reference.section} identity ${id}`);
      if (!createHash("sha256").update(id).digest("hex").startsWith(reference.path)) {
        throw new Error(`Expert ${reference.section} identity ${id} is assigned to the wrong partition path`);
      }
      sectionIds.add(id);
    }
    seenIds.set(reference.section, sectionIds);
    const entries = merged.get(reference.section) ?? [];
    entries.push(...Object.entries(payload.items).map(([id, value]): [string, unknown] => [id, structuredClone(value)]));
    merged.set(reference.section, entries);
  }
  const state = { schema: 1 } as unknown as ExpertState;
  for (const section of manifest.presentSections) {
    const entries = merged.get(section) ?? [];
    if (section === "audit") {
      state.audit = entries.sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value as NonNullable<ExpertState["audit"]>[number]);
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
