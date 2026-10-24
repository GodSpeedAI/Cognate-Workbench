// Not consumed by `cognate dev` (this app's `src/server.ts` composes its own runtime — see
// docs/explanation/why-single-bun-process.md). Kept for shape-parity with the
// `cognate create --profile harness` starter and as a single documented place for app metadata.
import type { CognateConfig } from "@godspeedai/cognate-cli";

export default {
  profile: "harness",
  instructions: "Cognate Workbench: capability-native agent development, grounded task contracts, session orchestration and verification.",
} satisfies CognateConfig;
