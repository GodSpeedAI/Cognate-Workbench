// #114 H4 on real bubblewrap: a no-network contained child must not reach a host daemon's PATHNAME unix socket that
// sits inside the read-only workspace mount (a network namespace does not isolate those). Opt-in like the other
// real-bubblewrap test (COGNATE_BWRAP_TESTS=1); a skip is not a pass.
//
// Method: a live host listener inside the workspace counts connections. The SAME fixture script run uncontained
// connects (positive control: the probe, the path and the listener count all work). The contained run must print its
// reply (the probe ran to completion), exit 0 (the child finished), and the listener must see zero connections.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { scopedPort } from "./support/scopedPort.ts";

const enabled = process.env.COGNATE_BWRAP_TESTS === "1" && process.platform === "linux";
const realTest = enabled ? test : test.skip;
const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const CHILD = join(import.meta.dir, "fixtures", "contained-child.py");
const ctx = { intentId: "intent-h4", runId: "run-h4" };

realTest("H4: a no-network contained child cannot connect to a host pathname socket inside the workspace", async () => {
  const bwrapPath = process.env.COGNATE_BWRAP_PATH ?? Bun.which("bwrap");
  if (!bwrapPath) throw new Error("BLOCKED: COGNATE_BWRAP_TESTS=1 but no bwrap on PATH (set COGNATE_BWRAP_PATH)");
  const launcherReal = realpathSync(bwrapPath);
  const python = realpathSync(process.env.COGNATE_FIXTURE_PYTHON ?? "/usr/bin/python3");
  const base = await mkdtemp(join(tmpdir(), "contained-h4-"));
  const workspace = join(base, "workspace");
  mkdirSync(workspace, { recursive: true });
  copyFileSync(CHILD, join(workspace, "child.py"));
  const sockPath = join(workspace, "host.sock");
  const hits = { connections: 0, data: [] as string[] };
  const server: Server = createServer((sock) => { hits.connections++; sock.on("data", (d) => hits.data.push(String(d))); sock.on("error", () => {}); });
  await new Promise<void>((resolve) => server.listen(sockPath, resolve));
  // A live host AF_UNIX DATAGRAM receiver inside the workspace, counting datagrams.
  const dgramPath = join(workspace, "dgram.sock");
  const receiver = Bun.spawn([python, "-c", `
import socket, sys, os
s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM); s.bind(${JSON.stringify(dgramPath)})
sys.stdout.write("ready\\n"); sys.stdout.flush()
while True:
    d = s.recv(4096); sys.stdout.write("got:" + d.decode() + "\\n"); sys.stdout.flush()
`], { stdout: "pipe", stderr: "pipe" });
  const received: string[] = [];
  void (async () => { let buf = ""; for await (const c of receiver.stdout as ReadableStream<Uint8Array>) { buf += new TextDecoder().decode(c); let i; while ((i = buf.indexOf("\n")) >= 0) { received.push(buf.slice(0, i)); buf = buf.slice(i + 1); } } })();
  for (let i = 0; i < 200 && !received.includes("ready"); i++) await Bun.sleep(20);
  expect(received).toContain("ready");
  const port = scopedPort({ authorize: async () => {}, launcher: { path: launcherReal, sha256: sha(readFileSync(launcherReal)) }, executables: [{ path: python, sha256: sha(readFileSync(python)) }], workspaceRoot: workspace, writableRoots: [base] });
  try {
    // Positive control: uncontained, the same fixture reaches the same listener through the same path.
    const control = Bun.spawn([python, CHILD], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    control.stdin.write(JSON.stringify({ op: "unix", path: sockPath, payload: "CONTROL-H4" }) + "\n"); await control.stdin.flush(); control.stdin.end();
    const controlOut = await new Response(control.stdout).text(); await control.exited;
    expect(JSON.parse(controlOut.trim().split("\n")[0]!)).toMatchObject({ op: "unix", ok: true });
    for (let i = 0; i < 100 && !hits.data.join("").includes("CONTROL-H4"); i++) await Bun.sleep(20);
    expect(hits.connections).toBe(1);
    expect(hits.data.join("")).toContain("CONTROL-H4");
    hits.connections = 0; hits.data.length = 0;

    // The contained run: the probe, its neighbours that must still work, and a clean exit.
    const { id, } = await port.spawn({ argv: [python, "/workspace/child.py"], cwd: workspace, env: {}, restrictions: { filesystem: ["read-only"], subprocess: true } }, ctx);
    const replies: Record<string, any>[] = [];
    void port.readLines(id, (line) => { try { replies.push(JSON.parse(line)); } catch { /* not protocol */ } });
    const ask = async (msg: Record<string, unknown>): Promise<Record<string, any>> => {
      const from = replies.length; await port.write(id, JSON.stringify(msg));
      for (let i = 0; i < 400; i++) { const hit = replies.slice(from).find((r) => r.op === msg.op); if (hit) return hit; await Bun.sleep(15); }
      throw new Error(`no reply to ${JSON.stringify(msg)}`);
    };
    const unix = await ask({ op: "unix", path: "/workspace/host.sock", payload: "FROM-SANDBOX" });
    const create = await ask({ op: "unix_create" });
    const pair = await ask({ op: "socketpair" });
    const inet = await ask({ op: "inet_create" });
    const uring = await ask({ op: "io_uring" });
    const caps = await ask({ op: "caps" });
    await port.write(id, JSON.stringify({ op: "exit" }));
    const exit = await port.exited(id);

    expect(exit.exitCode).toBe(0);                                  // the probe script ran to completion, it did not die early
    expect(unix).toMatchObject({ ok: false, errno: 13 });           // EACCES at socket(), so connect() was never attempted
    expect(create).toMatchObject({ ok: false, errno: 13 });
    expect(pair).toMatchObject({ ok: true });                       // positive control: socketpair creates no path and still works
    expect(inet).toMatchObject({ ok: true });                       // positive control: other socket families still work
    expect(uring.ok).toBe(true);
    expect(uring.value.errno).toBe(1);                              // io_uring_setup is EPERM
    expect(caps.caps.Seccomp).toBe("2");                            // the kernel reports the filter is in force
    await Bun.sleep(150);
    expect(hits.connections).toBe(0);                               // observed from the host: the listener saw nothing
    expect(hits.data).toEqual([]);

    // Control for io_uring: where the host kernel does not itself deny it, the same call is not EPERM uncontained.
    const ring = Bun.spawn([python, CHILD], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    ring.stdin.write(JSON.stringify({ op: "io_uring" }) + "\n"); await ring.stdin.flush(); ring.stdin.end();
    const ringOut = JSON.parse((await new Response(ring.stdout).text()).trim().split("\n")[0]!); await ring.exited;
    const hostDenies = (() => { try { return readFileSync("/proc/sys/kernel/io_uring_disabled", "utf8").trim() !== "0"; } catch { return false; } })();
    if (!hostDenies) expect(ringOut.value.errno).not.toBe(1);
    // ── delta-2: socket families are an allowlist (datagram socketpair, vsock, packet, other netlink) ──
    const probes = [
      { op: "dgram_attack", path: dgramPath },
      { op: "family", family: 40, type: 1, proto: 0 },          // AF_VSOCK
      { op: "family", family: 17, type: 3, proto: 0x300 },      // AF_PACKET
      { op: "family", family: 16, type: 3, proto: 15 },         // NETLINK_KOBJECT_UEVENT
      { op: "pair_type", kind: "dgram" },
    ];
    const uncontained = async (msgs: Record<string, unknown>[]): Promise<Record<string, any>[]> => {
      const proc = Bun.spawn([python, CHILD], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      for (const m of msgs) proc.stdin.write(JSON.stringify(m) + "\n");
      await proc.stdin.flush(); proc.stdin.end();
      const out = (await new Response(proc.stdout).text()).trim().split("\n").map((l) => JSON.parse(l)); await proc.exited;
      return out;
    };
    // Positive controls: uncontained, the datagram really is delivered, and none of the family probes is denied with EACCES.
    const ctl = await uncontained(probes);
    expect(ctl).toHaveLength(probes.length);                       // every probe ran to completion
    expect(ctl[0]).toMatchObject({ op: "dgram_attack", ok: true });
    for (let i = 0; i < 100 && !received.some((l) => l === "got:DGRAM-ATTACK"); i++) await Bun.sleep(20);
    expect(received.filter((l) => l === "got:DGRAM-ATTACK")).toHaveLength(1);
    for (const r of ctl.slice(1)) expect(r.errno).not.toBe(13);   // the kernel itself does not return EACCES for these; only the filter does
    received.length = 0;

    const s2 = await port.spawn({ argv: [python, "/workspace/child.py"], cwd: workspace, env: {}, restrictions: { filesystem: ["read-only"], subprocess: true } }, { intentId: "intent-h4", runId: "run-h4b" });
    const rep2: Record<string, any>[] = [];
    void port.readLines(s2.id, (line) => { try { rep2.push(JSON.parse(line)); } catch { /* not protocol */ } });
    const ask2 = async (msg: Record<string, unknown>): Promise<Record<string, any>> => {
      const from = rep2.length; await port.write(s2.id, JSON.stringify(msg));
      for (let i = 0; i < 400; i++) { const hit = rep2.slice(from).find((r) => r.op === msg.op); if (hit) return hit; await Bun.sleep(15); }
      throw new Error(`no reply to ${JSON.stringify(msg)}`);
    };
    for (const probe of probes) expect([probe.op, await ask2(probe)]).toEqual([probe.op, expect.objectContaining({ ok: false, errno: 13 })]);
    // Positive controls inside the same sandbox: what an empty network namespace legitimately offers still works.
    expect(await ask2({ op: "family", family: 2, type: 1, proto: 0 })).toMatchObject({ ok: true });       // AF_INET
    expect(await ask2({ op: "family", family: 10, type: 2, proto: 0 })).toMatchObject({ ok: true });      // AF_INET6
    expect(await ask2({ op: "family", family: 16, type: 3, proto: 0 })).toMatchObject({ ok: true });      // NETLINK_ROUTE
    expect(await ask2({ op: "pair_type", kind: "stream" })).toMatchObject({ ok: true });
    expect(await ask2({ op: "pair_type", kind: "seqpacket" })).toMatchObject({ ok: true });
    await port.write(s2.id, JSON.stringify({ op: "exit" }));
    expect((await port.exited(s2.id)).exitCode).toBe(0);           // the child finished, so every probe above ran to completion
    await Bun.sleep(150);
    expect(received).toEqual([]);                                  // observed from the host: the datagram receiver saw nothing from the sandbox
  } finally {
    receiver.kill();
    await port.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(base, { recursive: true, force: true });
  }
}, 60_000);
