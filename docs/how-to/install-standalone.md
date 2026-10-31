# Install the standalone Cognate Workbench

A standalone package is a single executable with its browser assets and the pinned `pg0` PostgreSQL manager.
It needs no Bun, no Node, no source checkout and no PostgreSQL that you install yourself. On first start it
creates its own local database under your user profile.

## Install

| Platform | Package | Install |
|---|---|---|
| Linux x86_64 | `cognate-workbench_<version>_amd64.deb`, `…-linux-x64.tar.gz` | `sudo dpkg -i <file>.deb` |
| Linux ARM64 (NVIDIA Jetson, Ubuntu 22.04) | `cognate-workbench_<version>_arm64.deb`, `…-linux-arm64.tar.gz` | `sudo dpkg -i <file>.deb`, or `bash scripts/install-cognate-workbench.sh` |
| Windows x86_64 | `cognate-workbench-<version>-windows-x64-setup.exe`, `…-windows-x64.zip` | run the setup (per-user, no administrator rights) |
| macOS ARM64 | `cognate-workbench-<version>-darwin-arm64.pkg` / `.dmg` | open the `.pkg` (administrator password) |
| macOS Intel | `cognate-workbench-<version>-darwin-x64.pkg` / `.dmg` | open the `.pkg` (administrator password) |

Every download has a `.sha256` file and the release has a `SHA256SUMS` file. Check them before you install.

The installers are **not signed or notarised**. macOS and Windows will ask you to confirm the first run.

### One-line Linux install (verifies, installs, cleans up)

```bash
bash scripts/install-cognate-workbench.sh            # latest release
bash scripts/install-cognate-workbench.sh v0.1.0     # a named release
```

The script downloads into a temporary directory under `/tmp`, checks the checksums and the package
architecture, installs with `sudo dpkg -i`, confirms the bundled `pg0` against the release manifest, and deletes
its download directory on exit. It does not touch your home directory and enables no service.

## Run

```bash
cognate-workbench doctor     # what this installation uses, and whether it is healthy
cognate-workbench start      # starts the bundled database if needed, then the server
```

Open `http://127.0.0.1:3180` in a browser on the same machine. The server listens on loopback only.

On a Jetson or any remote machine, forward the port over SSH from your desktop:

```powershell
ssh -N -L 3180:127.0.0.1:3180 jetson
```

Then open `http://127.0.0.1:3180` on the desktop. No public tunnel is created.

## Where data lives

| Platform | Data home (durable state, credentials, database files, logs) |
|---|---|
| Linux | `$XDG_DATA_HOME/cognate-workbench` (default `~/.local/share/cognate-workbench`) |
| macOS | `~/Library/Application Support/CognateWorkbench` |
| Windows | `%LOCALAPPDATA%\CognateWorkbench` |

Inside the data home:

- `database/bundled.json`: the record of this home's bundled database (instance name, data directory, the
  generated password, whether it was initialised). Mode `0600`.
- `database/data/`: the PostgreSQL data directory. Mode `0700`.
- `logs/pg0.log`: output of the database manager.
- `server.lock`: the running owner's process ID. A stale lock is taken over automatically after a crash.

The installed program files are read-only resources under the install prefix. Nothing durable is written there.
The bundled database's engine is kept by `pg0` under `~/.pg0`, outside the install prefix; it survives uninstall.

`COGNATE_WORKBENCH_HOME` overrides the data home.

## The bundled database

The default. On first `start`, Workbench:

1. verifies the bundled `pg0` executable against the sha256 in the release manifest, and refuses to run it if
   it differs;
2. records a new database for this data home with a freshly generated 192-bit password;
3. starts it with that data directory and password, and reads the endpoint it reports.

On every later start it reconnects to the same data directory with the same recorded password. It never
initialises a second database for a home that already has one.

It refuses, with a message that names the condition, when:

- the recorded database has disappeared or its data directory has moved (it will not create an empty store);
- a `pg0` instance with this name exists but this home has no record of it (it will not adopt it);
- the PostgreSQL version differs from the one this build expects;
- another live Workbench already owns the data home.

Stopping Workbench cleanly (`Ctrl-C`, `SIGTERM`, or a service manager stop) stops only the database this data
home owns. A crash leaves the database running; the next start reconnects to it.

## Use an external PostgreSQL server instead

Set `COGNATE_POSTGRES_URL` to a server you manage. Workbench then never starts, adopts or stops the bundled
database.

```bash
COGNATE_POSTGRES_URL='postgres://user:password@db.example:5432/cognate' cognate-workbench start
```

If the external server is unreachable or rejects the credentials, Workbench refuses to start. It never falls
back to the bundled database or to an in-memory store. Keep the URL in a file readable only by you, not in shell
history. `doctor` prints the URL with the password masked.

## Upgrade and uninstall

- **Upgrade**: install the newer package over the old one. The data home and the bundled database are kept, and
  the new version reads the state the old one wrote. Stop Workbench first.
- **Uninstall**: `sudo dpkg -r cognate-workbench` (Linux), the Windows uninstaller in Apps, or remove
  `/usr/local/lib/cognate-workbench` and `/usr/local/bin/cognate-workbench` (macOS). Uninstall removes the program
  files only. Your data home, its database and any other PostgreSQL instance remain. Delete the data home
  yourself if you want to discard the data.

## Security notes and known limits

- Credentials: the bundled database password is generated from the operating system's cryptographic random
  source and stored in the data home (mode `0600`). `pg0` also writes it to its own instance metadata, which
  Workbench tightens to `0600` on each start. On Windows, access follows your user profile's file permissions.
- Process arguments: `pg0` takes the password as a command-line argument when it starts the database. Other
  users on the same machine may see it in the process list while that command runs. `pg0` has no
  secret-provisioning interface, so this is a limit of the bundled manager. For a shared machine, use an
  external server with its own credentials.
- The bundled database listens on `127.0.0.1` only, on a port `pg0` chooses.
- Installers are unsigned. Verify checksums against `SHA256SUMS` from the release.
- Agent execution stays contained by default (`COGNATE_EXECUTION_POSTURE=contained`). `doctor` reports whether
  bubblewrap is available for contained execution.

## Troubleshooting

| Message | Meaning and fix |
|---|---|
| `bundled pg0 is missing` / `failed integrity verification` | The install is incomplete or altered. Reinstall the package. |
| `refusing to create an empty store` | The recorded database is gone. Restore it, or move the data home aside to start fresh. Nothing was created. |
| `refusing to adopt an instance` | A database with this name exists that this data home did not create. Remove it only if you know it is yours. |
| `is using data home … stop it first` | Another Workbench is running on this data home. Stop it. |
| `port … already in use (EADDRINUSE)` | Choose another port with `PORT=…`. No database was touched. |
| `this build expects …` | The database's PostgreSQL version differs from this build's. Use the matching build. |

The logs for the bundled database are in `<data home>/logs/pg0.log`.
