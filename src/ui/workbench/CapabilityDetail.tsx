// Capability inspector: registered metadata, recorded activations and, when supplied by the host,
// trusted fragment and safe-mode state. Missing authority or presentation data is not inferred.
import React from "react";
import { FragmentSlot, type RegisteredFragment } from "../FragmentSlot.tsx";
import type { SafeModeController, SafeModeRead } from "../../workbench/safeMode.ts";

export interface BundleActivation {
  readonly capabilityId: string;
  readonly version: string;
  readonly level: string;
  readonly sessionId?: string;
  readonly state: string;
  readonly suspensionReasons?: readonly string[];
  readonly ceiling?: readonly string[];
}

export interface CapabilityDetailProps {
  readonly capabilityId: string;
  readonly name?: string;
  readonly version: string;
  readonly origin: string;
  readonly creatingActor: string;
  readonly grants?: readonly string[];
  readonly actions?: readonly string[];
  readonly activations?: readonly BundleActivation[];
  readonly fragments?: readonly RegisteredFragment[];
  readonly read?: SafeModeRead;
  readonly safeMode?: SafeModeController;
  readonly isOperator?: boolean;
  readonly onClear?: () => void;
}

export const SafeModeBanner: React.FC<{ reason: string; canClear?: boolean; onClear?: () => void }> = ({ reason, canClear, onClear }) => (
  <div className="wb-safe-banner" role="alert">
    Safe mode: extensions are suspended ({reason}).
    {canClear && onClear && <button type="button" className="wb-btn" onClick={onClear}>Clear safe mode</button>}
  </div>
);

export const CapabilityDetail: React.FC<CapabilityDetailProps> = ({ capabilityId, name, version, origin, creatingActor, grants, actions, activations, fragments, read, safeMode, isOperator, onClear }) => (
  <div className="wb-capability-detail wb-root">
    {read?.safe && (
      <SafeModeBanner reason={read.reason} {...(isOperator !== undefined ? { canClear: isOperator } : {})} {...(onClear ? { onClear } : {})} />
    )}
    <h2>{name || capabilityId}</h2>
    {name && <p>{capabilityId}</p>}
    <dl>
      <dt>Latest registered version</dt><dd>{version || "Unknown"}</dd>
      <dt>Origin</dt><dd>{origin || "Unknown"}</dd>
      <dt>Created by</dt><dd>{creatingActor || "Unknown"}</dd>
      {grants && <><dt>Effective grants</dt><dd>{grants.length ? grants.join(", ") : "none"}</dd></>}
      {actions && <><dt>Actions</dt><dd>{actions.length ? actions.join(", ") : "none"}</dd></>}
    </dl>
    {activations && <section><h3>Activations</h3>{activations.length === 0 ? <p>No activation recorded</p> : <ul>{activations.map((a) => <li key={`${a.level}/${a.sessionId ?? ""}`}>
      <span>{a.level}{a.sessionId ? `, session ${a.sessionId}` : ""}: {a.state || "unknown"}</span>
      <dl>
        <dt>Activated version</dt><dd>{a.version || "Unknown"}</dd>
        {a.suspensionReasons && a.suspensionReasons.length > 0 && <><dt>Suspension reasons</dt><dd>{a.suspensionReasons.join(", ")}</dd></>}
        {a.ceiling && <><dt>Recorded activation ceiling</dt><dd>{a.ceiling.length ? a.ceiling.join(", ") : "None"}</dd></>}
      </dl>
    </li>)}</ul>}</section>}
    {read && safeMode && fragments?.filter((f) => f.payload.capabilityId === capabilityId).map((f) => <FragmentSlot key={f.key} fragment={f} read={read} faults={safeMode.faults} />)}
  </div>
);
