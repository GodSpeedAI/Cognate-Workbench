// `secret.put`: the only path that writes a credential to disk. Never invoked from inside an
// agent's `run()` (that would record the raw secret in a `run.invocation` event payload) — callers
// invoke it directly through `RuntimeService.invoke` / `client.invoke`, which is NOT recorded as an
// event (see cognate-api.md §4/§5). The value never appears in any event, projection, or log line.
import type { SemanticRef } from "@godspeedai/cognate-kernel-api";
import type { Component } from "@godspeedai/cognate-kernel-api";
import type { SecretStore } from "../secrets.ts";

export interface SecretPutInput {
  readonly key: string;
  readonly value: string;
}

export function secretPutComponent(store: SecretStore, semanticRef?: SemanticRef): Component {
  return {
    id: "secret:put",
    provides: [{ id: "secret.put", version: "1.0.0", semanticRef }],
    activate(fiber) {
      fiber.provide({ id: "secret.put", version: "1.0.0", semanticRef }, async (rawInput) => {
        const input = rawInput as SecretPutInput;
        if (!input.key || typeof input.value !== "string") throw new Error("secret.put: key and value are required");
        await store.put(input.key, input.value);
        // Never echo the value back — confirmation only.
        return { ok: true, key: input.key };
      });
    },
  };
}
