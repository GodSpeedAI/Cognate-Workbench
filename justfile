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

# Pinned DomainForge CLI (stack lockstep version) for the SEA format fidelity test. DomainForge
# publishes no release binaries; this is its documented crates.io install, kept inside the checkout.
setup-domainforge:
    cargo install domainforge-core --version 0.21.1 --features cli --locked --root .tmp/domainforge

# Local pg0 installation is opt-in. Workbench also supports an external PostgreSQL URL.
db-setup:
    bun scripts/setup-pg0.ts

db-up:
    ./.tmp/pg0/pg0 start --name ${COGNATE_PG0_NAME:-cognate-dev}

db-status:
    ./.tmp/pg0/pg0 info --name ${COGNATE_PG0_NAME:-cognate-dev}

db-down:
    ./.tmp/pg0/pg0 stop --name ${COGNATE_PG0_NAME:-cognate-dev}
