# R5: Model provider recon (PandaCode vs Cognate Workbench)

Recon only. No source files were modified. Evidence labels: **seen** (file:line read or command output), **inferred**, **unknown**.

## Summary

- PandaCode's "providers" are mostly agent harnesses (CLI or ACP servers that hold their own sign-in), plus a few API-key plans that run through Claude Code. Only four PandaCode paths are raw HTTP with a PandaCode-held key: GLM Coding Plan, MiMo Token Plan, DeepSeek and Command Code (the last two are optional-key ACP), and the Jev decision/text models (TypeSafe, OpenRouter, or any OpenAI-compatible base URL).
- Cognate Workbench's SDK speaks three wire protocols over HTTP: OpenAI Chat Completions (also llama.cpp, vLLM, Ollama `/v1`), OpenAI Responses, and Anthropic Messages. The app exposes all three in the UI through `PROVIDER_CATALOG`. No OAuth or subscription sign-in is implemented anywhere.
- Cognate runs exactly one live model route at a time (`ProviderRegistry.#current`). Durable `provider-routes` rows can hold several configured providers, and per-expert routes resolve their own key by `providerId`, so the UI can pick among them.
- Biggest UX gap: `model.configure` always overwrites the stored key (see 3.4). Switching model or endpoint forces the key to be re-entered.
- Found a bug: the Anthropic preset's "Fetch models" hits `/v1/v1/models` (verified by running `catalogRequest`, see 3.5).
- Largest parity gap: PandaCode's harness list (Claude Code, Codex, Kimi, OpenCode, Pi, Cline, Copilot CLI, and others) cannot be expressed as a Cognate provider. That needs a new kind of "agent backend" capability, not a provider preset.

---

## 1. PandaCode: every provider and agent backend

Source: `/home/sprime01/projects/cognate-workbench/.tmp/donor/pandacode`. `ProviderId` union (`src/types.ts:1`) has 17 ids. The Providers panel (`src/provider-settings.ts`) shows 15 cards. Codex and Kimi have no card, only installed-agent rows in Settings > Agents.

### 1.1 Raw HTTP providers that PandaCode keys (API-key or plan)

| id | Display | Kind | Protocol / base URL | Auth + key storage | Model list | Test / UX |
|---|---|---|---|---|---|---|
| glm | GLM Coding Plan (via Claude Code) | Plan key, relayed through the `claude` CLI | Anthropic Messages: `https://api.z.ai/api/anthropic` (`src-tauri/src/providers/glm.rs:6`). Claude Code is spawned with `ANTHROPIC_BASE_URL` overrides (`glm.rs:149`). | Z.ai key saved in the OS secret store (`app.pandacode.providers`, account `zai-coding-plan`). Env fallback `ZAI_API_KEY` (`provider_settings.rs:42`). | Static list: `glm-5.3`, `glm-5.3-flash`, `glm-5-turbo`, plus `[1m]` variants (`glm.rs:91`). | Save key, Remove saved key, status line "Key saved in secure system storage" or "Using ZAI_API_KEY from your environment". No live test. |
| mimo | MiMo Token Plan (Xiaomi, via Claude Code) | Plan key via Claude Code | Anthropic Messages, per-cluster: `token-plan-cn`, `token-plan-sgp`, `token-plan-ams`, `api` (pay-as-you-go). URLs at `providers/mimo.rs:14-17`. | Key in OS store (`mimo-token-plan`). Env `MIMO_API_KEY`. Cluster choice persisted as `mimoEndpoint`; unknown ids dropped (`provider_settings.rs:869`). | Static: `mimo-v2.6-pro`, `-flash`, `v2.5-pro`, `v2.5`, plus `[1m]` (`mimo.rs:112`). | Endpoint select is required before tasks can start. Hint shows the chosen URL. Key format hint `tp-`, `ttp-`, `sk-`. |
| deepseek | DeepSeek (DeepSeek Harness, via ACP) | Agent CLI `dsh --profile acp`, key optional | ACP over stdio (`providers/acp.rs:33`, `providers/deepseek.rs`) | Optional key in OS store (`deepseek-api`), env `DEEPSEEK_API_KEY`. DeepSeek can also use its own stored credentials. | Discovered from ACP `session/new` metadata, cached (`acp_catalog.rs`). | Install with `npm i -g @deepseek-ai/dsh`. Key optional. |
| commandcode | Command Code (via ACP) | Agent CLI `command-code acp`, key optional | ACP (`commandcode.rs:8`) | Optional key (`command-code-api`), env `COMMAND_CODE_API_KEY`. | ACP-discovered, cached. | Install `npm i -g command-code`, then `command-code login`. |

### 1.2 Claude Code (Anthropic) connection modes

- Card "Claude Code" (`provider-settings.ts`). Select: **Use current environment** (`inherit`, default) or **Prefer saved Claude login** (`subscription`).
- `subscription` removes inherited overrides from new Claude processes only: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, Bedrock/Vertex/Foundry toggles, `CLAUDE_CODE_OAUTH_TOKEN`, model overrides (`providers/claude_auth.rs:19-31`, `apply_mode` at :40).
- "Check login" calls `provider_claude_status`. It reports the source (for example "Environment API key"), env names only (never values), endpoint origin, and the saved-login state: `signedIn`, `notSignedIn`, `otherCredentials`, `unknown`. Copy such as "Saved login not found. Run claude auth login, then check again."
- Models: `claude -p --input-format stream-json` discovery (`providers.rs:925`). Static aliases otherwise (`model-catalog.ts`: Sonnet, Opus, Haiku, "Version resolved by Claude Code").
- The actual Anthropic sign-in is done by the Claude CLI (`claude auth login`). PandaCode never holds an OAuth token itself.

### 1.3 Sign-in through an agent CLI (no PandaCode key)

Each card has an install link, a sign-in instruction, and an "Executable location" disclosure (`pathForm`) with a path field, folder picker and Apply.

| id | Display | Launch | Sign-in | Models |
|---|---|---|---|---|
| claude | Claude Code | `claude -p --input-format stream-json --output-format stream-json ...` (`providers.rs:2740`) | `claude auth login` or env (see 1.2) | discovered |
| codex | Codex | `codex app-server --enable goals` (`providers.rs:2701`) | Codex CLI | `codex app-server` model/list (`providers.rs:991`) |
| kimi | Kimi Code | `kimi --model M acp` (`providers.rs:2707`) | Kimi CLI | `kimi provider list --json` (`providers/kimi_models.rs:117`) |
| opencode | OpenCode | `opencode acp` + `OPENCODE_CONFIG_CONTENT` (`acp.rs:52`) | `opencode auth login` | `opencode models --verbose`, fallback plain (`extra_models.rs:87`). UI lets you pick which models show in the picker (`opencode-model-settings.ts`). |
| antigravity | Antigravity | ACP server (official Google `agy_acp_server`, not the `agy` CLI) | Google | ACP-discovered |
| grok | Grok Build (xAI) | `grok --no-auto-update --permission-mode M agent stdio` (`acp.rs:57`) | `grok login` | ACP-discovered |
| pi | Pi | `pi --mode rpc` (`pi.rs:38`) | Pi CLI, `--provider`/`--model` | RPC `get_available_models` (`pi.rs:112`) |
| omp | Oh My Pi | same RPC, `omp` binary (`pi.rs`) | `omp` CLI | same |
| cline | Cline | `cline --acp` (`cline.rs:18`) | `cline auth` or `CLINE_API_KEY` | ACP |
| kilo | Kilo Code | `kilo acp` (`kilo.rs:32`) | `kilo auth login` | ACP |
| github-copilot | GitHub Copilot CLI | `copilot --no-auto-update --acp --stdio` (`acp.rs:69`) | `copilot login` | Advertised list only (`model-catalog.ts`: `advertisedModelsOnly`) |
| devin | Devin CLI (Cognition) | `devin acp` (`devin.rs:33`) | `devin auth login` | Advertised list only |
| muse | Muse Code (Meta) | `muse serve --no-session-log`, `MUSE_LOGIN=0` (`muse.rs:124`) | `muse login` | `muse serve` catalog |

### 1.4 Jev (decision and text models; separate from agents)

- Decision provider: **TypeSafe** (default, built-in model `jev-1.13.0`, key) or **OpenRouter** (key, model list fetched from `openrouter.ai/api/v1/models` only when the menu opens; `src-tauri/src/jev_decisions/models.rs:6`).
- Text model: a free-form **OpenAI-compatible base URL** (default `https://openrouter.ai/api/v1`, model `inception/mercury-2.5`), its own key (`src-tauri/src/jev.rs:58-59`, `src/jev.ts:161-171`). This is a real BYO-OpenAI-compatible surface in PandaCode.
- Keys in the secret store (`secret_store`). Labels in the UI: "TypeSafe API key", "OpenRouter API key", "Text model API key".

### 1.5 Installed-agent management

- Settings > Agents lists installed agents with a status pill and a default-agent picker plus default-model picker. Install channels are in `src-tauri/src/agent_updates_install.rs` (npm, curl installers, cask). "Check updates" and "Refresh agents" buttons.
- Named connections (`connections.ts`, "Add connection"): extra setups of one harness with its own executable, arguments, environment variables and config folder (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and so on, `connections.ts:14`).

### 1.6 Model picker UX (`src/model-picker.ts`, 463 lines)

- Popover titled "Harness and model", search box "Search harnesses and models…".
- Grouped by harness with logos. Each option shows name and a description. "Default" means "Uses the model selected by your harness". Custom IDs are accepted: `Use "<id>" with <group>`.
- Reasoning-effort slider where the harness has one.
- Agent teams group at the top.
- Catalog errors are shown per provider. There is no "test connection" button anywhere in the provider panel.

### 1.7 Screenshots checked

- `38-settings-providers.png`: Providers page. Connections card with "Add connection"; Claude Code with "Claude connection" select and "Check login"; GLM with "Z.ai API key" and "Save key"; MiMo with Endpoint select (red "Required before MiMo tasks can start").
- `46-settings-providers-first-card-expanded.png`: OpenCode and Antigravity cards, with "Executable location" disclosure.
- `17-model-picker-open.png`: picker grouped as Claude Code, Codex, Kimi Code, OpenCode; search box; context-size hints ("200K context").
- `37-settings-agents.png`: Default agent and Default model rows, Agent updates with "Check updates", "Project checks after turns" toggle, Installed agents list with Installed / Not installed pills.
- `47-settings-agents-default-agent-menu.png`: default-agent dropdown listing Claude Code, Codex, Kimi, OpenCode, GLM Coding Plan, Antigravity, Grok Build, MiMo Token Plan, Pi, DeepSeek, Command Code, Cline, Kilo Code, Oh My Pi, GitHub Copilot CLI. So GLM and MiMo appear as selectable agents.

### 1.8 Storage

- Keys: OS secure store via `keyring` (service `app.pandacode.providers`). Locked or unavailable store falls back to env vars, with the error text shown (`provider_settings.rs:183`).
- Nothing is sent to a PandaCode server. Browser preview shows "keys are never saved here".

---

## 2. Cognate Workbench: what the SDK and server can run

### 2.1 SDK packages (`node_modules/@godspeedai`, all 0.8.0)

| Package | What it does (seen) |
|---|---|
| `cognate-provider-openai-compatible` | `openAICompatible({id, baseURL, model, apiKey?, features?})`. POSTs `${baseURL}/chat/completions` with `Authorization: Bearer` when `apiKey` is set. Streaming, tools, JSON output. README: works with llama.cpp, vLLM, Ollama `/v1`. Its limitation section says feature flags must match the server. |
| `cognate-provider-openai-responses` | `openAIResponses({id, baseURL, model, credentials, subscription?})`. POSTs `${baseURL}/responses`, `store:false`, tool calls. Credentials come from a `CredentialSource`. Has an optional `subscription` grant (`assertSubscriptionUse`) that requires scope `chatgpt.tokens.use.direct` and an automation approval. |
| `cognate-provider-anthropic-compatible` | `anthropicCompatible({id, baseURL, model, credentials, anthropicVersion?})`. POSTs `${baseURL}/messages`, `anthropic-version: 2023-06-01`, tools with `input_schema`, streaming ending on `message_stop`. Rejects `responseFormat` (JSON schema not implemented). README: "Configure baseURL including version prefix". |
| `cognate-provider-auth` | `CredentialSource` interface; `apiKeySource(fn, "authorization" | "x-api-key")`; `bearerSource`; `credentialHeaders`; `assertSubscriptionUse`. README says explicitly: "**Not an OAuth sign-in implementation.** Secure SIWC dynamic client registration, PKCE, OIDC validation, encrypted-at-rest/token-refresh storage and account UX remain a separate gated workstream." |
| `cognate-provider-wire` | `sendJson`, `readSSE`, `httpError`, `requestSignal`. Shared transport. |
| `cognate-provider-local` | Deterministic offline provider for tests and demos. Not imported by the app. |

Not installed: `@godspeedai/cognate-provider-openai-oauth`. It appears in `docs/sdk-0.5.0-publication-receipt.json` (v0.5.0), but not in `node_modules` or `bun.lock`. A copy exists only under `.tmp/consumer-proof-050-…` and the bun cache (`0.2.0`). **Unknown** whether 0.8.0 ships it. Not wired.

Auth modes in the SDK, summarized: API key (Bearer or `x-api-key`), custom header via `CredentialSource`, no-key (Ollama/local, but see 3.6 for side effects), and a policy gate for ChatGPT plan use with no token acquisition. No device flow, no PKCE, no Azure AD / `api-version` query, no AWS SigV4, no Vertex.

### 2.2 App wiring

- `src/components/providerRegistry.ts:20-33` `buildProvider(config, secrets)`:
  - `openai-compatible` and `openai-completions` → `openAICompatible({ apiKey: key })`
  - `openai-responses` → `openAIResponses({ credentials: apiKeySource(key) })`
  - `anthropic-messages` → `anthropicCompatible({ credentials: apiKeySource(key, "x-api-key") })`
  - `key` reads `secrets.get("model-provider:" + providerId)`.
- `ProviderRegistry.swap()` mounts a new `model.generate` component, waits for ACTIVE (5 s), disposes the old one. One live route: `#current`.
- `src/capabilities/modelConfigure.ts` (`model.configure`): validates the protocol, writes the secret, swaps, then records a `model.configured` event via an agent run (`agents/agentConfig.ts:51`). Non-secret fields only are durable.
- `src/capabilities/providerManage.ts`:
  - `provider.delete` only deletes the **current** provider (secret, then dismount, then `provider.deleted` event). "This build holds exactly one live configuration."
  - `model.catalog` does `GET` on `catalogRequest(protocol, baseURL)` with the typed key or the stored key (stored key only to its saved target, `storedKeyTarget`). Returns `{ok, models}` or a reason string. 15 s timeout. Never saves anything.
- `src/modelCatalog.ts`:
  - Discovery paths: `/models` for all OpenAI variants (Bearer); `/v1/models` for `anthropic-messages` (`x-api-key`, scheme none).
- `src/secrets.ts` (264 lines): stores secrets in the OS keychain (`keychain`, `credential-manager`, `secret-service`); falls back to `secrets.json` mode 0600 with a reason. Service name "Cognate Workbench". **Seen, current file.**
- Boot restore: `server.ts:662` reads the `model-config` projection `current` row and re-mounts it, so the last provider survives restarts.
- Expert routes: `src/experts/service.ts:52-56` store `{providerId, model, baseURL, protocol}` only. `capabilities/expertModel.ts` builds a provider per route using `buildProvider`, so a route resolves its own secret by `providerId`. `ExpertEditor.tsx:56-78` lets an expert pick "Use Workbench default" or any configured route (`provider-routes` projection, `ExpertsTeamsPanel.tsx:43`).
- Projections: `src/projections/providerRoutes.ts` keeps one row per `providerId` (upsert on `model.configured`, delete on `provider.deleted`). So several providers can be configured as rows.

### 2.3 UI

- `src/ui/models/providerCatalog.ts` (76 lines): `API_PROTOCOL_OPTIONS` = OpenAI Chat Completions, OpenAI Responses, Anthropic Messages. `PROVIDER_CATALOG` (the list given in the coordinator message):

| id | Label | Protocol | Base URL | Auth | Key hint / docs |
|---|---|---|---|---|---|
| openai | OpenAI | Responses | `https://api.openai.com/v1` | apiKey | `sk-`; platform.openai.com/api-keys; defaults `gpt-4.1` |
| anthropic | Anthropic | Messages | `https://api.anthropic.com/v1` | apiKey | `sk-ant-`; console.anthropic.com/settings/keys; defaults `claude-sonnet-4-5` |
| openrouter | OpenRouter | Chat Completions | `https://openrouter.ai/api/v1` | apiKey | `sk-or-`; openrouter.ai/keys |
| groq | Groq | Chat Completions | `https://api.groq.com/openai/v1` | apiKey | `gsk_`; console.groq.com/keys |
| mistral | Mistral | Chat Completions | `https://api.mistral.ai/v1` | apiKey | console.mistral.ai/api-keys |
| together | Together AI | Chat Completions | `https://api.together.xyz/v1` | apiKey | api.together.xyz/settings/api-keys |
| fireworks | Fireworks AI | Chat Completions | `https://api.fireworks.ai/inference/v1` | apiKey | fireworks.ai/account/api-keys |
| azure-openai | Azure OpenAI | Chat Completions | `https://your-resource.openai.azure.com/openai/deployments/your-deployment` | apiKey | placeholder URL; `api-key` header not sent (Bearer only), see 3.7 |
| ollama | Ollama | Chat Completions | `http://127.0.0.1:11434/v1` | none | local |
| lm-studio | LM Studio | Chat Completions | `http://127.0.0.1:1234/v1` | none | local |
| custom | Custom OpenAI-compatible | Chat Completions | (empty) | apiKey | any |

- `ProviderAuthKind` = `"apiKey" | "none" | "oauth"`. **No preset uses `oauth`**, and nothing reads it.
- `src/ui/models/ProviderWizard.tsx` (433 lines). Fields: Display name, Provider ID (lowercase, `PROVIDER_ID_PATTERN`), Base URL, API protocol (select), API key (with show toggle, hint from preset), Model (free text plus "Fetch models" listbox, up to 200 results), Save provider. Hints: "Re-enter the key to save changes; it is stored on this computer, never in the event log." Save calls `client.invoke("model.configure", ...)` and toasts "Model provider saved".
- `src/ui/models/ModelPicker.tsx` (161 lines): button shows current model. Popover lists other models from `model.catalog`. Choosing a different model opens the provider form. Note text: "Choosing another model reopens the provider form, because the key must be re-entered." Empty state: "No model provider is connected yet."
- `src/ui/onboarding/FirstRun.tsx` reuses the wizard.
- Expert route select: "Configured provider" with "Use Workbench default (provider · model)" and one option per configured route; "manual" option for a custom route.

### 2.4 Protocols and features: what runs today vs what is exposed

| Capability | Runs server-side | Exposed in UI |
|---|---|---|
| OpenAI Chat Completions (`openai-compatible`, `openai-completions`) | Yes | Yes (preset + Custom) |
| OpenAI Responses (`openai-responses`) | Yes (`store:false`) | Yes (OpenAI preset only) |
| Anthropic Messages (`anthropic-messages`) | Yes (`x-api-key`) | Yes (Anthropic preset + Custom) |
| API-key auth (Bearer, `x-api-key`) | Yes | Yes |
| No-key local servers | Yes for Chat Completions; **not** for Responses and Anthropic (see 3.6) | Yes (Ollama, LM Studio) but only works for Chat Completions |
| Model discovery (`/models`, `/v1/models`) | Yes | Yes (Fetch models), but Anthropic preset is broken (3.5) |
| Streaming and tool use | Yes, all three | Implicit (agent runs) |
| Structured output (JSON schema) | Chat Completions only; Anthropic rejects it | Not exposed |
| Multimodal input | Off in all three adapters (`multimodal_input: false`) | No |
| Subscription / OAuth sign-in (ChatGPT, Claude, Copilot) | **No** (only a policy gate, no token flow) | No (`oauth` auth kind exists but unused) |
| Azure OpenAI `api-key` header and `api-version` | **No** (Bearer only, no query param) | Preset present but will not auth correctly unless the server accepts Bearer |
| Bedrock, Vertex, SigV4 | No | No |
| Multiple simultaneously live providers | No (one `#current` route) | Partially: expert routes can use different configured providers |

### 2.5 What "switching model" costs today

- `model.configure` always writes `secrets.put("model-provider:<id>", input.apiKey ?? "")` (`modelConfigure.ts:43`). Empty string overwrites the saved key. So a model-only change must re-send the key. This matches the ModelPicker note.
- `provider.delete` removes only the current provider's secret. Switching to a different `providerId` leaves the old secret and old `provider-routes` row, so keys accumulate with no UI to remove them.

---

## 3. Gaps and findings

### 3.1 Harness-based providers have no equivalent in Cognate
PandaCode's Claude Code, Codex, Kimi, OpenCode, Pi, Cline, Copilot CLI, Devin, Kilo, Muse, Grok, Antigravity and DeepSeek agents are each a local process with its own session, tools and sign-in. Cognate's `model.generate` is a stateless HTTP call. Matching these requires a new capability kind (an "agent backend" with launch, session, permission and event mapping), not a provider preset. Cognate already has an agent layer (`agents/agentConfig.ts`, four agents), but none wraps an external CLI. **Not feasible as UI-only.**

### 3.2 GLM and MiMo can be emulated with the Anthropic preset, with caveats
Both speak Anthropic Messages at `https://api.z.ai/api/anthropic` and `https://token-plan-*.xiaomimimo.com/anthropic`. In Cognate you could add them as Anthropic-protocol custom providers. Caveats:
- Path: the adapter appends `/messages` to `baseURL`, so `baseURL` must end in `/v1` for Z.ai and MiMo (their Claude Code configs add `/v1/messages`). **Inferred**; verify against Z.ai/MiMo docs.
- Cluster selection for MiMo needs a dropdown of the four endpoints, which the catalog lacks.
- Model ids: GLM and MiMo ids above.
- No Claude Code, so none of PandaCode's agent behaviour, only raw chat.

### 3.3 Missing from Cognate's catalog relative to PandaCode's raw-HTTP providers
- Z.ai GLM Coding Plan (Anthropic-compatible; see 3.2).
- Xiaomi MiMo Token Plan (Anthropic-compatible; four clusters).
- DeepSeek API (`https://api.deepseek.com`; OpenAI-compatible and Anthropic-compatible endpoints are documented by DeepSeek. **Unknown** which DeepSeek accepts from this app without verification). PandaCode uses DeepSeek only via its harness.
- Command Code: harness only in PandaCode; no HTTP endpoint identified in source. **Unknown**.
- OpenRouter is in both. Jev's OpenRouter path is the same provider.

### 3.4 Key re-entry on every save (coordinator concern: confirmed)
- `modelConfigure.ts:43` writes whatever `apiKey` is sent, including `""`. There is no "keep stored secret" path.
- ModelPicker and ProviderWizard both require re-entry (`ModelPicker.tsx:151`).
- **Capability change (small, server-only):** make `apiKey` optional in `model.configure`. If absent or empty, do not call `secrets.put`; keep the existing `model-provider:<id>` value. `secrets.delete` only on explicit removal. Update the wizard so a blank key field keeps the stored one (the hint "Stored on this computer" already exists). Also add a `provider.setKey` or `secret.delete` path (`secret.put` exists, `secretPut.ts`) so keys can be cleared without a model change.
- The same guard belongs in `providerManage.ts:61` (`model.catalog`): it already uses a stored key when none is typed, so no change needed there.

### 3.5 BUG: Anthropic preset model discovery hits `/v1/v1/models`
- Verified by running `catalogRequest` from `src/modelCatalog.ts`:
  - `https://api.anthropic.com/v1` → `https://api.anthropic.com/v1/v1/models` (wrong)
  - `https://api.anthropic.com` → `https://api.anthropic.com/v1/models` (correct)
  - `https://api.z.ai/api/anthropic/v1` → `…/v1/v1/models` (wrong)
- Cause: `anthropic-messages` discovery appends `/v1/models` to the base URL, but `anthropicCompatible` and the Anthropic preset (`providerCatalog.ts:44`, `https://api.anthropic.com/v1`) treat the base URL as including `/v1`. The unit test (`test/workbench-model-catalog.test.ts:26`) and the J-CFG test (`test/J-CFG-model-catalog.test.ts:73`) use an origin-only base, so they pass while the preset fails.
- Fix (small): choose one convention. Either strip a trailing `/v1` before appending in `catalogRequest`, or append `/models` when the base already ends in `/v1`. Add a test with the preset's exact base URL.

### 3.6 Keyless local servers break Responses and Anthropic adapters, and Chat sends an empty Bearer
- `apiKeySource` throws `Credential unavailable` on an empty key (`cognate-provider-auth/src/index.ts`). So an Anthropic-protocol or Responses-protocol route with "No API key" cannot run, even if the local server needs none.
- `openAICompatible` sends `authorization: Bearer ` whenever `apiKey` is a function, even when it returns `""` (`openai-compatible/src/index.ts:46`). Harmless to Ollama and LM Studio in practice, but strict gateways may reject it. **Inferred**.
- Fix: in `buildProvider`, pass `apiKey` only when the key is non-empty, and use an unauthenticated source for keyless routes.

### 3.7 Azure OpenAI preset will not authenticate
- Azure expects `api-key:` header and `?api-version=`. The SDK sends `Authorization: Bearer` and no query. The preset is listed (`providerCatalog.ts`) but would fail. **Inferred from SDK source**; test against a real resource.
- Fix: a header-name option in `apiKeySource` (it already has `"x-api-key"`; add `"api-key"`) and a query-param option on the chat adapter, or a dedicated Azure adapter. Capability change.

### 3.8 No OAuth or subscription sign-in
- SDK auth README: OAuth/PKCE/token storage is an unbuilt workstream. The one subscription gate (`assertSubscriptionUse`) needs an externally obtained token with scope `chatgpt.tokens.use.direct`.
- To expose ChatGPT or Claude subscription sign-in: implement the OAuth client (PKCE, redirect/loopback, refresh, encrypted storage) as a `CredentialSource`, plus a UI flow. Note the `openai-responses` adapter already accepts a `CredentialSource` and the `subscription` gate, so the adapter side is ready. The missing parts are the OAuth client, token refresh, and an approved OpenAI client registration. **Not feasible without vendor approval** for ChatGPT subscriptions; the policy text in `assertSubscriptionUse` also says unattended use requires explicit approval. Anthropic subscription OAuth, and GitHub Copilot, have no documented third-party flow in the sources here. **Unknown**.
- PandaCode's equivalent is "let the CLI own the sign-in", which Cognate cannot copy without the agent-backend work in 3.1.

### 3.9 Multiple providers at once
- Runtime: one live `model.generate` (`ProviderRegistry.#current`). Hot-swap replaces it.
- Durable: `provider-routes` holds one row per `providerId`, and `model.configure` can add more. Experts pick a route, and the route's key is resolved per request. So "several configured, one active by default, per-expert override" already works, but only one default is shown in the Settings UI.
- Missing: a list UI for configured providers, a way to set the default, delete for non-current providers, and cleanup of orphaned `model-provider:*` secrets when a route is removed.
- Capability change: `provider.delete` should accept any `providerId` and remove its secret and projection row. Add `provider.list` (or read `provider-routes`) for the UI.

### 3.10 Other gaps noted
- No "Test connection" action. Fetch models is the closest, and it runs only for protocols that have a discovery path.
- No reasoning-effort, context-window or per-model pricing controls in the wizard beyond optional `prices` in the event (`modelConfigure.ts:24`).
- `ProviderAuthKind` includes `"oauth"` but nothing uses it. Either remove it or implement it with 3.8.

---

## 4. Gap table

Status key: **SE** = supported and exposed; **SN** = supported but not exposed; **NS** = needs server work; **NF** = not feasible as stated.

| PandaCode provider or feature | Cognate status | Recommended implementation | File refs |
|---|---|---|---|
| Anthropic (API key) | SE, but preset discovery broken | Fix `catalogRequest` base-URL convention (UI-tested) | `src/modelCatalog.ts`, `src/ui/models/providerCatalog.ts:44`, `test/workbench-model-catalog.test.ts:26` |
| OpenAI (API key) | SE | None | `providerCatalog.ts:43` |
| OpenRouter (API key) | SE | None | `providerCatalog.ts` |
| Z.ai GLM Coding Plan (Anthropic-compatible) | SN (wire works, no preset) | UI-only preset: Anthropic protocol, `https://api.z.ai/api/anthropic/v1` (verify), default `glm-5.3` | `providerCatalog.ts` |
| MiMo Token Plan (Anthropic-compatible) | SN | UI-only preset with four cluster options as a select that fills `baseURL`; default `mimo-v2.6-pro` | `providerCatalog.ts`, new cluster field in `ProviderWizard.tsx` |
| DeepSeek (API key) | SN, but endpoint **unknown** here | UI-only preset after verifying DeepSeek's documented endpoint | `providerCatalog.ts` |
| Command Code | NF in Cognate (harness only; no HTTP endpoint found) | Covered by the agent-backend work (3.1) | n/a |
| Ollama, LM Studio (local) | SE for Chat, but Responses and Anthropic routes cannot run keyless | NS: keyless credential path in `buildProvider` (3.6) | `src/components/providerRegistry.ts:20`, `cognate-provider-auth` |
| Custom OpenAI-compatible | SE | None | `providerCatalog.ts` |
| Azure OpenAI | SN, probably broken auth | NS: `api-key` header and `api-version` query (3.7) | `cognate-provider-auth`, `cognate-provider-openai-compatible` |
| Groq, Mistral, Together, Fireworks | SE (Chat Completions) | None | `providerCatalog.ts` |
| Claude Code (CLI, env or subscription login) | NF as a provider; closest analogue is Anthropic API key | Agent-backend capability (3.1). A UI-only substitute: Anthropic preset plus a note "Use your Anthropic API key" | new capability; `src/agents/agentConfig.ts` |
| Codex, Kimi, OpenCode, Pi, Cline, Kilo, Grok, Antigravity, Copilot CLI, Devin, Muse, Oh My Pi | NF in current architecture | Agent-backend capability: spawn process, ACP or RPC client, sign-in delegated to CLI, executable path setting | new capability |
| GitHub Copilot, ChatGPT or Claude subscription sign-in (OAuth) | NS plus vendor-dependent | OAuth client with PKCE and refresh as a `CredentialSource`; UI flow; approvals (3.8) | `cognate-provider-auth` (`apiKeySource`, `assertSubscriptionUse`), `openai-responses` `subscription` option |
| Saved key reuse on model change | NS | Make `apiKey` optional in `model.configure`; keep stored secret (3.4) | `src/capabilities/modelConfigure.ts:43`, `src/ui/models/ProviderWizard.tsx`, `ModelPicker.tsx:151` |
| Several configured providers, pick default | SN partly (durable routes exist; no list UI or default setter) | Add `provider.list` and default-selection capability; list UI in Settings > Models | `src/projections/providerRoutes.ts`, `src/capabilities/providerManage.ts`, `ExpertsTeamsPanel.tsx` |
| Per-provider delete (not only current) | NS | Let `provider.delete` remove any `providerId` and its secret and row (3.9) | `src/capabilities/providerManage.ts:52-62` |
| Test connection | SN partly (Fetch models) | UI button calling `model.catalog`; add a generic "Test" that sends a 1-token request (NS for non-discoverable protocols) | `providerManage.ts`, `ProviderWizard.tsx` |
| Jev-style separate decision model (TypeSafe, OpenRouter) | Not applicable (no Jev) | Out of scope unless Cognate adds that feature | n/a |
| OS keychain key storage | SE (`src/secrets.ts`, new) | None | `src/secrets.ts` |
| Executable path and install checks for agents | NF until agent-backend exists | Part of 3.1 | n/a |

---

## 5. Recommended unified provider catalog

Union of Cognate's `PROVIDER_CATALOG` and PandaCode's raw-HTTP providers. Harness agents are listed separately because they cannot be presets. Default models are suggestions; the UI should keep "type any model ID" and "Fetch models".

| id | Label | Protocol (wire) | Base URL | Auth kind | Key hint and docs | Suggested models | Status |
|---|---|---|---|---|---|---|---|
| openai | OpenAI | `openai-responses` | `https://api.openai.com/v1` | apiKey | `sk-`; platform.openai.com/api-keys | `gpt-4.1` | Exists |
| anthropic | Anthropic | `anthropic-messages` | `https://api.anthropic.com/v1` | apiKey | `sk-ant-`; console.anthropic.com/settings/keys | `claude-sonnet-4-5` | Exists; fix discovery |
| openrouter | OpenRouter | `openai-completions` | `https://openrouter.ai/api/v1` | apiKey | `sk-or-`; openrouter.ai/keys | (fetch) | Exists |
| zai-glm-coding | Z.ai GLM Coding Plan | `anthropic-messages` | `https://api.z.ai/api/anthropic/v1` (verify) | apiKey | Coding Plan key; docs.z.ai/devpack/tool/claude | `glm-5.3`, `glm-5.3-flash` | Add |
| xiaomi-mimo-token | Xiaomi MiMo Token Plan | `anthropic-messages` | one of `https://token-plan-cn.xiaomimimo.com/anthropic/v1`, `…-sgp…`, `…-ams…`; pay-as-you-go `https://api.xiaomimimo.com/anthropic/v1` (verify `/v1`) | apiKey | `tp-`, `ttp-` or `sk-`; platform.xiaomimimo.com/token-plan | `mimo-v2.6-pro`, `mimo-v2.6-flash` | Add (cluster select) |
| deepseek | DeepSeek | `openai-completions` (verify) | DeepSeek docs (**unknown** here) | apiKey | platform.deepseek.com/api_keys | fetch | Add after verification |
| groq | Groq | `openai-completions` | `https://api.groq.com/openai/v1` | apiKey | `gsk_`; console.groq.com/keys | fetch | Exists |
| mistral | Mistral | `openai-completions` | `https://api.mistral.ai/v1` | apiKey | console.mistral.ai/api-keys | fetch | Exists |
| together | Together AI | `openai-completions` | `https://api.together.xyz/v1` | apiKey | api.together.xyz/settings/api-keys | fetch | Exists |
| fireworks | Fireworks AI | `openai-completions` | `https://api.fireworks.ai/inference/v1` | apiKey | fireworks.ai/account/api-keys | fetch | Exists |
| azure-openai | Azure OpenAI | `openai-completions` (needs `api-key` header and `api-version`) | `https://<resource>.openai.azure.com/openai/deployments/<deployment>` | apiKey | Azure portal keys | deployment name | Exists; NS for auth |
| ollama | Ollama | `openai-completions` | `http://127.0.0.1:11434/v1` | none | local | fetch | Exists; NS for non-chat protocols |
| lm-studio | LM Studio | `openai-completions` | `http://127.0.0.1:1234/v1` | none | local | fetch | Exists |
| custom | Custom OpenAI-compatible | `openai-completions` | user | apiKey or none | any | type | Exists |
| oauth-chatgpt | ChatGPT subscription | `openai-responses` | `https://api.openai.com/v1` (**unknown** whether plan tokens are accepted here) | oauth | not available | n/a | NF until OAuth client and approval |

Harness agents (PandaCode-only, not presets): Claude Code, Codex, Kimi Code, OpenCode, Antigravity, Grok Build, Pi, Oh My Pi, Cline, Kilo Code, GitHub Copilot CLI, Devin CLI, Muse Code, DeepSeek Harness, Command Code. Each needs the agent-backend capability in 3.1.

---

## 6. Recommended next steps (ranked)

1. Fix the Anthropic discovery path (3.5). Small, server plus test.
2. Make `apiKey` optional in `model.configure` and add a clear-key action (3.4). Fixes re-entry on model change.
3. Add keyless route support in `buildProvider` and the Responses/Anthropic credential sources (3.6).
4. UI-only presets: Z.ai GLM and MiMo (Anthropic protocol, after verifying `/v1`), DeepSeek (after verifying endpoint).
5. Multi-provider list and default selection, with per-provider delete (3.9).
6. Azure header and query support (3.7).
7. Agent-backend capability for harness agents (3.1). Large; a separate workstream.
8. OAuth sign-in (3.8). Blocked on vendor approval and an OAuth client; do not start without a decision.

## Files read (no edits)

- PandaCode: `src/provider-settings.ts`, `src/types.ts`, `src/provider-logos.ts`, `src/model-catalog.ts`, `src/jev.ts`, `src/jev-assist.ts`, `src-tauri/src/provider_settings.rs`, `providers.rs` (catalog, launch, configure_command), `providers/{glm,mimo,acp,claude_auth,kimi_models,extra_models,pi,muse,deepseek,commandcode,kilo,cline,devin,github_copilot}.rs`, `jev.rs`, `jev_decisions/{api,models}.rs`, `agent_updates_install.rs`, `connections.ts`, `model-picker.ts`.
- Screenshots: `38-settings-providers.png`, `46-settings-providers-first-card-expanded.png`, `17-model-picker-open.png`, `37-settings-agents.png`, `47-settings-agents-default-agent-menu.png`.
- Cognate: `node_modules/@godspeedai/cognate-provider-{auth,anthropic-compatible,openai-compatible,openai-responses,wire,local}` (src and README), `src/components/providerRegistry.ts`, `src/ui/models/{providerCatalog,ProviderWizard,ModelPicker}.ts(x)`, `src/modelCatalog.ts`, `src/capabilities/{modelConfigure,providerManage,secretPut}.ts`, `src/secrets.ts`, `src/server.ts` (provider wiring, boot restore), `src/experts/service.ts`, `src/capabilities/expertModel.ts`, `src/projections/providerRoutes.ts`, `src/ui/experts/ExpertEditor.tsx`, `src/ui/experts/ExpertsTeamsPanel.tsx`, `src/agents/agentConfig.ts`, `docs/sdk-0.5.0-publication-receipt.json`, `test/workbench-model-catalog.test.ts`, `test/J-CFG-model-catalog.test.ts`.
- Not fully read: `src/ui/models/ProviderWizard.tsx` line-by-line UI copy beyond the grep hits; the complete PandaCode `providers.rs` (4574 lines, sampled); `secrets.ts` backend internals beyond the header and public API.
