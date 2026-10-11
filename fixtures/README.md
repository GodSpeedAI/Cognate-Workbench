# Fixtures — deterministic model endpoint + workspace

Shared by the pinned-reference captures and the Cognate reconstruction's
journey tests (usage plan: `.agents/plans/deepseek-harness-usage-features.md`).

## aimock (the simulated OpenAI endpoint)

Since usage pass U1 the deterministic model endpoint is CopilotKit's
[`@copilotkit/aimock`](https://www.npmjs.com/package/@copilotkit/aimock)
(`llmock` bin, a devDependency of the cognate app) serving
[aimock/fixtures.json](aimock/fixtures.json) — replacing the repository's own
hand-written mock-model server, which is retired. The old `[[scenario:<name>]]`
markers live on as the fixtures' `match.userMessage` keys.

```sh
# from the repo root: boots llmock on :4010 + the app on :3180 + a workspace
just harness-up
# or directly (from validation/reconstructions/deepseek-harness/cognate):
./node_modules/.bin/llmock -f ../../fixtures/aimock/fixtures.json -p 4010 --validate-on-load
```

Multi-round tool loops use `toolCallId`-anchored follow-up fixtures (ordered
before their leg-1 entry, leg 1 gated `hasToolResult: false`); branch variants
gate on `toolResultContains`; the `retry` scenario uses `sequenceIndex`
variants (a fresh llmock process per test keeps counters at zero). Unmatched
messages get llmock's honest 404 `no_fixture_match`, which the app surfaces as
a failed run (`test/J-AIM-aimock.test.ts`).

## workspace

```sh
bun workspace/make-workspace.ts /tmp/my-fixture   # fresh workspace, deterministic SHA
```

Known files + git state so file-tool mutations are comparable across reference
and reconstruction.
