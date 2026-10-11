# Migration verification report

Source snapshot: `GodSpeedAI/Cognate@a4517d005c433d37a1b3ae7fb149c14e6ca8ec2c`.

This branch contains Workbench sources, models, tests, mock fixtures, skills and design provenance. Dependencies are pinned to the published Cognate 0.2.0 SDK. The original reconstruction is **not removed** and no merge to Workbench `main` has occurred.

Runtime screenshots and reference comparison images remain in the source repository; they are historical evidence, not a prerequisite to running Workbench. Old SQLite files and generated database sidecars are deliberately excluded.

Independent execution validation is pending CI. The CI workflow installs dependencies from npm, uses a PostgreSQL service, typechecks, runs Workbench smoke tests, installs Chromium and attempts the complete test suite. Do not call this a successful cutover until the workflow is green and the UI is manually exercised.
