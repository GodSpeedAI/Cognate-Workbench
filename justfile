# Standalone Cognate Workbench commands
setup:
    bun install

dev:
    bun run dev

typecheck:
    bun run typecheck

test:
    bun run test

verify:
    bun run verify

smoke:
    bun run test:smoke

# Full RealityTrace integration tests require the pinned SXR CLI.
# Installs into this repository only; no global Rust packages are changed.
setup-realitytrace:
    cargo install realitytrace --version 0.3.0 --locked --root .tmp/realitytrace
