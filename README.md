# Cognate Workbench

An open-source coding agent harness for work that somebody is accountable for. Authority is declared before the agent acts. Traces are inspectable afterward. Settled work becomes reusable capability.

Bring your own models, change the tools, and inspect every tool call, approval, and state change. Built on the [Cognate SDK](https://github.com/GodSpeedAI/Cognate). Runs in the browser against local project directories.

## Why it exists

Most agent tooling asks you to trust the agent. Workbench asks for the route, the evidence, and the trace. It keeps models, tools, environments, and workflows separate, so you can change one without redoing the rest.

| Principle | What it means |
| --- | --- |
| Composable | Models, tool implementations, execution environments, and workflows are separate. Change one without touching the others. |
| Observable | Model output, tool calls, agent activity, state changes, and approvals are recorded. The final chat message is not the only evidence. |
| Durable | The Cognate runtime stores events and state in PostgreSQL. Sessions, approvals, and projections survive restarts. |
| Explicit control | Authority, boundaries, task contracts, and acceptance evidence are defined in the system, not in prompt text. |
| Usable out of the box | A browser coding agent with sessions, streaming, tools, plans, subagents, and approvals. Task and review workflows are optional. |

## Who it is for

- Power users who already customize prompts, tools, models, agent roles, and workflows.
- Harness builders who need an observable environment for testing capabilities, delegation, execution, and verification.
- Solo developers and small teams running long, multi-step projects where supervising agent activity matters.

If you only need a chat box that edits files, Workbench is more than you need. If you need to answer "what did the agent do, and may it do that again", it fits.

## What works today

### Coding

- File reading, editing, shell, and code-execution tools in real local project directories.
- Streaming responses, session history, run cancellation, plans, and subagent delegation.
- Model providers can be changed without restarting. Adapters: OpenAI-compatible, OpenAI Responses, Anthropic-compatible. Local and hosted endpoints both work.
- Execution environments: local, SSH, and WSL where supported.

### Experts and Teams

- Persistent, editable Experts with individual model routes and scoped memory.
- Cognate Team: Product Manager coordinates Builder, Critic, Verifier and Reviewer as needed.
- Custom Teams with one atomic Orchestrator role, durable Assignments, correlated Specialist returns and human settlement.
- Native roster, configuration, conversations, approvals, evidence inspection and recovery controls.

Open **Experts & Teams** in the sidebar. See [using Experts and Teams](docs/experts-and-teams.md) for setup, authority and recovery details.

### Traces

- Inspect tool invocations, output, refusals, and event-backed session traces.
- Follow durable events and projections through the PostgreSQL-backed runtime.
- Optional **RealityTrace** adds observation receipts and evidence correlation. Workbench runs without it.

### Structure

- Task contracts that define goals, skills, authority, invariants, and acceptance criteria.
- Task boards, a skill and capability catalog, and represented workflow dependencies.
- Human approval gates and protected-evidence checks on supported write operations.
- Steering of an active run at its next step boundary, with context preserved.
- Recorded evidence, worker returns, and review decisions. "The agent says it's done" is not acceptance.

### Known limits

Some features record intent but do not act on it yet.

| Feature | Current behavior |
| --- | --- |
| Capability substitution | Recorded. Does not rebind a running tool. |
| Parallelism plans | Recorded. Do not start workers. |
| Legacy automation records | Stored workflow intent; native Expert/Team schedules now execute due work through Cognate. See [schedules](docs/schedules.md). |
| Budget information | Workbench planning economics remain informational. Expert Assignment attempts enforce configured model limits before invocation, and session and global spending ceilings fail closed. |


## Quick start

**Requirements:** [Bun](https://bun.sh/) 1.4+, [Just](https://github.com/casey/just), and PostgreSQL 18 or the pinned [pg0](https://github.com/vectorize-io/pg0) distribution. The bundled pg0 installer targets Linux x86_64 and WSL.

```bash
git clone https://github.com/GodSpeedAI/Cognate-Workbench.git
cd Cognate-Workbench
bun install
just db-setup    # installs checksum-verified pg0 (Linux x86_64 / WSL)
just dev
```

Open **http://127.0.0.1:3180**. Set your model endpoint in **Settings → Models**, then select a workspace.

To use an existing PostgreSQL instance, skip pg0 and set a connection URL:

```bash
export COGNATE_POSTGRES_URL='postgres://USER:PASSWORD@HOST:5432/DATABASE'
just dev
```

The app binds to `127.0.0.1` and stores local state in `.data/`. Set `COGNATE_WORKBENCH_HOME` to use a different data directory.

> **Warning:** The server uses a development authenticator. Do not expose it to untrusted networks or users.

### Optional: RealityTrace

Install the pinned CLI to enable RealityTrace and its evidence-delivery tests. Requires Rust and Cargo.

```bash
just setup-realitytrace
```

Alternatively, set `SXR_BIN` to an existing compatible executable. Without RealityTrace, observation delivery stays queued and is never reported as completed.

### Commands

| Command | Purpose |
| --- | --- |
| `just dev` | Start Workbench |
| `just typecheck` | Check TypeScript |
| `just smoke` | Run focused contract and configuration tests |
| `just test` | Run the full suite. Needs optional integration prerequisites. |
| `just verify` | Typecheck, then run the full suite |
| `just db-status` | Inspect the local pg0 instance |
| `just db-down` | Stop local pg0. Data is kept. |

Full command, environment and configuration reference: [docs](docs/README.md).

## Customize

| Path | What you change |
| --- | --- |
| `.sea/interaction/` | Semantic interaction and domain model |
| `domain/index.ts` | Semantic-to-capability bindings |
| `src/capabilities/` | Agent actions and their enforcement boundaries |
| `src/components/` | Model and other runtime components |
| `src/workbench/` | Task, workflow, authority, skill, and review logic |
| `src/projections/` | Derived views of durable activity |
| `src/ui/` | Cockpit, panels, and interface behavior |
| `.agents/skills/` | Development skills, including Building with Cognate and its modeling skills |
| `test/` | Agent journeys, invariants, and browser tests |

The design path is capability contract, then implementation binding, then executor binding. A capability keeps its meaning while its mechanism and execution environment change. Not all of this is wired into execution yet.


## Origin

Workbench began as a reconstruction of the DeepSeek Harness experience. It has since diverged into its own product, built on Cognate's event-sourced runtime and explicit semantic capabilities. The interface and workflow ideas are starting points. They do not require copying another harness's architecture.

## Status

Active development. Working today: coding-agent interactions, durable runtime state, traces, approval workflows, task contracts, native Experts and Teams, and a browser cockpit. Partial: orchestration and automation. Isolation is opt-in only — a host-configured Linux execution world can contain a workspace, but it is not the default. Read the [known gaps](docs/known-gaps.md) for the specific limitation on each.

The development authenticator and tool guards are not a production multi-user security boundary. Path checks and best-effort shell parsing are not a sandbox, so by default agents cannot run commands or write files in a local (uncontained) workspace: use a [Linux contained workspace](docs/linux-contained-workspaces.md), or start with `COGNATE_EXECUTION_POSTURE=uncontained-local` to let agents act on this computer as you. Read the [known gaps and validation evidence](docs/known-gaps.md) before using Workbench with untrusted code or data.

To let SEA-Forge, not Workbench, decide which agent actions may run, see [SEA-Forge as the external authority](docs/sea-forge-authority.md). It is off by default.

## Documentation

[docs/README.md](docs/README.md) is the map of the system: orientation, architecture, subsystems, execution workflows, design explanation, tutorials, how-to guides and technical reference.

- [Getting started](docs/getting-started.md)
- [Mental model](docs/mental-model.md) and [architecture](docs/architecture.md)
- [Glossary](docs/glossary.md)
- [Known gaps](docs/known-gaps.md)
- [Mobile remote control](docs/REMOTE.md): pairing with a passkey, the trust model, and tunnel setup
- [Troubleshooting](docs/troubleshooting.md)
- [Source map](docs/source-map.md)

## License

[Apache License 2.0](LICENSE).
