# Test-Infrastructure Recon — `/home/sprime01/projects/cognate-workbench`

Read-only. No files edited. `OBSERVED` = I ran it / read the line; `INFERRED` = reasoning from code.

---

## 1. UI COMPONENT TESTS — two distinct patterns

### A) Static-markup (dominant: 11 of 14 `.tsx` test files) — no DOM
Exact header (`test/ui-tasks.test.tsx:4-8`):
```tsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DoneLadder } from "../src/ui/workbench/DoneLadder";
import { TaskList } from "../src/ui/workbench/TaskList";
import { RuntimeStrip } from "../src/ui/workbench/RuntimeStrip";
```
- No `document`, no registrator, no `@testing-library`. Assertions are **substring/attribute matches on the HTML string**.
- Representative (`test/ui-tasks.test.tsx:11-19`):
```tsx
test("level: not-started reaches no stages", () => {
  const html = renderToStaticMarkup(<DoneLadder level="not-started" />);
  expect(html).toContain("How done is this task");
  expect(html).toContain("○ Finished");
  expect(html).not.toContain('aria-current="step"');
});
```
- Logical/branch assertions also possible via regex counting: `test/ui-governance-approval.test.tsx:23` `expect(html.match(/disabled=""/g)?.length).toBe(2);`
- Files: `ui-tasks`, `ui-governance-approval`, `ui-observability`, `ui-ambiguous-step`, `ui-experts`, `ui-review`, `ui-schedules`, `ui-settlement`, `ui-skills`, `ui-automation`, `ui-workflow`. `ui-contract.test.tsx:1-3` is **pure logic** (no render at all — imports `src/workbench/contract`).
- Test counts: `ui-tasks` 40 `test(`, `ui-governance-approval` 4, `ui-observability` 1.

### B) Real DOM interaction (2 files only) — happy-dom + testing-library
Exact header (`test/ui-contained-workspace.test.tsx:1-20`, identical shape at `test/ui-runtime-execution.test.tsx:1-21`):
```tsx
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react/pure";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import React from "react";
import { LocalWorkspaceForm, selectWorkspaceForExecution } from "../src/ui/App.tsx";

beforeAll(() => GlobalRegistrator.register());
afterEach(async () => { await act(async () => { cleanup(); await Promise.resolve(); }); });
afterAll(async () => { /* cleanup */ await GlobalRegistrator.unregister(); });
```
- Note `/pure` import (no auto-cleanup; teardown is explicit).
- Interaction example (`test/ui-contained-workspace.test.tsx:36-41`): `await act(async () => { fireEvent.click(local); }); expect(local.checked).toBe(true);` plus `await waitFor(() => expect(ui.getByLabelText("Linux child containment").hasAttribute("disabled")).toBe(false));`
- **No shared happy-dom setup file.** No `bunfig.toml` (absent at repo root; I checked `ls -a`), no `preload`, no `playwright.config.*`. Registration is per-file in `beforeAll`. JSX transform comes from `tsconfig.json:16` `"jsx": "react-jsx"`.
- Deps present: `@happy-dom/global-registrator` 20.14.5, `@testing-library/react` 16.3.3 (package.json devDependencies); `node_modules/@happy-dom`, `node_modules/@testing-library/{dom,react}` exist.

---

## 2. WORKBENCH UI TESTS + `src/ui/App.tsx` coverage

- Convention confirmed: components in `src/ui/workbench/` are covered by `test/ui-*.test.tsx`:
  - `test/ui-tasks.test.tsx:6-8` → `DoneLadder`, `TaskList`, `RuntimeStrip`
  - `test/ui-skills.test.tsx:4-5` → `AuthorityPlane`, `CapabilityList`
  - `test/ui-review.test.tsx:3-5` → `LedgerPanel`, `WorkerReturnForm`, `ReviewCard`
  - `test/ui-workflow.test.tsx:4-5` → `WorkflowGraph`, `NodeInspector`
  - `test/ui-automation.test.tsx:4` → `AutomationPanel`
- **`src/ui/App.tsx` (5818 lines) has NO whole-App test.** `grep -rn '<App' test/` → zero hits. Four files import *named exported subcomponents* out of it:
  - `test/ui-observability.test.tsx:3` → `SubagentTree`, `SubagentRowView`
  - `test/ui-ambiguous-step.test.tsx:6` → `SessionRowButton`
  - `test/ui-governance-approval.test.tsx:6` → `SessionRowButton`
  - `test/ui-contained-workspace.test.tsx:5` → `LocalWorkspaceForm`, `selectWorkspaceForExecution`
- App.tsx export surface (for choosing what to test): `App.tsx:397 SessionRowButton`, `:909 ShortcutsDialog`, `:1561 ConfigFileDialog`, `:2518 SubagentTree`, `:2695 ReviewPanel`, `:3382 LocalWorkspaceForm`, `:3677 PluginsPanelBody`, `:4574 App`. So `App()` itself is exercised only end-to-end via Chromium (E2E), never in unit tests.

---

## 3. E2E HARNESS

`test/helpers.ts` (99 lines, read fully):
- `withTempHome` (`helpers.ts:11-18`): `mkdtemp(tmpdir()/deepseek-harness-t5-)`, `rm -rf` in `finally`.
- `bootApp` (`helpers.ts:20-26`) — **real in-process server, real store, ephemeral port**:
```ts
const app = await startServer({ executionPosture: "uncontained-local", devAuth: true, port: 0, home });
const transport = connectTransport(app.url);
const service = createRemoteRuntimeService(transport, () => devToken(LOCAL_OPERATOR));
const client = createClient({ service, caller: LOCAL_OPERATOR });
```
  (`startServer` at `src/server.ts:342`; devAuth at `src/server.ts:728-738`.)
- `bootAimock` (`helpers.ts:54-83`): spawns the **real `llmock` binary** as a separate process, parses the readiness line from stdout.
- `aimockChatRequests` (`helpers.ts:90-99`): reads the mock's request journal over HTTP.

`test/E2E-workbench.test.ts` (read 1-140, 200-259):
- `:8` `import { chromium, type Page } from "playwright-core";` — **library mode, not `@playwright/test`**. No `playwright.config.*` exists; `@playwright/test` 1.63.0 is a devDep but unused by `test/`. Chromium 1243 is installed (`~/.cache/ms-playwright/chromium-1243`).
- Boot sequence (`:20-35`): `withTempHome` → `bootAimock()` → `bootApp(home)` → `chromium.launch()` → `browser.newPage({viewport:{width:1440,height:900}})` → `page.goto(app.url)`. So: **real server + real Postgres + real llmock + real browser**. Asserts both UI (`getByRole`) and durable log (`allEvents(app)`), and writes screenshots to `screenshots/workbench/*.png` (`:12-13`).
- Timeouts are per-test third arg: `:219 }, 240_000)` and `:258 }, 120_000)`.

**Exact commands**
```bash
cd /home/sprime01/projects/cognate-workbench
bun test --timeout 15000 test/E2E-workbench.test.ts          # one E2E file
bun test --timeout 15000 test/J-WB-steering.test.ts          # one journey file
bun test --timeout 15000 test/ui-observability.test.tsx      # one UI file
bun test test/E2E-contained-workspace.test.ts                # gated: skipped unless COGNATE_BWRAP_TESTS=1
```
(OBSERVED: I ran the last three shapes; E2E itself I did not execute.)

**Database requirement: YES.**
- `src/store.ts:18-24` — `storeConfigFor` returns **only** `{postgres:{url,schema}}` (when `COGNATE_POSTGRES_URL` set) or `{postgresPg0:{name,schema}}`. There is no sqlite/in-memory branch. `startServer` calls it at `src/server.ts:369` (`storeConfigFor(home, "harness")`).
- Env: `COGNATE_POSTGRES_URL` (optional) **or** pg0 instance `COGNATE_PG0_NAME` (default `cognate-dev`) — `src/store.ts:15,23`. Default URL fallback `postgres://postgres:postgres@127.0.0.1:5432/postgres` (`src/store.ts:15`).
- Per-test isolation comes from a **derived schema name** off the temp home (`src/store.ts:9-12` `schemaFor`), so parallel/temp dirs don't collide.
- OBSERVED proof: currently running pg0 `cognate-dev` (PG 18.1.0, port 5432, PID 173873, from `./.tmp/pg0/pg0 info --name cognate-dev`). `bun test test/J-I-work-details.test.ts` **without** `--timeout` → 1 pass / 1 fail at 5001ms; **with** `--timeout 15000` → 2 pass. Re-running with `COGNATE_POSTGRES_URL='postgres://postgres:postgres@127.0.0.1:59999/postgres'` → both tests hang and time out (dead DB ⇒ no boot).
- `just db-setup` / `db-up` / `db-status` / `db-down` (`justfile:31-39`) manage pg0 under `.tmp/pg0`.
- Opt-in host tests: `test/E2E-contained-workspace.test.ts:17-18`, `test/J-RW-contained-workspace.test.ts:20-21`, `test/J-RW-AGGREGATE-CONTAINMENT.test.ts:19-20` — `COGNATE_BWRAP_TESTS === "1" && platform === "linux"` else `test.skip`; require `COGNATE_BWRAP_TEST_ATTESTATION` JSON.

---

## 4. MOCK PROVIDER — `@copilotkit/aimock`

- devDependency `"@copilotkit/aimock": "1.43.0"` (package.json); bin `node_modules/.bin/llmock` (OBSERVED present). Purpose (per `fixtures/README.md:7-24` and `test/J-AIM-aimock.test.ts:1-9`): a **real, out-of-process simulated OpenAI endpoint** (fixture-scripted SSE streaming, tool calls, honest 404 on no-match), replacing the repo's retired hand-written mock server.
- Spawn (`test/helpers.ts:28,54-58`):
```ts
const proc = Bun.spawn([resolveLlmockBin(), "-f", AIMOCK_FIXTURES, "-p", "0",
                        "--validate-on-load", "--log-level", "info"], {...});
// readiness: /aimock server listening on http:\/\/127\.0\.0\.1:(\d+)/
```
  Fixture path `fixtures/aimock/fixtures.json` (`helpers.ts:28`). Fresh process per test keeps `sequenceIndex` at zero (`helpers.ts:50-52`).

**Minimal fake-provider configuration (no API key)** — `test/wb-helpers.ts:76-83`:
```ts
await inv(client, "model.configure", {
  providerId: "mock", baseURL: `http://127.0.0.1:${aimockPort}/v1`,
  protocol: "openai-compatible", model: "mock-model-1", apiKey: "",
});
const { workspaceId } = await inv(client, "workspace.select", { path: workspaceDir });
```
Then scenario selection is by **marker substring in the user message**, matched against `match.userMessage`:
```ts
await client.startRun("agent.coding", { sessionId, workspaceId, message: "[[scenario:aim-plain]] say the fixture thing" }, {...});
```
(`test/J-AIM-aimock.test.ts:37-55`; markers indexed at `fixtures/aimock/fixtures.json:7` `"[user steering]"`, `:307` `"[[scenario:multi]]"`.) Executor wiring: contract executor `"model:mock-model-1"` (`test/wb-helpers.ts:113`).

**Request-body capture — YES, exists and is exactly what you'd need.**
`test/helpers.ts:90-99`:
```ts
GET http://127.0.0.1:${port}/__aimock/journal?path=/v1/chat/completions
→ readonly { method, path, body: { messages?: { role?: string; content?: unknown }[] },
             response: { status: number } }[]
```
- `body.messages[].content` is typed **`unknown`**, so a content-block **array** (e.g. an image block) survives to the assertion without a type fight. This is the hook for "did an image block reach the provider".
- Usage precedent filtering on journal bodies: `test/J-AIM-aimock.test.ts:70-75` (`mine.every(e => e.response.status === 200)`), also `:128`, `:191`; `test/J-H-cancellation.test.ts:91`.
- aimock documents the journal as returning every recorded request, filterable by `path|method|status|service|testId|requestId` (`node_modules/@copilotkit/aimock/README.md:80-81`).
- **Gap (INFERRED):** no current test asserts an image block; `grep -rn 'image_url\|type: "image"' src/ domain/` → no hits, and `fixtures/aimock/fixtures.json` has no image matches (24 `toolCalls` fixtures instead). You'd add a fixture + a journal assertion; the harness already supports it.

---

## 5. JOURNEY TESTS — `test/J-WB-steering.test.ts` (94 lines, read fully)

- Imports (`:4-7`): `bun:test`, type-only `Inbox` from `src/workbench/steering.ts`, and helpers from **`./wb-helpers.ts`** (`allEvents, bootApp, bootAimock, seed, waitForCompletion, waitForRow, waitUntil, withTempHome, inv`).
- Boot (`:11-16`): `withTempHome` → `bootAimock()` → `bootApp(home)` → `seed(client, home, aimock.port)`; `finally { app.stop(); aimock.stop(); }`. Store = the same Postgres-backed runtime via `startServer`. Two tests, each `}, 60_000)`.
- Test 1 asserts V-004 steering semantics:
  - validation: blank text rejected (`/text is required/`), bad mode rejected (`/mode must be/`) — `:18-19`
  - `steer.enqueue` with `mode:"steer-now"` lands in `nextStep`, `"queue-next"` in `nextTurn`; idempotent re-send by `id` is a no-op — `:21-26`
  - run completes and final text contains `"Steered"` — `:29-33`
  - exactly **one** `workbench.steer.consumed` event, `payload.ids === [messageId]` — `:37-39`
  - trajectory change proven from `run.invocation` payloads: earlier model request does **not** carry `"[user steering]"`, a later one does — `:41-48`
  - `queue-next` survives (`nextTurn` still `["then write a changelog"]`) — `:50-55`
- Test 2 (`:63-93`): same via the live-run channel — seeds `state: { steer: [{ id:"live-1", ... }] }` on `startRun` (`:71-73`) instead of `steer.enqueue`; asserts consumed-once with `ids === ["live-1"]` and first-request-predates-boundary ordering.
- **Command (OBSERVED pass):** `bun test --timeout 15000 test/J-WB-steering.test.ts` → `2 pass`, 6.32s. Plain `bun test test/J-WB-steering.test.ts` also works because the per-test `60_000` third arg overrides, but keep `--timeout` for consistency with `bun run test`.

---

## 6. TYPE / VERIFY GATES

`package.json:7-13` (OBSERVED verbatim):
```json
"dev": "bun src/server.ts",
"start": "bun src/server.ts",
"test": "bun test --timeout 15000 test",
"typecheck": "tsc -p tsconfig.json",
"verify": "bun run typecheck && bun run test",
"test:smoke": "bun test test/workbench-contract.test.ts test/workbench-glob.test.ts test/skill-bundle.test.ts"
```
`justfile` is a thin pass-through (`justfile:9-21`): `just typecheck`, `just test`, `just verify`, `just smoke`, `just setup`, `just dev`; plus `db-setup/db-up/db-status/db-down`, `setup-realitytrace`, `setup-domainforge`.

| Gate | Exact command |
|---|---|
| typecheck | `bun run typecheck` = `tsc -p tsconfig.json` (scope: `domain`, `src`, `test` — `tsconfig.json:26-30`; `strict`, `noUncheckedIndexedAccess`, `noEmit`, `verbatimModuleSyntax`) |
| full test | `bun run test` = `bun test --timeout 15000 test` |
| verify | `bun run verify` (= typecheck && test) |
| one file | `bun test --timeout 15000 test/<file>.test.ts[x]` |

- **Test timeout: 15000 ms** via the script flag. **Critical:** bare `bun test <file>` uses Bun's 5000 ms default and *fails Postgres-booting tests* (OBSERVED: `J-I-work-details` 1 pass/1 fail bare, 2 pass with `--timeout 15000`). Per-test third-arg timeouts (e.g. `60_000`, `240_000`) still take precedence.

---

## 7. BASELINE + repo-invariant tripwires

- **136 test files** in `test/` (`ls test/*.test.ts test/*.test.tsx | wc -l`): 122 `.ts` + 14 `.tsx`; of which 11 `E2E-*.test.ts`, 70 `J-*.test.ts`. Plus 6 non-test helper modules: `helpers.ts`, `wb-helpers.ts`, `expert-helpers.ts`, `expert-inbox-replay-worker.ts`, `expert-runtime-worker.ts`, `liveSettlement.ts`.
- **`bun test` and Postgres:** the whole suite is NOT DB-split; **46 files reference `bootApp`** and therefore need a live Postgres. The `ui-*` static-markup tests do not. OBSERVED: `bun test test/ui-observability.test.tsx` → 1 pass in 719 ms with no DB interaction.

### Invariants a *new file* could trip

`test/skill-bundle.test.ts`:
- `:5-9,11-18` — asserts these exist and each `SKILL.md` is >200 bytes: `.agents/skills/{building-with-cognate,deriving-interaction-domain-models,domainforge-sea}/SKILL.md`, plus `.sea/interaction/interaction-model.sea` and `domain/index.ts`. Breaks if you move/rename any skill or the SEA model.
- `:20-37` — **every relative Markdown link** anywhere under `.agents/skills/**/*.md` must resolve on disk (`missing` must be `[]`). **A new doc linking to a not-yet-created file fails here.**
- `:39-49` — every `@godspeedai/cognate-*` dependency must be an **exact `X.Y.Z`** (no `workspace:`/`file:`/`link:`), and there must be `> 10` of them. Breaks if you add a dependency with a caret/range.

`test/sea-format.test.ts` (`:1-17`):
- `verifySeaFormat()` (`scripts/verify-sea-format.ts:84-124`) shells out to the **`domainforge` binary** (found at `/home/sprime01/.cargo/bin/domainforge`, provisioned by `just setup-domainforge` → `.tmp/domainforge`, pinned 0.21.1). It asserts: `domainforge validate` passes on original *and* formatted; normalized AST identical (ignoring line/column); **comment content/placement preserved**; `fmt` idempotent; `domainforge fmt --check` exit 0. So **any `.sea` edit that is not `domainforge fmt`-canonical fails**, and a missing `domainforge` on PATH fails the file. OBSERVED: 2 pass, 150 ms.
- `:5-12` also pins the comment scanner (`extractCommentTokens`) behavior on `//` inside strings/`"""`.

`.sea` ↔ `domain/index.ts` sync: **no dedicated invariant test** — the sync is enforced at runtime/typecheck (`domain` is in `tsconfig` include, and every `startServer` boot logs `[domain] loaded 252 semantic objects (digest sha256:8ddb42ab…)`, OBSERVED in test output). `INFERRED`, not an asserted test.

`semanticRef` invariant: not a global "every capability has a semanticRef" sweep. Closest is `test/cognitive-bindings.test.ts:33-53,85-114` — it binds a capability set and asserts `contract.semanticRef === refs[contract.id]`, and that legacy contracts fall back to a provided `semanticRef`. **INFERRED:** a new capability wired into a `bindX(domain)` (see the ~18 `bind*` calls in `src/server.ts:376-395`) whose id has no `.sea` ref would fail *that file's* assertion pattern, or fail binding — but only for the set that test passes in, not repo-wide.

---

## Notes / gaps (not defects I can confirm)

- No `bunfig.toml`, no test preload hook ⇒ happy-dom setup is duplicated per file (`ui-contained-workspace`, `ui-runtime-execution` only). A third DOM-interaction test must copy the `beforeAll/afterAll` boilerplate.
- `@playwright/test` is a devDependency but never imported; all E2E uses raw `playwright-core`. `INFERRED`: intentional (no runner config), but it means no HTML report / retries / sharding.
- `just` recipes depend on `bun run *` scripts; there is no `just` recipe that sets `COGNATE_POSTGRES_URL`.

**Commands I actually executed:** `ls`/`wc -l`/`grep -rn` over `test/`, `src/`, `package.json`, `justfile`, `tsconfig.json`, `fixtures/`, `node_modules/@copilotkit/aimock/README.md`; `bun test test/ui-observability.test.tsx`; `bun test test/J-I-work-details.test.ts` (bare and `--timeout 15000`, plus a dead-DB `COGNATE_POSTGRES_URL` variant); `bun test --timeout 15000 test/J-WB-steering.test.ts`; `bun test --timeout 15000 test/sea-format.test.ts`; `bun test test/skill-bundle.test.ts`; `./.tmp/pg0/pg0 info --name cognate-dev`; `which domainforge`; `ls ~/.cache/ms-playwright`; `ls node_modules/.bin`.
