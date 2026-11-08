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

# Zero-grant guard for the desktop shell (desktop-native-completion B2): no capability
# files may ship, and a generated capability manifest must be empty. Build the shell
# first for the full check (`bun run tauri build --debug --no-bundle`).
tauri-guards:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -d src-tauri/capabilities ] && [ -n "$(ls -A src-tauri/capabilities 2>/dev/null)" ]; then
        echo "FAIL: src-tauri/capabilities must stay empty (zero-grant posture):" >&2
        ls -la src-tauri/capabilities >&2
        exit 1
    fi
    if [ -f src-tauri/gen/schemas/capabilities.json ]; then
        bun -e 'const c = await Bun.file("src-tauri/gen/schemas/capabilities.json").json();
            if (Object.keys(c).length > 0) { console.error("FAIL: generated Tauri capability manifest is not empty:", JSON.stringify(c)); process.exit(1); }
            console.log("tauri-guards: generated capability manifest empty (zero-grant)")'
    else
        echo "tauri-guards: no generated manifest present (build the shell first for the full check)"
    fi

# Packaged-shell smoke harness (desktop-native-completion B2). Args pass through to
# scripts/qualify-tauri.sh; paths with spaces are not supported by just's interpolation —
# copy such a deb to a space-free name first (the Tauri deb's name carries the productName's
# space until B5's package-identity fix). Examples:
#   just tauri-smoke --shell src-tauri/target/debug/cognate-workbench-shell
#   just tauri-smoke --bundle /tmp/shell.deb --xvfb
#   just tauri-smoke --bundle /tmp/shell.deb --coexist /tmp/cli.deb
tauri-smoke *ARGS:
    bash scripts/qualify-tauri.sh {{ARGS}}

# Full RealityTrace integration tests require the pinned SXR CLI.
# Installs into this repository only; no global Rust packages are changed.
setup-realitytrace:
    cargo install realitytrace --version 0.3.0 --locked --root .tmp/realitytrace

# Pinned DomainForge CLI (stack lockstep version) for the SEA format fidelity test. DomainForge
# publishes no release binaries; this is its documented crates.io install, kept inside the checkout.
setup-domainforge:
    cargo install domainforge-core --version 0.21.2 --features cli --locked --root .tmp/domainforge

# Local pg0 installation is opt-in. Workbench also supports an external PostgreSQL URL.
db-setup:
    bun scripts/setup-pg0.ts

db-up:
    ./.tmp/pg0/pg0 start --name ${COGNATE_PG0_NAME:-cognate-dev}

db-status:
    ./.tmp/pg0/pg0 info --name ${COGNATE_PG0_NAME:-cognate-dev}

db-down:
    ./.tmp/pg0/pg0 stop --name ${COGNATE_PG0_NAME:-cognate-dev}
