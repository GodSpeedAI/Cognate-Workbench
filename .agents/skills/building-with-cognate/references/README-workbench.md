# Standalone Workbench usage

This copy of the Building with Cognate skill was imported from Cognate commit `a4517d005c433d37a1b3ae7fb149c14e6ca8ec2c`.

**Workbench is an existing application.** Do not run `cognate create` to scaffold it. Edit `.sea/interaction/interaction-model.sea`, map explicit bindings in `domain/index.ts`, then implement and test the corresponding journey. All framework APIs are imported from published `@godspeedai/cognate-*` packages at version 0.2.0, never a monorepo checkout.

The upstream skill's CLI guidance may describe old create-source behavior. For this app, the committed `package.json`, source imports and installed SDK API are authoritative. Check the current published CLI before giving new-project scaffolding instructions.

Keep the three required skills together. Verify upstream changes deliberately; do not silently update semantics or project identity.
