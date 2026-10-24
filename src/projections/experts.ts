import type { Projection } from "@godspeedai/cognate-projections";
import { fingerprint, type Json } from "@godspeedai/cognate-events";
import { EXPERTS_THREAD, type ExpertState } from "../experts/types.ts";
import { json, publicExperts } from "../experts/state.ts";
import { isExpertStateManifest, parsePartitionThreadId, publicPartition, validateExpertManifestReferences, type ExpertStateManifest } from "../experts/persistence.ts";

function publicStateFromManifest(manifest: ExpertStateManifest, projectionState: Parameters<Projection["apply"]>[1], tenant: string): ExpertState | undefined {
  const restored = { schema: 1 } as unknown as ExpertState;
  const tables = new Map<string, [string, unknown][]>();
  for (const reference of manifest.partitions) {
    const cached = projectionState.get(`${tenant}/partition/${reference.hash}`) as {
      hash?: string; section?: string; path?: string; threadId?: string;
      chunk?: { items?: Record<string, unknown> };
    } | undefined;
    if (!cached || cached.hash !== reference.hash || cached.section !== reference.section || cached.path !== reference.path
        || cached.threadId !== reference.threadId || !cached.chunk?.items) {
      return undefined;
    }
    const entries = tables.get(reference.section) ?? [];
    entries.push(...Object.entries(cached.chunk.items));
    tables.set(reference.section, entries);
  }
  for (const section of manifest.presentSections) {
    const entries = tables.get(section) ?? [];
    if (section === "audit") {
      restored.audit = entries.sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value as NonNullable<ExpertState["audit"]>[number]);
    } else {
      (restored as unknown as Record<string, unknown>)[section] = Object.fromEntries(entries);
    }
  }
  for (const section of ["experts", "teams", "conversations", "assignments", "messages", "memory", "receipts"]) {
    (restored as unknown as Record<string, unknown>)[section] ??= {};
  }
  return publicExperts(restored);
}

export const expertsProjection: Projection = {
  name:"experts",version:"3.0.0",
  apply(event, projectionState) {
    if (event.eventType === "erasure.recorded") {
      const eventId = (event.payload as { eventId?: unknown } | null)?.eventId;
      if (typeof eventId !== "string") return [];
      const sourceKey = `${event.tenant}/_source/${eventId}`;
      const source = projectionState.get(sourceKey) as { kind?: string; hash?: string } | undefined;
      if (!source) return [];
      const writes: { key: string; value: Json | null }[] = [{ key: sourceKey, value: null }];
      if (source.kind === "partition" && source.hash) {
        writes.push({ key: `${event.tenant}/partition/${source.hash}`, value: null });
        const refs = projectionState.get(`${event.tenant}/_meta/current-refs`) as { hashes?: unknown } | undefined;
        if (Array.isArray(refs?.hashes) && refs.hashes.includes(source.hash)) {
          writes.push(
            { key: `${event.tenant}/current`, value: null },
            { key: `${event.tenant}/_meta/current-refs`, value: null },
            { key: `${event.tenant}/_meta/current-root`, value: null },
          );
        }
      } else if (source.kind === "root") {
        const currentRoot = projectionState.get(`${event.tenant}/_meta/current-root`) as { eventId?: unknown } | undefined;
        if (currentRoot?.eventId === eventId) {
          writes.push(
            { key: `${event.tenant}/current`, value: null },
            { key: `${event.tenant}/_meta/current-refs`, value: null },
            { key: `${event.tenant}/_meta/current-root`, value: null },
          );
        }
      }
      return writes;
    }
    // Erased envelopes retain metadata but have no usable payload. The corresponding
    // erasure.recorded event below invalidates any projection row derived from the source.
    if (event.erasure) return [];
    if (event.eventType !== "state.changed") return [];
    const threadId = event.metadata?.threadId;
    if (typeof threadId === "string") {
      const parsed = parsePartitionThreadId(threadId);
      if (parsed) {
        const payload = event.payload as {snapshot?: unknown};
        const snapshot = payload.snapshot as {schema?: number; section?: string; path?: string; items?: unknown} | undefined;
        if (!snapshot || snapshot.schema !== 1 || snapshot.section !== parsed.section || snapshot.path !== parsed.path
            || fingerprint(snapshot as unknown as Json) !== parsed.hash || !snapshot.items || typeof snapshot.items !== "object" || Array.isArray(snapshot.items)) {
          throw new Error(`Expert partition event ${threadId} failed content verification`);
        }
        const safe = publicPartition(snapshot as never);
        return [{
          key:`${event.tenant}/partition/${parsed.hash}`,
          value:json({hash:parsed.hash,section:parsed.section,path:parsed.path,threadId,chunk:safe}),
        }, { key:`${event.tenant}/_source/${event.eventId}`, value:json({kind:"partition",hash:parsed.hash}) }];
      }
    }
    if (threadId !== EXPERTS_THREAD) return [];
    const payload = event.payload as {snapshot?: unknown};
    if (isExpertStateManifest(payload.snapshot)) {
      validateExpertManifestReferences(payload.snapshot);
      const current = publicStateFromManifest(payload.snapshot,projectionState,event.tenant);
      return current ? [
        {key:`${event.tenant}/current`,value:json(current)},
        {key:`${event.tenant}/_meta/current-refs`,value:json({hashes:payload.snapshot.partitions.map((ref)=>ref.hash)})},
        {key:`${event.tenant}/_meta/current-root`,value:json({eventId:event.eventId})},
        {key:`${event.tenant}/_source/${event.eventId}`,value:json({kind:"root"})},
      ] : [
        {key:`${event.tenant}/current`,value:null},
        {key:`${event.tenant}/_meta/current-refs`,value:null},
        {key:`${event.tenant}/_meta/current-root`,value:null},
        {key:`${event.tenant}/_source/${event.eventId}`,value:json({kind:"root"})},
      ];
    }
    if ((payload.snapshot as {schema?: number} | undefined)?.schema === 1) {
      return [
        {key:`${event.tenant}/current`,value:json(publicExperts(payload.snapshot as ExpertState))},
        {key:`${event.tenant}/_meta/current-refs`,value:json({hashes:[]})},
        {key:`${event.tenant}/_meta/current-root`,value:json({eventId:event.eventId})},
        {key:`${event.tenant}/_source/${event.eventId}`,value:json({kind:"root"})},
      ];
    }
    return [];
  },
};
