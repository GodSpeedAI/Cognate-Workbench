# Cognate Workbench — agent instructions

This repository is the independently maintained Cognate Workbench application. Its authoritative app model is `.sea/interaction/interaction-model.sea`; preserve its semantic IDs unless performing an explicit data migration. The Cognate framework is an npm dependency (`@godspeedai/cognate-*`); do not import its monorepo source, vendored tarballs, or workspace aliases.

Read `.agents/skills/building-with-cognate/SKILL.md` and its two companion skills `deriving-interaction-domain-models` and `domainforge-sea` before changing models or capabilities. Keep the model → explicit capability binding → journey tests → evidence sequence.

Use Bun 1.4+, Just, and `just verify`. Run `just typecheck` and targeted `bun test` suites before changing UI or agent behavior. Default persistence is PostgreSQL/pg0 via `src/store.ts`; CI may set `COGNATE_POSTGRES_URL` to use an externally managed PostgreSQL service.

Keep feature changes separate from migration cleanup. Do not remove Cognate's original reconstruction until standalone verification passes. See `MIGRATION.md` for the provenance snapshot and exclusions. Treat the single-operator development authenticator as a known security limitation; do not claim the app is production hardened.

Commit often at meaningful milestones.

Check and update `CURRENT_STATUS.md` and `.agents/CURRENT_STATUS.jsonl` frequently during development and before starting work.
