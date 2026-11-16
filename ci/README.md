# ci

Inputs for `.github/workflows/verify.yml`.

- `test-timings.json`: per-file test durations (ms) that `bun test --shard` uses to balance the
  four `test (shard i/4)` jobs. Each shard uploads its measured `test-timings-<i>` artifact; to
  rebalance, merge those four files into this one and commit. An empty `files` map is valid (shards then
  split by file count).

The required status check is the aggregate job `verify`; it fails when any of `checks`, `test` or
`tauri-linux` fails or is skipped.
