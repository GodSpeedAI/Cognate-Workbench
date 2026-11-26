# Current status — revision 51

CognitiveOS #112 (Workbench half): the Workbench now consumes the published Cognate 0.11.0 `rlm.*` recursive child-run contract.

**Behaviour.** The provider registry is host configuration (`ServerOptions.rlmProviders`, default empty); an empty registry changes nothing. An operator selects a provider on `expert.converse`/`team.converse`; it is frozen in the Assignment's execution snapshot (`execution.rlm`, absent in old snapshots = no recursive execution) and inherited by delegated children. The Expert tool `rlm_delegate` goes through `rlm.invoke`, wrapped by `src/capabilities/rlmGoverned.ts`, which derives parent run, Assignment, depth, grant, reservation and a pinned context digest from the registered Assignment. Authority must be a subset of the parent's tools and mode; depth uses the Team `maxDepth`; the reservation is the Expert's cost ceiling less its spend and earlier child reservations. The invocation id derives from parent run plus request id, so repeats reuse the same Child Run. Refusals (`rlm-*` codes) happen before dispatch and leave no Child Run.

The parent waits on an `rlm-child` continuation that the completion bridge resolves when the `agent.rlm` run is terminal; the handoff then carries `rlmChildren` (run id, status) and evidence. Independent review and human settlement are unchanged. `rlm.inspect`/`rlm.cancel` are parent-scoped: the parent run, or the operator acting through the parent principal.

**Unknown outcomes.** A provider view of `unknown` parks the child on `ambiguous:<id>` and the parent keeps waiting. `run.invocation.reconcile` resolves it; the handoff records the child as reconciled with an uncertainty, so it never reads as plain success.

**Governed admission is closed.** Providers that spawn, claim isolation, need containment or have network reach are refused. No spawn port is registered.

**Verified.** `test/J-RLM-child-run.test.ts`: red (0/6) then green (8/8 after reconcile and standing tests). Typecheck and DomainForge checks clean. Expert/Team gate suites pass except load-timing flakes that pass alone, and one E2E failure that is identical on base.

**Limits.** Child spend is not debited from the parent ledger after reservation. In-run inspect/cancel is tested at the wrapper only (no Expert tool). Cognate re-runs the child body on resume, so a provider invoke can be re-entered for the same invocation; report upstream.

**Next.** Review and merge; #114-#116 open governed admission.

Plan: none. Spec: SEA-Forge #112. Full history is in `.agents/CURRENT_STATUS.jsonl`.
