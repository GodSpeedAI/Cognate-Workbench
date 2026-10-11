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

# Point COGNATE_POSTGRES_URL at an existing Postgres service to avoid local pg0 bootstrap.
db-status:
    @echo 'COGNATE_POSTGRES_URL='\"\$\"'{COGNATE_POSTGRES_URL:-[pg0 managed by Cognate runtime]}'
