# Cognate CLI

This file is the only place in the skill that says how the Cognate CLI is installed and invoked. Everything else says `cognate <command>`. When the CLI's distribution changes, update this file only.

## Distribution mode

**Current mode: published.** The CLI ships as the [`@godspeedai/cognate-cli`](https://www.npmjs.com/package/@godspeedai/cognate-cli) npm package (current line: 0.1.x). All SDK packages publish under the `@godspeedai/cognate-*` convention ([ADR-0012](../../../docs/decisions/ADR-0012-cognate-package-naming.md)).

| Setting | Published (current) | Registry-only `create` (future, DEBT-016) |
| --- | --- | --- |
| `cognate` means | `bunx @godspeedai/cognate-cli` (or `cognate` after `bun add -g @godspeedai/cognate-cli`) | same |
| `create` package source | `--source $COGNATE_CHECKOUT` still required: `create` vendors the profile's packages from a Cognate checkout and pins them with `file:` tarballs | npm registry, pinned versions — no checkout needed |
| Upgrade the app | re-run `create` against a newer checkout, or re-vendor; SDK deps inside a generated app update with `bun update` | `bun update @godspeedai/*` |

Pin the major version in scripts (`bunx @godspeedai/cognate-cli@0.1`) so generated apps stay reproducible.

## Commands

Verify the live usage string with `cognate` (no arguments) before relying on this list; the same text ships in the installed package's `src/bin.ts`.

```bash
# Generate a starter app. The profile is copilot or harness; --with adds optional adapters (comma-separated).
cognate create <dir> --profile copilot|harness --source "$COGNATE_CHECKOUT" [--with a,b]   # --source is still required (DEBT-016)

# Run the app: runtime + Connect + AG-UI + UI server.
cognate dev [--port N]
```

The starter's `domain/` directory holds the app's `.sea` files. `cognate dev` loads them with `loadSemanticProjection`, so put the validated interaction model there (or have `domain/` reference `.sea/interaction/`) rather than keeping a second copy.

## Updating this file when `create` gains a registry-only mode

`create` still vendors from `--source` (tracked as DEBT-016's remaining gap). When a registry-only mode lands:

1. Remove `--source` from the `create` example and the table row above. Check with `cognate create /tmp/x --profile copilot` (no flags).
2. Drop the `COGNATE_CHECKOUT` mentions from SKILL.md.
3. Re-run the smoke check: `cognate create /tmp/x --profile copilot`, then `cognate dev` in `/tmp/x`, and confirm the UI serves.
