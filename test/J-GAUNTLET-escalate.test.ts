// Journey J-GAUNTLET-escalate (CognitiveOS convergence 12 · #122): the OPTIONAL operator escalation
// of a frozen Case to a named Gauntlet runner. This ticket gates no part of the central proof; the
// journey proves the seam's refusals and its honesty:
//
//   * an explicit operator action spawns `gauntlet run --config <path> <intent>` through the
//     governed execution-world port, records the report/exit code/terminal state and produces NO
//     `world.settled`, no `workbench.settlement.recorded` and no SEA-Forge receipt;
//   * a missing runner, an ineligible posture and a missing frozen criterion each refuse BEFORE any
//     spawn (the escalation project directory is never created);
//   * a changed reference makes Gauntlet refuse (its own lock check) and Workbench surfaces the
//     refusal without re-freezing the ruler;
//   * duration alone never escalates, and ordinary work has no Gauntlet dependency at all.
//
// The real `gauntlet` binary is absent on this host, so the composition is driven by an executable
// fixture that stands in for it: it parses `--config`, verifies the frozen reference against
// `.gauntlet/reference.lock` exactly as Gauntlet does, and prints a small report. It is injected
// through the same seam production uses (`process.exec` in the `local` world) — production
// behaviour is not weakened for the fixture.
import { chmod, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer, type AppServer, type ServerOptions } from "../src/server.ts";
import { withTempHome } from "./helpers.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";

type Client = ReturnType<typeof createClient>;

const clientFor = (app: AppServer): Client =>
  createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });

const events = async (app: AppServer) => {
  const out: { position: number; eventType: string; payload: any; recordedAt: string }[] = [];
  for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) out.push({ position: e.position, eventType: e.eventType, payload: e.payload, recordedAt: e.recordedAt });
  return out;
};

const boot = async (home: string, options: Partial<ServerOptions>): Promise<{ app: AppServer; client: Client }> => {
  const app = await startServer({ port: 0, home, devAuth: true, executionPosture: "uncontained-local", ...options });
  return { app, client: clientFor(app) };
};

/** A controlled stand-in for the absent `gauntlet` binary. It performs Gauntlet's own reference
 *  integrity check (the `.gauntlet/reference.lock` digest against the answer key on disk) so a
 *  mutated reference refuses exactly as the real CLI would, then prints a small settled report. */
async function fixtureBinary(home: string): Promise<string> {
  const path = join(home, "gauntlet-fixture.sh");
  await writeFile(path, `#!/usr/bin/env bash
set -euo pipefail
config=""
intent=()
while [ $# -gt 0 ]; do
  case "$1" in
    --config) config="\${2:-}"; shift 2;;
    -*) shift;;
    *) intent+=("$1"); shift;;
  esac
done
if [ -z "$config" ] || [ \${#intent[@]} -eq 0 ]; then
  echo "gauntlet run: the operator intent is required (a quoted phrase)" >&2
  exit 2
fi
root="$(dirname "$config")"
touch "$root/.last-spawn"
lock="$root/.gauntlet/reference.lock"
key="$root/reference/answer-key.md"
if [ ! -f "$lock" ] || [ ! -f "$key" ]; then
  echo "gauntlet run: the reference lock is unusable" >&2
  exit 1
fi
expected="$(sed -n 's/.*"answer_key_digest": *"\\([0-9a-f]\\{64\\}\\)".*/\\1/p' "$lock")"
actual="$(sha256sum "$key" | cut -d' ' -f1)"
if [ "$expected" != "$actual" ]; then
  echo "gauntlet run: the answer key MUTATED against the reference lock: frozen $expected, current $actual — the ruler has moved (spec 9.4, I1)" >&2
  exit 1
fi
echo "run: run_id=01TESTFIXTURE000000000000000"
echo "run: terminal=settled iterations=1"
echo '{"run_id":"01TESTFIXTURE000000000000000","terminal_state":"settled"}'
exit 0
`);
  await chmod(path, 0o755);
  return path;
}

/** Freeze a case and its criterion; the caller names gate criteria from the frozen criterion. */
async function frozenCase(client: Client, caseId: string): Promise<{ criterionHash: string }> {
  await client.invoke("case.open", { caseId, desiredOutcome: `escalate ${caseId} to Gauntlet` });
  return (await client.invoke("criterion.freeze", {
    caseId,
    spec: { version: 1, requiredChecks: ["unit"], observed: ["the report"], unobserved: [], guardrails: ["read-only"], protectedInvariants: ["reference integrity"] },
  })) as { criterionHash: string };
}

const input = (caseId: string, runner = "mock-agent") => ({ caseId, assignmentId: "asg-1", criteria: ["unit"], runner, budget: { max_rounds: 2 } });

describe("J-GAUNTLET-escalate", () => {
  test("explicit escalation records the report/exit code/terminal and produces no settlement events", async () => {
    await withTempHome(async (home) => {
      const binary = await fixtureBinary(home);
      const { app, client } = await boot(home, { gauntlet: { binary } });
      try {
        const { criterionHash } = await frozenCase(client, "GAUNT-1");
        const result = (await client.invoke("case.escalate", input("GAUNT-1"))) as {
          escalationId: string; exitCode: number; stdoutRef: string; stderrRef: string; gauntletTerminal: string | null;
        };
        expect(result.exitCode).toBe(0);
        expect(result.gauntletTerminal).toBe("settled");
        expect(result.escalationId).toMatch(/^esc-/);
        // stdout is archived as the report; the fixture's report is on disk, not invented.
        expect(await readFile(result.stdoutRef, "utf8")).toContain("terminal_state");
        expect(await readFile(result.stderrRef, "utf8")).toBe("");
        // One configuration file plus the reference projection exist as a real Gauntlet project.
        const project = join(home, "escalations", "GAUNT-1");
        expect(existsSync(join(project, "GAUNTLET.md"))).toBe(true);
        const config = await readFile(join(project, "GAUNTLET.md"), "utf8");
        expect(config).toContain('default: "mock-agent"'); // the operator's own runner name
        expect(config).toContain("reference/answer-key.md");
        expect(existsSync(join(project, ".gauntlet", "reference.lock"))).toBe(true);

        // The escalation is recorded with its intent before and its disposition after — never as a settlement.
        const log = await events(app);
        const intended = log.find((e) => e.eventType === "workbench.escalation.intended");
        const recorded = log.find((e) => e.eventType === "workbench.escalation.recorded");
        expect(intended).toBeDefined();
        expect(recorded).toBeDefined();
        expect(intended!.position).toBeLessThan(recorded!.position);
        expect(recorded!.payload).toMatchObject({ exitCode: 0, gauntletTerminal: "settled", version: 1 });
        expect(recorded!.payload.referenceDigest).toBe(criterionHash);
        expect(recorded!.payload.argvDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(typeof recorded!.payload.reportRef).toBe("string");

        // No local Candidate Promotion, no governed settlement record and no receipt.
        expect(log.some((e) => e.eventType === "world.settled")).toBe(false);
        expect(log.some((e) => e.eventType === "workbench.settlement.recorded")).toBe(false);
        expect(recorded!.payload.receiptRef ?? null).toBeNull();
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("a missing runner refuses before spawn and never invents one", async () => {
    await withTempHome(async (home) => {
      const binary = await fixtureBinary(home);
      const { app, client } = await boot(home, { gauntlet: { binary } });
      try {
        await frozenCase(client, "GAUNT-2");
        await expect(client.invoke("case.escalate", input("GAUNT-2", ""))).rejects.toThrow(/name a Gauntlet runner/);
        // Nothing was projected and nothing spawned.
        expect(existsSync(join(home, "escalations", "GAUNT-2"))).toBe(false);
        expect(existsSync(join(home, "escalations", "GAUNT-2", ".last-spawn"))).toBe(false);
        const log = await events(app);
        expect(log.some((e) => e.eventType === "workbench.escalation.intended")).toBe(false);
        expect(JSON.stringify(log)).not.toContain("prime-agent");
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("an ineligible posture refuses before spawn", async () => {
    await withTempHome(async (home) => {
      const binary = await fixtureBinary(home);
      // The default contained posture does not admit a host spawn; the governed world would also refuse.
      const { app, client } = await boot(home, { gauntlet: { binary }, executionPosture: "contained" });
      try {
        await frozenCase(client, "GAUNT-3");
        await expect(client.invoke("case.escalate", input("GAUNT-3"))).rejects.toThrow(/does not admit a host spawn/);
        expect(existsSync(join(home, "escalations", "GAUNT-3"))).toBe(false);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("no frozen criterion refuses before spawn", async () => {
    await withTempHome(async (home) => {
      const binary = await fixtureBinary(home);
      const { app, client } = await boot(home, { gauntlet: { binary } });
      try {
        // A case with no criterion at all: nothing to project, nothing to spawn.
        await expect(client.invoke("case.escalate", input("GAUNT-4"))).rejects.toThrow(/no frozen criterion/);
        expect(existsSync(join(home, "escalations", "GAUNT-4"))).toBe(false);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("a changed reference makes the runner refuse and Workbench surfaces it without re-freezing", async () => {
    await withTempHome(async (home) => {
      const binary = await fixtureBinary(home);
      const { app, client } = await boot(home, { gauntlet: { binary } });
      try {
        await frozenCase(client, "GAUNT-5");
        const first = (await client.invoke("case.escalate", input("GAUNT-5"))) as { exitCode: number; gauntletTerminal: string | null };
        expect(first.exitCode).toBe(0);
        expect(first.gauntletTerminal).toBe("settled");

        // The operator edits the frozen reference after it was locked.
        const answerKey = join(home, "escalations", "GAUNT-5", "reference", "answer-key.md");
        const edited = `${await readFile(answerKey, "utf8")}\n- tampered\n`;
        await writeFile(answerKey, edited);
        const before = (await events(app)).filter((e) => e.eventType === "criterion.frozen").length;

        const second = (await client.invoke("case.escalate", input("GAUNT-5"))) as { exitCode: number; gauntletTerminal: string | null; stderrRef: string };
        // Gauntlet refused; Workbench surfaces the refusal (exit code + stderr) and does not invent a terminal.
        expect(second.exitCode).toBe(1);
        expect(second.gauntletTerminal).toBeNull();
        expect(await readFile(second.stderrRef, "utf8")).toContain("MUTATED");
        // Workbench did NOT re-freeze: the edited reference is untouched and no new criterion was frozen.
        expect(await readFile(answerKey, "utf8")).toBe(edited);
        const after = (await events(app)).filter((e) => e.eventType === "criterion.frozen").length;
        expect(after).toBe(before);

        const recorded = (await events(app)).filter((e) => e.eventType === "workbench.escalation.recorded");
        expect(recorded.at(-1)!.payload).toMatchObject({ exitCode: 1, gauntletTerminal: null });
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("duration alone does not escalate", async () => {
    await withTempHome(async (home) => {
      const binary = await fixtureBinary(home);
      const { app, client } = await boot(home, { gauntlet: { binary } });
      try {
        await frozenCase(client, "GAUNT-6");
        // Ordinary case work passes; time passing never starts an escalation.
        await new Promise((r) => setTimeout(r, 60));
        const log = await events(app);
        expect(log.some((e) => e.eventType.startsWith("workbench.escalation."))).toBe(false);
        expect(existsSync(join(home, "escalations"))).toBe(false);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("ordinary runs have no Gauntlet dependency (no process, no config requirement at boot)", async () => {
    await withTempHome(async (home) => {
      // No `gauntlet` binary configured and none installed: boot must not touch it.
      const { app, client } = await boot(home, {});
      try {
        const { criterionHash } = await frozenCase(client, "GAUNT-7");
        expect(criterionHash).toMatch(/^[0-9a-f]{64}$/);
        await client.invoke("affordance.field", { caseId: "GAUNT-7" });
        const log = await events(app);
        expect(log.some((e) => e.eventType.startsWith("workbench.escalation."))).toBe(false);
        expect(existsSync(join(home, "escalations"))).toBe(false);
      } finally {
        await app.stop();
      }
    });
  }, 120_000);

  test("the refused spawn path archives the reason and records it without a report", async () => {
    await withTempHome(async (home) => {
      // A binary that does not exist: the spawn fails; Workbench records the refusal, not a settlement.
      const { app, client } = await boot(home, { gauntlet: { binary: join(home, "definitely-absent-gauntlet") } });
      try {
        await frozenCase(client, "GAUNT-8");
        await expect(client.invoke("case.escalate", input("GAUNT-8"))).rejects.toThrow(/refused before spawn/);
        const recorded = (await events(app)).filter((e) => e.eventType === "workbench.escalation.recorded");
        expect(recorded).toHaveLength(1);
        expect(recorded[0]!.payload).toMatchObject({ exitCode: -1, gauntletTerminal: null });
        expect(await readFile(recorded[0]!.payload.stderrRef, "utf8")).not.toBe("");
      } finally {
        await app.stop();
      }
    });
  }, 120_000);
});
