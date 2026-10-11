// Not consumed by `cognate dev` (this app's `src/server.ts` composes its own runtime — see
// README.md "Why createRuntime, not createHarness/cognate dev"). Kept for shape-parity with the
// `cognate create --profile harness` starter and as a single documented place for app metadata.
import type { CognateConfig } from "@godspeedai/cognate-cli";

export default {
  profile: "harness",
  instructions: "DeepSeek Harness reconstruction: configure a model, choose a workspace, run a session.",
} satisfies CognateConfig;
