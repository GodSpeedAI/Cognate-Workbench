// Registered bundles from the Workbench projection; authority and fragments are not inferred.
import React from "react";
import { CapabilityDetail, type BundleActivation } from "./CapabilityDetail.tsx";

export interface BundleRecord {
  readonly capabilityId: string;
  readonly name?: string;
  readonly origin?: string;
  readonly createdBy?: string;
  readonly versionHash?: string;
  readonly uninstalled?: boolean;
}
export type { BundleActivation };

export function BundleDetails({ bundles, activations }: { readonly bundles: readonly BundleRecord[]; readonly activations: readonly BundleActivation[] }) {
  const installed = bundles.filter((bundle) => !bundle.uninstalled);
  if (!installed.length) return null;
  return <section aria-label="Registered bundles"><h2>Registered bundles</h2>{installed.map((bundle) =>
    <CapabilityDetail key={bundle.capabilityId} capabilityId={bundle.capabilityId}
      {...(bundle.name ? { name: bundle.name } : {})} version={bundle.versionHash ?? ""}
      origin={bundle.origin ?? ""} creatingActor={bundle.createdBy ?? ""}
      activations={activations.filter((a) => a.capabilityId === bundle.capabilityId)} />
  )}</section>;
}
