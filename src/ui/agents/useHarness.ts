// Reads for the external agent-harness CLIs: what is installed (`agent.harness.list`, detected on
// the server host, not in the browser) and which session is bound to which (`session-harness-bindings`).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCognate, useProjection } from "@godspeedai/cognate-react";
import type { HarnessInfo, HarnessListResult } from "../../agents/harness/detect.ts";
import type { SessionHarnessBindingRow } from "../../projections/sessionHarnessBindings.ts";

export type { HarnessInfo, SessionHarnessBindingRow };

export interface HarnessChoice {
  /** null = the native Cognate agent. */
  readonly harnessId: string | null;
  readonly permissionMode?: string;
  readonly model?: string;
}

export function useHarnessList(): {
  readonly harnesses: readonly HarnessInfo[] | undefined;
  readonly host: HarnessListResult["host"] | undefined;
  readonly refreshing: boolean;
  readonly error: string | undefined;
  readonly refresh: () => Promise<void>;
} {
  const client = useCognate();
  const [data, setData] = useState<HarnessListResult | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const load = useCallback(
    async (force: boolean) => {
      setRefreshing(true);
      try {
        setData((await client.invoke("agent.harness.list", (force ? { refresh: true } : {}) as never)) as unknown as HarnessListResult);
        setError(undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRefreshing(false);
      }
    },
    [client],
  );
  useEffect(() => {
    void load(false);
  }, [load]);
  const refresh = useCallback(() => load(true), [load]);
  return { harnesses: data?.harnesses, host: data?.host, refreshing, error, refresh };
}

export function useHarnessBindings(): ReadonlyMap<string, SessionHarnessBindingRow> {
  const rows = useProjection("session-harness-bindings");
  return useMemo(() => {
    const m = new Map<string, SessionHarnessBindingRow>();
    for (const r of rows ?? []) {
      const v = r.value as unknown as SessionHarnessBindingRow;
      if (v && typeof v.sessionId === "string") m.set(v.sessionId, v);
    }
    return m;
  }, [rows]);
}

/** One honest sentence about what a harness choice means. `warn` for full access. */
export function postureNotice(info: HarnessInfo | undefined, label: string, permissionMode: string | undefined): { readonly text: string; readonly warn: boolean } {
  if (permissionMode === "full") {
    return { text: `Full access: ${label} can change files and run commands on this computer without asking you. Workbench containment, approvals and evidence checks don't apply.`, warn: true };
  }
  if (info && !info.supportsApprovals) {
    return { text: `Runs ${label} on this computer. It applies its own permission rules; Workbench containment and evidence checks don't apply.`, warn: false };
  }
  return { text: `Runs ${label} on this computer. Its tool calls ask you here for approval; Workbench containment and evidence checks don't apply.`, warn: false };
}

export function defaultModeFor(info: HarnessInfo): string | undefined {
  return info.permissionModes.find((m) => m.id === "ask")?.id ?? info.permissionModes[0]?.id;
}
