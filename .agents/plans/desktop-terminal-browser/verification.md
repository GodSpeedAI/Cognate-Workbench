# Verification log — desktop-terminal-browser

Append-only. Every entry: date, exact command, result, evidence notes.

## T1 — Baseline (2026-11-03)

- `bun run typecheck` → exit 0.
- `bun run test:smoke` → 73 pass / 0 fail (274 expects).
- Repo maps recorded in `architecture.md` §Baseline (backend, UI, packaging maps from three
  exploration passes + external-tech research pass with sources).
- Toolchain check: bun 1.4.0, rustc/cargo 1.98.0, webkit2gtk-4.1 + gtk3 present,
  `.tmp/domainforge/bin/domainforge` present, `.tmp/pg0/pg0` present, COGNATE_POSTGRES_URL unset.
