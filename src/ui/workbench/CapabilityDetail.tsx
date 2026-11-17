// Capability inspector (T4a): version, origin, creating actor, effective grants and attributable actions, with the
// capability's presentation fragments in their slots. The safe-mode banner and the operator-only clear live here.
import React from "react";
import { FragmentSlot, type RegisteredFragment } from "../FragmentSlot.tsx";
import type { SafeModeController, SafeModeRead } from "../../workbench/safeMode.ts";

export interface CapabilityDetailProps {
  readonly capabilityId: string;
  readonly version: string;
  readonly origin: string;
  readonly creatingActor: string;
  readonly grants: readonly string[];
  readonly actions: readonly string[];
  readonly fragments: readonly RegisteredFragment[];
  readonly read: SafeModeRead;
  readonly safeMode: SafeModeController;
  /** Only an operator session sees the clear control; the controller refuses everyone else regardless. */
  readonly isOperator: boolean;
  readonly onClear?: () => void;
}

export const CapabilityDetail: React.FC<CapabilityDetailProps> = ({ capabilityId, version, origin, creatingActor, grants, actions, fragments, read, safeMode, isOperator, onClear }) => (
  <div className="wb-capability-detail wb-root">
    {read.safe && (
      <div className="wb-safe-banner" role="alert">
        Safe mode: extensions are suspended ({read.reason}).
        {isOperator && <button className="wb-btn" onClick={onClear}>Clear safe mode</button>}
      </div>
    )}
    <h2>{capabilityId}</h2>
    <dl>
      <dt>Version</dt><dd>{version}</dd>
      <dt>Origin</dt><dd>{origin}</dd>
      <dt>Created by</dt><dd>{creatingActor}</dd>
      <dt>Effective grants</dt><dd>{grants.length ? grants.join(", ") : "none"}</dd>
      <dt>Actions</dt><dd>{actions.length ? actions.join(", ") : "none"}</dd>
    </dl>
    {fragments.filter((f) => f.payload.capabilityId === capabilityId).map((f) => <FragmentSlot key={f.key} fragment={f} read={read} faults={safeMode.faults} />)}
  </div>
);
