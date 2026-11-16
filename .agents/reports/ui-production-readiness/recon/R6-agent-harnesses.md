# R6: Agent harness CLIs (PandaCode donor vs Cognate Workbench)

Scope: static source reading only. Nothing in the donor was executed. No model was called. Only `command -v` and `--version` ran on this machine.

Evidence legend: **seen** = read in source (file:line). **inferred** = follows from seen code but not run. **unknown** = not found or not read in this pass.

Donor root: `/home/sprime01/projects/cognate-workbench/.tmp/donor/pandacode`. Rust paths below are relative to `src-tauri/src/`.

---

## 0. Summary

- PandaCode supports **17 harness ids** (`providers.rs:73-91`). Gemini, Qwen, Aider, Amp, Goose, Cursor agent, and Copilot-as-`copilot` are not all covered. Only GitHub Copilot CLI is in the donor, as id `github-copilot` with binary `copilot`. **Gemini, Qwen, Aider, Amp, Goose, and Cursor agent have no adapter in the donor** (grep of `src/` and `src-tauri/src/` for their names finds no harness entry; **seen** by absence in the PROVIDERS list).
- Detection is a **PATH plus known-dirs scan with no cache**. `discover()` runs `<bin> --version` synchronously for every provider on every `list_providers` call, with a 2 s timeout (`providers.rs:598-661`, `lib.rs:2309-2324`). Model catalogs are cached for 5 min (`providers/acp_catalog.rs:12`).
- The donor does **not** use the headless one-shot form. Claude runs as a **bidirectional stream-json session** over pipes, Codex runs `codex app-server` (JSON-RPC), and most others run `acp` (Agent Client Protocol, JSON-RPC over stdio). The user's suggested argv (`claude -p --output-format stream-json --verbose`, `codex exec --json`, `opencode run --format json`, `kimi` JSONL) is **not** what PandaCode uses. See section 2.
- Approvals are **owned by each CLI's protocol**. PandaCode answers the CLI's permission requests through the protocol (Claude `can_use_tool` control_request, Codex `*/requestApproval`, ACP `session/request_permission`) and maps its own modes onto each CLI's permission flags.
- Cognate today has **no harness adapter**. The native `agent.coding` loop (`src/agents/agentCoding.ts`) calls the model and runs tools through capabilities. A harness CLI can run through `process.exec`, but that port is **buffered and argv-only, with no stdin and no streaming** (`@godspeedai/cognate-execution/src/types.ts:25-47`). It can't show live output or deliver an approval round-trip as-is. The cleanest seam is a new agent kind (`agent.harness`) registered beside `agentCodingAgent` (`src/server.ts:519`) that emits the same `tool.call.*`/`message.completed` events the UI already folds. An SDK-level streaming `process.spawn` port would be the proper long-term fix, and it lives upstream.
- Under the default `contained` posture, `process.exec` in the `local` world is **refused** (`src/executionPosture.ts`). A harness detect/version probe run as a local process launch is therefore refused too, unless it runs in a contained/ssh/wsl world. This is the first design constraint.
- Cognate guarantees that **do not** hold for an external CLI: its tool calls skip `authority.check` (`agentCoding.ts:588`), `approvalGate` (`agentCoding.ts` approval path), protected-evidence blocking, and settlement (`src/settlement/orchestrator.ts:26` settles only `agent.coding`). Evidence is limited to what the adapter records. Details in section 5.

---

## 1. CLI catalog

### 1a. PandaCode harness catalog (17 ids)

Binary-name mapping (`providers.rs:529-541`): `glm`, `mimo` run the **`claude`** binary; `antigravity` runs `agy_acp_server` (Windows `agy_acp_server.exe`, Unix `agy_acp_server.par`); `deepseek` runs `dsh`; `commandcode` runs `command-code`; `github-copilot` runs `copilot`. All others use the id as the binary name.

Search dirs (`providers/launch.rs:291-340`, Unix): `PATH`, then `~/.local/bin`, `~/.kimi-code/bin`, `~/.kimi-code/Scripts`, `~/.opencode/bin`, `~/.kilo/bin`, `~/.cargo/bin`, `~/.bun/bin`, `~/.grok/bin`, `~/.volta/bin`, `~/.npm-global/bin`, node-version-manager bin dirs (fnm/nvm/asdf/mise, `launch.rs:346-415`), `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, and the npm global prefix (`launch.rs:419-461`: `NPM_CONFIG_PREFIX`, then `~/.npmrc` `prefix`, then the real node's prefix). Windows adds `%APPDATA%\npm`, `%LOCALAPPDATA%\Microsoft\WinGet\Links`, `pi-node\current`, `%ProgramFiles%\nodejs`, and `System32\WindowsPowerShell\v1.0` (`launch.rs:312-333`).

Windows shims: candidate extensions `.exe .com .cmd .bat ""` (`launch.rs:480-486`). npm and pnpm `.cmd` shims are **not** run through `cmd.exe`. PandaCode parses the shim, finds the package entry in `package.json`, and runs it with the adjacent `node.exe` (`launch.rs:75-170`, `174-230`). Unix requires an executable bit (`launch.rs:495-500`).

| id | Display | Binary (donor) | Detect extras | Version cmd | Install hint (donor) | Donor docs URL |
|---|---|---|---|---|---|---|
| claude | Claude Code | `claude` | ~/.local/bin | `claude --version` | none in UI | https://code.claude.com/docs/en/setup (`agent_updates_install.rs:36`) |
| codex | Codex | `codex` | ~/.local/bin | `codex --version` | none in UI | https://developers.openai.com/codex/cli/ (`agent_updates_install.rs:37`) |
| kimi | Kimi Code | `kimi` | ~/.kimi-code/bin, Scripts | `kimi --version` | none in UI | https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html (`agent_updates_install.rs:38`) |
| opencode | OpenCode | `opencode` | ~/.opencode/bin | `opencode --version` | none in UI | https://opencode.ai/docs/ (`agent_updates_install.rs:39`) |
| glm | GLM Coding Plan | `claude` (Z.ai env) | — | via claude | https://docs.z.ai/devpack/tool/claude (`provider-settings.ts:61`) | — |
| antigravity | Antigravity | `agy_acp_server(.par)` | — | not probed; version shown as "ACP" (`providers.rs:640`) | — | https://antigravity.google/docs/ide/extensions (`agent_updates_install.rs:41`) |
| grok | Grok Build | `grok` | ~/.grok/bin | `grok --version` | `curl -fsSL https://x.ai/cli/install.sh \| sh` (`provider-settings.ts:72`) | https://docs.x.ai/build |
| mimo | MiMo Token Plan | `claude` (MiMo endpoint env) | — | via claude | — | — |
| pi | Pi | `pi` | Windows pi-node | `pi --version` | pi.dev installer (`launch.rs:333` comment) | — |
| deepseek | DeepSeek | `dsh` | — | `dsh --version` | `npm i -g @deepseek-ai/dsh` (`provider-settings.ts:75`) | — |
| commandcode | Command Code | `command-code` | — | `command-code --version` | `npm i -g command-code` then `command-code login` (`provider-settings.ts:78`) | — |
| cline | Cline | `cline` | ~/.local/bin on this machine | `cline --version` | `npm i -g cline` then `cline auth` (`provider-settings.ts:81`) | https://docs.cline.bot/usage/cli-overview (`agent_updates_install.rs:42`) |
| kilo | Kilo Code | `kilo` | ~/.kilo/bin | `kilo --version` | `npm i -g @kilocode/cli` then `kilo auth login` (`provider-settings.ts:84`) | — |
| omp | Oh My Pi | `omp` | — | `omp --version` | — | — |
| github-copilot | GitHub Copilot CLI | `copilot` | — | `copilot --version` | `npm install -g @github/copilot` (`provider-settings.ts:82`) | — |
| muse | Muse Code | `muse` | — | `muse --version` | — | — |
| devin | Devin CLI | `devin` (also bundled, `devin::bundled()`) | — | `devin --version` | `curl -fsSL https://cli.devin.ai/install.sh \| bash` (`provider-settings.ts:83`) | https://docs.devin.ai/cli (`agent_updates_install.rs:44`) |

Note: "version cmd" is what `discover()` runs (`providers.rs:598-625`, `--version` for every id except antigravity). Install hints are in `src/provider-settings.ts:61-84`. `docs()` at `agent_updates_install.rs:30-45` covers only 8 ids.

### 1b. Requested CLIs (catalog vs PandaCode)

| Requested CLI | PandaCode id/binary | Headless/protocol argv used by PandaCode | Output | Resume | Model flag | Permission modes | Installed here? |
|---|---|---|---|---|---|---|---|
| Claude Code (`claude`) | claude / `claude` | see 2a | stream-json over stdio | `--resume=<id>` (`providers.rs:2753-2754`) | `--model` (`2744`), `--effort` (`2748`) | `--permission-mode` default/acceptEdits/auto/plan/bypassPermissions (`2723-2737`) | **yes**, 2.1.316 |
| OpenAI Codex CLI (`codex`) | codex / `codex` | `codex app-server --enable goals` (`2701`, `994`) | JSON-RPC notifications | thread id via `thread/resume` (`3533`, `3774`) | turn params (`providers/goals.rs`, not read in full) | sandbox+approvalPolicy (see 3b) | **yes**, codex-cli 0.163.0 |
| Gemini CLI (`gemini`) | **no adapter** | — | — | — | — | — | no |
| OpenCode (`opencode`) | opencode / `opencode` | `opencode acp` + env `OPENCODE_CONFIG_CONTENT` (`acp.rs:48-51`) | ACP JSON-RPC | `session/resume` or `session/load` (`acp.rs:252-258`) | `session/set_config_option` (`acp.rs:163`) | config JSON per mode (`acp.rs` `configuration()`) | **yes**, v2.2.0 at ~/.opencode/bin |
| Kimi CLI (`kimi`) | kimi / `kimi` | `kimi [--model M] acp` (`2707-2712`) | ACP JSON-RPC | ACP session methods | `--model` | ACP option ids (see 3c) | no |
| Qwen Code (`qwen`) | **no adapter** | — | — | — | — | — | no |
| Aider (`aider`) | **no adapter** | — | — | — | — | — | no |
| Amp (`amp`) | **no adapter** | — | — | — | — | — | no |
| Goose (`goose`) | **no adapter** | — | — | — | — | — | no |
| Cursor agent (`cursor-agent`) | **no adapter** | — | — | — | — | — | no |
| GitHub Copilot CLI (`copilot`) | github-copilot / `copilot` | `copilot --no-auto-update --acp --stdio` (`acp.rs:69-70`) | ACP JSON-RPC | ACP session methods | ACP config | Plan / task modes advertised by Copilot (`acp.rs:581`) | no |

Other harnesses found in this pass (not in the user's list): `cline` 3.0.68 and `pi` 0.8.0 in ~/.local/bin; `agy` 1.2.0 in ~/.local/bin. PandaCode's Antigravity adapter runs `agy_acp_server`, not `agy`, so whether `agy` is the same product is **unknown**.

### 1c. Donor argv detail per protocol family

Claude (default arm, `providers.rs:2713-2760`), exact args in order:
`-p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --permission-prompt-tool stdio --replay-user-messages --permission-mode <m> --disallowedTools=ScheduleWakeup,Monitor,CronCreate [--allow-dangerously-skip-permissions if full] [--model M] [--effort E] [--resume=ID] [--append-system-prompt <instructions>]`, with `CLAUDECODE` removed from env. Prompt and control messages are JSON lines on **stdin** (`write_json`, `providers.rs:2539`). Stdout is stream-json.

Codex (`providers.rs:2699-2702`): `app-server --enable goals`. Per-process override, "never alter the user's Codex config" (comment at `2700`). JSON-RPC 2.0 over stdio. Methods seen: `initialize`, `initialized`, `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, `model/list`, `review/start`, `thread/compact/start`, `thread/tokenUsage/updated`, `turn/started`, `turn/completed`, `item/started`, `item/completed`, `item/agentMessage/delta`, `item/commandExecution/outputDelta`, `item/tool/call`, and `item/*/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput` (grep of `providers.rs`).

Kimi (`2707-2712`): `[--model M] acp`.

ACP family (`providers/acp.rs:37-80`):
- opencode: `acp`, env `OPENCODE_CONFIG_CONTENT`
- grok: `--no-auto-update --permission-mode <m> agent [--always-approve] [--model M] [--reasoning-effort E] stdio`
- github-copilot: `--no-auto-update --acp --stdio`
- deepseek: `--profile acp`, env `DSH_PERMISSION_MODE` (`acp.rs:33,40-42`)
- commandcode: `acp` (`commandcode.rs:8`)
- cline: `--acp`, `--thinking E`, `--auto-approve true|false`, env `CLINE_MODEL` (`cline.rs:13-24`)
- devin: `acp`, env `HOST_CREDENTIALS` removed (`devin.rs:32-35`)
- kilo: `super::kilo::configure` (not read)
- antigravity: `agy_acp_server` (not read)

Pi / omp (`providers/pi.rs:37-62`): `--mode rpc`, `--provider P --model M` (model as `provider/model`), `--thinking E`, `--resume ID` (omp) or `--session-id ID` (pi), `--approval-mode yolo` for full, `--append-system-prompt`. Read-only catalog probe: `--mode rpc --no-session --no-extensions --no-skills ...` (`pi.rs:239-243`).

Muse (`muse.rs:30-34`): `serve`, env `MUSE_LOGIN=0`. Not read further.

Agent runs use **pipes** (stdin/stdout/stderr piped, `kill_on_drop`, `process_group(0)` on Unix) at `providers.rs:2996-3005`. **PTY** is used only for the integrated terminal (`terminal.rs:241`, `providers.rs` re-exports `pty_command`), not agent runs.

Environment: `child_env::sanitize` (`providers/launch.rs:238-239`, `child_env.rs:78`), which on Linux strips AppImage overrides. Claude adds `env_remove("CLAUDECODE")` (`providers.rs` after the mode block). Auth env is set by `claude_auth::configure` (`providers.rs:2692`, `claude_auth.rs:32-35`).

---

## 2. PandaCode detection, invocation, output, resume, models

### 2a. Detection and refresh

- Entry: `list_providers` (`lib.rs:2309`) → `local_providers(force)` (`lib.rs:2319-2332`) → `spawn_blocking(providers::discover)`. `force` only invalidates ACP model catalogs for antigravity, grok, devin.
- `discover()` (`providers.rs:630-661`) runs, per id, `executable(id)` then `version(path)`.
- `version()` (`providers.rs:598-625`) spawns `<path> --version`, stdout piped, stderr null, polls every 20 ms, kills after 2 s, truncates to 150 chars. **No result cache.** Windows attaches a job object.
- `executable()` (`providers.rs:524-529`): settings override first (`provider_settings::executable_override`, set via `provider_set_executable`, `provider-settings.ts:179`), then `launch::find` over the search dirs.
- Catalog caching: `acp_catalog` cache with 5 min TTL (`providers/acp_catalog.rs:12, 63-74`), keyed by provider + path identity, with per-provider refresh locks. Claude/Codex/Kimi/OpenCode model lists are fetched per process (`providers.rs:725-745`, `list_model_catalog`).
- UI refresh: `Refresh agents` button (`settings.ts:83-92`, screenshot 37) and `force` flag on `list_providers`.

### 2b. Output parsing to transcript items

`AgentEvent { session_id, kind, text, request_id, data, tool }` (`providers.rs:135-143`). Kinds emitted (counted by grep of `event("…"` across `providers*.rs`): `status` (25), `session` (10), `text` (1 site, plus `text_stream` helpers), `tool` (2 sites), `approval` (4), `approval_cancelled` (4), `input_request` (1), `input_cancelled` (4), `usage` (1), `turn_start`, `turn_complete`, `message_start`, `error`, `done`, `subagent`, `goal`, `goal_input`, `goal_ready`, `steer`, `limited`, `commands_changed`, `task_settings`.

Per harness:
- **Claude** (`fn claude`, `providers.rs:2209`): `content_block_start/delta/stop`, `input_json_delta` (partial tool input), `message_start`, `message_delta`, `tool_use`, `tool_result`, `text`, `text_delta`. Tool input and output are truncated (`TOOL_INPUT_LIMIT=4096`, `TOOL_OUTPUT_LIMIT=8192`, `providers.rs:69-70`). Usage: `claude_usage` (`providers.rs:1242`). A test name says usage reports the current context, "not cumulative cost or subagent tokens" (`providers.rs:3696`). **No USD cost is parsed.** `thinking` is **not** handled in `providers.rs`; grep found no thinking block parsing (`terminal.rs` and `providers/cline.rs` mention it, unrelated).
- **Codex** (`fn codex`, `providers.rs:1775`): `item/agentMessage/delta` → text; `item/started|completed` with `fileChange` → tool events with a `diff` field (`providers.rs:1511`); `commandExecution` → tool with output delta; `thread/tokenUsage/updated` → usage; `turn/completed` → `turn_complete`.
- **ACP family** (`fn acp`, `providers.rs` ~ `acp.rs`): `session/update` notifications → text / tool / plan; `session/prompt` result → turn end; `session/cancel` on stop (`providers.rs` `cancel`).
- **Kimi** (`fn kimi`, `providers.rs:2011`): ACP-style; `kimi_tool` (`providers.rs:1597`) maps tool updates.

Limits: `MAX_FRAME=4 MiB` per frame, `STDERR_LIMIT=16 KiB`, `MODEL_CATALOG_LIMIT=10_000` (`providers.rs:66-68`).

### 2c. Session resume

- Claude: `--resume=<session_id>` (`providers.rs:2753-2754`). Session id stored from the `session` event.
- Codex: `thread/resume` with stored thread id, else `thread/start` (`providers.rs:3533-3536`, `3774-3777`). Resume-with-different-session is refused (`providers.rs:4562`).
- Pi/omp: `--session-id` or `--resume` (`pi.rs:55`).
- ACP: `session/resume` or `session/load` if advertised, else `session/new` (`acp.rs:252-258`).

### 2d. Model and effort selection

- Model catalog: Claude via `initialize` control request (`providers.rs:959`) and parsed `models` list (`parse_claude_models`, `870`); Codex via `model/list` (`codex_models`, `991`); ACP via session metadata. Model `default` means "no `--model` flag" (`configure_command`, `2692-2745`).
- Effort: validated per provider (`validate_reasoning_effort`, `providers.rs:467-495`). Claude `--effort`; Codex turn param; Pi `--thinking`; Cline `--thinking`; Grok `--reasoning-effort`.
- Picker: `src/model-picker.ts` lists installed harnesses only: `providers.filter(p => p.installed || p.id === current.provider)` (`model-picker.ts:264-265`). Uninstalled harnesses are hidden unless the task already uses them, and their effort range is disabled (`model-picker.ts:176, 204, 271, 436`). Search box: "Search harnesses and models…" (`model-picker.ts:58`).

### 2e. Auth status

- Claude: `claude_auth.rs` reads saved login by running `claude auth status --json`-equivalent (`inspect_saved_login_command`, `claude_auth.rs:96-112`), parses `loggedIn`/`authMethod`/`apiProvider` into `signedIn | notSignedIn | otherCredentials | unknown` (`claude_auth.rs:87-93`, tests `174-178`). Shows source, endpoint and conflicts (`claude_auth.rs:53-84`). Surfaced via `provider_claude_status` (`claude_auth.rs:117-118`) and the Providers card ("Checking Claude login…", `provider-settings.ts`).
- ACP harnesses: sign-in is detected from the protocol response. Failure returns a human message, e.g. "Grok Build is not signed in. Run `grok login`…" (`acp.rs:26-27, 179`), "Command Code is not signed in…" (`commandcode.rs:22`), and Cline/Kilo/Devin equivalents (`acp.rs:182-191`). ACP startup timeout 60 s (`acp.rs:8`).
- Readiness check: `provider_check_connection` returns `installed`, `acpReady`, `sessionReady`, `state` (`authenticationRequired`), metadata only, no prompt sent (`src/provider-readiness.ts:2-18`).

### 2f. Usage limits

`agent_usage_providers.rs` queries provider usage endpoints: Kimi `https://api.kimi.com/coding/v1/usages` (`:155`), GLM `https://api.z.ai/api/monitor/usage/quota/limit` (`:20`), OpenCode `https://opencode.ai/zen/go/v1/usage` (`:21`). Others get a link to the provider's plan page (`:37-40`). Claude usage is read via `agent_usage.rs` (`claude_usage`, `claude_credential`, `CLAUDE_CONFIG_DIR`). Credentials are read from local files (`credential_bytes`, `agent_usage_providers.rs:73`). **Secret-bearing; do not copy this approach without review.**

---

## 3. Approvals and permissions

### 3a. PandaCode modes (shared UI vocabulary)

Valid modes: `ask | auto | review | plan | full`; new tasks default to `full` (`storage.rs:17-23`). UI labels (`src/approval-modes.ts:11-84`): **Standard** (`ask`), **Accept edits** (`auto`), **Plan mode** (`plan`), **Full access** (`full`), plus "review" for Claude auto mode. Descriptions differ per harness (`approval-modes.ts:11-84`).

### 3b. Mapping to each CLI's own modes

- **Claude** (`providers.rs:2723-2737`): ask→`default`, auto→`acceptEdits`, review→`auto` (Claude's safety reviewer), plan→`plan`, full→`bypassPermissions` plus `--allow-dangerously-skip-permissions`. Permission prompts go through `--permission-prompt-tool stdio`. Plan mode auto-allows read-only tools (`providers.rs:2459-2465`, `plan_reads::plan_read_only`). `AskUserQuestion` is denied with a free-text instruction (`providers.rs:2448-2453`). Other requests become `approval` events and wait for the user (`providers.rs:2466-2470`).
- **Codex** (`providers.rs:1311-1333`): ask→`workspace-write` + `on-request` + reviewer `user`; auto→`workspace-write` + `on-request` + reviewer `auto_review`; plan→`read-only` + `never`; full→`danger-full-access` + `never`. Writable roots pinned to the cwd (`providers.rs:1325-1327`). Network off in non-full modes.
- **ACP** (`providers.rs:1710-1721`): approval options are chosen by kind: `allow_once`/`allow_always` or `reject_once`/`reject_always`. Full access is applied by the server's own config (opencode `configuration()`, `acp.rs:48-51`; grok `--always-approve`, `acp.rs:58`; cline `--auto-approve`, `cline.rs:24`; deepseek `DSH_PERMISSION_MODE`, `acp.rs:42`; command code uses its own session modes, `commandcode.rs:10`).
- **Pi/omp**: `--approval-mode yolo` for full, else extension UI confirm (`pi.rs:59`, `providers.rs:1699`).

### 3c. How approvals reach the UI

`approval()` (`providers.rs:1678-1687`) stores the raw request in `pending`, caps it at 64, and emits an `approval` event with `request_id` and the command text (truncated). The UI shows the approval bar (`src/approval-bar.ts`, not read in detail). The reply is built per protocol in `approve()` (`providers.rs:1689-1729`) and written back to stdin or the RPC channel. Declining Claude sends `behavior:"deny"` with "Declined by the user" (`providers.rs:1726`). Cancellation of pending approvals emits `approval_cancelled`.

### 3d. Sandbox

PandaCode does not add its own sandbox to CLI processes. Containment is each CLI's own sandbox (Codex `workspace-write`, Claude `default`/`plan`) plus the approval modes above. This is the posture label Cognate must show honestly (section 5).

---

## 4. Cancellation and process lifecycle

- **Protocol cancel**: `cancel()` (`providers.rs:1730-1744`): Claude `control_request` subtype `interrupt`; Pi/omp `abort`; Codex `turn/interrupt` (`1734-1736`); ACP `session/cancel`.
- **Finish**: `finish_child` (`providers.rs:2640-2665`): close stdin, wait 1 s, then `SIGTERM` to the process group, wait 0.5 s, then SIGKILL (`kill_group`, `providers.rs:2580-2590`).
- **Unix**: `process_group(0)` so the whole tree shares one group (`providers.rs:3000-3003`). Killed via `libc::kill(-pid, SIGKILL)`.
- **Windows**: `windows_job` job object (`providers/windows_job.rs:86, 157`), fallback `taskkill /F /T /PID` (`providers.rs:2591-2597`).
- **Shutdown**: `shutdown_all()` kills registered groups (`providers.rs:2601-2610`). `ProcessGroup` registry (`providers.rs:2575-2636`).

---

## 5. PandaCode UX flow (what the user sees)

1. **Install detection**: Settings > Agents lists each harness with `Installed` or `Not installed`, version, and a `Refresh agents` button (`src/settings.ts:83-92, 140-155`; screenshot `evidence/donor/37-settings-agents.png`). Antigravity shows "Not installed" there.
2. **Default agent and model**: Settings > Agents "Default agent" opens a dialog listing harnesses with logos (`evidence/donor/47-settings-agents-default-agent-menu.png`). "Default model" is a select (`settings.ts:86-88`).
3. **Composer picker**: the model button (bottom bar, next to the permission mode "Standard") opens a grouped picker: harness headers (Claude Code, Codex, Kimi Code, OpenCode, …), each with "Default: uses the model selected by your harness" and its catalog models with context size. Search: "Search harnesses and models…" (`evidence/donor/17-model-picker-open.png`; `model-picker.ts:58`).
4. **Permission mode**: a second composer button ("Standard") with the modes from 3a.
5. **Missing CLI**: no inline install prompt. Uninstalled harnesses are hidden from the picker unless the task uses one (`model-picker.ts:264`). Install commands live only in Settings > Providers copy (`provider-settings.ts:72-84`). R1 already recorded "No inline install prompt was found" (`R1-pandacode-ux-inventory.md:915`).
6. **Sign-in**: Providers card per harness. Claude shows saved-login state and a "Check login" button; ACP harnesses show the sign-in error text when a run fails (`acp.rs:179-191`).
7. **Approvals**: the approval bar shows the command or tool name; the user allows or declines. Claude's question tool is denied with a note to answer in chat (`providers.rs:2448-2453`).
8. **Stop**: protocol interrupt, then group kill after the grace period (section 4).

R1 cross-reference: `/home/sprime01/projects/cognate-workbench/.agents/reports/ui-production-readiness/recon/R1-pandacode-ux-inventory.md` §3.6 (line 401) and the Agents row (line 352), line 365 for diagnostic rows.

---

## 6. Locally installed CLIs (this machine, probed)

Probe: `command -v` and `<bin> --version` only. No model call, no login.

| Binary | Found | Path | Version output |
|---|---|---|---|
| claude | yes | /home/sprime01/.local/bin/claude | 2.1.316 (Claude Code) |
| codex | yes | /home/sprime01/.local/bin/codex | codex-cli 0.163.0 |
| gemini | no | — | — |
| opencode | yes | /home/sprime01/.opencode/bin/opencode | opencode v2.2.0 |
| kimi | no | — | — |
| qwen | no | — | — |
| aider | no | — | — |
| amp | no | — | — |
| goose | no | — | — |
| cursor-agent | no | — | — |
| copilot | no | — | — |

Extras found: `cline` 3.0.68 (/home/sprime01/.local/bin/cline), `pi` 0.8.0 (/home/sprime01/.local/bin/pi), `agy` 1.2.0 (/home/sprime01/.local/bin/agy). Not found: grok, devin, dsh, command-code, kilo, omp, kimi-code.

Note: `~/.local/bin` is in PandaCode's search list, so PandaCode would detect claude, codex, cline and pi here (**inferred**, not run).

---

## 7. Cognate integration seam

### 7a. Current turn path (seen)

- Run start: `src/remote/mobile.ts:484` → `service.startRun(caller, { agent: "agent.coding", input: { sessionId, workspaceId, message, mode, preset } })`.
- Agent registration: `src/server.ts:519` `agents: [agentConfigAgent, agentCodingAgent, agentCognitiveAgent, agentExpert]`.
- Loop: `src/agents/agentCoding.ts:402` `agentCodingAgent.run`. Model call `invokeModelGenerate` (`:146`) → `ctx.invoke("model.generate")`. Tools `TOOL_DEFS` (`:200`): `read`, `edit`, `bash`, `todo_write`, `exit_plan_mode`, `subagent`, `run_code`.
- Tool execution: `invokeTool` (`:342`). `bash` → capability `tool.bash` (`src/capabilities/tools.ts:208-212`) → `process.exec` on world `input.executionWorldId ?? "local"` with argv `["bash","-lc",command]`.
- Authority: `authority.check` before `edit`/`bash` (`agentCoding.ts:588`); protected-evidence blocks emit `workbench.protection.blocked`.
- Approval: `approvalGate({tool,args,mode})` (`src/domain/approvalGate.ts`, `agentCoding.ts` ~ `:600`), then `ctx.waitFor(... condition: { kind: "human_approval" })` and events `tool.approval.requested` / `tool.approval.decided`.
- Events emitted by the agent (`agentCoding.ts`, counted): `session.turn.started` (`:456`), `tool.call.started`, `tool.call.completed` (6), `tool.call.failed` (9), `message.completed` (3), `turn.failed` (2), `tool.approval.requested/decided`, `plan.*`, `subagent.spawned`, `workbench.task.*`, `workbench.usage.recorded`, `model.request.retried`.
- Live text: `run.invocation.progress` with `payload.kind === "text"` is folded by `useStreamingTurn` (`src/ui/App.tsx:1895-1930`), which also handles `model.request.retried`, `turn.failed`, `message.completed`, `run.cancelled`, `run.failed`.
- Tool timeline: `useToolTimeline` (`App.tsx:1976-2020`) folds `tool.call.started|completed|failed` and `tool.approval.requested|decided` keyed by `toolCallId`.
- Projections: `src/projections/sessions.ts:72, 109, 157`; `src/projections/sessionTrace.ts:92, 132, 146-153`; `src/capabilities/sessionHistory.ts:43-51` (counts `tool.call.started`, filters `run.agent === "agent.coding"`).
- Governance: `governance.approval.resolve` (`src/capabilities/governance.ts:13, 110-145`) resolves **SEA-Forge escalations** only, and only for a direct human operator (`:132`). It is not a per-tool gate.

### 7b. Execution worlds (seen)

- Port contract: `ExecSpec { argv, cwd, env?, timeoutMs? }` → `ExecResult { stdout, stderr, exitCode, timedOut }`, buffered (`node_modules/@godspeedai/cognate-execution/src/types.ts:25-37`). `ExecOptions.signal` aborts and "must terminate the process" (`types.ts:39-42`). `ProcessPort.exec` only (`types.ts:59-61`). **No stdin, no streaming, no pid, no process group.**
- Local: `local.ts:68-90` uses `Bun.spawn`, merges `process.env` with `spec.env`, pipes stdout and stderr, kills with `proc.kill()` (not a group kill). Forwarded through `capabilities.ts:134` `registry.get(worldId).process.exec`.
- Posture guard: `src/executionPosture.ts`. Default `contained` refuses `process.exec` and `filesystem.writeText` in `local` worlds with `UncontainedEffectRefusedError` (`executionPosture.ts` class near line 30). `uncontained-local` is the explicit opt-in. SEA-Forge governance requires `contained` (`src/server.ts:380-383`), because an uncontained agent could reach the SEA-Forge socket.
- Bubblewrap (opt-in, Linux): `node_modules/@godspeedai/cognate-execution/src/bubblewrap.ts`, argv confined, ro-binds, binary digest check.
- SSH: `node_modules/@godspeedai/cognate-execution-ssh/src/index.ts:206-230`, `client.exec(command, { pty: false })`. Command is a single string.
- WSL: `node_modules/@godspeedai/cognate-execution-wsl/src/index.ts` runs a persistent shell with markers and pid tokens (`:53, 112, 119`).

### 7c. Can an external CLI run inside a world's process API? (inferred)

Yes for **one-shot, buffered** runs. `process.exec({argv:["claude","-p", prompt, "--output-format","stream-json","--verbose"], cwd: workspaceRoot, timeoutMs})` works in contained, bubblewrap, ssh and wsl worlds. Limits:

1. **No live output.** The whole JSONL arrives after exit, so the UI cannot stream. Acceptable for a first slice, not for parity.
2. **No stdin.** The prompt must go in argv (quoting and ARG_MAX risk) or in a file under the workspace. The Claude bidirectional protocol (stdin control messages) cannot be used.
3. **No approval round-trip.** A harness that asks permission mid-run blocks until timeout. Use the CLI's own non-interactive modes only (Claude `acceptEdits`/`bypassPermissions`, Codex `workspace-write`/`danger-full-access`), and label the posture.
4. **Coarse cancel.** `AbortSignal` kills the spawned process (local.ts uses `proc.kill()`), not the CLI's child tree. Descendants can survive.
5. **Env.** Local exec inherits the full `process.env` (`local.ts:72`). Secrets reach the CLI. The harness adapter must pass an explicit allowlist, and `Cognate`'s secrets store should be the only source of keys.

### 7d. Recommended seam

**New agent kind `agent.harness`**, separate from `agent.coding`, so settlement, expert admission and the native loop stay untouched.

1. `src/agents/agentHarness.ts` (new). `agentHarnessAgent.run(input, ctx)` takes `{ sessionId, workspaceId, harnessId, model, effort, mode, message, resumeId }`. It resolves the world the same way `tool.bash` does (`workspace.path`, `task.checkout.resolve` if relevant) and spawns through `process.exec`. Each harness is an adapter record: `{ id, binaries, versionArgv, headlessArgv(model, resume, mode), parse(line) → domain events, postureLabel }`.
2. Map JSONL to the **same domain events** the UI already folds (no UI rewrite needed for MVP):
   - text → `run.invocation.progress` (kind text) or `message.completed` at the end (`App.tsx:1895-1930`)
   - tool start/end → `tool.call.started` / `tool.call.completed` / `tool.call.failed` (`App.tsx:1976-2020`; `sessionTrace.ts:132-153`)
   - `session.turn.started` at start (`agentCoding.ts:456`) so `projections/sessions.ts:72` titles and folds the session
   - errors → `turn.failed`
   - usage → `workbench.usage.recorded` only if a price is known; otherwise record tokens with "unknown cost"
3. Detection: a `harness.detect` capability that runs `sh -c 'command -v <bin>'` and `<bin> --version` **inside the chosen world**, not on the host. This makes SSH/WSL detection honest per machine. Under `contained`, the local-world probe is refused (`executionPosture.ts`), so the UI must say "Detect in a contained workspace or remote world" instead of "Not installed".
4. Register `agentHarnessAgent` in `src/server.ts:519`. Add a session setting that selects `harness` vs native. Keep `ProviderRegistry` (model providers) separate.
5. Upgrade path (upstream SDK, not in this repo): add `process.spawn(spec, {stdin?}) → { lines: AsyncIterable<string>, wait(), kill(group) }` to `@godspeedai/cognate-execution` ports, implemented for local/ssh/wsl/bubblewrap. This removes limits 1, 2 and 4 in 7c. Until then, do not claim live streaming.
6. Approvals: for Claude, `--permission-prompt-tool` on stdin/stdout can be bridged to `tool.approval.requested` / `tool.approval.decided` (PandaCode does exactly this, `providers.rs:2446-2475`). This needs the bidirectional process from 5. Without it, Cognate cannot gate the CLI's tools.

---

## 8. Posture labels and guarantee gaps

### 8a. Posture levels to display (proposed)

| Level | Meaning | Cognate can show |
|---|---|---|
| `harness-own-sandbox` | CLI runs in a world (contained/ssh/wsl/bubblewrap). CLI enforces its own permissions. Cognate sees only the final transcript. | "Runs with Codex's own permissions in this workspace. Cognate records the result but does not approve each tool call." |
| `harness-bridged-approvals` | Cognate answers the CLI's permission requests (requires the bidirectional adapter). | "Tool approvals are routed through Cognate." |
| `harness-uncontained` | CLI runs as the operator's account (`uncontained-local`). | Red banner. Refused when SEA-Forge governance is on (`server.ts:380-383`). |

`full`-equivalent modes (Claude `bypassPermissions`, Codex `danger-full-access`) must map to the uncontained label unless the world is contained. Never show them as "Standard".

### 8b. Guarantees that do NOT hold for an external harness

| Cognate guarantee | Native `agent.coding` | External harness (one-shot) | How to represent |
|---|---|---|---|
| Containment of effects | Yes via contained world (`executionPosture.ts`) | Holds for the CLI process itself. Its internal tool calls are inside the CLI's sandbox, not Cognate's. | Label "CLI's own sandbox". |
| Per-tool authority check | Yes (`agentCoding.ts:588`) | **No.** `authority.check` never sees the CLI's `edit`/`bash`. Protected-evidence paths are not enforced. | State it; list protected paths as unenforced. |
| Human approval gating | Yes (`approvalGate`, `waitFor human_approval`) | **No** in one-shot mode. Only with the bridge (7d.6). | Show "CLI decides" or "bridged". |
| Settlement (`agent.coding` settled) | Yes (`settlement/orchestrator.ts:26`) | **No**, since the agent kind differs. | Mark the run "unsettled, external". |
| Evidence and audit trail | Each tool call is a Cognate event | Only events the adapter writes. Tool activity is what the CLI reports, unverified. | Mark evidence "self-reported by harness". |
| SEA-Forge escalation | Yes | **No.** Must refuse when governance is on and posture is uncontained. | Refuse; explain. |
| Usage and cost | Model pricing (`ProviderRegistry.prices`) | Unknown unless the CLI reports cost. PandaCode does not parse cost. | Show tokens if reported, else "unknown". |
| Secret hygiene | Cognate secrets store | `process.env` inherited by local exec (`local.ts:72`) | Pass an env allowlist; never print keys. |
| Live streaming | Yes | No in one-shot mode | Show "waiting for harness" until exit. |
| Cancellation of the whole tree | Native loop | Only the top process via `proc.kill()` | State "stops the harness process". |

### 8c. Points to verify before building (unknown)

- Whether `ctx.emit` from a custom agent can emit `run.invocation.progress` and `message.completed` so the existing `useStreamingTurn` folds them. Source of runtime-emitted progress is in `@godspeedai/cognate-runtime-bun` (not read).
- Whether `settlement/orchestrator.ts` filters by agent name only (`SETTLED_AGENT`, `:26`), or also by event shape.
- Whether `experts/admission.ts:252` assumes `agent.coding` for runs (it branches on it).
- Exact CLI JSON schemas for Codex `exec`, Gemini, Qwen, Aider, Amp, Goose and Cursor agent. None are in the donor, so they are **unknown** here. Do not design against them without fetching their docs.
- `kilo`, `muse`, `antigravity`, `cline` full argv (only partly read).

---

## 9. Key corrections to the requested brief

- Claude is **not** `claude -p --output-format stream-json --verbose` alone. PandaCode also sends `--input-format stream-json`, `--include-partial-messages`, `--permission-prompt-tool stdio`, `--replay-user-messages`, `--disallowedTools=...`, and writes JSON control messages on stdin (`providers.rs:2713-2760`).
- Codex is **`codex app-server --enable goals`** (JSON-RPC), not `codex exec --json` (`providers.rs:2701`).
- Kimi is **`kimi [--model M] acp`**, not a JSONL print mode (`providers.rs:2707-2712`).
- OpenCode is **`opencode acp`** (ACP), not `opencode run --format json` (`providers/acp.rs:48-51`).
- Gemini, Qwen, Aider, Amp, Goose and Cursor agent have **no adapter** in PandaCode.
- Copilot is `copilot --no-auto-update --acp --stdio` (`providers/acp.rs:69-70`).
- PandaCode does not use a PTY for agent runs (pipes only, `providers.rs:2996-3005`).

---

## 10. File index

Donor (key files):
- `/home/sprime01/projects/cognate-workbench/.tmp/donor/pandacode/src-tauri/src/providers.rs` (registry 73-91, discover 630, configure_command 2695, run_inner, approvals 1678-1744, Claude control 2446-2475, codex approvals 1311-1333)
- `.../src-tauri/src/providers/launch.rs` (search dirs 285-345, find 480-520, shim resolution 75-230)
- `.../src-tauri/src/providers/acp.rs` (ACP configure 37-80, sign-in 179-191)
- `.../src-tauri/src/providers/acp_catalog.rs` (TTL 12, cache 63-96)
- `.../src-tauri/src/providers/claude_auth.rs` (saved login 87-118)
- `.../src-tauri/src/providers/pi.rs`, `cline.rs`, `commandcode.rs`, `devin.rs`, `muse.rs` (argv)
- `.../src-tauri/src/lib.rs` (list_providers 2309, local_providers 2319)
- `.../src-tauri/src/storage.rs` (permission modes 17-23)
- `.../src-tauri/src/agent_updates_install.rs` (docs URLs 30-45)
- `.../src-tauri/src/agent_usage_providers.rs` (usage endpoints 18-40)
- `.../src/provider-settings.ts` (install hints 61-84), `.../src/approval-modes.ts` (labels 11-84), `.../src/model-picker.ts` (picker 58, 264-271), `.../src/provider-readiness.ts`
- Screenshots: `/home/sprime01/projects/cognate-workbench/.agents/reports/ui-production-readiness/evidence/donor/37-settings-agents.png`, `.../47-settings-agents-default-agent-menu.png`, `.../17-model-picker-open.png`

Cognate:
- `/home/sprime01/projects/cognate-workbench/src/agents/agentCoding.ts` (run loop 402, tools 200, authority 588, approval gate, events)
- `/home/sprime01/projects/cognate-workbench/src/agents/agentConfig.ts` (config commands; not deeply read)
- `/home/sprime01/projects/cognate-workbench/src/server.ts` (agent registration 519, posture guard 380-383, runtime 499-527)
- `/home/sprime01/projects/cognate-workbench/src/capabilities/tools.ts` (tool.bash 151-212 region)
- `/home/sprime01/projects/cognate-workbench/src/capabilities/governance.ts` (approval.resolve 13, 110-145)
- `/home/sprime01/projects/cognate-workbench/src/capabilities/executionWorlds.ts` (world registry, restore 158)
- `/home/sprime01/projects/cognate-workbench/src/executionPosture.ts` (contained default, UncontainedEffectRefusedError)
- `/home/sprime01/projects/cognate-workbench/src/domain/approvalGate.ts`
- `/home/sprime01/projects/cognate-workbench/src/ui/App.tsx` (useStreamingTurn 1895, useToolTimeline 1976)
- `/home/sprime01/projects/cognate-workbench/src/projections/sessions.ts`, `sessionTrace.ts`, `src/capabilities/sessionHistory.ts`
- `/home/sprime01/projects/cognate-workbench/src/remote/mobile.ts` (startRun 484)
- `/home/sprime01/projects/cognate-workbench/src/settlement/orchestrator.ts` (SETTLED_AGENT 26)
- `/home/sprime01/projects/cognate-workbench/src/experts/admission.ts` (AGENT_CODING branch 252)
- SDK (installed, read-only): `/home/sprime01/projects/cognate-workbench/node_modules/@godspeedai/cognate-execution/src/{types.ts,local.ts,capabilities.ts,bubblewrap.ts}`, `.../cognate-execution-ssh/src/index.ts`, `.../cognate-execution-wsl/src/index.ts`

Report (this file): `/home/sprime01/projects/cognate-workbench/.agents/reports/ui-production-readiness/recon/R6-agent-harnesses.md`
