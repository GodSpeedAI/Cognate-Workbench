# Expert model budgets, billing reservations and spending ceilings

Edit an Expert and enable **Model budget per Assignment attempt** to set context and output ceilings,
an optional attempt token allowance, and an optional USD allowance. Cost enforcement requires both
explicit input and output prices per million tokens. Unknown prices are never treated as zero.
Limits and route are frozen in each Assignment. Editing the Expert changes future assignments;
retrying an assignment remains a separately attributable attempt.

`expert.model.generate` authorizes the registered assignment, constructs its isolated provider,
then checks the complete visible request: messages, instructions, tool schemas and JSON structure,
plus a reserved output limit. Context accounting tokenizes the complete visible request with the
route's model-specific tokenizer: OpenAI o-series/4o/4.1/5 families count under `o200k_base`,
GPT-4/3.5 under `cl100k_base`, legacy completion models under their published encodings, and
families without a public tokenizer (Claude, Llama and unknown model names) count under
`cl100k_base` labeled `approximate`. Every count carries an explicit envelope margin for hidden
provider framing, and the accounting method label always names the encoding used
(`model-tokenizer:o200k_base-with-envelope-margin`, or the legacy conservative UTF-8 byte
estimate when no model name is available). Tokenization is still an estimate, not a provider
token receipt. The smaller of the provider-declared and configured context limits applies.
Required context is retained; an excessive request fails before provider dispatch with
`BUDGET_EXCEEDED`.

## Durable billing reservations and crash reconciliation

Every model dispatch — Expert assignment or ordinary coding session — holds a durable reservation
on the governed billing ledger (the `experts:billing:v1` shared-state thread) before the provider
is called, with the conservative input estimate, the reserved output limit and the effective
prices. On completion the reservation settles from provider-reported usage; failed or unreported
generations settle at their full conservative amount. Erased prior model evidence fails closed
because the remaining allowance cannot be established safely. Provider calls remain recorded native
invocations, so replay of a committed outcome never re-executes the capability and never charges a
second logical call.

A process death between reservation and outcome no longer silently repeats: reservation ids are
deterministic per logical invocation, so the recovered run's re-execution collides with its own
interrupted reservation. That collision is reconciled, never blindly repeated — the interrupted
entry is booked conservatively as `reconciled-unknown` (never zero), and the recovery dispatch
proceeds under a new, separately booked generation of the same identity (`…:r1`, `…:r2`). Every
attempt is accounted exactly once; no usage is dropped or double-counted. On boot, an
evidence-based reconciliation settles still-open reservations: committed invocation outcomes settle
from provider-reported usage (or conservatively for committed failures), live runs stay in flight,
and anything unestablishable — a terminal run without the invocation outcome, a missing run or
erased evidence — books the full conservative amount as unknown. An owner whose dispatch provably
never happened (a released entry) may re-reserve the same identity in place.

These are still preflight guardrails over the Workbench's own durable records, not a physical
billing guarantee: a provider's inaccurate token report or unrecorded server-side processing of an
aborted request cannot be undone, and provider-side billing reconciliation is not claimed.

## Spending ceilings

Settings → **Spending and billing** exposes the operator-configured ceilings through the durable
`settings.changeSpending` capability: an ordinary-session ceiling (per coding session) and a
global ceiling (Expert and session reservations together). Enforcement fails closed at reservation
time: over-ceiling dispatch is refused before any provider call, and while ceilings are configured,
model activity without explicit prices is refused because the ceiling cannot be verified — unknown
prices never count as zero. Session prices are declared on the model configuration
(`model.configure`), Expert prices on the per-attempt budget. Ceilings are cleared with an empty
`{}` patch.

## Inspection

Open an assignment's **Model usage and budget** disclosure for provider-reported usage,
visible-input estimate, reserved output and cost at operator-configured prices. The Experts panel's
**Spending and billing** section shows the live ledger: booked cost, unknown-price count, active
reservations with their statuses and causes, and the effective ceilings. Unreported usage, unknown
prices and provider-added framing are shown as such. Prices are configuration estimates, not a
billing-system reconciliation.

## Evidence

`test/expert-economics.test.ts` covers full visible request accounting, model-specific tokenization
and method labels, unknown prices, failed-call reservations, an actual over-budget native run with
zero provider calls, frozen limits during reconfiguration and receipt persistence after restart.
`test/J-CONTEXT-BUDGET-billing.test.ts` passes actual PostgreSQL journeys: a real native Expert run
settling from provider-reported usage, global-ceiling and unpriced refusal with zero provider
calls, the interrupted-reservation generation and restart reconciliation (booked conservative,
never zero, never double-counted), the proven-release re-reserve, ordinary-session reservations
under the session ceiling, and fail-closed ledger transitions. `test/E2E-experts-debt.test.ts`
exercises the real usage disclosure and the browser spending/billing inspection. Provider-side
billing accuracy beyond observed usage receipts remains a stated limit.
