// Data access for the cockpit: typed reads of the public `workbench` projection and one action
// helper that surfaces a capability's own refusal text. Components below this layer stay pure.
import { useMemo } from "react";
import { useCognate, useProjection } from "@godspeedai/cognate-react";
import type { Json } from "@godspeedai/cognate-events";

export interface WbRow<T> {
  readonly id: string;
  readonly value: T;
}

/** Rows whose key starts with `prefix` (e.g. `task/`), id = the remainder of the key. */
export function useWbRows<T>(prefix: string): readonly WbRow<T>[] {
  const rows = useProjection("workbench");
  return useMemo(
    () => (rows ?? []).filter((r) => r.key.startsWith(prefix)).map((r) => ({ id: r.key.slice(prefix.length), value: r.value as unknown as T })),
    [rows, prefix],
  );
}

export function useWbRow<T>(key: string): T | undefined {
  const rows = useProjection("workbench");
  return useMemo(() => rows?.find((r) => r.key === key)?.value as unknown as T | undefined, [rows, key]);
}

/** A capability refusal arrives as `invocation of x failed: {"kind":"failed","message":"x: reason",...}`.
 *  Show the reason the capability wrote, which is written for people. */
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const json = /failed: (\{.*\})\s*$/s.exec(raw)?.[1];
  if (json) {
    try {
      const message = (JSON.parse(json) as { message?: string }).message;
      if (message) return message.replace(/^[a-z.]+: /, "");
    } catch {
      /* fall through to the raw text */
    }
  }
  return raw;
}

export type Notice = { readonly kind: "error" | "ok"; readonly text: string } | undefined;

/** `invoke(capability, input)` for domain objects; rejects with the capability's readable reason. */
export function useWorkbenchActions(onNotice: (n: Notice) => void) {
  const client = useCognate();
  return useMemo(
    () => ({
      async call<T = unknown>(capability: string, input: unknown, ok?: string): Promise<T | undefined> {
        try {
          // Editors may leave `undefined` fields; the wire (protobuf Value) accepts strict JSON only.
          const out = (await client.invoke(capability, JSON.parse(JSON.stringify(input ?? null)) as Json)) as unknown as T;
          onNotice(ok ? { kind: "ok", text: ok } : undefined);
          return out;
        } catch (error) {
          onNotice({ kind: "error", text: errorText(error) });
          return undefined;
        }
      },
    }),
    [client, onNotice],
  );
}
