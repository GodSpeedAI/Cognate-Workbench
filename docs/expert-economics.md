# Expert model budgets and accounting

Edit an Expert and enable **Model budget per Assignment attempt** to set context and output ceilings,
an optional attempt token allowance, and an optional USD allowance. Cost enforcement requires both
explicit input and output prices per million tokens. Unknown prices are never treated as zero.
Limits and route are frozen in each Assignment. Editing the Expert changes future assignments;
retrying an assignment remains a separately attributable attempt.

`expert.model.generate` authorizes the registered assignment, constructs its isolated provider,
then checks the complete visible request: messages, instructions, tool schemas and JSON structure,
plus a reserved output limit. The estimate is UTF-8 bytes plus an envelope margin. It is deliberately
labeled an estimate, not an exact model tokenizer or measurement of hidden provider framing.
The smaller of the provider-declared and configured context limits applies. Required context is
retained; an excessive request fails before provider dispatch with `BUDGET_EXCEEDED`.

Successful provider-reported input/output tokens replace the conservative reservation in accounting.
Failed or unreported generations retain input and maximum-output reservations. Erased prior model
evidence fails closed because the remaining allowance cannot be established safely. Provider calls
are recorded native invocations, so replay of a committed outcome does not create another logical
call. A process death after provider dispatch but before outcome persistence can leave unknown billed
usage and repeat that inference on recovery. Durable pre-dispatch billing reservations and provider
reconciliation are not implemented; these limits are not a physical billing guarantee. These are preflight
guardrails: a provider's inaccurate token report or disregard of an output limit cannot be undone.

Open an assignment's **Model usage and budget** disclosure to inspect provider-reported usage,
visible-input estimate, reserved output and cost at operator-configured prices. Unreported usage,
unknown prices and provider-added framing are shown as such. Prices are configuration estimates,
not a billing-system reconciliation.

`test/expert-economics.test.ts` covers full visible request accounting, unknown prices, failed-call
reservations, an actual over-budget native run with zero provider calls, frozen limits during
reconfiguration and receipt persistence after restart. `test/E2E-experts-debt.test.ts` exercises
the real usage disclosure. Ordinary coding-session/global spending ceilings and model-specific
tokenization remain open.
