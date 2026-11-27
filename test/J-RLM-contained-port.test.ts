// J-RLM-contained-port (SEA-Forge #114): real-bubblewrap conformance for the contained `StdioSpawnPort`.
// Opt-in (COGNATE_BWRAP_TESTS=1, the repo convention) so hosted CI skips it; a skip is NOT a pass.
//
// Method (governed-runtime-probing): a controlled fixture child ATTEMPTS each forbidden effect and
// every verdict is observed from OUTSIDE the sandbox (file hashes, host listener counts, the host's
// /proc), never from the child's own report. Each denial is paired with a positive control that runs
// the SAME fixture script uncontained and shows the effect does happen when allowed.
// Fixture interpreter: the host's system python3 (/usr/bin/python3.x, package-owned, digest-pinned by
// this test as host configuration). It runs from the read-only runtime roots with no extra mounts, its
// stdlib covers fork/setsid/sockets/signals, and it is installed on every Linux CI runner; a static
// binary would need a toolchain, and bun would be bound in as an extra file.
// Run: COGNATE_BWRAP_TESTS=1 bun test test/J-RLM-contained-port.test.ts  (bwrap on PATH or COGNATE_BWRAP_PATH)
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { createSocket } from "node:dgram";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { StdioSpawnSpec } from "@godspeedai/cognate-runtime-api";
import { launchPlanDigest } from "../src/capabilities/containedLaunch.ts";
import { containedStdioSpawnPort, type ContainedStdioSpawnPort, type ExitRecord } from "../src/capabilities/containedStdioPort.ts";

const enabled = process.env.COGNATE_BWRAP_TESTS === "1" && process.platform === "linux";
const realTest = enabled ? test : test.skip;
const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ctx = { intentId: "intent-114", runId: "run-114" };
const CHILD = join(import.meta.dir, "fixtures", "contained-child.py");

// ── host-side observation helpers (independent of the port's own bookkeeping) ──
const ppidOf = (pid: number): number | undefined => { try { const s = readFileSync(`/proc/${pid}/stat`, "utf8"); return Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]); } catch { return undefined; } };
const nsOf = (pid: number): string | undefined => { try { return readlinkSync(`/proc/${pid}/ns/pid`); } catch { return undefined; } };
const allPids = (): number[] => readdirSync("/proc").filter((e) => /^\d+$/.test(e)).map(Number);
/** Every host pid inside the sandbox's pid namespace, found from the launcher pid through the host's /proc. */
function sandboxMembers(launcherPid: number): { ns: string | undefined; pids: number[] } {
  const kid = allPids().find((pid) => ppidOf(pid) === launcherPid);
  const ns = kid ? nsOf(kid) : undefined;
  return { ns, pids: ns ? allPids().filter((pid) => nsOf(pid) === ns) : [] };
}
const alive = (pid: number, ns: string | undefined): boolean => existsSync(`/proc/${pid}`) && nsOf(pid) === ns;
const nsPidToHost = (members: number[], nsPid: number): number | undefined => members.find((pid) => { try { return Number(readFileSync(`/proc/${pid}/status`, "utf8").match(/NSpid:\s+(.*)/)?.[1]?.trim().split(/\s+/).pop()) === nsPid; } catch { return false; } });
const hashTree = (dir: string): Record<string, string> => Object.fromEntries(readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => [join(e.parentPath, e.name).slice(dir.length), sha(readFileSync(join(e.parentPath, e.name)))]).sort());
const netDevices = (pid: number): string[] => readFileSync(`/proc/${pid}/net/dev`, "utf8").split("\n").slice(2).map((l) => l.split(":")[0]!.trim()).filter(Boolean);

// ── host listeners the sandbox must not reach (and one it may) ──
interface Listener { readonly name: string; connections: number; data: string[]; close(): Promise<void>; address: string | number }
function tcpListener(): Promise<Listener & { port: number }> {
  return new Promise((resolve) => {
    const state = { name: "tcp-loopback", connections: 0, data: [] as string[] };
    const server = createServer((sock) => { state.connections++; sock.on("data", (d) => state.data.push(String(d))); sock.on("error", () => {}); });
    server.listen(0, "127.0.0.1", () => resolve(Object.assign(state, { port: (server.address() as { port: number }).port, address: (server.address() as { port: number }).port, close: () => new Promise<void>((r) => server.close(() => r())) })));
  });
}
function unixListener(name: string, path: string): Promise<Listener> {
  return new Promise((resolve) => {
    const state = { name, connections: 0, data: [] as string[] };
    const server: Server = createServer((sock) => { state.connections++; sock.on("data", (d) => state.data.push(String(d))); sock.on("error", () => {}); });
    server.listen(path, () => resolve(Object.assign(state, { address: path, close: () => new Promise<void>((r) => server.close(() => r())) })));
  });
}
function udpListener(): Promise<Listener & { port: number }> {
  return new Promise((resolve) => {
    const state = { name: "udp-loopback", connections: 0, data: [] as string[] };
    const sock = createSocket("udp4");
    sock.on("message", (m) => { state.connections++; state.data.push(String(m)); });
    sock.bind(0, "127.0.0.1", () => resolve(Object.assign(state, { port: sock.address().port, address: sock.address().port, close: () => new Promise<void>((r) => sock.close(() => r())) })));
  });
}

// ── a line session over the port ──
interface Session { readonly id: string; readonly lines: Record<string, unknown>[]; readonly raw: string[]; ask(msg: Record<string, unknown>, ms?: number): Promise<Record<string, any>>; hostPid: number }
async function open(port: ContainedStdioSpawnPort, spec: StdioSpawnSpec): Promise<Session> {
  const { id } = await port.spawn(spec, ctx);
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  void port.readLines(id, (line) => { raw.push(line); try { lines.push(JSON.parse(line)); } catch { /* non-protocol output */ } });
  return {
    id, lines, raw, hostPid: port.inspect(id).hostPid,
    async ask(msg, ms = 8000) {
      const from = lines.length;
      await port.write(id, JSON.stringify(msg));
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const hit = lines.slice(from).find((l) => l.op === msg.op);
        if (hit) return hit as Record<string, any>;
        await sleep(15);
      }
      throw new Error(`no reply to ${JSON.stringify(msg)} within ${ms}ms; raw=${JSON.stringify(raw.slice(-3))}`);
    },
  };
}

realTest("J-RLM-contained-port: real bubblewrap enforces filesystem, credential, network, process, ceiling and streaming controls observed from outside", async () => {
  const bwrapPath = process.env.COGNATE_BWRAP_PATH ?? Bun.which("bwrap");
  if (!bwrapPath) throw new Error("BLOCKED: COGNATE_BWRAP_TESTS=1 but no bwrap on PATH (set COGNATE_BWRAP_PATH)");
  const launcherReal = realpathSync(bwrapPath);
  const python = realpathSync(process.env.COGNATE_FIXTURE_PYTHON ?? "/usr/bin/python3");
  const launcher = { path: launcherReal, sha256: sha(readFileSync(launcherReal)) };
  const bwrapVersion = Bun.spawnSync([launcherReal, "--version"]).stdout.toString().trim();
  const pythonPin = { path: python, sha256: sha(readFileSync(python)) };
  const base = await mkdtemp(join(tmpdir(), "contained-port-"));
  const ports: ContainedStdioSpawnPort[] = [];
  const listeners: Listener[] = [];
  const evidence: Record<string, unknown>[] = [];
  const T = (m: string): void => { if (process.env.CONTAINED_PORT_TRACE) console.error(`[trace] ${m}`); };
  const record = (scenario: string, status: "PASS" | "FAIL", detail: Record<string, unknown>) => { if (process.env.CONTAINED_PORT_TRACE) console.error(`[trace] ${scenario} ${status}`); evidence.push({ scenario, status, ...detail }); };
  let failure: string | undefined;
  let manifestPlan: unknown;
  let manifestDigest: string | undefined;
  let manifestProfile: string | undefined;

  const fixture = async (label: string) => {
    const dir = join(base, label);
    const workspace = join(dir, "workspace");
    const home = join(dir, "home");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(home, ".aws"), { recursive: true });
    copyFileSync(CHILD, join(workspace, "child.py"));
    writeFileSync(join(workspace, "notes.txt"), "workspace file\n");
    const secret = `SFTEST-${randomBytes(8).toString("hex")}`;
    const envSecret = `SFTEST-ENV-${randomBytes(8).toString("hex")}`;
    const credential = join(home, ".aws", "credentials");
    writeFileSync(credential, `aws_secret_access_key = ${secret}\n`);
    const canary = join(dir, "canary.txt");
    writeFileSync(canary, `canary-${randomBytes(4).toString("hex")}\n`);
    return { dir, workspace, home, secret, envSecret, credential, canary };
  };
  const spec = (workspace: string, restrictions: StdioSpawnSpec["restrictions"] = {}): StdioSpawnSpec => ({
    argv: [python, "/workspace/child.py"], cwd: workspace, env: {}, restrictions: { filesystem: ["read-only"], subprocess: true, ...restrictions },
  });
  const makePort = (workspace: string, extra: Partial<Parameters<typeof containedStdioSpawnPort>[0]> = {}) => {
    const port = containedStdioSpawnPort({ authorize: async () => {}, launcher, executables: [pythonPin], workspaceRoot: workspace, writableRoots: [base], ...extra });
    ports.push(port);
    return port;
  };
  /** The same fixture script, run uncontained on the host, for the positive controls. */
  const control = async (extraEnv: Record<string, string>) => {
    const proc = Bun.spawn([python, CHILD], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, ...extraEnv } });
    const out: Record<string, any>[] = [];
    void (async () => { let buf = ""; for await (const c of proc.stdout as ReadableStream<Uint8Array>) { buf += new TextDecoder().decode(c); let i; while ((i = buf.indexOf("\n")) >= 0) { try { out.push(JSON.parse(buf.slice(0, i))); } catch { /* ignore */ } buf = buf.slice(i + 1); } } })();
    const ask = async (msg: Record<string, unknown>) => { const from = out.length; proc.stdin.write(JSON.stringify(msg) + "\n"); await proc.stdin.flush(); for (let i = 0; i < 400; i++) { const hit = out.slice(from).find((l) => l.op === msg.op); if (hit) return hit; await sleep(15); } throw new Error("control: no reply"); };
    return { ask, end: async () => { proc.stdin.end(); proc.kill(); await proc.exited; } };
  };

  try {
    // ════════ ESSENTIAL SCENARIOS × 3 (fresh workspace, listeners and secrets each time) ════════
    for (let rep = 1; rep <= Number(process.env.CONTAINED_PORT_REPS ?? 3); rep++) {
      const f = await fixture(`rep${rep}`);
      process.env.SFTEST_ENV_SECRET = f.envSecret;
      const tcp = await tcpListener();
      const udp = await udpListener();
      const abstractName = `\0sftest-${randomBytes(6).toString("hex")}`;
      const abstract = await unixListener("abstract-unix", abstractName);
      const otherUnix = await unixListener("host-unix-not-bound", join(f.dir, "other.sock"));
      const egress = await unixListener("host-egress-socket", join(f.dir, "egress.sock"));
      listeners.push(tcp, udp, abstract, otherUnix, egress);

      // Positive controls: the same payloads uncontained reach every host effect.
      const ctl = await control({ SFTEST_ENV_SECRET: f.envSecret });
      const ctlWrite = await ctl.ask({ op: "write", path: join(f.dir, "control-write.txt"), text: "control" });
      const ctlRead = await ctl.ask({ op: "read", path: f.credential });
      const ctlEnv = await ctl.ask({ op: "env" });
      const ctlCaps = await ctl.ask({ op: "caps" });
      const ctlTcp = await ctl.ask({ op: "tcp", host: "127.0.0.1", port: tcp.port });
      const ctlUdp = await ctl.ask({ op: "udp", host: "127.0.0.1", port: udp.port });
      const ctlUnix = await ctl.ask({ op: "unix", path: join(f.dir, "egress.sock"), payload: "CONTROL-UNIX" });
      await ctl.end();
      await sleep(150);
      const control_ = {
        writeLanded: ctlWrite.ok === true && existsSync(join(f.dir, "control-write.txt")),
        credentialReadable: ctlRead.ok === true && String(ctlRead.value).includes(f.secret),
        envSecretVisible: JSON.stringify(ctlEnv).includes(f.envSecret),
        capabilityBoundingSetNonEmpty: !/^0+$/.test(ctlCaps.caps.CapBnd), nestedUsernsPossible: ctlCaps.userns.ok === true,
        tcpReached: tcp.connections === 1, udpReached: udp.connections === 1, unixReached: egress.data.join("").includes("CONTROL-UNIX"),
      };
      expect(control_).toEqual({ writeLanded: true, credentialReadable: true, envSecretVisible: true, capabilityBoundingSetNonEmpty: true, nestedUsernsPossible: true, tcpReached: true, udpReached: true, unixReached: true });
      tcp.connections = 0; tcp.data.length = 0; udp.connections = 0; udp.data.length = 0; egress.connections = 0; egress.data.length = 0;

      // The contained run: host socket slot configured so egress is one reachable path and nothing else.
      const port = makePort(f.workspace, { hostSocket: join(f.dir, "egress.sock"), envAllowlist: ["FIXTURE_FLAG"] });
      const containedSpec = spec(f.workspace, { network: { outbound: [`host-socket:${join(f.dir, "egress.sock")}`] } });
      const { plan, digest, executionProfileDigest: profileDigest } = await port.plan({ ...containedSpec, env: { FIXTURE_FLAG: "on" } }, ctx);
      if (rep === 1) { manifestPlan = plan; manifestDigest = digest; expect(digest).toBe(launchPlanDigest(plan)); }
      // The operator-approved profile is stable across repetitions (fresh workspaces and runs) when the deployment config is
      // the same; the egress socket's resolved path is part of it, and each repetition has its own socket, so only the
      // no-network profile is compared here. The launch digest differs every time.
      const noNet = await port.plan({ ...spec(f.workspace), env: {} }, ctx);
      if (rep === 1) manifestProfile = noNet.executionProfileDigest;
      expect(noNet.executionProfileDigest).toBe(manifestProfile as string);
      expect(profileDigest).not.toBe(noNet.executionProfileDigest);
      expect(plan.executionProfileDigest).toBe(profileDigest);
      if (rep > 1) expect(digest).not.toBe(manifestDigest);
      const s = await open(port, { ...containedSpec, env: { FIXTURE_FLAG: "on" } });
      expect(port.inspect(s.id).launchPlanDigest).toBe(digest);

      const before = { workspace: hashTree(f.workspace), canary: sha(readFileSync(f.canary)), credential: sha(readFileSync(f.credential)), dirListing: readdirSync(f.dir).sort() };
      const hostNs = readlinkSync("/proc/self/ns/pid");

      // Streaming: a request/response exchange both ways.
      const echo = await s.ask({ op: "echo", v: `ping-${rep}` });
      expect(echo.echo).toBe(`ping-${rep}`);
      const hello = await s.ask({ op: "hello" });
      const mem = sandboxMembers(s.hostPid);
      const inside = { childNs: hello.ns, hostNs, procNs: mem.ns, differs: mem.ns !== undefined && mem.ns !== `pid:[${hostNs}]` && mem.ns !== hostNs, members: mem.pids.length, cwd: hello.cwd, homeExists: hello.home_exists, root: hello.root };
      expect(inside.differs).toBe(true);        // outside observation: members live in another pid namespace
      expect(hello.cwd).toBe("/workspace");
      expect(hello.home_exists).toBe(false);     // no host home
      expect(hello.root.sort()).toEqual(["dev", "lib", "lib64", "opt", "proc", "run", "tmp", "usr", "workspace"].filter((d) => hello.root.includes(d)));
      expect(hello.root).not.toContain("home");

      // M2: no capabilities and no way to regain them, read from /proc/self/status and a real unshare attempt.
      const capsReport = await s.ask({ op: "caps" });
      const zero = (v: string) => /^0+$/.test(v);
      expect(["CapEff", "CapPrm", "CapBnd", "CapInh", "CapAmb"].map((k) => zero(capsReport.caps[k]))).toEqual([true, true, true, true, true]);
      expect(capsReport.userns.ok).toBe(false);
      // The host reads the same sets from outside (the child's report is not the only evidence).
      const memberCaps = mem.pids.map((pid) => readFileSync(`/proc/${pid}/status`, "utf8").match(/CapEff:\s+(\w+)/)?.[1]);
      expect(memberCaps.every((c) => c !== undefined && zero(c))).toBe(true);

      // Filesystem: write into the workspace and outside it.
      const inWs = await s.ask({ op: "write", path: "/workspace/new.txt" });
      const overwrite = await s.ask({ op: "write", path: "/workspace/notes.txt" });
      const hostWs = await s.ask({ op: "write", path: join(f.workspace, "new-host-path.txt") });
      const outside = await s.ask({ op: "write", path: f.canary, text: "OVERWRITTEN" });
      const usr = await s.ask({ op: "write", path: "/usr/bin/pwned" });
      const tmpWrite = await s.ask({ op: "write", path: "/tmp/ok.txt" }); // scratch is tmpfs and must work (probe liveness)
      expect([inWs.ok, overwrite.ok, hostWs.ok, outside.ok, usr.ok]).toEqual([false, false, false, false, false]);
      expect(tmpWrite.ok).toBe(true);

      // Credentials: file under the (fake) host home, and env secrets.
      const readCred = await s.ask({ op: "read", path: f.credential });
      const readHome = await s.ask({ op: "read", path: join(f.home, ".aws", "credentials").replace(f.dir, "") });
      const env = await s.ask({ op: "env" });
      expect(readCred.ok).toBe(false);
      expect(readHome.ok).toBe(false);
      // Cleared env plus the allowlist; PWD (launcher chdir) and LC_CTYPE (python locale coercion) are added by the runtime itself.
      expect(Object.keys(env.env).filter((k) => !["PWD", "LC_CTYPE"].includes(k)).sort()).toEqual(["FIXTURE_FLAG", "HOME", "PATH", "SEA_EGRESS_SOCKET"]);
      expect(Object.keys(env.env)).not.toContain("SFTEST_ENV_SECRET");

      // Network: loopback TCP/UDP, external, abstract and path unix sockets, then the one host socket.
      const tcpLoop = await s.ask({ op: "tcp", host: "127.0.0.1", port: tcp.port });
      const tcpExt1 = await s.ask({ op: "tcp", host: "1.1.1.1", port: 53 });
      const tcpExt2 = await s.ask({ op: "tcp", host: "93.184.216.34", port: 80 });
      const udpLoop = await s.ask({ op: "udp", host: "127.0.0.1", port: udp.port });
      const abs = await s.ask({ op: "unix", path: abstractName });
      const otherSock = await s.ask({ op: "unix", path: join(f.dir, "other.sock") });
      const egressOk = await s.ask({ op: "unix", path: "/run/egress.sock", payload: `ONLY-EGRESS-${rep}` });
      await sleep(200);
      const devices = mem.pids.map(netDevices);
      // UDP sendto is fire-and-forget: the child may report "sent" into the empty namespace. Only the host listener count (below) is evidence for UDP.
      expect([tcpLoop.ok, tcpExt1.ok, tcpExt2.ok, abs.ok, otherSock.ok]).toEqual([false, false, false, false, false]);
      expect(egressOk.ok).toBe(true);
      expect(tcp.connections).toBe(0);
      expect(udp.connections).toBe(0);
      expect(abstract.connections).toBe(0);
      expect(otherUnix.connections).toBe(0);
      expect(egress.connections).toBe(1);        // the bound host socket, and only it, received a connection
      expect(egress.data.join("")).toBe(`ONLY-EGRESS-${rep}`);
      const hostObservations = { tcpConnections: tcp.connections, udpDatagrams: udp.connections, abstractConnections: abstract.connections, otherUnixConnections: otherUnix.connections, boundSocketConnections: egress.connections, boundSocketPayload: [...egress.data] };
      expect(devices.every((d) => d.length === 1 && d[0] === "lo")).toBe(true); // the sandbox netns has only a loopback device

      // Host-side state unchanged; no secret in anything captured.
      const after = { workspace: hashTree(f.workspace), canary: sha(readFileSync(f.canary)), credential: sha(readFileSync(f.credential)), dirListing: readdirSync(f.dir).sort() };
      expect(after).toEqual(before);
      const captured = JSON.stringify([s.raw, egress.data, tcp.data, udp.data]);
      expect(captured).not.toContain(f.secret);
      expect(captured).not.toContain(f.envSecret);

      // Processes: stubborn double-forked descendant. Control first: left alone it reaches the host socket.
      const stubbornPort = makePort(f.workspace, { hostSocket: join(f.dir, "egress.sock") });
      const nets = { network: { outbound: [`host-socket:${join(f.dir, "egress.sock")}`] } };
      const c2 = await open(stubbornPort, spec(f.workspace, nets));
      egress.data.length = 0;
      await c2.ask({ op: "stubborn", late_socket: "/run/egress.sock", delay: 1 });
      await sleep(2500);
      const controlLate = egress.data.join("").includes("LATE-FROM-DESCENDANT");
      await stubbornPort.kill(c2.id, "control done");
      expect(controlLate).toBe(true);

      egress.data.length = 0;
      const v = await open(stubbornPort, spec(f.workspace, nets));
      const stub = await v.ask({ op: "stubborn", late_socket: "/run/egress.sock", delay: 5 });
      const vm = sandboxMembers(v.hostPid);
      const grand = nsPidToHost(vm.pids, stub.pid);
      expect(grand).toBeDefined();
      process.kill(grand!, "SIGTERM");          // from outside: the descendant must ignore it (it is the stubborn kind)
      await sleep(300);
      const ignoredTerm = alive(grand!, vm.ns);
      expect(ignoredTerm).toBe(true);
      const groupPid = v.hostPid;
      const membersBefore = [...vm.pids];
      expect(membersBefore.length).toBeGreaterThanOrEqual(3);
      await stubbornPort.kill(v.id, "test teardown");
      await stubbornPort.kill(v.id, "idempotent second kill");
      const survivors = membersBefore.filter((pid) => alive(pid, vm.ns));
      const launcherAlive = existsSync(`/proc/${groupPid}`);
      await sleep(6000);                          // beyond the descendant's delayed host attempt (5s)
      const survivorsLater = membersBefore.filter((pid) => alive(pid, vm.ns));
      const lateArrived = egress.data.join("").includes("LATE-FROM-DESCENDANT");
      const exit = stubbornPort.inspect(v.id).exit as ExitRecord;
      expect(survivors).toEqual([]);
      expect(survivorsLater).toEqual([]);
      expect(launcherAlive).toBe(false);
      expect(lateArrived).toBe(false);
      expect(exit.reason).toBe("killed");
      expect(exit.residualPids).toEqual([]);
      expect(exit.nsKnown).toBe(true);
      const again = await stubbornPort.kill(v.id, "third");
      expect(again).toBeUndefined();
      expect(stubbornPort.inspect(v.id).exit).toEqual(exit); // idempotent: the first recorded exit stands

      record(`essential-${rep}`, "PASS", {
        control: control_, planDigest: digest, inside, before, after,
        capabilities: { report: capsReport, hostObservedCapEff: memberCaps },
        filesystem: { inWorkspace: inWs, overwriteExisting: overwrite, hostPathWorkspace: hostWs, outsideCanary: outside, usr, tmpfsScratch: tmpWrite },
        credentials: { readFakeCredential: readCred, readHomeRelative: readHome, envKeys: Object.keys(env.env), secretInCapturedOutput: captured.includes(f.secret) || captured.includes(f.envSecret) },
        network: { attempts: { tcpLoop, tcpExt1, tcpExt2, udpLoop, abstractUnix: abs, otherHostUnix: otherSock, boundHostSocket: egressOk }, hostObservations, sandboxNetDevices: devices },
        processes: { membersBefore, memberCountBeforeKill: membersBefore.length, descendantIgnoredHostSigterm: ignoredTerm, survivorsAfterKill: survivors, survivorsAfter6s: survivorsLater, launcherAliveAfterKill: launcherAlive, lateMarkerControlReceived: controlLate, lateMarkerAfterKillReceived: lateArrived, exit },
      });
      for (const l of [tcp, udp, abstract, otherUnix, egress]) await l.close();
      await ports.at(-2)!.kill(s.id, "scenario done");
    }

    // ════════ CEILINGS (each on its own port with small ceilings) ════════
    const f = await fixture("ceilings");
    // The fixture interpreter is the member whose argv[0] is the interpreter running the script (not the launcher, whose argv also names it); the limits are read from the host's /proc.
    const procLimits = (pids: number[]) => readFileSync(`/proc/${pids.find((pid) => { try { const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0"); return /python/.test(argv[0] ?? "") && argv.includes("/workspace/child.py"); } catch { return false; } })}/limits`, "utf8");
    const gone = (pids: number[], ns: string | undefined) => pids.filter((pid) => alive(pid, ns));

    { if (process.env.CONTAINED_PORT_TRACE) console.error("[trace] begin output bytes"); // output bytes
      const port = makePort(f.workspace, { ceilings: { outputBytes: 8192 } });
      const s = await open(port, spec(f.workspace));
      await s.ask({ op: "echo", v: "alive" });
      const m = sandboxMembers(s.hostPid);
      void port.write(s.id, JSON.stringify({ op: "flood", lines: 200 }));
      const exit = await port.exited(s.id);
      const delivered = s.raw.reduce((n, l) => n + l.length + 1, 0);
      expect(exit.reason).toBe("output-limit");
      expect(delivered).toBeLessThanOrEqual(8192);
      expect(gone(m.pids, m.ns)).toEqual([]);
      record("ceiling-outputBytes", "PASS", { ceiling: 8192, deliveredBytes: delivered, exit, survivors: gone(m.pids, m.ns) });
    }
    { if (process.env.CONTAINED_PORT_TRACE) console.error("[trace] begin line length"); // line length
      const port = makePort(f.workspace, { maxLineBytes: 4096 });
      const s = await open(port, spec(f.workspace));
      T("line: opened");
      await s.ask({ op: "echo", v: "alive" });
      T("line: echoed");
      void port.write(s.id, JSON.stringify({ op: "longline", bytes: 200_000 }));
      const exit = await port.exited(s.id);
      expect(exit.reason).toBe("line-too-long");
      expect(s.raw.every((l) => l.length <= 4096)).toBe(true); // the oversized line was never delivered to the consumer
      record("ceiling-lineBytes", "PASS", { ceiling: 4096, exit });
    }
    { if (process.env.CONTAINED_PORT_TRACE) console.error("[trace] begin wall clock"); // wall clock
      const port = makePort(f.workspace, { ceilings: { wallSeconds: 2 } });
      const started = Date.now();
      const s = await open(port, spec(f.workspace));
      await s.ask({ op: "echo", v: "alive" });
      const m = sandboxMembers(s.hostPid);
      void port.write(s.id, JSON.stringify({ op: "sleep", s: 60 }));
      const exit = await port.exited(s.id);
      const elapsed = Date.now() - started;
      expect(exit.reason).toBe("wall-clock");
      expect(elapsed).toBeGreaterThanOrEqual(1800);
      expect(elapsed).toBeLessThan(6000);
      expect(gone(m.pids, m.ns)).toEqual([]);
      record("ceiling-wallSeconds", "PASS", { ceiling: 2, elapsedMs: elapsed, exit, survivors: gone(m.pids, m.ns) });
    }
    { if (process.env.CONTAINED_PORT_TRACE) console.error("[trace] begin CPU"); // CPU
      const port = makePort(f.workspace, { ceilings: { cpuSeconds: 1 } });
      const started = Date.now();
      const s = await open(port, spec(f.workspace));
      await s.ask({ op: "echo", v: "alive" });
      const m = sandboxMembers(s.hostPid);
      void port.write(s.id, JSON.stringify({ op: "burn" }));
      const exit = await port.exited(s.id);
      const elapsed = Date.now() - started;
      expect(["cpu-ceiling", "signal"]).toContain(exit.reason);
      expect(elapsed).toBeLessThan(60_000); // CPU seconds, not wall: a loaded host stretches the wall time; the ceiling itself is the recorded reason above
      expect(gone(m.pids, m.ns)).toEqual([]);
      record("ceiling-cpuSeconds", "PASS", { ceiling: 1, elapsedMs: elapsed, exit });
    }
    { if (process.env.CONTAINED_PORT_TRACE) console.error("[trace] begin address space"); // address space (+ nofile/nproc as read from the host's /proc, not the child's report)
      const port = makePort(f.workspace, { ceilings: { nofile: 64, nproc: 50 } });
      const cap = 256 * 1024 * 1024;
      const s = await open(port, spec(f.workspace, { caps: { memoryBytes: cap } }));
      const small = await s.ask({ op: "alloc", bytes: 16 * 1024 * 1024 });  // control: a small allocation works (also proves prlimit has exec'd the interpreter)
      const m = sandboxMembers(s.hostPid);
      const limits = procLimits(m.pids);
      const big = await s.ask({ op: "alloc", bytes: 512 * 1024 * 1024 });
      const alive2 = await s.ask({ op: "echo", v: "still-running-after-denied-allocation" });
      expect(limits).toMatch(new RegExp(`Max address space\\s+${cap}\\s+${cap}`));
      expect(limits).toMatch(/Max open files\s+64\s+64/);
      expect(limits).toMatch(/Max processes\s+50\s+50/);
      expect(small.ok).toBe(true);
      expect(big.ok).toBe(false);
      expect(alive2.echo).toBe("still-running-after-denied-allocation");
      record("ceiling-addressSpace", "PASS", { cap, hostObservedLimits: limits.split("\n").filter((l) => /address space|open files|processes|cpu time/i.test(l)), smallAlloc: small, bigAlloc: big, note: "the port records no exit reason for an allocation failure: RLIMIT_AS makes the allocation fail inside the child, it is not a termination" });
      await port.kill(s.id, "done");
    }

    { if (process.env.CONTAINED_PORT_TRACE) console.error("[trace] begin tmp and file size"); // M3: tmpfs size and RLIMIT_FSIZE
      const small = makePort(f.workspace, { ceilings: { tmpBytes: 1024 * 1024, fsizeBytes: 512 * 1024 } });
      const s = await open(small, spec(f.workspace));
      await s.ask({ op: "echo", v: "alive" });
      const m = sandboxMembers(s.hostPid);
      const py = m.pids.find((pid) => { try { const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0"); return /python/.test(argv[0] ?? "") && argv.includes("/workspace/child.py"); } catch { return false; } });
      const hostLimits = readFileSync(`/proc/${py}/limits`, "utf8");
      const hostMounts = readFileSync(`/proc/${py}/mountinfo`, "utf8").split("\n").filter((l) => l.includes(" /tmp "));
      const oneBig = await s.ask({ op: "filltmp", path: "/tmp/big", chunk: 1024 * 1024, count: 1 });       // over RLIMIT_FSIZE
      await s.ask({ op: "unlink", path: "/tmp/big" });                                                         // free the partial 512K it left
      const first = await s.ask({ op: "filltmp", path: "/tmp/a", chunk: 256 * 1024, count: 1 });            // fits
      const second = await s.ask({ op: "filltmp", path: "/tmp/b", chunk: 256 * 1024, count: 2 });           // fits (total 768K)
      const third = await s.ask({ op: "filltmp", path: "/tmp/c", chunk: 256 * 1024, count: 2 });            // exceeds the 1 MiB tmpfs
      expect(hostLimits).toMatch(/Max file size\s+524288\s+524288/);
      expect(hostMounts.join("\n")).toMatch(/size=1024k/);
      expect(oneBig.ok).toBe(false);
      expect([first.ok, second.ok]).toEqual([true, true]);
      expect(third.ok).toBe(false);
      // Control: the default ceilings let the same total be written.
      const roomy = makePort(f.workspace);
      const r = await open(roomy, spec(f.workspace));
      const ctlA = await r.ask({ op: "filltmp", path: "/tmp/a", chunk: 256 * 1024, count: 2 });
      const ctlB = await r.ask({ op: "filltmp", path: "/tmp/b", chunk: 256 * 1024, count: 2 });
      expect([ctlA.ok, ctlB.ok]).toEqual([true, true]);
      record("ceiling-tmpBytes-and-fsize", "PASS", { hostObservedLimits: hostLimits.split("\n").filter((l) => /file size/i.test(l)), hostObservedTmpMount: hostMounts, oneBig, first, second, third, control: { ctlA, ctlB } });
      await small.kill(s.id, "done"); await roomy.kill(r.id, "done");
    }

    { if (process.env.CONTAINED_PORT_TRACE) console.error("[trace] begin fd-bound executable"); // N2: an executable outside the runtime roots is bound by descriptor
      const script = realpathSync(join(import.meta.dir, "fixtures", "fd-bound.sh"));
      const port = makePort(f.workspace, { executables: [{ path: script, sha256: sha(readFileSync(script)) }] });
      const { plan, digest } = await port.plan({ argv: [script], cwd: f.workspace, env: {}, restrictions: {} }, ctx);
      const { id } = await port.spawn({ argv: [script], cwd: f.workspace, env: {}, restrictions: {} }, ctx);
      const got: string[] = [];
      void port.readLines(id, (l) => got.push(l));
      await port.write(id, "ping");
      for (let i = 0; i < 200 && got.length < 2; i++) await sleep(25);
      const exit = await port.exited(id);
      expect(plan.executable.bound).toBe("fd");
      expect(plan.sandboxArgv.join(" ")).toContain("--ro-bind-fd 6 /opt/cognate/bin/fd-bound.sh");
      expect(got[0]).toMatch(/^fd-bound:\/opt\/cognate\/bin\/fd-bound\.sh:/);
      expect(got[1]).toBe("got:ping");
      expect(exit.reason).toBe("exited");
      expect(exit.exitCode).toBe(0);
      record("executable-bound-by-fd", "PASS", { digest, executable: plan.executable, output: got, exit });
    }

    // ════════ READ-ONLY WORKSPACE IS NOT AN ARTIFACT OF THE FIXTURE: wall of refusal before spawn on a real launcher ════════
    {
      const bad = containedStdioSpawnPort({ authorize: async () => {}, launcher: { ...launcher, sha256: "0".repeat(64) }, executables: [pythonPin], workspaceRoot: f.workspace, writableRoots: [] });
      const marker = join(f.dir, "must-not-exist");
      await expect(bad.spawn({ ...spec(f.workspace), argv: [python, "-c", `open('${marker}','w')`] }, ctx)).rejects.toMatchObject({ code: "rlm-containment-unavailable" });
      expect(existsSync(marker)).toBe(false);
      record("refusal-launcher-digest-real", "PASS", { marker: "absent" });
    }
  } catch (error) {
    failure = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 2000) : String(error);
    if (process.env.CONTAINED_PORT_TRACE) console.error("[trace] ERROR", error);
    throw error;
  } finally {
    if (process.env.CONTAINED_PORT_TRACE) console.error("[trace] finally: disposing", ports.length, "ports");
    for (const port of ports) await port.dispose();
    for (const l of listeners) await l.close().catch(() => {});
    delete process.env.SFTEST_ENV_SECRET;
    const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: join(import.meta.dir, "..") }).stdout.toString().trim();
    const outDir = join(import.meta.dir, "..", ".tmp", "evidence", "114");
    mkdirSync(outDir, { recursive: true });
    const manifest = {
      ticket: "SEA-Forge #114", complete: failure === undefined, ...(failure ? { failure } : {}), recordedAt: new Date().toISOString(), commit,
      host: { kernel: Bun.spawnSync(["uname", "-r"]).stdout.toString().trim(), os: process.platform, arch: process.arch, bun: Bun.version, wsl: existsSync("/proc/sys/fs/binfmt_misc/WSLInterop") || existsSync("/proc/sys/fs/binfmt_misc/WSLInterop-late") },
      launcher: { ...launcher, version: bwrapVersion }, fixtureInterpreter: pythonPin,
      launchPlan: manifestPlan, launchPlanDigest: manifestDigest, executionProfileDigest: manifestProfile,
      scenarios: evidence,
    };
    const out = join(outDir, `contained-port-${Date.now()}.json`);
    writeFileSync(out, JSON.stringify(manifest, null, 2));
    console.log(`evidence: ${out}`);
    await rm(base, { recursive: true, force: true });
  }
}, 600_000);
