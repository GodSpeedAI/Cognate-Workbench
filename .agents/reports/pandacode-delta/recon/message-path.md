# Message path: Workbench composer → model

Recon date: this session. Read-only pass over `/home/sprime01/projects/cognate-workbench`.
Legend: **OBSERVED** = read directly in code. **INFERRED** = reasoned from what was read.

## 1. HTTP server — `src/server.ts` (859 lines)

**Single `Bun.serve`** at `src/server.ts:793-825`, loopback-only, hand-composed (not `serveRuntime`).

| # | Route | Line(s) | Auth | Body limit |
|---|-------|---------|------|-----------|
| 0 | loopback/Host gate (all paths) | `799-800` (impl `117-130`) | host-header only — 421 non-loopback Host, 403 non-loopback Origin | — |
| 1 | `GET /health` | `802-804` | **none** | — |
| 2 | `/cognate.v1.RuntimeService/*` → Connect unary+server-stream | `805-808`, handler map `742-757`, router `725,741` | `authenticate` (per-RPC, inside Connect handler) | Bun `maxRequestBodySize: 64*1024*1024` (`797`); Connect JSON depth 32 (`741`) |
| 3 | `GET /app.js` (bundled UI) | `811` | none | — |
| 4 | `GET /astryx.css` | `812` | none | — |
| 5 | `GET /theme.css` | `813` | none | — |
| 6 | `GET /app.css` | `814` | none | — |
| 7 | `GET /` (index.html, CSP) | `815-822` | none | — |
| 8 | fallback `404` | `823` | — | — |

**Auth wiring (OBSERVED):**
- `sessionAuth = createSessionAuthenticator(governedService, SYSTEM_CALLER)` — `:731`
- dev-token branch armed only by `COGNATE_DEV_AUTH=1` — `:730,132-138`
- `authenticate` reads `Authorization: Bearer …` and resolves against the durable session ledger per request — `:732-737`
- `registerRuntimeService(connectRouter, governedService, { authenticate, maxJsonDepth: 32 })` — `:741`
- Browser session token is **inlined into the generated bundle** — `:302-305` (template) and `:764`
- Static routes 3-7 do **not** call `authenticate`; only the Connect prefix does.

**Body-size caveat (OBSERVED, material for uploads):** this server sets only Bun's `maxRequestBodySize` (64 MiB, `:797`). The published `serveRuntime` enforces a stricter declared-`content-length` ceiling (`1_048_576`, `node_modules/@godspeedai/cognate-protocol-connect-bun/src/index.ts:54,63-70`) — that code path is **not** used here. So today the effective Connect body ceiling is 64 MiB with only JSON-depth structure checks.

**Where a new bounded upload/read route goes:** inside the `fetch` handler between the `/health` branch (`:804`) and the RuntimeService prefix (`:805`), or immediately after `/app.css` (`:814`). It must call `authenticate(request.headers)` itself (static routes don't) and must add its own byte ceiling — nothing above will bound it except `:797`. Response must pass through `hardened()` (`:785-792`), and if it is reachable from the document, `connect-src 'self'` / `img-src 'self' data:` in the CSP at `:821` already permits same-origin fetch + data URLs.

---

## 2. Composer → agent

**`send(message: string)`** — `src/ui/App.tsx:5047-5120`. Text-only signature; composer submit is `onSend(trimmed)` at `:3114`, declared `onSend: (message: string) => void` at `:3081`.

Exact dispatch call (`:5111-5116`):

```ts
const view = await client.startRun(
  "agent.coding",
  { sessionId, workspaceId: sendWorkspaceId, message: messageWithFocus(message), mode, preset,
    ...(activeCaseId ? { caseId: activeCaseId } : {}), ...(runTaskId ? { taskId: runTaskId } : {}) } as unknown as Json,
  { idempotencyKey: crypto.randomUUID(), correlationId: `session:${sessionId}`, state: { steer: [] } as unknown as Json },
);
```

- `messageWithFocus` prepends referent/focus text — `:4749` (so `message` is already string-mutated before it leaves the UI).
- `client.startRun` signature: `node_modules/@godspeedai/cognate-client/src/index.ts:50`, impl `708-709` → `service.startRun(caller, { agent, input, ... })`.
- Connect decode of `input` (`google.protobuf.Value` → Json, depth-capped): `node_modules/@godspeedai/cognate-protocol-connect/src/index.ts:361-379` (`decodeValue(req.input, depth)`).

**`AgentCodingInput`** — `src/agents/agentCoding.ts:53-85`: `{ sessionId, workspaceId, message: string, mode?, preset?, caseId?, taskId?, expertExecution? }`. No attachment/blob field.

**Message → ModelMessage:**
- destructure `:406`
- `session.turn.started` payload includes the raw `message` — `:429-435`
- history fold + user turn assembly — `:460-463`:
  ```ts
  const history = expertExecution ? expertExecution.context
    : (await ctx.invoke("session.history", { sessionId, excludeRunId: ctx.runId })) as unknown as ModelMessage[];
  const messages: ModelMessage[] = [...history, { role: "user", content: message }];
  ```
- per-step dispatch — `:514-517` → `invokeModelGenerate` `:146-162`, which builds `request = { messages, tools, …instructions }` and `ctx.invoke("model.generate", request)`.
- `steer` and Expert-inbox messages are appended as additional `role:"user"` string messages — `:485`, `:503-506`.

**Injection point for an attachment:** the single line `src/agents/agentCoding.ts:463` is the only place the user turn enters model context (plus `:485`/`:503` for out-of-band messages). Because `ModelMessage.content` is `string` only (`node_modules/@godspeedai/cognate-capabilities/src/model.ts:7-14` — `readonly content: string`), an attachment cannot be carried structurally today: it must be (a) decoded to text and inlined at `:463`, or (b) surfaced to the model as a `tool` message via a read tool (tool-result path at `:503`/`messages.push({role:"tool",...})`). The `AgentCodingInput` shape at `:53-85` is where an `attachmentIds` field would be declared (and therefore also inside `run.input`, which `session.history` reads).

---

## 3. Model providers — non-text content cannot currently reach a provider

`src/components/providerRegistry.ts:20-33` — `buildProvider` mounts one of three adapters (`openAICompatible`, `openAIResponses`, `anthropicCompatible`) from `ModelConfig` (`:12-19`).
`src/components/modelProvider.ts:44-61` — `request` is handed to `provider.generate`/`provider.stream` **unmodified**; billing token estimate `estimateRequestTokens(request, tokenizer)` at `:74`.

### Every `multimodal_input` occurrence under `node_modules/@godspeedai`

| Location | Value | Note |
|---|---|---|
| `cognate-capabilities/src/model.ts:64` | declared in `ModelFeatures` | the only type-level definition |
| `cognate-provider-openai-compatible/src/index.ts:12` | optional override in options | |
| `cognate-provider-openai-compatible/src/index.ts:17` | `DEFAULT_FEATURES … multimodal_input: false` | |
| `cognate-provider-openai-compatible/README.md:1` | doc mention | |
| `cognate-provider-openai-responses/src/index.ts:58` | `multimodal_input: false` (hard-coded) | |
| `cognate-provider-anthropic-compatible/src/index.ts:58` | `multimodal_input: false` (hard-coded) | |
| `cognate-provider-local/src/index.ts:48` | `multimodal_input: false` | |
| `cognate-provider-local/README.md:1` | doc mention | |

**Adapter serialization (OBSERVED — all text-only):**
- OpenAI-compatible `toOpenAIMessage`: `{ role, content: message.content }` — `…/cognate-provider-openai-compatible/src/index.ts:19-26`
- OpenAI Responses `wireInput`: `{ role, content: message.content }` — `…/cognate-provider-openai-responses/src/index.ts:15-22`
- Anthropic `wire`: builds `{type:"text", text:m.content}` blocks only, plus `tool_use`/`tool_result` — `…/cognate-provider-anthropic-compatible/src/index.ts:21-28`

**Conclusion:** no provider adapter serializes non-string content; the declared capability flag is `false` on every mounted provider (openai-compatible's `:12` override is never set by `buildProvider`, `providerRegistry.ts:25`). Sending an image today requires either a feature-flag flip + adapter changes in `node_modules` (not app code) or encoding bytes as text inside `content`.

---

## 4. Durable storage primitives for bounded blobs

| Primitive | Location | Shape |
|---|---|---|
| Secret store | `src/secrets.ts:13-46` | JSON file `$HOME/secrets.json`, mode 0600; **write-only by policy**, "never placed in an event payload or a projection" (`:1-3`). Not suitable for attachments. |
| Store selection | `src/store.ts:18-24` | Postgres (`COGNATE_POSTGRES_URL`) or pg0-managed; schema derived from data dir (`:9-12`) |
| Content-addressed blob store | `node_modules/@godspeedai/cognate-events/src/types.ts:238-239` (`putBlob`/`getBlob`); table `cognate-store-postgres/src/schema.ts:99`, impl `src/index.ts:805-820` | dedup by hash, `Uint8Array` |
| `ArtifactService` | `node_modules/@godspeedai/cognate-artifacts/src/index.ts:67` (`put`), `137-150` (`get`), `152-162` (`list`), `165` (`delete`/tombstone) | `PutArtifact` `:31-44` (name, mediaType, bytes, `access{tenant,scopeId,readers[]}`, retention, runId, representations); `ReadResult` union incl. `tombstoned`/`lost` `:46-65`; **bytes committed before record+event** (`:69-72`, `artifact.created` `:110-130`) |
| Capability → artifact | `cognate-runtime-api/src/types.ts:48` (`ctx.artifact(ArtifactInput): Promise<string>`); impl `cognate-runtime-bun/src/executor.ts:274-296` (id `${runId}.artifact.${n}`, emits `run.artifact`) | run-scoped, replay-idempotent |
| Read path | `runtime-api/src/types.ts:241` `getArtifact` → `runtime-bun/src/service.ts:205-216` (denied/tombstoned collapse to `not_found`) → RPC `cognate-protocol-connect/src/index.ts:462-463` → client `cognate-client/src/index.ts:74,781-782` | |

**Yes — the app already uses the artifacts API:**
- `src/agents/agentExpert.ts:16` — `ctx.artifact({ name: 'expert-…json', mediaType:'application/json', bytes: new TextEncoder().encode(JSON.stringify({…})) })`
- `src/experts/service.ts:293-294` — validates handoff artifact ids belong to the run (`run.artifact` event + `getArtifact`)
- `src/experts/bridge.ts:71-79` — pushes receipt artifact ids into handoffs
- `src/ui/experts/ExpertsTeamsPanel.tsx:596-608` — `client.artifact(id)` → `URL.createObjectURL(new Blob([artifact.bytes as BlobPart], {type: artifact.mediaType}))` download
- React hook available but **unused by the composer**: `useArtifact` at `node_modules/@godspeedai/cognate-react/src/index.tsx:320-351`
- `src/agents/agentCoding.ts` itself never calls `ctx.artifact` (no artifact use in the coding path).

**On-disk locations the app writes today:** app home `.data` (default, `src/server.ts:850`), `secrets.json` (`:372-373`), `.generated/entry.tsx` bundle entry (`:761-764`), `tmpdir()` scratch for RealityTrace (`src/settlement/realitytrace.ts:88-95`) and cognitive forks (`src/capabilities/cognitive.ts:86,171,333`). **There is no uploads directory**, and `rg 'multipart|FormData|upload'` over `src/` and `test/` returns nothing. So a bounded binary attachment has one natural durable home — `ArtifactService` over the existing `blobs` table — reachable without new storage, but currently only writable from *inside* a run (`ctx.artifact`), i.e. not from the composer before a run starts.

---

## 5. Events read by the UI

`src/ui/App.tsx:4` — `import { useCognate, useContinuations, useProjection } from "@godspeedai/cognate-react";`

| Hook | Definition | Mechanism |
|---|---|---|
| `useProjection(name)` | `cognate-react/src/index.tsx:218-224` | `client.projection(name)` + `useSyncExternalStore` over the live fold |
| `useRun` / `useAgent` | `:160`, `:169` | run state / start |
| `useContinuations` | `:308` | approval/plan continuations |
| `useArtifact` | `:320-351` | one-shot `client.artifact` fetch (text-decodes `text/*`) |
| app-local `useStreamingTurn` | `App.tsx:2237` | `client.subscribe({runId}, …)` |
| app-local `useToolTimeline` | `App.tsx:2294-2303+` | `client.subscribe({runId}, …)` folding `tool.call.*` |

**Projection registration:** `src/server.ts:520-536` (`{ projection: X, public: true }` × 16, incl. `subagentsProjection` `:531`).
**Pure reducer pattern:** `src/projections/workbench.ts:10-20` — tenant-prefixes keys in, `state.get` lookups, returns `{key,value}[]`.
**The worked example (`subagents`)** — `src/projections/subagents.ts`:
- row type `:18-34`; correlation parser `:46-52`
- `apply(event, state)` keys rows `${event.tenant}/${parentRunId}/${toolCallId}` `:67`; spawn `:58-79`; completion from the *child's own* `message.completed` `:83-92`; failure `:93-100`
- consumed in UI by `useSubagents` at `src/ui/App.tsx:265-273` (`useProjection("subagents")` + memo filter by `sessionId`)
- also consumed server-side by `session.history` (`src/capabilities/sessionHistory.ts:33,56-62`)

An `attachments` projection would follow exactly this shape: `src/projections/attachments.ts` folding `attachment.*` events into `${tenant}/${sessionId}/${attachmentId}` rows, registered at `src/server.ts:520-536`, read via `useProjection("attachments")`.

---

## 6. Session history — `src/capabilities/sessionHistory.ts` (68 lines)

`session.history` capability `:23-28`; fold loop `:41-63`:
1. `service.listRuns(caller, { correlationId: 'session:'+sessionId })` — `:32`
2. `subagentRows` from the `subagents` projection — `:33`
3. per run: skip `excludeRunId` (`:42`), skip non-`agent.coding` (`:43`)
4. **user message**: `const runInput = run.input as { message?: string }; if (typeof runInput?.message === "string") messages.push({ role:"user", content: runInput.message })` — `:44-45`
5. **assistant message** (completed runs only): `run.output.text` + `stepCount` = count of `tool.call.started` in the run's events + 1 — `:46-54`
6. **synthetic user messages** for completed subagent children — `:56-62`

**Where an attachment reference must be re-materialized:** `:45`. This is the sole rehydration site for prior user turns into `ModelMessage[]`, and it reads only `run.input.message` (a string). A turn carrying `attachmentIds` on run input would need the fold at `:44-45` to look the ids up (e.g. via `service.getArtifact(caller, {artifactId})`, `runtime-api/src/types.ts:241`) and expand them into the message — again as text, since `ModelMessage.content` is `string` (`cognate-capabilities/src/model.ts:9`).

**Second, UI-side twin:** `openSession` at `src/ui/App.tsx:4901-4940` invokes `session.history` directly and maps rows into the transcript at `:4922-4938`, typing results as `{ role, content, stepCount? }` only. Any attachment display in a reopened conversation needs that type widened and a rendering branch added there too.

---

### Cross-cutting notes (INFERRED unless marked)

- **OBSERVED:** the only end-to-end path that can carry bytes today is `ctx.artifact` *inside a run* → `getArtifact` → `client.artifact`. The composer, `AgentCodingInput`, `ModelMessage`, and every provider adapter are string-only.
- **OBSERVED:** `src/server.ts:797` (64 MiB) is the only byte ceiling on the Connect path in this process; the 1 MiB `serveRuntime` limit is not applied (`cognate-protocol-connect-bun/src/index.ts:54`).
- **OBSERVED:** static routes (`:811-822`) are unauthenticated; the bearer token ships inside `/app.js` (`:764`), so any new attachment route must not rely on obscurity.
- **INFERRED:** a bounded attachment feature minimally touches five seams: a new authenticated route (or a new Connect RPC, which would require proto changes in `node_modules` and is therefore less likely), an `attachmentIds?` field on `AgentCodingInput` (`agentCoding.ts:53-85`), the message assembly at `agentCoding.ts:463`, the rehydration at `sessionHistory.ts:45`, and a `multimodal_input`/text-encoding decision in the provider layer (currently `false` everywhere).

---

## 7. Attachment feasibility verdict

**Question:** given `ModelMessage.content: string` (`node_modules/@godspeedai/cognate-capabilities/src/model.ts:9`) and all three adapters serializing `content` as a string (§3), is there any app-level seam where an image could reach a provider **without** modifying the framework package?

**Verdict: YES — with one hard constraint. The seam exists and is already used by this app, but the image must still ride inside the `content` string.** The type wall is on `ModelRequest`, not on the provider implementation.

### Why the seam exists (OBSERVED)

`ModelProvider` is a **plain interface the app implements**, not a class the framework owns:

```ts
// cognate-capabilities/src/model.ts:79-86
export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly features: ModelFeatures;
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
  stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelDelta>;
}
```

Nothing in that contract constrains **how** a `ModelRequest` becomes an HTTP body — that is entirely the implementor's business. The three shipped adapters happen to serialize `content` as a string (§3), but they are just three implementations. `src/components/modelProvider.ts` already demonstrates the wrapper pattern in app code: it takes an arbitrary `ModelProvider`, publishes its contract, and drives its own `stream` loop (`:44-61`) plus its own billing (`:62-97`).

Two app-level injection points already exist:

1. `src/components/providerRegistry.ts:20-33` — `buildProvider(config, secrets): ModelProvider`, called by `ProviderRegistry.swap` (`:54-69`), which mounts `streamingProviderComponent(...)` (`:56`).
2. `src/capabilities/expertModel.ts:33` — `providerFactory?: (route: ModelConfig, secrets: SecretStore) => ModelProvider`, the per-Expert route seam, with its own dispatch loop at `:118-140`.

A custom `Component` in `src/components/` that builds the wire body itself is therefore **fully supported by the existing app architecture**, no `node_modules` edits.

### The unavoidable constraint

The wrapper receives the image only via `ModelRequest.messages[].content`, which is `string`. So the app must adopt a **string carrier convention** — e.g. a marker such as `cognate-attachment:<artifactId>` or an inline `data:image/png;base64,…` — placed into the user message at `src/agents/agentCoding.ts:463`. The wrapper then parses `request.messages` before serializing and emits real multimodal blocks:

- OpenAI chat-completions shape: `{ type: "image_url", image_url: { url: "data:image/png;base64,…" } }`
- Anthropic messages shape: `{ type: "image", source: { type: "base64", media_type, data } }`

Bytes can be resolved two ways, both app-side: inline base64 already in the string (simplest, no store read), or an artifact id resolved via `service.getArtifact` / `ArtifactService.get` (`cognate-artifacts/src/index.ts:137-150`) inside the handler, which has `ctx.runId` / `ctx.tenant` available (`cognate-kernel-api/src/types.ts:91-99` extending `InvocationContext` `:49-63`).

### Can such a wrapper set `multimodal_input: true` honestly?

**Yes at the contract level, with one precise qualification.** `ModelFeatures.multimodal_input` (`model.ts:64`) is surfaced as a capability-contract *attribute* by `modelContract` (`:89-92`):

```ts
return { id: "model.generate", version: "1.0.0", attributes: { ...features, provider: provider.id, model: provider.model } };
```

So the flag advertises what the published `model.generate` capability accepts. Honest, iff both of these hold:

1. **The documented input convention is the string carrier.** `content: string` is still the only input channel; the flag must not be read as "`ModelMessage` accepts content blocks". It is honest as "this provider will interpret image references embedded in message text"; it would be dishonest as "this contract accepts structured multimodal parts", which the type forbids.
2. **The declared features match the wire.** `generate: true` and a real `stream` implementation are required (`features.generate: true` at `:60`), and the wrapper must emit the `ModelDelta` alphabet (`:50-56`) if it declares `stream: true`.

**Caveat worth stating explicitly (OBSERVED):** nothing in the runtime reads `multimodal_input` for eligibility. `rg 'multimodal'` over `cognate-capabilities/src` and `cognate-runtime-bun/src` returns only the declaration at `model.ts:64`; no consumer filters on it. The flag is currently inert metadata — setting it `true` gates nothing and breaks nothing, so it is a forward declaration rather than an enforced claim.

### Exact contract a replacement Component must satisfy

| Contract | Must match | Location |
|---|---|---|
| `ModelProvider` | `id`, `model`, `features: ModelFeatures`, `generate`, `stream` | `cognate-capabilities/src/model.ts:79-86` |
| `ModelFeatures` | `generate: true`, `stream`, `tool_use`, `structured_output`, `multimodal_input`, `context_limit` | `:59-66` |
| `ModelRequest` | `messages: readonly ModelMessage[]`, optional `instructions`, `tools`, `stream`, `responseFormat`, `maxTokens`, `temperature` | `:29-40` |
| `ModelMessage` | `role: "system"|"user"|"assistant"|"tool"`, **`content: string`**, optional `toolCallId`, `toolCalls` | `:7-14` |
| `ModelResponse` | `message{role:"assistant",content:string}`, `toolCalls`, one of the five `finishReason`s, optional `usage{inputTokens,outputTokens}`, `model` | `:42-48` |
| `ModelDelta` | `text`, `tool_call_start`, `tool_call_args`, `tool_call_end`, `tool_call`, `done` | `:50-56` |
| `CapabilityContract` | `id`, `version`, optional `attributes`, optional `semanticRef` | `cognate-kernel-api/src/types.ts:31-38` |
| Component shape | `{ id: 'model-provider:'+id, provides: [contract], activate(fiber) { fiber.provide(contract, handler) } }` | `src/components/modelProvider.ts:38-43` |
| `HandlerContext` | `actor`, `tenant?`, `correlationId`, `runId?`, `deadline?`, `signal?`, `progress?` | `cognate-kernel-api/src/types.ts:91-99` + `:49-63` |

### Two obligations a replacement wrapper must not quietly drop

1. **Billing.** The current wrapper reserves before dispatch and settles from reported usage (`src/components/modelProvider.ts:77-97`), keyed on the run's `sessionId` (`:66-68`) via `reserveModelCall`/`settleModelCall`. A custom provider component that skips this bypasses the spending ceiling and leaves `model.generate` invocations unbooked.
2. **Token accounting for images.** `estimateRequestTokens(request, tokenizer)` (`:74`) counts text only, so an inline base64 carrier is counted as a long string while the provider bills image tokens. The reservation would under-reserve relative to real cost — a correctness note, not a blocker. **INFERRED** from the code shape; not observed failing.

**Net answer:** an app-level `Component` can carry an image to a real multimodal provider today with zero framework edits, because `ModelProvider` is an interface the app implements and the wire body is the implementor's choice. `multimodal_input: true` is defensible on such a wrapper provided the app documents the string-carrier convention and does not claim structured content-block input, which `ModelMessage.content: string` (`model.ts:9`) categorically excludes.
