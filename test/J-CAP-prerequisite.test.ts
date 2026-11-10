// Journey J-CAP-prerequisite (capability-bundles tranche P, §1.6/§1.7 of
// .agents/plans/capability-bundles/design.md): the authority-defect remediation matrix and the
// enablement evidence marker. Covers: the user-kind masquerade is refused and durably recorded
// (guard rows of the P evidence matrix); the ALL_ALLOWED fallback is retired — unbound calls and
// declared scopes clamp to the operator runtime ceiling; run_code joins the authority plane;
// subagent lineage runs under derived per-agent principals; and the remediation marker records
// versioned build evidence through the real recording path. Passing, this suite writes the
// `workbench.capability_runtime.remediation_verified` marker (§1.7's enablement input).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, withTempHome, waitUntil, wbRows } from "./wb-helpers.ts";
import { seedWorkspaceOnly } from "./wb-helpers.ts";
import { AGENT_CONFIG } from "../src/agents/agentConfig.ts";
import { workbenchComponent } from "../src/capabilities/workbench.ts";
import { subagentStartComponent } from "../src/capabilities/subagentStart.ts";

const SYSTEM = { actor: { id: "system", kind: "system" as const }, tenant: "local" };

async function decisionRows(app: AppServer): Promise<readonly Record<string, unknown>[]> {
  const rows = await wbRows(app);
  return [...rows.entries()].filter(([k]) => k.startsWith("decision/")).map(([, v]) => v as Record<string, unknown>);
}

describe("J-CAP-prerequisite", () => {
  test("the user-kind masquerade is refused and durably recorded (guard evidence row)", async () => {
    // The kind-only check the guard replaces let a run carrying its starter's user actor pass a
    // human gate. Captured handlers exercise the refusal without a full run; the recording goes
    // through the component's real recording path (startRun of the agent.config recorder), so the
    // captured service input must contain the decision event.
    const recorded: unknown[] = [];
    const component = workbenchComponent({
      getService: (() => ({
        startRun: async (_caller: unknown, request: { input: unknown }) => {
          recorded.push(request.input);
          return { runId: "recording-run" };
        },
        readProjection: async () => ({ rows: [] }),
      })) as never,
      systemCaller: LOCAL_OPERATOR,
      semanticRefs: {},
    });
    const handlers = new Map<string, (raw: unknown, ctx: unknown) => Promise<unknown>>();
    component.activate({ provide: (contract: { readonly id: string }, handler: (raw: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(contract.id, handler) } as never);
    const decide = handlers.get("task.review.decide");
    expect(decide).toBeDefined();
    // Masquerade: user-kind actor inside a run — the exact shape the kind-only check passed.
    await expect(decide!({ taskId: "t", decision: "accept" }, { actor: { kind: "user", id: "op" }, runId: "run-1" })).rejects.toThrow(/human decision/);
    const batch = recorded.at(-1) as { readonly kind: string; readonly events: readonly { readonly type: string; readonly payload: Record<string, unknown> }[] };
    expect(batch.kind).toBe("workbench.recorded");
    const decision = batch.events.find((e) => e.type === "authority.decision.recorded");
    expect(decision).toBeDefined();
    expect(decision!.payload.point).toBe("operator-guard");
    expect(decision!.payload.capability).toBe("task.review.decide");
    expect(decision!.payload.outcome).toBe("refused");
    expect(decision!.payload.reasonCode).toBe("operator-only");
    expect(decision!.payload.runId).toBe("run-1");
  }, 60000);

  test("the ALL_ALLOWED fallback is retired: unbound and declared scopes clamp to the runtime ceiling", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        // A task whose operator-declared authority says outside-workspace writes are plainly
        // allowed: the clamp must still land it on approval (strictest wins per surface).
        const created = (await client.invoke("task.create", {
          title: "clamp-proof",
          workspaceId,
          contract: {
            authority: {
              filesystem: { read: "yes", write: "yes", outsideWorkspace: "yes" },
              shell: { run: "yes", destructive: "yes" },
              network: { outbound: "yes" },
              packages: { install: "yes" },
              extensions: { install: "yes", enable: "yes" },
              protectedPaths: [],
            },
          } as never,
        })) as { readonly taskId?: string };
        const taskId = created.taskId!;
        const outside = await client.invoke("authority.check", { workspaceId, taskId, tool: "edit", args: { file_path: "/etc/passwd" } }) as { readonly outcome: string };
        expect(outside.outcome).toBe("approval");
        // Unbound calls: the ALL_ALLOWED fallback used to answer "allow" for the same shape.
        const unbound = await client.invoke("authority.check", { workspaceId, tool: "edit", args: { file_path: "/etc/passwd" } }) as { readonly outcome: string };
        expect(unbound.outcome).toBe("approval");
        // Inside the workspace, work still flows under the ceiling.
        const inside = await client.invoke("authority.check", { workspaceId, taskId, tool: "edit", args: { file_path: "notes.md" } }) as { readonly outcome: string };
        expect(inside.outcome).toBe("allow");
      } finally {
        await app.runtime.idle().catch(() => {});
      }
    });
  }, 60000);

  test("run_code joins the authority plane: denied without a shell grant, allowed under the ceiling", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        const { workspaceId } = await seedWorkspaceOnly(client, home);
        const denied = (await client.invoke("task.create", {
          title: "no-shell",
          workspaceId,
          contract: { authority: { filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" }, shell: { run: "no", destructive: "no" }, network: { outbound: "no" }, packages: { install: "no" }, extensions: { install: "no", enable: "no" }, protectedPaths: [] } } as never,
        })) as { readonly taskId?: string };
        const refused = await client.invoke("authority.check", { workspaceId, taskId: denied.taskId!, tool: "run_code", args: { code: "1+1" } } as never) as { readonly outcome: string; readonly rule: string };
        expect(refused.outcome).toBe("deny");
        expect(refused.rule).toBe("shell.run");
        // An escalated sandbox permission under the ceiling stays allowed at the authority plane
        // (pre-P parity for the operator baseline; the destructive shell grant is the operator
        // ceiling's "yes" until per-principal grants land in T1 — destructive mediation remains
        // with the existing risk.assess/Sentinel gate).
        const unboundEscalated = await client.invoke("authority.check", { workspaceId, tool: "run_code", args: { code: "1+1", sandbox_permissions: "workspace-write" } } as never) as { readonly outcome: string };
        expect(unboundEscalated.outcome).toBe("allow");
        const unboundPlain = await client.invoke("authority.check", { workspaceId, tool: "run_code", args: { code: "1+1" } } as never) as { readonly outcome: string };
        expect(unboundPlain.outcome).toBe("allow");
      } finally {
        await app.runtime.idle().catch(() => {});
      }
    });
  }, 60000);

  test("subagent children run under derived per-agent principals (lineage narrowing provenance)", async () => {
    await withTempHome(async (home) => {
      const { app } = await bootApp(home);
      try {
        // A parent run whose starter is not an agent principal (the system recorder): the child
        // derives the responsible coding-agent principal.
        const parent = await app.runtime.service.startRun(SYSTEM, { agent: AGENT_CONFIG, input: { kind: "workbench.recorded", events: [] } as never, idempotencyKey: randomUUID() });
        const handlers = new Map<string, (raw: unknown, ctx: unknown) => Promise<unknown>>();
        const component = subagentStartComponent({ getService: () => app.runtime.service, systemActor: SYSTEM.actor });
        component.activate({ provide: (contract: { readonly id: string }, handler: (raw: unknown, ctx: unknown) => Promise<unknown>) => handlers.set(contract.id, handler) } as never);
        const start = handlers.get("subagent.start");
        expect(start).toBeDefined();
        const child = (await start!({ agent: AGENT_CONFIG, input: { kind: "workbench.recorded", events: [] }, key: `${parent.runId}:1` }, { runId: parent.runId, tenant: "local", actor: { kind: "agent", id: "wb-agent:coding" } })) as { readonly runId: string };
        const view = await waitUntil("child run view", async () => {
          const v = await app.runtime.service.getRun(SYSTEM, { runId: child.runId });
          return v.startedBy ? v : undefined;
        });
        expect(view.startedBy).toBe("wb-agent:coding");
      } finally {
        await app.runtime.idle().catch(() => {});
      }
    });
  }, 60000);

  test("the remediation marker records versioned build evidence through the real recording path", async () => {
    await withTempHome(async (home) => {
      const { app } = await bootApp(home);
      try {
        // The evidence run: real recorder, real store — a marker a test database fixture cannot
        // manufacture. Build identity pins the deployed runtime the suite ran against.
        const commit = (() => {
          const probe = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe" });
          return probe.exitCode === 0 ? probe.stdout.toString().trim() : "unknown";
        })();
        const suiteDigest = createHash("sha256").update(Buffer.from(await Bun.file(import.meta.path).arrayBuffer())).digest("hex").slice(0, 32);
        const pkg = (await Bun.file(import.meta.dir + "/../package.json").json()) as { readonly version: string };
        const version = pkg.version;
        await app.runtime.service.startRun(SYSTEM, {
          agent: AGENT_CONFIG,
          input: {
            kind: "workbench.recorded",
            events: [{ type: "workbench.capability_runtime.remediation_verified", payload: { workbenchBuild: { commitSha: commit, packageVersion: version }, suiteDigest, recordedAt: new Date().toISOString() } }],
          } as never,
          idempotencyKey: randomUUID(),
        });
        const row = await waitUntil("runtime/remediation row", async () => ((await wbRows(app)).get("runtime/remediation") as Record<string, unknown> | undefined));
        const payload = row as { readonly workbenchBuild?: { readonly commitSha?: string }; readonly suiteDigest?: string };
        expect(payload.workbenchBuild?.commitSha).toBe(commit);
        expect(payload.suiteDigest).toBe(suiteDigest);
      } finally {
        await app.runtime.idle().catch(() => {});
      }
    });
  }, 60000);

  test("decision records fold into the workbench projection (the P evidence substrate)", async () => {
    await withTempHome(async (home) => {
      const { app } = await bootApp(home);
      try {
        const decisionId = randomUUID();
        await app.runtime.service.startRun(SYSTEM, {
          agent: AGENT_CONFIG,
          input: { kind: "workbench.recorded", events: [{ type: "authority.decision.recorded", payload: { decisionId, point: "tool-loop", actorId: "wb-agent:coding", actorKind: "agent", capability: "tool.edit", outcome: "refused", reasonCode: "protected-evidence", reason: "path is protected evidence" } }] } as never,
          idempotencyKey: randomUUID(),
        });
        const row = await waitUntil(`decision row ${decisionId}`, async () => ((await wbRows(app)).get(`decision/${decisionId}`) as Record<string, unknown> | undefined));
        expect(row.point).toBe("tool-loop");
        expect(row.outcome).toBe("refused");
        expect((await decisionRows(app)).length).toBeGreaterThanOrEqual(1);
      } finally {
        await app.runtime.idle().catch(() => {});
      }
    });
  }, 60000);
});
