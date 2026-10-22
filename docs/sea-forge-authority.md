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
- A SEA-Forge server with the `resources` policy filter, and a Cognate SDK in which an approval governs
  only the operation it was granted for (Cognate PR #60).
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

## Limits

- Every capability call, including ordinary UI calls, makes a round trip to SEA-Forge and adds a ledger
  entry.
- Settlement through SEA-Forge (RealityTrace evidence → `authority_settle`) is not wired yet.
- The in-app approval gate still applies inside SEA-Forge's decision as a stricter local check.

Evidence: `test/J-SEA-FORGE-AUTHORITY.test.ts` (opt-in: `SEA_FORGE_SERVER_BIN`, the real-bwrap
prerequisites). It runs a real sea-forge-server, a real contained workspace and the mock model.
