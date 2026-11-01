// Shared reads for the provider UI: the stored providers (`provider.list`) and where their keys live
// (`secrets.backend.describe`). Both are capabilities, not projections, so the list refetches when the
// durable `model-config` / `provider-routes` projections change.
import { useCallback, useEffect, useState } from "react";
import { useCognate, useProjection } from "@godspeedai/cognate-react";
import type { StoredProviderRow } from "../../capabilities/providerSwitch.ts";
import type { SecretsBackendDescription } from "../../capabilities/secretsBackendDescribe.ts";

export type StoredProvider = StoredProviderRow;

export function useProviderList(): { readonly providers: readonly StoredProvider[] | undefined; readonly refresh: () => void } {
  const client = useCognate();
  const config = useProjection("model-config");
  const routes = useProjection("provider-routes");
  const [providers, setProviders] = useState<readonly StoredProvider[] | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = (await client.invoke("provider.list", {} as never)) as unknown as { readonly providers: readonly StoredProvider[] };
        if (!cancelled) setProviders(r.providers);
      } catch {
        if (!cancelled) setProviders((prev) => prev ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, config, routes, tick]);
  return { providers, refresh };
}

export function useSecretsBackend(): SecretsBackendDescription | undefined {
  const client = useCognate();
  const [backend, setBackend] = useState<SecretsBackendDescription | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void client
      .invoke("secrets.backend.describe", {} as never)
      .then((r) => {
        if (!cancelled) setBackend(r as unknown as SecretsBackendDescription);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);
  return backend;
}

/** "Windows Credential Manager" etc. for the key-status line. */
export function keyStoreLabel(b: SecretsBackendDescription | undefined): string {
  return b?.label ?? "your system's secret store";
}

/** Technical detail behind the storage note (file location, why no system store); shown on request only. */
export function storageDetail(b: SecretsBackendDescription | undefined): string | undefined {
  if (!b || b.backend !== "file") return undefined;
  const parts = [b.location ? `File: ${b.location}` : "", b.reason ? `No system store: ${b.reason}` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

export function storageNote(b: SecretsBackendDescription | undefined): string {
  if (!b) return "API keys are kept in your system's secret store, never in the event log. The agent never sees them.";
  if (b.backend === "file") {
    return "API keys are stored in a protected file on this computer, not in a system secret store. The agent never sees them.";
  }
  return `API keys go straight to ${b.label}. The agent never sees them.`;
}
