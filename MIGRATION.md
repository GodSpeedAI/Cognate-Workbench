# Extraction provenance and validation

Source: `GodSpeedAI/Cognate@a4517d005c433d37a1b3ae7fb149c14e6ca8ec2c` (`main` at the start of extraction).

Application source: `validation/reconstructions/deepseek-harness/cognate/` → repository root.

Additional sources: mock fixtures from `validation/reconstructions/deepseek-harness/fixtures/`; complete `building-with-cognate`, `deriving-interaction-domain-models`, and `domainforge-sea` skill folders.

The `cognate/harness` branch is already merged into Cognate main (0 ahead, 33 behind at inspection); this extraction does not require merging it again.

The source's runtime database files, historical screenshot captures, binary image diffs, and private donor checkout artifacts are intentionally excluded from the standalone application. Historical evidence remains in the originating repository. This GitHub-connector extraction copies current source content; its standalone repository commits do not retain the original files' per-path commit histories. Refer to the source commit for lineage.

## Required validation before cutover

- [ ] Resolve all declared npm dependencies from the public registry, without a Cognate source checkout.
- [ ] Run TypeScript check.
- [ ] Run narrow unit and journey suites.
- [ ] Run complete Workbench test suite and categorize pre-existing failures.
- [ ] Boot UI and exercise model streaming, sessions, PostgreSQL persistence, tools, approvals, and subagents.
- [ ] Exercise Playwright browser journeys and verify screenshots/expected behavior.
- [ ] Validate the three Cognate skills and referenced source links.
- [ ] Confirm no workspace aliases or outside-repo runtime dependencies remain.
- [ ] Only then propose a separate Cognate PR removing the original reconstruction app.
