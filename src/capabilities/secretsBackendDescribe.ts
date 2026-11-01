// `secrets.backend.describe` (J-SECRETS-storage): read-only, operator-only report of where API keys
// are stored, so Settings can say "API keys are stored in: <label>". It reports the backend kind, a
// human label and the reason a fallback is in use. It never reads, lists or returns a secret value.
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";
import { secretBackendLabel, type SecretBackendKind } from "../secrets.ts";

export interface SecretsBackendDescription {
  readonly backend: SecretBackendKind;
  readonly label: string;
  readonly reason?: string;
  /** Where the keys live: the file path, or the native service name and per-home scope. */
  readonly location?: string;
}

export function secretsBackendDescribeComponent(options: {
  readonly describe: () => SecretsBackendDescription;
  readonly semanticRef: SemanticRef | undefined;
}): Component {
  const contract = { id: "secrets.backend.describe", version: "1.0.0", semanticRef: options.semanticRef };
  return {
    id: "secrets:backend-describe",
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (): Promise<SecretsBackendDescription> => options.describe());
    },
  };
}
