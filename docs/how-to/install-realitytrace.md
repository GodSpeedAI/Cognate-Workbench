# How-to: install RealityTrace

## Goal

Turn on the optional evidence-delivery layer, so observed events produce external records instead of
staying queued.

## What you actually get

The app's execution trace is already authoritative — it is the `session-trace` projection over the
event log, and it needs nothing installed. RealityTrace adds an *evidence* layer on top: a record per
observed event, correlated back to the Cognate event that produced it.

Without it, everything still works. Observations queue. Nothing is lost.

## Prerequisites

Rust and Cargo on `PATH`. Everything installs into this repository; no global Rust package is
changed.

## Procedure

```bash
just setup-realitytrace
```

This installs the pinned CLI into `.tmp/realitytrace/bin/realitytrace`.

Then start the app as usual:

```bash
just dev
```

At boot, `defaultSxrBin()` resolves the binary — `SXR_BIN` first if it points at an existing file,
otherwise the pinned local path — and delivery starts. You should see no warning.

If you would rather use a binary you already have:

```bash
export SXR_BIN=/path/to/realitytrace
just dev
```

## Verify

Open the inspection view for a session. Each observed event should move from `queued` toward a
delivered state with a target reference.

To check the wiring without the UI, watch the boot log:

- present: no `SXR binary not found` warning
- absent: `[cognate-workbench] realitytrace: SXR binary not found; observations stay queued (dev
  tools unaffected)`

## Run the delivery tests

```bash
just test
```

The RealityTrace delivery tests are part of the full suite and **intentionally fail** when the CLI
is absent, rather than skipping. That is deliberate: a silent skip would let a broken evidence layer
look healthy.

## Delivery semantics to know

- Delivery is **at-least-once**, from a durable outbox committed in the same decision as the event.
- Backoff is 250 ms base, 4 s max, 5 attempts. After that an entry is poisoned for reconciliation.
- An unreachable CLI never blocks or breaks the app.
- A drain cycle is skipped when the durable RealityTrace plugin gate is off. Nothing is lost —
  enabling it drains the backlog.

## Validation

```bash
just typecheck
just test
```

## Common failure symptoms

| Symptom | Cause | Fix |
|---|---|---|
| Observations stay queued forever | No binary | `just setup-realitytrace`, or set `SXR_BIN` |
| `SXR binary not found` at boot | `SXR_BIN` points at a path that does not exist, and there is no pinned binary | Check the path, or unset it |
| Delivery entries poisoned | The CLI rejected or was unavailable 5 times | Reconcile; the underlying events are unaffected |
| Tests fail with an observation error | The CLI is missing in CI | `just setup-realitytrace` in the workflow, as CI already does |
| "No target configured" in the inspector | CLI absent | Queued, not an error |

## Uninstall

Delete `.tmp/realitytrace/`. There is nothing else to undo — the outbox entries remain queued and are
delivered if you later reinstall.

## Source trail

- `justfile` — the `setup-realitytrace` recipe
- `src/observations.ts` — `defaultSxrBin`, `wireObservations`, `OBSERVED_EVENT_TYPES`,
  `observationOutboxFor`, the backoff settings
- `src/server.ts` — the warning string, the unconditional read-side mount, the `stop()` call
- `.github/workflows/verify.yml` — `just setup-realitytrace` in CI
- `test/J-RT-realitytrace.test.ts`, `test/J-COG-realitytrace.test.ts`