# Bubblewrap containment fixture provenance

This note records the temporary Bubblewrap binary used for the contained-workspace OS tests. It is a test fixture, not a Workbench dependency, shipped executable, or claim that the Workbench is production-hardened.

## Source and fix

The fixture was built from the official [`containers/bubblewrap` v0.12.0 release](https://github.com/containers/bubblewrap/releases/tag/v0.12.0). GitHub identifies annotated tag object `014a04330642e5c870418beb621532cb896e0002`, which points to source commit `2a76602a8c71f36c1527cf9fc3417d9149822e0c`. GitHub's tag API reported `verification.verified: true`. A local `git verify-tag` check could not run because the environment's read-only home prevented GPG from creating `~/.gnupg`; the signature result here is GitHub's verification, not a local GPG verification.

The upstream [`NEWS.md`](https://github.com/containers/bubblewrap/blob/2a76602a8c71f36c1527cf9fc3417d9149822e0c/NEWS.md) says v0.12.0 resolves absolute symlinks during setup with `openat2(RESOLVE_IN_ROOT)` or its fallback, fixing [GHSA-pxhw-h44j-8pfx / CVE-2026-87766](https://github.com/containers/bubblewrap/security/advisories/GHSA-pxhw-h44j-8pfx). The source's `LICENSE` is LGPL 2.1 or later.

The installed Ubuntu binary was not used as patched evidence. Its package was `0.11.1-1ubuntu0.3`, SHA-256 `523da3e7399044be5163aee6f57a77a6bef7454376e28f0a0627920bae1b76b6`. [USN-8779-1](https://ubuntu.com/security/notices/USN-8779-1) listed `0.11.1-1ubuntu0.2` as the Resolute fix, but [USN-8779-2](https://ubuntu.com/security/notices/USN-8779-2) says that fix was reverted and lists `0.11.1-1ubuntu0.3`. The package changelog agrees. The isolated v0.12.0 build avoids making a false patched claim about the installed package.

## Isolated build record

The source checkout is `.tmp/donor/bubblewrap-0.12`; the build tree and downloaded build-tool packages are under `.tmp/tools/bubblewrap-v0.12-build`. No source files were copied into Workbench, no system package was installed, and `/usr/bin/bwrap` was not replaced.

The build used Meson 1.10.1, Ninja 1.13.2, GCC 15.2.0, pkg-config 2.5.1, and libcap 2.75. `meson` and `libcap-dev` packages were downloaded with `apt-get download`, then extracted with `dpkg-deb -x` into the task-owned build directory. The extracted libcap library directory was exposed through a local `usr/lib64` symlink to the package's `usr/lib/x86_64-linux-gnu`; `PKG_CONFIG_SYSROOT_DIR` kept include and link paths inside that extraction.

The dependency preparation commands were:

```sh
cd .tmp/tools/bubblewrap-v0.12-build/debs
apt-get download meson libcap-dev
dpkg-deb -x libcap-dev_1%3a2.75-10ubuntu2_amd64.deb ../root
dpkg-deb -x meson_1.10.1-1ubuntu2_all.deb ../root
cd ../../../../
ln -s lib/x86_64-linux-gnu .tmp/tools/bubblewrap-v0.12-build/root/usr/lib64
```

The configured build command was:

```sh
CC=/usr/bin/gcc \
PKG_CONFIG_SYSROOT_DIR="$PWD/.tmp/tools/bubblewrap-v0.12-build/root" \
PYTHONPATH="$PWD/.tmp/tools/bubblewrap-v0.12-build/root/usr/lib/python3/dist-packages" \
PKG_CONFIG_PATH="$PWD/.tmp/tools/bubblewrap-v0.12-build/root/usr/lib/x86_64-linux-gnu/pkgconfig" \
.tmp/tools/bubblewrap-v0.12-build/root/usr/bin/meson setup --wipe \
  .tmp/tools/bubblewrap-v0.12-build/out \
  .tmp/donor/bubblewrap-0.12 \
  -Dtests=false -Dman=disabled -Dselinux=disabled \
  --prefix=/tmp/bubblewrap-v0.12-install
ninja -C .tmp/tools/bubblewrap-v0.12-build/out
```

The prefix was configuration metadata only; `meson install` was not run. The build had SELinux disabled and did not build or link libseccomp; Bubblewrap's Meson project has no seccomp build option or libseccomp dependency. Its built-in test suite and man-page generation were disabled. The Workbench provider separately applies its configured namespace, session, capability-drop, runtime-root, output, and timeout options when it launches the executable.

The resulting binary reports `bubblewrap 0.12.0` and has SHA-256 `44f8437bfc9a54233d765590038b497fb7a3726e797b611da29e2bc8f4d6cee1`. The temporary attestation JSON records that hash, executable path, version, source commit, and patched-CVE review flag. The integration test rehashes the configured executable and checks its version and pinned source commit before using it.

## Recorded OS test results

These are fixture-specific Linux namespace runs; they do not establish production security or deployment readiness.

| Test surface | Result | Context |
| --- | --- | --- |
| Cognate SDK Bubblewrap OS suite | 10 pass, 29 assertions, 2.60 s | Initial run before identity hardening. |
| Workbench contained-workspace integration | 2 pass, 49 assertions, 6.16 s | Initial run before identity hardening. Covers select, tools, process execution, sibling-file and loopback denial, persisted-event privacy, restart, fail-closed behavior, and digest mismatch. |
| Workbench contained-workspace E2E | 1 pass, 24 assertions, 8.83 s | Current run. Exercises the UI-to-agent flow using the contained world. |

The SDK OS run used `bun test --timeout 15000 packages/execution/test/bubblewrap.test.ts` from `.tmp/donor/cognate-admission`. The two Workbench gates used:

```sh
COGNATE_BWRAP_TESTS=1 \
COGNATE_BWRAP_TEST_ATTESTATION=/home/sprime01/projects/cognate-workbench/.tmp/tools/bubblewrap-v0.12-build/attestation.json \
bun test test/J-RW-contained-workspace.test.ts

COGNATE_BWRAP_TESTS=1 \
COGNATE_BWRAP_TEST_ATTESTATION=/home/sprime01/projects/cognate-workbench/.tmp/tools/bubblewrap-v0.12-build/attestation.json \
bun test test/E2E-contained-workspace.test.ts
```

The Cognate SDK test is gated by `COGNATE_BWRAP_TESTS=1` and a host-owned `COGNATE_BWRAP_TEST_ATTESTATION` JSON path. The Workbench integration and E2E tests use the same reviewed attestation contract. They require real Linux namespace execution and a controlled PostgreSQL fixture; ordinary CI runs skip the OS tests unless the explicit gate is enabled.

The binary remains a temporary validation artifact. It must not be treated as a supported installation or reused without rechecking the source, provenance, build inputs, and binary hash.
