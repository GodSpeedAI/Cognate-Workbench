# Workflow: provider hot-swap

## Summary

The operator configures a model provider in Settings. The capability validates, stores the secret,
records a `model.configured` event, swaps the live provider component, and leaves the previous one
usable until the replacement is confirmed active. At boot the server does the same thing from durable
state, so a run resumed after a restart can still call the model.

## Sequence

1. The operator opens **Settings → Models**, picks or creates a provider entry: provider id, base
   URL, wire protocol, model id, and an API key.
2. The UI invokes `model.configure`.
3. `modelConfigureComponent` validates the fields. An unsupported protocol throws
   `model.configure: unsupported wire protocol`.
4. The secret is written through `secret.put` to `<home>/secrets.json` under
   `model-provider:<providerId>`. The API key **never enters an event payload** — the
   `model-configured` projection's own comment says the event it folds never contained one.
5. The capability starts an `agent.config` run with `kind: "model.configured"` carrying
   `{ providerId, baseURL, protocol, model }`.
6. `agent.config` emits `model.configured`. The `model-config` projection folds it to
   `${tenant}/current`.
7. `ProviderRegistry.swap` builds the provider with `buildProvider(config, secrets)` and mounts a new
   `streamingProviderComponent`.
8. It waits up to 5 seconds for the new handle to reach `ACTIVE`.
   - **Reached** → dispose the previous handle, store the new one. The swap is done.
   - **Not reached** → dispose the new handle, leave the previous provider mounted and usable, and
     rethrow. A hot-swap failure must not take the app down.
9. From this point, `model.generate` resolves to the new provider for every subsequent invocation.
   Runs already in flight hold whatever they resolved.

## Boot restoration

`model.generate` is not durable. Only the `model.configured` event is.

At boot, `src/server.ts` reads the `model-config` projection and re-mounts the last configured
provider. Without this step, a run paused on an open approval continuation and resumed after a
restart would have no provider to call and would fail at its next model call. This was a real fix
made while building the approval-durability journey.

## Wire protocols

| Protocol | Provider used |
|---|---|
| `openai-compatible`, `openai-completions` | `openAICompatible` (with `apiKey`) |
| `openai-responses` | `openAIResponses` (with `apiKeySource`) |
| `anthropic-messages` | `anthropicCompatible` (with `apiKeySource(key, "x-api-key")`) |

The first two share an implementation; `openai-compatible` is retained for configurations persisted
earlier. Anything else throws.

## Streaming

`streamingProviderComponent` publishes `model.generate` and forwards text deltas through
`ctx.progress({ kind: "text", text })`, which the runtime records as `run.invocation.progress`. That
is what makes the transcript stream live inside the invoking run.

If the provider does not advertise streaming, or the context has no progress channel, it falls back
to `provider.generate` and returns the whole response.

This exists because the framework's stock provider component only awaits the full response, and this
app needs the deltas.

## State

| Fact | Where |
|---|---|
| providerId, baseURL, protocol, model, configuredAt | `model-config` projection |
| API key | `<home>/secrets.json`, key `model-provider:<providerId>` |
| The live component handle | in memory, `ProviderRegistry` |
| The fact that a provider is configured | the durable `model.configured` event |

## Failure branches

| Branch | Behaviour |
|---|---|
| Unsupported protocol | The capability throws; nothing is stored |
| Swap fails before activation | New handle disposed, old provider stays usable, error rethrown |
| No `model-config` row after a restart | No provider mounted; the operator must configure one |
| Missing secret | `buildProvider` resolves the key to an empty string; the provider call fails at the endpoint |

## Sequence diagram

```mermaid
sequenceDiagram
    participant OP as operator
    participant UI
    participant CAP as model.configure
    participant SEC as secrets.json
    participant RT as runtime
    participant PRJ as model-config projection
    participant REG as ProviderRegistry

    OP->>UI: save provider settings
    UI->>CAP: model.configure { providerId, baseURL, protocol, model, apiKey }
    CAP->>CAP: validate (unknown protocol → throw)
    CAP->>SEC: secret.put("model-provider:<id>", apiKey)
    CAP->>RT: startRun(agent.config, { kind: "model.configured", ... })
    RT->>PRJ: emit model.configured
    CAP->>REG: swap(config, secrets)
    REG->>REG: buildProvider → mount streamingProviderComponent
    REG->>REG: wait ACTIVE (5s)
    alt activated
        REG->>REG: dispose the previous handle
        REG-->>UI: success
    else not activated
        REG->>REG: dispose the new handle; keep the old one mounted
        REG-->>UI: error (app stays up)
    end
```

## Source trail

- `src/components/providerRegistry.ts` — `ModelWireProtocol`, `ModelConfig`, `buildProvider`,
  `ProviderRegistry.swap` with the rollback
- `src/components/modelProvider.ts` — `streamingProviderComponent`, the `ctx.progress` path
- `src/capabilities/modelConfigure.ts` — `modelConfigureComponent`, validation, the run start
- `src/capabilities/secretPut.ts` — the only capability that writes the secret file
- `src/secrets.ts` — `secretStore`
- `src/projections/modelConfig.ts` — `modelConfigProjection` and the "never carries the secret" note
- `src/server.ts` — the boot remount, with the comment explaining why it is required
- `src/agents/agentConfig.ts` — the `model.configured` input variant
- `test/J-CFG-model-provider.test.ts`, `test/providerRegistry.test.ts`