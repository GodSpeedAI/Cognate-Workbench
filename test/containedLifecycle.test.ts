// #114: the port's lifetime is two constructs, not scattered checks (the root mechanism behind four review rounds of "a gap between
// two awaits"): ONE synchronous launch gate at the effect site, and ONE per-spawn scope that owns every resource the spawn acquires.
// These tests state the invariants at ground truth and then attack them with randomized dispose and lease-revocation points.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fc from "fast-check";
import { RlmRefusedError } from "@godspeedai/cognate-runtime-bun";
import { runInContainedLease } from "../src/capabilities/containedRunContext.ts";
import { LaunchGate } from "../src/capabilities/launchGate.ts";
import { scopedPort } from "./support/scopedPort.ts";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
let root: string; let marker: string; let workspace: string; let config: Parameters<typeof scopedPort>[0]; let launcherPath: string;
let spec: { argv: string[]; cwd: string; env: Record<string, string>; restrictions: Record<string, never> };

// The fixture launcher writes its OWN record as its first action: pid and a clock reading taken by the launcher itself. A launcher
// process that exists has a line here, whatever the port believes about it.
const LAUNCHER = (log: string): string => `#!/bin/sh\necho "$$ $(date +%s%N) $1" >> ${log}\nif [ "$1" = "--version" ]; then echo "bubblewrap 0.13.1"; exit 0; fi\nexit 0\n`;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "contained-lifecycle-"));
  workspace = join(root, "ws"); await mkdir(workspace); await mkdir(join(root, "bin"));
  marker = join(root, "launcher-starts");
  launcherPath = join(root, "bin", "bwrap");
  const text = LAUNCHER(marker); const exe = "#!/bin/sh\necho child\n";
  await writeFile(launcherPath, text); await chmod(launcherPath, 0o755);
  await writeFile(join(root, "bin", "child"), exe); await chmod(join(root, "bin", "child"), 0o755);
  config = { authorize: async () => {}, launcher: { path: launcherPath, sha256: sha(text) }, executables: [{ path: join(root, "bin", "child"), sha256: sha(exe) }], workspaceRoot: workspace, writableRoots: [] };
  spec = { argv: [join(root, "bin", "child"), "--serve"], cwd: workspace, env: {}, restrictions: {} };
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const startedProcesses = (): number => (existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean).length : 0);
const ownedDescriptors = (): number => readdirSync("/proc/self/fd").filter((fd) => { try { const link = readlinkSync(`/proc/self/fd/${fd}`); return link === launcherPath || link === workspace || link.startsWith(join(root, "bin")); } catch { return false; } }).length;

describe("one synchronous launch gate: the only place a process is started", () => {
  test("no other call to Bun.spawn or Bun.spawnSync exists in the contained port's modules", () => {
    const dir = join(import.meta.dir, "..", "src", "capabilities");
    const sites: Record<string, number> = {};
    for (const file of readdirSync(dir).filter((f) => /^(contained|launchGate).*\.ts$/.test(f))) {
      const code = readFileSync(join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      const n = (code.match(/\bBun\.spawn(?:Sync)?\s*\(/g) ?? []).length;
      if (n > 0) sites[file] = n;
    }
    expect(sites).toEqual({ "launchGate.ts": 2 });                      // exactly the gate's spawn and spawnSync
  });

  test("the gate refuses once closed, and for a revoked permit, without calling the spawn API; it counts only launches it began", () => {
    const gate = new LaunchGate();
    expect(gate.begun).toBe(0);
    const ok = gate.spawnSync(undefined, [process.execPath, "--version"], { stdout: "pipe", stderr: "pipe" });   // positive control: it launches
    expect(ok.exitCode).toBe(0);
    expect(gate.begun).toBe(1);
    let active = true;
    const permit = { get active() { return active; } };
    expect(gate.spawnSync(permit, [process.execPath, "--version"], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
    expect(gate.begun).toBe(2);
    active = false;
    expect(() => gate.spawnSync(permit, [process.execPath, "--version"], { stdout: "pipe", stderr: "pipe" })).toThrow(/lease|ended/);
    expect(() => gate.spawn(permit, [process.execPath, "--version"], {})).toThrow(/lease|ended/);
    expect(gate.begun).toBe(2);
    gate.close();                                                         // dispose's first statement
    expect(() => gate.spawnSync(undefined, [process.execPath, "--version"], { stdout: "pipe", stderr: "pipe" })).toThrow(/disposed/);
    expect(() => gate.spawn(undefined, [process.execPath, "--version"], {})).toThrow(/disposed/);
    expect(gate.begun).toBe(2);
    expect(gate.inFlight).toBe(0);
  });
});

describe("one scope per spawn owns every resource: randomized dispose and lease-revocation points", () => {
  test("every await point of the spawn path is observable (the property below is not vacuous)", async () => {
    const port = scopedPort(config);
    const labels: string[] = [];
    port.__debug().onAwait = (label) => { labels.push(label); };
    await port.spawn(spec as never, { intentId: "i", runId: "r" });
    await port.dispose();
    expect(labels.length).toBeGreaterThanOrEqual(6);
    expect(new Set(labels).size).toBeGreaterThanOrEqual(5);
  });

  const SEED = Number(process.env.LIFECYCLE_SEED ?? 114);
  const RUNS = Number(process.env.LIFECYCLE_RUNS ?? 500);
  test(`for ${RUNS} random schedules (seed ${SEED}): no launcher process starts after dispose or revocation, nothing leaks, every started process is accounted for`, async () => {
    const baselineFds = ownedDescriptors();
    let disposed = 0; let revoked = 0; let spawnedOk = 0; let refusedOk = 0; let started = 0;
    await fc.assert(fc.asyncProperty(
      fc.record({ disposeAt: fc.option(fc.nat(24), { nil: undefined }), revokeAt: fc.option(fc.nat(24), { nil: undefined }), allow: fc.boolean(), reach: fc.constantFrom("none" as const) }),
      async (plan) => {
        const port = scopedPort({ ...config, authorize: async () => { if (!plan.allow) throw new RlmRefusedError("rlm-containment-unavailable", "rlm-profile-unauthorized: property deny"); } });
        const debug = port.__debug();
        const baseBegun = debug.launcherCalls; const baseStarted = startedProcesses();
        let n = 0; let begunAtDispose: number | undefined; let revokedHere = false; let startsAtDispose: number | undefined;
        let revoke!: () => void; const revoked_ = new Promise<void>((resolve) => { revoke = resolve; });
        debug.onAwait = () => {
          const at = n++;
          if (plan.disposeAt === at) { begunAtDispose = debug.launcherCalls; startsAtDispose = startedProcesses(); void port.dispose(); }   // dispose runs at this exact await
          if (plan.revokeAt === at) { revokedHere = true; revoke(); }
        };
        let outcome: "spawned" | "refused" = "refused"; let id: string | undefined;
        let settled!: Promise<void>;
        await runInContainedLease({ runId: "r", reach: plan.reach }, async () => {
          settled = port.spawn(spec as never, { intentId: "i", runId: "r" }).then((r) => { outcome = "spawned"; id = r.id; }, (error) => { if (!(error instanceof RlmRefusedError)) throw error; });
          await Promise.race([settled, revoked_]);                       // the run returns (lease revoked) at the chosen await, or when the spawn settles
        });
        const beginsAtLeaseEnd = debug.launcherCalls;                       // the lease is revoked in the runner's finally: read right after it
        await settled;
        await port.dispose();
        if (id) await port.exited(id);                                    // a spawned child is torn down by dispose and its exit is observed
        // Ground truth: wait until every launch the gate BEGAN has really produced a process (the async launch logs a moment later).
        const begun = debug.launcherCalls - baseBegun;
        for (let i = 0; i < 400 && startedProcesses() - baseStarted < begun; i++) await Bun.sleep(5);
        const processes = startedProcesses() - baseStarted;
        expect(processes).toBe(begun);                                    // every begun launch is a process, and no process exists that was not begun
        if (begunAtDispose !== undefined) { disposed++; expect(processes).toBeLessThanOrEqual(begunAtDispose - baseBegun); expect(debug.launcherCalls).toBe(begunAtDispose); }   // none began after dispose
        if (revokedHere) revoked++;
        expect(debug.launcherCalls).toBe(beginsAtLeaseEnd);               // no launch began after the lease ended
        if (startsAtDispose !== undefined) expect(startsAtDispose - baseStarted).toBeLessThanOrEqual(begun);
        expect(debug.registrations).toBe(0);                              // the scope released every registration
        expect(debug.scopes).toBe(0);                                     // and is itself gone
        if (outcome === "spawned") spawnedOk++; else refusedOk++;
        started += processes;
      }),
      { seed: SEED, numRuns: RUNS });
    expect(ownedDescriptors()).toBe(baselineFds);                         // no launcher, workspace or executable descriptor left open by any schedule
    expect(disposed).toBeGreaterThan(RUNS / 10);                          // the dispose point really landed inside the spawn path often
    expect(revoked).toBeGreaterThan(RUNS / 20);
    expect(spawnedOk).toBeGreaterThan(0);                                 // positive control: unfaulted schedules do spawn
    expect(refusedOk).toBeGreaterThan(0);
    console.log(`lifecycle property: seed ${SEED}, ${RUNS} runs, disposed-in-path ${disposed}, revoked-in-path ${revoked}, spawned ${spawnedOk}, refused ${refusedOk}, launcher processes ${started}`);
  }, 900_000);
});
