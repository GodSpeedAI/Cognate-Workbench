# Tutorial: your first run

A guided session with a real model endpoint. By the end you will have configured a provider, selected
a workspace, watched the agent use tools, and seen an approval gate do its job.

## Before you start

- Bun 1.4+ and Just installed.
- A PostgreSQL 18 database, or a machine where `just db-setup` can install pg0 (Linux x86-64 / WSL).
- API credentials for at least one model endpoint you control.
- A throwaway directory you are happy to let an agent edit. Do not point this at something you care
  about yet.

Start from a clean checkout:

```bash
git clone https://github.com/GodSpeedAI/Cognate-Workbench.git
cd Cognate-Workbench
bun install
just db-setup
just dev
```

Expected output:

```
setup-pg0: pg0 0.15.2 installed at .tmp/pg0/pg0 (sha256 verified)
[cognate-workbench] listening on http://127.0.0.1:3180 (home: …/.data)
[cognate-workbench] dev auth: Authorization: Bearer …
```

Open `http://127.0.0.1:3180`.

## Step 1 — get past the first-run dialogs

Two dialogs appear on a fresh home directory: a notice, then an API-key prompt.

Dismiss each one.

**Verify it worked.** Both should be gone, and they stay gone across a reload. Deleting your home
directory brings them back, because the dismissal is durable per home.

If they reappear on every reload, your home directory is not persisting — check `COGNATE_WORKBENCH_HOME`
and that the process can write to it.

## Step 2 — configure a model

Open **Settings → Models**. Add a provider:

| Field | Example | Notes |
|---|---|---|
| Provider id | `my-endpoint` | Your name for it, not the vendor's |
| Base URL | `https://api.example.com/v1` | |
| Wire protocol | `openai-compatible`, `openai-responses`, or `anthropic-messages` | Match your endpoint |
| Model id | whatever your endpoint exposes | |
| API key | your key | Stored in `secrets.json`, never in the event log |

Save.

**Verify it worked.** The provider appears as current. No restart is needed — this is a hot swap, and
if the replacement fails to activate the previous one stays usable.

To confirm the provider is actually reachable before you spend a turn, try a one-token request from
your provider's own tooling. The app does not health-check the endpoint for you.

## Step 3 — make a workspace

In the sidebar, add a workspace and pick a directory. For this tutorial, create one:

```bash
mkdir -p ~/workbench-demo/src
cd ~/workbench-demo
printf 'export const greet = (name: string): string => `Hello, ${name}!`;\n' > src/greet.ts
printf '# demo\n' > README.md
```

Then select it. A selected workspace is shown as current in the sidebar.

**Verify it worked.** The composer becomes usable. Before a workspace is selected it is disabled —
that is deliberate, not a bug.

## Step 4 — send a turn

Type something that requires reading a file:

```
What is in src/greet.ts?
```

**Expected results:**

1. The user message appears immediately.
2. A tool card appears for `read`, with its arguments visible.
3. The assistant answers with the file's contents.
4. The status pill resolves to "Worked" and shows a duration.

**Verify it worked.** Expand the tool card. You should see the file path and the result, not just a
summary. Click **Settings → General → Work details** and switch the verbosity to `compact`, then
`verbose`, and send another turn — the tool detail suffix appears and disappears accordingly.

## Step 5 — watch the edit path

```
Change src/greet.ts to return "Hi" instead of "Hello".
```

**Expected results:** a `read` of the file, then an `edit`. If the file has not been read yet in this
session, the agent reads it first — the read-before-edit guard is enforced, and the refusal is fed
back to the model as a tool result rather than crashing the turn.

A file-change control appears in the transcript with a `+N -M` line count. Open it for a split diff.

## Step 6 — see an approval gate

This is the part worth practising.

Set the composer's access mode to `read-only` (the default). Then ask for something that
needs escalation:

```
Run a Python snippet with full access that writes a file called probe.txt in the workspace.
```

**Expected results:**

1. The turn stops. A consequential card appears with the tool, its arguments, the requested
   permission, and the justification.
2. The run's status is waiting — the transcript does not spin.
3. `Enter` allows, `Escape` denies.

**Verify durability, which is the actual point:** reload the page. The card is still there. Stop the
server with `Ctrl-C` and run `just dev` again. The card is *still* there, and the run is still
waiting. Decide, and the turn completes.

That survival is a deliberate property of this application and is covered by
`test/J-D-approval.test.ts`. It is covered in
[Approval escalation](../workflows/approval-escalation.md).

## Step 7 — try protected evidence

Protected paths are enforced structurally, before a tool runs. Ask the agent to write somewhere it
should not, such as a pattern you have protected in the workbench, or simply outside the workspace
root:

```
Write a file at ../escaped.txt
```

**Expected result:** `Error: blocked by authority (...)` as a tool result. The turn continues; the
model sees the refusal and adapts. Nothing is written.

## Step 8 — leave yourself a trail

Open the execution trace view. Every step you just performed is there as an ordered record, with the
tool arguments and results.

If you installed RealityTrace with `just setup-realitytrace`, observations additionally show a
delivery state per event. Without it, they stay queued — which is honest, not an error.

## Step 9 — leave and come back

Stop the server. Start it again.

**Verify it worked.** Your sessions are still listed. Open one: its transcript is intact. Sessions,
approvals and plans all come back, because they are events, not memory. See
[Restart and recovery](../workflows/restart-and-recovery.md).

## What you have learned

- The composer is gated on a selected workspace.
- Tool calls are visible with arguments and results, at four verbosity levels.
- Privilege escalation produces a durable, survivable approval.
- Protected paths block structurally, not by prompt.
- The whole session survives a restart.

## Where to go next

- [Tutorial: the workbench cockpit](workbench-cockpit.md) — shape a task and accept it against
  evidence.
- [Mental model](../mental-model.md) — why it works this way.
- [Troubleshooting](../troubleshooting.md) — when it does not.