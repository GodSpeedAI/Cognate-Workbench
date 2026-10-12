# How-to: add a model wire protocol

## Goal

Support a provider whose API shape the current adapters do not cover.

## Decide first

Before writing an adapter, check whether the existing ones already fit. Three ship with the app:

| Protocol | Adapter |
|---|---|
| `openai-compatible`, `openai-completions` | `openAICompatible` |
| `openai-responses` | `openAIResponses` |
| `anthropic-messages` | `anthropicCompatible` |

If one of them works against your endpoint, use it. `openai-completions` and `openai-compatible`
share an implementation — the first exists so configurations persisted earlier keep resolving.

Only write a new adapter when the request/response shape genuinely differs.

## Procedure

### 1. Write the adapter

A `ModelProvider` from `@godspeedai/cognate-capabilities`:

```ts
export function myProvider(config: {
  id: string; baseURL: string; model: string; credentials: () => Promise<string>;
}): ModelProvider { /* … */ }
```

It must implement `generate`, and — if the endpoint streams — `stream`, plus `features` and
`modelContract` (via `modelContract(provider)`).

### 2. Extend the union

In `src/components/providerRegistry.ts`:

```ts
export type ModelWireProtocol =
  | "openai-compatible" | "openai-completions"
  | "openai-responses" | "anthropic-messages"
  | "my-protocol";
```

### 3. Extend `buildProvider`

Add a case. **Keep the `default` throw.** An unrecognised protocol must fail loudly; silently
falling back to a default adapter would send your traffic somewhere you did not intend.

```ts
case "my-protocol":
  return myProvider({ id: config.providerId, baseURL: config.baseURL, model: config.model, credentials: apiKeySource(key) });
default:
  throw new Error("model.configure: unsupported wire protocol");
```

### 4. Let it stream

`streamingProviderComponent` already forwards deltas through `ctx.progress` for any provider that
advertises `features.stream`. Nothing to do — but check that your `done` delta carries the final
response, or the wrapper synthesises one from the accumulated text.

### 5. Expose it in the UI

The provider list in Settings → Models is where protocols are offered. Add the option there.

### 6. Test it

Extend `test/providerRegistry.test.ts` for the switch, and add coverage for the adapter's own
request shaping and streaming.

### 7. Document it

Update the protocol table in
[Provider hot-swap](../workflows/provider-hot-swap.md) and
[Configuration](../reference/configuration.md).

## Validation

```bash
just typecheck
bun test test/providerRegistry.test.ts
just test
```

Then configure the provider in Settings and send a turn.

## Common failure symptoms

| Symptom | Cause | Fix |
|---|---|---|
| `model.configure: unsupported wire protocol` | The value is not in the union | Step 2 |
| Works until the first long response, then nothing | Streaming advertised but no `done` delta | Return the final response in `done` |
| Text appears all at once | `features.stream` is false, or the context has no `progress` | Expected fallback; check the wrapper's condition |
| API key rejected | Wrong credential shape | Anthropic uses an `x-api-key` header, not `Authorization` |

## Rollback

Remove the union member, the `buildProvider` case, and the UI option. Persisted configurations using
that protocol will then throw on `model.configure` — which is the correct failure, because silently
substituting a different wire protocol would be worse.

## Source trail

- `src/components/providerRegistry.ts` — `ModelWireProtocol`, `ModelConfig`, `buildProvider`,
  `ProviderRegistry.swap`
- `src/components/modelProvider.ts` — `streamingProviderComponent`, `modelContract`
- `src/capabilities/modelConfigure.ts` — validation and the swap trigger
- `package.json` — the `@godspeedai/cognate-provider-*` packages
- `test/providerRegistry.test.ts`
- `@godspeedai/cognate-capabilities` — `ModelProvider`, `ModelRequest`, `ModelResponse`