// Publishes `model.generate`, forwarding streamed text deltas via `HandlerContext.progress` into
// `run.invocation.progress` events (the durable progress channel; see
// docs/reference/capability-catalog.md).
// Distinct from `@godspeedai/cognate-profile-harness`'s `providerComponent`, which only calls `generate` — this
// reconstruction needs live token deltas in the invoking run, which requires calling `provider.stream`
// from inside the handler.
import type { ModelProvider, ModelRequest, ModelResponse } from "@godspeedai/cognate-capabilities";
import { modelContract } from "@godspeedai/cognate-capabilities";
import type { Component, SemanticRef } from "@godspeedai/cognate-kernel-api";

export function streamingProviderComponent(provider: ModelProvider, semanticRef?: SemanticRef): Component {
  const contract = { ...modelContract(provider), semanticRef };
  return {
    id: `model-provider:${provider.id}`,
    provides: [contract],
    activate(fiber) {
      fiber.provide(contract, async (rawInput, ctx): Promise<ModelResponse> => {
        const request = rawInput as ModelRequest;
        if (!provider.features.stream || !ctx.progress) {
          return provider.generate(request, ctx.signal);
        }
        let text = "";
        let final: ModelResponse | undefined;
        for await (const delta of provider.stream(request, ctx.signal)) {
          if (delta.type === "text") {
            text += delta.text;
            await ctx.progress({ kind: "text", text: delta.text });
          } else if (delta.type === "done") {
            final = delta.response;
          }
        }
        return final ?? { message: { role: "assistant", content: text }, toolCalls: [], finishReason: "stop", model: provider.model };
      });
    },
  };
}
