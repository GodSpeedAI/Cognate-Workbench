# Current status — revision 49

CognitiveOS #110 (`experts.restore`) now handles a missing default Team whose required built-in Expert is archived.

**Behaviour.** Without an explicit request, restore recreates every other built-in verbatim but skips the Team. It never creates a Team around an archived member. The report adds an optional `blocked` array, present only when non-empty:

`blocked: [{ teamId: "cognate-team", reason: "required-expert-archived", requires: { reactivate: ["builder"] }, message }]`

The message names the exact IDs and the request that satisfies it: `experts.restore` with `{"includeArchived": true}`. That is the existing explicit-reactivation input. With it, archived built-ins are reactivated first and the Team is created after, so no intermediate state breaks the Team or one-Team-Lead invariants. Failure persists nothing, because the mutation boundary revalidates every Team. Active and custom definitions and stable IDs are untouched. Agent and in-Run callers are still refused, including under safe mode.

**Verified.** `test/J-EXPERTS-restore-blocked.test.ts` (5 tests) failed before the fix and passed after. It covers the state, capability and safe-mode paths and the caller refusals. `just typecheck` is clean. The Expert and Team suites passed on isolated pg0: 9, 24 and 53 tests, 0 failures. Existing restore suites are unchanged and pass.

**Limits.** The interaction model has no restore journey, so no model change was made. Full `just verify` is pending on hosted CI.

**Next.** Run the hosted gate, then review and merge the checkpoint branch.

Plan: none. Spec: SEA-Forge #108 and #110. Full history is in `.agents/CURRENT_STATUS.jsonl`.
