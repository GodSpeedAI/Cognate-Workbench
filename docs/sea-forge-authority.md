# SEA-Forge as Workbench's external authority

By default Workbench decides its own approvals. With SEA-Forge governance on, **SEA-Forge decides**:
every capability call and consequential action is sent to SEA-Forge as a CEP `authority_request`. When
SEA-Forge escalates, the run waits, and the action does not run, until the operator approves or rejects
it. SEA-Forge records every decision in its append-only ledger.

Off by default. A standalone Workbench is unchanged.

## Requirements

- **Contained execution posture** (`COGNATE_EXECUTION_POSTURE=contained`, the default) with host
  containment configured (`COGNATE_LINUX_CONTAINMENT_CONFIG`). Workbench refuses to start with SEA-Forge
  governance under `uncontained-local`. Any process running as your OS user can speak to SEA-Forge on
  the operator's behalf, and only containment keeps agent processes away from the SEA-Forge socket.
- A SEA-Forge server with the `resources` policy filter, and Cognate SDK 0.6.2 or later, in which an approval
  governs only the operation it was granted for (Cognate PR #60).
- DomainForge at the stack lockstep version (0.21.1) for the governed world.

## Identity: one OS user, two actors

SEA-Forge binds one OS user to exactly one actor. Workbench's process is bound to `cognate-service` and
is also SEA-Forge's gateway. Authority requests come from `cognate-service`. When you approve or reject
in Workbench, the decision goes to SEA-Forge `on_behalf_of` the operator actor. So the requester and the
approver are different actors, and SEA-Forge refuses a requester approving its own escalation.

## The governed world

The world is Workbench's own interaction model. Derive its `world_ref` with DomainForge:

```bash
cd .sea/interaction
domainforge envelope --emit cep --world-name workbench interaction-model.sea | jq -r .scope.world_ref
```

## Reference SEA-Forge cell (`server.yaml`)

Replace `1000` with your uid (`id -u`). Copy `interaction-model.sea` into the cell's `worlds/` directory.

```yaml
socket_path: /run/user/1000/sea-forge-workbench.sock
identity:
  bindings:
    - { uid: 1000, actor_id: cognate-service, roles: [service] }
    - { actor_id: operator, roles: [operator] }
gateway: { uid: 1000, actor: cognate-service, delegable_actors: [operator] }
cep_authority:
  enabled: true
  policy: policy.yaml
  worlds:
    - { name: workbench, base: worlds, entry: interaction-model.sea, files: [interaction-model.sea] }
```

## Reference policy (`policy.yaml`)

The first matching rule wins. Agent actions with external effects need your approval; everything else
Workbench calls is allowed; the operator may resolve approvals.

```yaml
version: "0.1"
rules:
  - name: consequential-agent-effects
    verdict: allow
    requires_approval: true
    actor_role: service
    operation_kind: cognate_capability
    resources: ["tool.edit", "tool.bash", "tool.run_code", "expert.tool.invoke", "plugin.install", "plugin.uninstall"]
  - name: workbench-capabilities
    verdict: allow
    actor_role: service
    operation_kind: cognate_capability
  - name: workbench-actions
    verdict: allow
    actor_role: service
    operation_kind: cognate_action
  - name: operator-approves
    verdict: allow
    actor_role: operator
    operation_kind: approval_resolution
  # Settlement (below): Workbench submits RealityTrace's evidence and asks SEA-Forge to settle.
  - { name: evidence, verdict: allow, actor_role: service, operation_kind: evidence_mutation }
  - { name: settlement, verdict: allow, actor_role: service, operation_kind: settlement_declaration }
```

## Turning it on

```bash
export COGNATE_GOVERNANCE=sea-forge
export COGNATE_SEA_FORGE_SOCKET=/run/user/1000/sea-forge-workbench.sock
export COGNATE_WORLD_REF='world:workbench@sha256:…'   # from the DomainForge command above
export COGNATE_SEA_FORGE_OPERATOR=operator
just dev
```

A partial or inconsistent configuration is an error at startup, never a silent fallback to `off`.
`governance.status` reports the mode, world and actors.

## What you see

When an agent asks for a consequential action, the chat shows **Action awaiting approval**, naming the
capability and the SEA-Forge approval id, and the session reads "Waiting for approval". Approve, and the
run resumes and the action runs once. Reject, and it never runs.

## Settlement: did the authorized work achieve what was expected?

An approval says the agent may act. Settlement says whether the action did what the operator expected.
SEA-Forge decides it, on evidence RealityTrace recorded. Workbench only carries the evidence and reports
the outcome.

1. **Declare the proof before the run.** `workspace.proof.declare { workspaceId, argv, cwd?, timeoutS? }`
   (operator only, outside any run) fixes the command that judges the workspace's agent runs, e.g.
   `["bun", "test"]`. It applies to runs that start after the declaration. An agent can neither declare
   nor change it.
2. **RealityTrace runs it.** When a governed agent run ends, RealityTrace runs the declared proof with
   its `command` verifier. The proof runs under the same bubblewrap containment as agent tools, with the
   workspace mounted read-only and nothing else reachable. RealityTrace records the exit code, the
   output and a digest of the workspace tree it verified.
3. **SEA-Forge settles.** For each consequential operation of the run (`tool.edit`, `tool.bash`,
   `tool.run_code`), Workbench submits RealityTrace's evidence and asks SEA-Forge to settle. With
   `cep_authority.realitytrace` configured, SEA-Forge corroborates each evidence item against
   RealityTrace's own ledger and refuses a packet that differs from it.
   - A passing proof is **settled**; a failing one is **rejected**; both are final.
   - With no proof declared, the run is **not settled**, and the session says why.

The session shows each operation's outcome, the proof's exit code and the verified digest
(`settlement.status`). A run that ended while Workbench was down is settled at the next boot, once.

Turn it on with the same RealityTrace homes in both places:

```bash
export COGNATE_REALITYTRACE_BIN=/usr/local/bin/realitytrace
export COGNATE_REALITYTRACE_DATA_HOME=$HOME/.local/share      # RealityTrace's XDG_DATA_HOME
export COGNATE_REALITYTRACE_STATE_HOME=$HOME/.local/state     # RealityTrace's XDG_STATE_HOME
```

```yaml
# SEA-Forge server.yaml, under cep_authority:
realitytrace:
  bin: /usr/local/bin/realitytrace
  data_home: /home/op/.local/share
  state_home: /home/op/.local/state
```

Settlement needs SEA-Forge governance and host containment; a partial configuration is a startup error.
The workspace must be a git checkout, because RealityTrace enrolls it by its repository identity.

## Limits

- Every capability call, including ordinary UI calls, makes a round trip to SEA-Forge and adds a ledger
  entry.
- The proof judges the workspace as it is when the run ends. Two concurrent runs in one workspace are
  judged together.
- The verifier's sandbox mirrors the SDK's bubblewrap world, whose argv is not exported. Keep them in step.
- The in-app approval gate still applies inside SEA-Forge's decision as a stricter local check.

Evidence: `test/J-SEA-FORGE-AUTHORITY.test.ts` (opt-in: `SEA_FORGE_SERVER_BIN`, the real-bwrap
prerequisites). It runs a real sea-forge-server, a real contained workspace and the mock model.
