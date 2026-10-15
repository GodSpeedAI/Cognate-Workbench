# Current status — revision 21

Published Cognate 0.5.0 is fully consumed: native model-only Expert admission, runtime inspection
UI and Linux contained workspaces are integrated, and the final full gate passes 1,153 tests with
zero failures. The verified slice is committed and pushed. The overall debt-closure mission remains
incomplete by design; open tranches are tracked below.

The [mission plan](.agents/plans/20261014_experts-debt-closure.plan.yaml) remains **in progress**.
All debts remain reconciled in [verification](docs/experts-debt-verification.md).

PR44 merged at e90f511 and linked release PR45 merged at dd13c842; all 45 packages published as
0.5.0 with a complete registry audit (all versions and gitHeads matched, machine-readable
[receipt](docs/sdk-0.5.0-publication-receipt.json)) plus a fresh isolated consumer proof. Workbench
upgraded all 23 direct / 35 resolved SDK pins to 0.5.0 with no local links or vendored tarballs.

Native admission is wired through `src/experts/admission.ts` and `src/server.ts`: opt-in capacity
(1/2/4/8) uses only published SDK resource admission, with frozen intrinsic-return model work
allowed to overlap and tool-bearing work conservatively serialized. Actual PostgreSQL journeys
verify peaks, ordering, cancellation and same-run restart; a real Chromium journey shows distinct
visible Expert results with native handoffs at capacity 2.

The contained-workspace slice (J-RW) passes 5 tests / 111 assertions against the published
launcher guard, including lost-acknowledgment receipt recovery across retry and restart.

The final full gate passed on the exact integrated tree: `just verify` with the attested
containment suite ran 1,153 tests across 105 files, 0 failures, 7,543 assertions; `just typecheck`,
DomainForge validate (226 objects, 0 violations) / fmt --check and `git diff --check` all pass.

Remaining open (next tranches): general workspace-effect concurrency and Team-specific
admission/batching; distributed run-write ownership (one process only today); production
identity/session/tenant isolation, aggregate resource quotas and independent security review;
global root CAS, indexed retrieval, exact tokenization, durable billing reservations and
session/global budget ceilings; generalized SDK inbox/standalone live steering; and the explicit
product debts in the disposition matrix.

Next: use published 0.5.0 capabilities to close the parallelism and remaining debt tranches; see
[experts-debt-closure.md](docs/experts-debt-closure.md) for ownership and gates.
