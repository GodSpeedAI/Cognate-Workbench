// Registered bundles from the Workbench projection; authority and fragments are not inferred.
import React from "react";
import { CapabilityDetail, type BundleActivation, type AttributableAction } from "./CapabilityDetail.tsx";
import type { WbRow } from "./data.ts";

export interface BundleRecord {
  readonly capabilityId: string;
  readonly name?: string;
  readonly origin?: string;
  readonly createdBy?: string;
  readonly versionHash?: string;
  readonly uninstalled?: boolean;
}
export type { BundleActivation };

const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function recentActions(decisions: readonly WbRow<unknown>[], capabilityId: string): AttributableAction[] {
  return decisions.flatMap<AttributableAction>(({ id, value }) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    if (row.capability !== capabilityId || !nonempty(row.operation) || !nonempty(row.actorId) || !nonempty(row.actorKind)) return [];
    if (row.outcome !== "allowed" && row.outcome !== "refused") return [];
    if (!nonempty(row.recordedAt) || !Number.isFinite(Date.parse(row.recordedAt))) return [];
    return [{ id, operation: row.operation, actorId: row.actorId, actorKind: row.actorKind, outcome: row.outcome, recordedAt: row.recordedAt, ...(nonempty(row.sessionId) ? { sessionId: row.sessionId } : {}) }];
  }).sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || a.id.localeCompare(b.id)).slice(0, 10);
}

export function BundleDetails({ bundles, activations, decisions = [] }: { readonly bundles: readonly BundleRecord[]; readonly activations: readonly BundleActivation[]; readonly decisions?: readonly WbRow<unknown>[] }) {
  const installed = bundles.filter((bundle) => !bundle.uninstalled);
  if (!installed.length) return null;
  return <section aria-label="Registered bundles"><h2>Registered bundles</h2>{installed.map((bundle) =>
    <CapabilityDetail key={bundle.capabilityId} capabilityId={bundle.capabilityId}
      {...(bundle.name ? { name: bundle.name } : {})} version={bundle.versionHash ?? ""}
      origin={bundle.origin ?? ""} creatingActor={bundle.createdBy ?? ""}
      activations={activations.filter((a) => a.capabilityId === bundle.capabilityId)}
      actions={recentActions(decisions, bundle.capabilityId)} />
  )}</section>;
}
