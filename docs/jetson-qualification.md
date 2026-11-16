# Jetson AGX Orin qualification runbook

Executed by the operator on their device (this effort's access to the machine is read-only;
the prerequisites below are device state changes only the owner can authorize). Drafted in B5
of `desktop-native-completion`; executed in E2. A red run is a release blocker for the Jetson
target only — never silently skipped, never inferred from a generic ARM64 CI run.

## Machine (probed 2026-11-06, read-only)

- NVIDIA Jetson AGX Orin Developer Kit, JetPack 6 / L4T R36.5, Ubuntu 22.04.5, aarch64,
  kernel 5.15.185-tegra, 61 GiB RAM.
- Present: Rust 1.95, GTK 3.24. WebKitGTK 4.1 **not installed** (available in the Ubuntu
  repos as 2.50.4). No Bun needed on-device: the sidecar embeds the runtime.

## Prerequisites (operator-authorized)

1. `sudo apt install ./cognate-workbench-shell_<version>_arm64.deb` — the shell deb's
   dependency resolution installs `libwebkit2gtk-4.1-0` and the other GTK/webkit runtime
   packages. (Alternative: `sudo apt install libwebkit2gtk-4.1-0` first.)
2. Confirm a graphical session exists (`loginctl show-session <id> -p Type` — X11 or
   Wayland; WebKitGTK works under both, record which).
3. Headroom: ~1 GB disk for the package + resources, and the bundled PostgreSQL instance
   (data home: `~/.local/share/cognate-workbench`).

## Steps

1. Obtain the arm64 shell `.deb` from the `tauri` workflow's `tauri-linux-arm64` job (the
   `ubuntu-22.04-arm` runner's artifact; verify its SHA256 against the workflow's output).
2. Install per the prerequisites above.
3. Run the T1 harness from a terminal in the graphical session:
   `scripts/qualify-tauri.sh --bundle /tmp/wb-shell.deb` (copy the artifact to a space-free
   name first; `dpkg-deb -x` needs no sudo, or point `--shell` at the installed binary).
4. **Compositing check**: the window renders the Workbench UI under the device's actual
   compositor — verified by the operator's screenshot. If the webview renders garbled or
   blank, export `WEBKIT_DISABLE_DMABUF_RENDERER=1` and re-run; record whichever
   configuration passed as the supported one (the NVIDIA-driver DMABUF failure class is a
   known WebKitGTK hazard, documented — not a discovered surprise).
5. Record the environment fingerprint in the mission's `verification.md`:
   JetPack/L4T version, WebKitGTK version (`dpkg -l libwebkit2gtk-4.1-0`), session type,
   compositor, DMABUF state, package checksums, command log, screenshot.
6. Menu interaction (Workbench menu items enable after the page loads; a dispatched
   New Session creates a session) and the close-confirm dialog (with a run in flight) are
   operator-verified in the same pass — the WSLg host cannot automate native menu clicks
   (no xdotool) and records those rows implemented-per-code.
7. Shutdown/restart: close the window, confirm the bundled database stopped
   (`~/.local/share/cognate-workbench` lock released, no pg0 process), relaunch, confirm
   reuse of the interrupted owner's database if the close was abrupt.

## Gate

- PASS with evidence → the Jetson target is qualified for this build (per commit SHA and
  artifact checksum).
- FAIL → release blocker for the Jetson target, recorded with the failing step's log; the
  other four platform targets are unaffected.
- NOT RUN → the Jetson target ships explicitly marked unverified; the release notes say so.
