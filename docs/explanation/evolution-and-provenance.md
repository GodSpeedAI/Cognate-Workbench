# Evolution and provenance

Where this repository came from, what was taken from where, and which claims about its own history
are recovered rather than current.

## Read this before trusting any historical statement

Much of the project's history lives in files that were removed from version control and survive only
in a gitignored scratch directory. Two consequences:

1. Statements below marked **recovered** come from those files. They were accurate as of when they
   were written and may describe a repository that has since moved on.
2. Implementation and tests are the authority. Where this page and the code disagree, the code wins
   — see [Verified versus inferred](#verified-versus-inferred) below.

## The short history

This application was extracted from the GodSpeedAI Cognate monorepo at commit
`a4517d005c433d37a1b3ae7fb149c14e6ca8ec2c`, from the path
`validation/reconstructions/deepseek-harness/cognate/`.

It began as a **reconstruction** — an attempt to reproduce the behaviour of a third-party product,
the DeepSeek Harness web UI, using the Cognate framework. That goal has since been retired. Root
`DESIGN.md` records a Hallmark redesign pass that replaced a "forensic reconstruction of a
third-party reference" with an independent visual system, and root `PRODUCT.md` records the same for
the product framing. Pixel-parity numbers in the legacy notes are therefore **historical**, not
current targets.

Along the way the app grew three layers that the original reconstruction did not have:

- a **workbench cockpit** (`src/ui/workbench/`, `.agents/plans/unified_harness_experience_model_v2.md`)
- a **cognitive-navigation proof** (`.agents/specs/cybernetic-navigation-proof.md`)
- **remote execution worlds** over SSH and WSL

The migration to this standalone repository is recorded in `MIGRATION.md` and, in fuller form, in a
recovered migration verification note: the original reconstruction was **not** removed, no merge to
Workbench `main` had occurred at that point, and independent execution validation was pending CI —
with the explicit instruction not to call it a successful cutover until the workflow was green.

## Donors

Nothing below is a dependency. Ported logic was re-implemented in TypeScript and carries an
attribution header naming its donor, path and commit.

| Donor | Licence | Commit | Use | Lands in |
|---|---|---|---|---|
| `Hexagon/croner` | MIT | `713ee72` | ported logic | `src/workbench/automation.ts` |
| `micromatch/picomatch` | MIT | `9fab7bf` | ported logic | `src/workbench/glob.ts` |
| `openai/codex` | Apache-2.0 | `7aa8f51` | ported logic | `src/workbench/shellSafety.ts` |
| `anomalyco/opencode` | MIT | `7723920` | ported logic | `src/workbench/shellSafety.ts` |
| `aaif-goose/goose` | Apache-2.0 | `104ddde` | reviewed only, nothing taken | — |
| `dagrejs/dagre` | MIT | `32e7f30` | reviewed only, nothing taken | — |
| `deepseek-ai/deepseek-harness` | see reference manifest | `477b4f4` | pattern only | `src/workbench/workflow.ts`, `src/workbench/steering.ts` |
| `operator:gs-term` | operator-owned | working | adapted | `src/workbench/focus.ts` |

Deliberate divergences from donors are recorded next to each port: `glob.ts` makes dotfiles
matchable by `*`; `shellSafety.ts` drops Windows analysis and adds SQL and device-redirect fallbacks;
`automation.ts` uses strictly-after semantics with an explicit gap rule.

The reference product manifest records `deepseek-ai/deepseek-harness` at commit
`477b4f420553e8a52c2fbccc464d7561b239c443`, package `@deepseek-ai/dsh-root` version `0.1.7-rc.2`.

### A note on the reference behaviour matrix

A large legacy document recorded per-behaviour observations of the reference product — its startup
and shell, settings, workspace and session behaviour, tool and approval flows, cancellation, errors,
theme, and settings inventories. That is evidence about *another product*, it is stale with respect
to this application, and it has no reader need inside this repository's documentation. It is
therefore not reproduced here. It remains in git history for anyone auditing the reconstruction.

## Two behaviours that deliberately diverge from the reference

Both were recorded as deliberate at the time, and both are worth knowing because they look like bugs.

**A pending approval survives a full process restart.** The reference kept a pending approval across
a page reload but not across a process restart — after a restart it silently finalised the turn with
no approval card and no answer. Reproducing that would have meant treating durable event history as
something to paper over, so this app keeps the run `waiting`. `test/J-D-approval.test.ts` asserts it.

**Durable continuations need a provider at boot.** The first fix that fell out of the above was in
`src/server.ts`: only `model.configure` used to mount a provider, so a run resumed after a restart
had no `model.generate` to call. The boot path now remounts the last-configured provider from the
`model-config` projection.

## The persistence claim changed

Older notes in this project describe "SQLite-backed continuations". That is no longer true. The
store is PostgreSQL: `storeConfigFor` in `src/store.ts` returns either an explicit
`{ postgres: { url, schema } }` or `{ postgresPg0: { name, schema } }`, and CI provisions a
`postgres:18` service. Comments in a few source files and in the legacy notes still say SQLite;
where they do, they are stale, and the store-selection code plus the CI workflow are authoritative.

## A documentation event worth recording

The repository's entire `docs/` tree was removed from version control in the working tree and its
content relocated under `.tmp/`, which `.gitignore` excludes. That left the repository with no
version-controlled documentation, and left `README.md` linking to a path that no longer existed.
The current `docs/` tree is the rebuild, written from the implementation, with the recoverable
knowledge migrated into canonical pages. See [Documentation map](../documentation-map.md) for which
page owns what.

## Verified versus inferred

| Statement | Status |
|---|---|
| The app was extracted from the Cognate monorepo at `a4517d0…` | Recovered from `MIGRATION.md` and the recovered migration note |
| Pixel parity with the reference is no longer a goal | **Verified** — root `DESIGN.md` |
| The store is PostgreSQL | **Verified** — `src/store.ts`, `.github/workflows/verify.yml` |
| The donor table | Recovered from the legacy provenance report; the attribution headers in the ported files corroborate it |
| A pending approval survives a restart | **Verified** — `test/J-D-approval.test.ts` |
| The provider is remounted at boot for that reason | **Verified** — the comment in `src/server.ts` |
| Which tranches shipped, and in what order | Recovered from the legacy plan and notes |
| The cognitive layer is a local proof with three unpromoted candidates | **Verified** — the code labels it so; the candidate list is recovered |

Several artifacts cited by the legacy notes do **not** exist in this repository and were not available:
an evidence file recording the redesign decision, a debt register (`DEBT-015`, `022`, `023`, `024`),
the critic review rounds, a product-characterisation document, reference screenshots, and the
architecture guard tests. Where this documentation cites a debt or a critic finding, it is citing
them as recovered second-hand references, not as verified current facts.

## Source trail

- `MIGRATION.md` — the extraction snapshot and its validation conditions
- `PRODUCT.md` — the current product framing, which retired parity as a goal
- `DESIGN.md` — the visual system and the statement that the forensic reconstruction was replaced
- `src/workbench/glob.ts`, `shellSafety.ts`, `automation.ts`, `workflow.ts`, `steering.ts`,
  `focus.ts` — the attribution headers corroborating the donor table
- `src/store.ts` — the current persistence mechanism
- `src/server.ts` — the provider remount comment
- `test/J-D-approval.test.ts` — the restart-durability contract
- `.agents/specs/cybernetic-navigation-proof.md`, `.agents/plans/unified_harness_experience_model_v2.md`
- `.tmp/reconstruction/`, `.tmp/provenance/` — the recovered sources (gitignored; not required to
  read this page)