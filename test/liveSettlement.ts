// Shared harness for the live settlement journeys (J-SW01, J-SW02): a real sea-forge-server governing the
// Workbench world with RealityTrace corroboration, a real RealityTrace, and the host's bwrap attestation.
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { expect } from "bun:test";
import { externalAuthorityFromEnv, type ExternalAuthority } from "../src/capabilities/governance.ts";
import type { ContainmentConfig } from "../src/capabilities/containedWorkspace.ts";
import type { RealityTraceSettings } from "../src/settlement/realitytrace.ts";

export const SF = process.env.SEA_FORGE_SERVER_BIN;
export const RT = process.env.REALITYTRACE_BIN;
const DF = process.env.WB_DOMAINFORGE_BIN ?? "domainforge";
/** The live journeys' shared prerequisites: SEA-Forge, RealityTrace and real bwrap on Linux. */
export const liveSettlementEnabled = Boolean(SF && RT) && process.env.COGNATE_BWRAP_TESTS === "1" && Boolean(process.env.COGNATE_BWRAP_TEST_ATTESTATION) && process.platform === "linux";

export const SETTLEMENT_POLICY = `version: "0.1"
rules:
  - name: consequential-agent-effects
    verdict: allow
    requires_approval: true
    actor_role: service
    operation_kind: cognate_capability
    resources: ["tool.edit", "tool.bash", "tool.run_code"]
  - { name: workbench-capabilities, verdict: allow, actor_role: service, operation_kind: cognate_capability }
  - { name: workbench-actions, verdict: allow, actor_role: service, operation_kind: cognate_action }
  - { name: evidence, verdict: allow, actor_role: service, operation_kind: evidence_mutation }
  - { name: settlement, verdict: allow, actor_role: service, operation_kind: settlement_declaration }
  - { name: operator-approves, verdict: allow, actor_role: operator, operation_kind: approval_resolution }
`;

export async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what} (last: ${JSON.stringify(v).slice(0, 400)})`);
    await Bun.sleep(100);
  }
}

/** RealityTrace's documented target digest, recomputed here without its code. */
export async function treeDigest(root: string): Promise<string> {
  const lines: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== ".git") await walk(p); }
      else if (e.isFile()) lines.push(`${relative(root, p)}\0f\0${createHash("sha256").update(await readFile(p)).digest("hex")}\n`);
    }
  };
  await walk(root);
  lines.sort();
  return `sha256:${createHash("sha256").update(lines.join("")).digest("hex")}`;
}

/** A committed git repository at `dir` holding `files`. */
export async function gitWorkspace(dir: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  for (const args of [["init", "-q"], ["add", "-A"], ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]]) {
    expect(Bun.spawnSync(["git", ...args], { cwd: dir }).exitCode).toBe(0);
  }
}

export interface LiveCell {
  readonly root: string;
  readonly socket: string;
  readonly rtData: string;
  readonly worldRef: string;
  readonly realitytrace: RealityTraceSettings;
  readonly externalAuthority: ExternalAuthority;
  readonly containmentConfig: ContainmentConfig;
  /** Run the real `realitytrace` against this cell's homes; returns its JSON. */
  rtRun(args: string[]): unknown;
  stop(): Promise<void>;
}

/** Start sea-forge-server (RealityTrace corroboration required) over the Workbench world in a fresh root. */
export async function startLiveCell(prefix: string): Promise<LiveCell> {
  const root = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const socket = join(tmpdir(), `${prefix}-${process.pid}-${randomUUID().slice(0, 8)}.sock`);
  const rtData = join(root, "rt-data");
  const rtState = join(root, "rt-state");
  let server: ReturnType<typeof Bun.spawn> | undefined;
  const stop = async () => {
    server?.kill();
    await rm(root, { recursive: true, force: true });
    await rm(socket, { force: true });
  };
  try {
    await mkdir(rtData);
    await mkdir(rtState);
    await mkdir(join(root, "worlds"));
    await copyFile(join(import.meta.dir, "../.sea/interaction/interaction-model.sea"), join(root, "worlds/interaction-model.sea"));
    const envelope = Bun.spawnSync([DF, "envelope", "--emit", "cep", "--world-name", "workbench", "interaction-model.sea"], { cwd: join(root, "worlds") });
    expect(envelope.exitCode, envelope.stderr.toString()).toBe(0);
    const worldRef = JSON.parse(envelope.stdout.toString()).scope.world_ref as string;
    const uid = process.getuid!();
    await writeFile(join(root, "policy.yaml"), SETTLEMENT_POLICY);
    await writeFile(join(root, "server.yaml"), JSON.stringify({
      socket_path: socket,
      root,
      identity: { bindings: [{ uid, actor_id: "cognate-service", roles: ["service"] }, { actor_id: "operator", roles: ["operator"] }] },
      gateway: { uid, actor: "cognate-service", delegable_actors: ["operator"] },
      cep_authority: {
        enabled: true, policy: "policy.yaml",
        worlds: [{ name: "workbench", base: "worlds", entry: "interaction-model.sea", files: ["interaction-model.sea"] }],
        realitytrace: { bin: RT, data_home: rtData, state_home: rtState, require_corroboration: true },
      },
    }));
    server = Bun.spawn([SF!], { env: { ...process.env, SEA_FORGE_ROOT: root, SEA_FORGE_SOCKET: socket }, stdout: "ignore", stderr: process.env.WB_SF_LOG ? Bun.file(process.env.WB_SF_LOG) : "ignore" });
    await until(async () => existsSync(socket), Boolean, "sea-forge-server socket");
    return {
      root, socket, rtData, worldRef,
      realitytrace: { bin: RT!, dataHome: rtData, stateHome: rtState },
      externalAuthority: externalAuthorityFromEnv({ COGNATE_GOVERNANCE: "sea-forge", COGNATE_SEA_FORGE_SOCKET: socket, COGNATE_WORLD_REF: worldRef, COGNATE_SEA_FORGE_OPERATOR: "operator" })!,
      containmentConfig: JSON.parse(await readFile(process.env.COGNATE_BWRAP_TEST_ATTESTATION!, "utf8")) as ContainmentConfig,
      rtRun(args) {
        const p = Bun.spawnSync([RT!, ...args, "--json"], { env: { XDG_DATA_HOME: rtData, XDG_STATE_HOME: rtState, PATH: process.env.PATH ?? "" } });
        expect(p.exitCode, p.stderr.toString()).toBe(0);
        return JSON.parse(p.stdout.toString());
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
