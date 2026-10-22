# Linux contained workspaces

Workbench runs agent effects (process launches and file writes) only in contained or explicitly
connected remote workspaces. This is the **execution posture**, set per server by
`COGNATE_EXECUTION_POSTURE`:

| Posture | Agent commands and writes in a **local** workspace | How to get it |
|---|---|---|
| `contained` (default) | refused with an actionable error; reading and listing still work | nothing to set |
| `uncontained-local` | run on this computer as the operator; path checks are not a sandbox | `COGNATE_EXECUTION_POSTURE=uncontained-local` |

The guard sits on the execution-world registry, so it covers the base local world and every
local-kind world registered later (cognitive directory-copy forks included). `/health` reports
`execution.posture`, and the Add Workspace dialog labels the local option by posture.

Containment itself is still an explicit choice for each workspace, made by selecting a Linux
contained workspace below.

## Draft a host config

`bun scripts/containment-config.ts --bwrap /path/to/bwrap --source "<where it was built from>"`
measures the binary (path, SHA-256, reported version, package origin) and checks for the
CVE-2026-87766 fix (bubblewrap >= 0.12.0, or a distro build whose changelog applies the fix and has
not dropped it). It refuses a binary known to be unpatched — Ubuntu's `0.11.1-1ubuntu0.3` dropped
its fix. It writes `operatorVerified: true` only with `--attest`, which records that you reviewed
the binary; `--out containment.json` writes the file. The script never vouches for a binary by
itself.

## Configure the host

Containment requires host-owned Bubblewrap configuration. The browser and agents can provide a
workspace path, but cannot provide the executable, provenance, or runtime mounts. Set
`COGNATE_LINUX_CONTAINMENT_CONFIG` to a host-owned JSON file before starting Workbench, or pass the
equivalent `containmentConfig` through the server options in a controlled host integration.
Restrict writes to this file to the operator. It contains paths and assertions, not credentials.

Use this shape as a template and replace every placeholder with values reviewed for the actual
binary and host. The template is not evidence that any binary is patched or trusted.

```json
{
  "executablePath": "/absolute/path/to/reviewed/bwrap",
  "provenance": {
    "operatorVerified": true,
    "binarySha256": "<64 lowercase hex characters>",
    "version": "<version reported by the reviewed binary>",
    "source": "<reviewed source and build provenance>",
    "patchedCve202687766": true
  },
  "runtimeRoots": ["/usr/bin", "/usr/lib", "/lib", "/lib64"],
  "bunExecutable": "/absolute/path/to/bun",
  "timeoutMs": 30000,
  "maxOutputBytes": 1048576
}
```

The host validates the fields and permits only explicit public runtime directories from
`/usr/bin`, `/usr/lib`, `/usr/lib64`, `/bin`, `/lib`, and `/lib64`. Use only directories that exist
on the host and that you have reviewed. The default timeout is 30 seconds and the default combined
stdout/stderr limit is 1 MiB. Supported limits are 1–300,000 ms and 1 KiB–16 MiB. Neither limit is
a CPU, memory, process-count, or disk quota.

The host hashes the configured Bubblewrap executable before each launch and refuses a mismatch.
The provenance fields remain operator assertions; a JSON file or matching hash alone does not
prove that a binary contains a security fix. Review the actual binary, source, and build record.
See [the fixture provenance record](bubblewrap-fixture-provenance.md) for the binary used in the
current OS tests. Keep the launcher and optional Bun executable outside every selectable writable
workspace. Workbench consumes published Cognate0.5.0, whose native provider rejects trusted
launcher/Bun executable paths inside the writable root. The actual Workbench adversarial test
copies the correctly hashed launcher into that root and proves refusal before configuration events.

## Select a contained workspace

Open **Add workspace**, enter an existing dedicated directory, and explicitly choose **Linux child
containment** before opening it. The dialog reports whether host configuration is present and
Linux is supported; it also says that native preflight happens when you open the workspace. A
successful preflight records the contained execution world and selects the workspace. If
configuration, platform support, or preflight is unavailable, the choice is disabled or the error
is shown. Selection never falls back to uncontained local execution.

Workbench accepts only the selected directory as browser input. It resolves the directory to its
canonical path, rejects `/`, and rejects a root that contains the protected Workbench home. The
world identity binds that canonical root to the host configuration. On restart, Workbench restores
the world only when the host configuration still matches; without it, the saved world remains
unavailable rather than switching to local execution.

The native provider gives child processes private Linux namespaces, denies network access, mounts
the selected workspace writable, and mounts configured runtime directories read-only. The host
application itself remains outside containment. Selecting a directory also exposes all content
already in that directory, including any sensitive files or hard links; choose and inspect the
workspace accordingly.

## Verification and limits

The ordinary unit tests cover host-config validation, direct-human-only selection, restart refusal,
and failure behavior. The opt-in Workbench integration test exercises real Linux namespace
execution, workspace file access, sibling-file and loopback denial, restart, and changed-binary
refusal. The browser test covers the explicit UI choice and a contained coding flow. These OS tests
need Linux namespace support, a reviewed host attestation, and the controlled PostgreSQL test
fixture; they are not ordinary CI checks.

The feature does not isolate the Workbench process, classify secrets inside a selected directory,
provide aggregate resource quotas, or establish production readiness. Independent security review
and deployment-specific hardening remain necessary.
