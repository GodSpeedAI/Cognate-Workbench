# components (Kernel Components and Provider/Plugin Registries)

## Overview

Kernel-level wiring between the Cognate kernel, model providers, and the plugin
catalog. [modelProvider.ts] publishes the `model.generate` capability as a
kernel `Component`, forwarding streamed text deltas via
`HandlerContext.progress` into `run.invocation.progress` events and (when
billing is wired) holding a durable reservation on the governed billing ledger
around every ordinary-session dispatch (J-CONTEXT-BUDGET). [providerRegistry.ts]
builds wire-protocol-specific providers from a persisted [providerRegistry.ts:ModelConfig]
and hot-swaps them on the kernel. [pluginRegistry.ts] resolves the plugin
catalog across multiple `PluginSource`s and performs the *verification* an
install implies — it never evaluates downloaded code.

## Interface

- [modelProvider.ts:streamingProviderComponent] — `(provider, semanticRef?, billing?) => Component` publishing the model contract; handler id `model-provider:<provider.id>`.
- [modelProvider.ts:ModelGenerateBilling] — billing wiring injected into the component: `getService`, `systemCaller`, `prices`, `protocol`.
- [providerRegistry.ts:ModelWireProtocol] — `"openai-compatible" | "openai-completions" | "openai-responses" | "anthropic-messages"` (legacy openai-compatible remains accepted for persisted configurations).
- [providerRegistry.ts:ModelConfig] — `{ providerId, baseURL, protocol, model, prices? }` (operator-declared USD-per-million-token price estimates).
- [providerRegistry.ts:buildProvider] — `(config, secrets) => ModelProvider`; resolves the API key lazily from the `SecretStore` and constructs the protocol-specific provider.
- [providerRegistry.ts:ProviderRegistry] — kernel mount owner: `get current()`, [providerRegistry.ts:ProviderRegistry.clear] (dismount + clear route), [providerRegistry.ts:ProviderRegistry.swap] (hot-swap with rollback).
- [pluginRegistry.ts:PluginSource] — source interface (`id`, `list()`); implement it to add a catalog without touching the registry.
- [pluginRegistry.ts:BuiltinPluginSource] — the shipped catalog source (id `"builtin"`, returns `PLUGIN_CATALOG`).
- [pluginRegistry.ts:PluginRegistry] — registry class: [pluginRegistry.ts:PluginRegistry.addSource], `get sourceIds`, [pluginRegistry.ts:PluginRegistry.catalog] (merged, first-source-wins), [pluginRegistry.ts:PluginRegistry.entry], [pluginRegistry.ts:PluginRegistry.activate], [pluginRegistry.ts:PluginRegistry.planInstall].
- [pluginRegistry.ts:ActivationOutcome] — `{ activated: true; via } | { activated: false; reason }`; [pluginRegistry.ts:InstallOutcome] — what an install actually did (UI shows `reason` verbatim when not activated).
- [pluginRegistry.ts:verifyImplementation] — proves a declared `PluginImplementation` (`core`, `settings-toggle`, `tool`, `none`) exists in this build.

## Invariants

- Streaming is preferred but conditional: when the provider lacks `stream` or the context has no `progress`, the component falls back to `provider.generate` ([modelProvider.ts:streamingProviderComponent]).
- Billing path applies only to ordinary coding sessions: a reservation is made only when a `sessionId` is present on the run input; otherwise the generate proceeds unbilled ([modelProvider.ts:streamingProviderComponent]).
- Reservation ids are deterministic per run and invocation index (`<runId>:session-model:<invocationIndex>` counted from recorded `run.invocation` events with capability `model.generate`).
- Settlement is from provider-reported usage when sane ([modelProvider.ts:reportedUsageOf] validates non-negative safe integers), otherwise conservative (estimated input tokens + reserved output tokens); a failed dispatch still settles conservatively, and settlement failure is swallowed so the provider error propagates.
- Output reserve defaults to [modelProvider.ts:DEFAULT_RESERVED_OUTPUT_TOKENS] (4096) when the request names no `maxTokens`.
- Hot-swap safety: if the replacement provider never reaches `ACTIVE` within 5000 ms, it is disposed and the previous provider stays mounted and usable — a hot-swap failure must not take the app down ([providerRegistry.ts:ProviderRegistry.swap]).
- [providerRegistry.ts:ProviderRegistry.clear] is idempotent; after it, a deleted provider can never answer a later generate call.
- [providerRegistry.ts:buildProvider] throws on an unsupported wire protocol.
- Plugin activation is verification, not theatre: a `tool` entry is activated only if the named tool really exists in `TOOL_DEFS`, a `settings-toggle` only if the key is in `TOGGLEABLE_PLUGINS` ([pluginRegistry.ts:verifyImplementation]); a lying catalog entry installs inert and says so.
- No downloaded code is ever evaluated — a source supplies descriptions only; only implementations this application already contains can be activated (trust boundary, file header of [pluginRegistry.ts:PluginRegistry]).
- Later plugin sources never override an earlier id ([pluginRegistry.ts:PluginRegistry.addSource] throws on duplicate source ids; [pluginRegistry.ts:PluginRegistry.catalog] is first-source-wins on duplicate entry ids).
- Core plugins cannot be installed or removed ([pluginRegistry.ts:PluginRegistry.planInstall]); installs of already-installed plugins are refused.
- [pluginRegistry.ts:PluginRegistry.planInstall] is pure with respect to durable state — it resolves what an install should record.

## Side Effects

- [modelProvider.ts:streamingProviderComponent] performs network calls to the model provider (`provider.generate` / `provider.stream`) inside the kernel handler, and forwards `ctx.progress` deltas into the durable `run.invocation.progress` channel.
- Billing path calls the RuntimeService: `service.getRun`, `service.events` (reads the run's recorded events), and the billing ledger via `reserveModelCall` / `settleModelCall` (durable reservation/settlement; from `src/experts/billing.ts`), plus `readSpendingCeilings` and `tokenizerForRoute`.
- [providerRegistry.ts:ProviderRegistry.swap] and [providerRegistry.ts:ProviderRegistry.clear] mount/dispose kernel components (`kernel.mount`, `handle.waitFor("ACTIVE")`, `handle.dispose`).
- [providerRegistry.ts:buildProvider] reads API keys lazily from the `SecretStore` (`secrets.get("model-provider:<providerId>")`) at call time.
- [pluginRegistry.ts:PluginRegistry] performs no durable side effects — catalog merge and activation verification are in-memory.

## Verification

- Run (from repo root): `bun test test`
- Covered by, among others: `test/providerRegistry.test.ts` (verified present under `test/`, covers `providerRegistry.ts`), `test/J-CFG-model-provider.test.ts`, `test/J-CFG-provider-delete.test.ts`, `test/J-PLG-install.test.ts`, and `test/J-CONTEXT-BUDGET-billing.test.ts` (all verified present under `test/`).
