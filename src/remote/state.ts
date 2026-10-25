// Durable phone-remote device records (thread `auth:remote:v1`). The ledger holds only what survives a
// restart: the passkey public key, its sign count, the label, and the identity session id each paired
// phone holds. Pairing secrets, WebAuthn challenges and the live remote listener stay in memory. Sessions
// themselves are the identity ledger's (`issueSession` / `revokeSession`); nothing here is a second store.
import { randomUUID } from "node:crypto";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { ServiceError } from "@godspeedai/cognate-runtime-api";
import type { Json } from "@godspeedai/cognate-events";

export const REMOTE_THREAD = "auth:remote:v1";
export const REMOTE_AUDIT_LIMIT = 200;

export interface RemoteDevice {
  readonly id: string;
  readonly label: string;
  readonly credentialId: string;
  /** COSE_Key bytes, base64url. */
  readonly publicKey: string;
  readonly signCount: number;
  readonly generation: number;
  /** Identity session id of this phone's current cookie session. */
  readonly sid: string | null;
  readonly pairedAt: string;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
}

export interface RemoteAudit {
  readonly at: string;
  readonly deviceId: string;
  readonly command: string;
  readonly commandId: string;
  readonly outcome: string;
}

export interface RemoteState {
  readonly schema: 1;
  readonly devices: Record<string, RemoteDevice>;
  readonly audit: readonly RemoteAudit[];
}

export function emptyRemoteState(): RemoteState {
  return { schema: 1, devices: {}, audit: [] };
}

export async function readRemoteState(service: RuntimeService, system: Caller): Promise<{ state: RemoteState; version: number }> {
  const result = await service.readSharedState(system, { threadId: REMOTE_THREAD });
  if (result.version === 0) return { state: emptyRemoteState(), version: 0 };
  return { state: result.state as unknown as RemoteState, version: result.version };
}

/** Compare-and-set write: re-reads and re-applies `change` when another writer committed first. */
export async function mutateRemoteState<T>(
  service: RuntimeService,
  system: Caller,
  change: (draft: { devices: Record<string, RemoteDevice>; audit: RemoteAudit[] }) => T,
): Promise<{ state: RemoteState; result: T }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { state, version } = await readRemoteState(service, system);
    const draft = { devices: structuredClone(state.devices), audit: structuredClone([...state.audit]) };
    const result = change(draft);
    const next: RemoteState = { schema: 1, devices: draft.devices, audit: draft.audit.slice(-REMOTE_AUDIT_LIMIT) };
    try {
      await service.updateSharedState(system, { threadId: REMOTE_THREAD, update: { snapshot: next as unknown as Json }, expectedVersion: version, idempotencyKey: randomUUID() });
      return { state: next, result };
    } catch (error) {
      if (error instanceof ServiceError && error.code === "failed_precondition") continue;
      throw error;
    }
  }
  throw new Error("remote device ledger is busy; retry");
}
