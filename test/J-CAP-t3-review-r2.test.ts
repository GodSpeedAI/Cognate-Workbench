// Journey J-CAP-t3-review-r2: Codex round 2 on PR #39 (cut off by the content filter; three defects its tool
// runs had already reproduced). Each test failed against aa2979c and guards its fix.
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutionWorldRegistry, localExecutionWorld } from "@godspeedai/cognate-execution";
import { makeScrubber, reconcileSpawnLedger, spawnGoverned, type LedgerEvent, type ProcView } from "../src/capabilities/execSpawn.ts";
import { McpClient } from "../src/mcp/client.ts";
import { LOCAL_POSTURE, alive, sleep } from "./mcp-helpers.ts";
import { waitUntil } from "./wb-helpers.ts";

const CAP = "capability.bundle.t3r2";
const groupAlive = (pgid: number): boolean => { try { process.kill(-pgid, 0); return true; } catch { return false; } };
async function markerHolders(spawnId: string): Promise<number[]> {
  const out: number[] = [];
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try { if ((await readFile(`/proc/${name}/environ`, "utf8")).includes(`COGNATE_SPAWN_ID=${spawnId}\0`)) out.push(Number(name)); } catch { /* gone */ }
  }
  return out;
}
const slotsOf = (released: string[], onRelease?: () => void) => ({ acquire: async () => ({ slotId: "" }), release: async (id: string) => { onRelease?.(); released.push(id); } });
const baseRow = { capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", worldKind: "local", bundleDir: "/nonexistent/bundle", argv: ["sh"] };

describe("J-CAP-t3-review-r2 finding 1: a slot is released only when the group and every marker holder are dead", () => {
  test("the leader exited first and the descendant (which dropped the marker) remains in the group: the sweep ends the group before it releases", async () => {
    const spawnId = `spawn-${randomUUID()}`;
    // The descendant dropped the marker but still runs under the bundle directory (the signature that proves the group is ours).
    const bundleDir = await mkdtemp(join(tmpdir(), "t3r2-bundle-"));
    const leader = Bun.spawn(["sh", "-c", "env -i sh -c 'sleep 30; :' & echo $!; exit 0"], { cwd: bundleDir, env: { ...process.env, COGNATE_SPAWN_ID: spawnId }, detached: true, stdout: "pipe", stderr: "ignore" });
    const first = await leader.stdout.getReader().read();
    const orphan = Number(new TextDecoder().decode(first.value).trim().split("\n")[0]);
    await leader.exited;
    const pgid = leader.pid;
    expect(groupAlive(pgid)).toBe(true);
    expect(await markerHolders(spawnId)).not.toContain(orphan); // no marker to find it by: only the group says it is alive
    const released: string[] = [];
    let aliveAtRelease: boolean | undefined;
    try {
      const outcome = await reconcileSpawnLedger({ graceMs: 300, ledger: async () => {}, slots: slotsOf(released, () => { aliveAtRelease = groupAlive(pgid); }) }, [{ ...baseRow, bundleDir, spawnId, status: "confirmed", pid: leader.pid, pgid, slotId: "sl-1" }]);
      expect(outcome[0]!.outcome).not.toBe("reconciled-gone");
      expect(groupAlive(pgid)).toBe(false);
      expect(released).toEqual(["sl-1"]);
      expect(aliveAtRelease).toBe(false);
    } finally {
      try { process.kill(orphan, 9); } catch { /* gone */ }
    }
  });

  test("anything that cannot be verified dead keeps the slot reserved and records reconcile-incomplete", async () => {
    const spawnId = `spawn-${randomUUID()}`;
    const stubborn: ProcView = { readCmdline: async () => undefined, readCwd: async () => undefined, listPids: async () => [], pidsWithSpawnId: async () => [99_999_999] };
    const released: string[] = [];
    const events: LedgerEvent[] = [];
    const outcome = await reconcileSpawnLedger({ graceMs: 100, ledger: async (_id, evs) => { events.push(...evs); }, slots: slotsOf(released) }, [{ ...baseRow, spawnId, status: "confirmed", pid: 99_999_998, pgid: 99_999_998, slotId: "sl-2" }], stubborn);
    expect(outcome[0]!.outcome).toBe("reconcile-incomplete");
    expect(released).toEqual([]);
    expect(events[0]!.payload).toMatchObject({ reconciled: "reconcile-incomplete", survivors: true });
  });

  test("the normal stop path applies the same rule: a descendant that left the group (setsid) is ended before the slot is released", async () => {
    const events: LedgerEvent[] = [];
    let spawnIdSeen = "";
    const released: string[] = [];
    let holdersAtRelease: number[] | undefined;
    const result = await spawnGoverned({
      registry: createExecutionWorldRegistry([localExecutionWorld()]), getPosture: () => LOCAL_POSTURE, resolveSecret: async () => undefined,
      ledger: async (id, evs) => { spawnIdSeen = id.replace(/^/, ""); events.push(...evs); }, recordRefusal: async () => {},
      slots: { acquire: async () => ({ slotId: "s" }), release: async () => { holdersAtRelease = await markerHolders(events[0]!.payload.spawnId as string); released.push("s"); } },
      localHostSpawnAllowed: () => true, beforeIntent: async () => undefined, graceMs: 300, killMs: 300,
    }, { capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", argv: ["sh", "-c", "setsid sleep 30 & exec sleep 0.2"], cwd: "/", bundleDir: "/nonexistent/bundle", secrets: [], restrictions: {}, stop: "graceful" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await sleep(100);
    const id = events[0]!.payload.spawnId as string;
    expect((await markerHolders(id)).length).toBeGreaterThan(1); // the setsid child holds the marker outside the group
    await result.handle.exited;
    expect(spawnIdSeen).toBeTruthy();
    expect(await markerHolders(id)).toEqual([]);
    expect(holdersAtRelease).toEqual([]);
    expect(released).toEqual(["s"]);
  });
});

describe("J-CAP-t3-review-r2 finding 2: the output schema is sanitized like the input schema", () => {
  function server(tool: Record<string, unknown>, structured: unknown) {
    let onData: (chunk: Buffer) => void = () => {};
    const reply = (id: unknown, result: unknown) => queueMicrotask(() => onData(Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)));
    return {
      onData(l: (chunk: Buffer) => void) { onData = l; }, onClose() {}, async close() {},
      write(data: string) {
        for (const line of data.split("\n").filter(Boolean)) {
          const m = JSON.parse(line) as { id?: number; method?: string; params?: { protocolVersion?: string } };
          if (m.method === "initialize") reply(m.id, { protocolVersion: m.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "f", version: "1" } });
          else if (m.method === "tools/list") reply(m.id, { tools: [tool] });
          else if (m.method === "tools/call") reply(m.id, { content: [{ type: "text", text: "ok" }], structuredContent: structured });
        }
      },
    };
  }
  const bad = { name: "t", description: "d", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { a: { type: "string", pattern: "^(a+)+$", format: "regex" } } } };

  test("`^(a+)+$` in an outputSchema never blocks the event loop and the call still completes", async () => {
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const client = await McpClient.connect(server(bad, { a: `${"a".repeat(28)}!` }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    // A timer probe that cannot pass vacuously: it is armed before the call, and after the call we wait for it to fire
    // at least once, so a validator that blocked the loop shows up as a large gap (and as a long wall time).
    let worstGap = 0;
    let fired = 0;
    let last = performance.now();
    const ticker = setInterval(() => { const now = performance.now(); worstGap = Math.max(worstGap, now - last); last = now; fired += 1; }, 1);
    let outcome: Awaited<ReturnType<typeof client.callTool>>;
    let elapsed: number;
    try {
      const started = performance.now();
      outcome = await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" });
      elapsed = performance.now() - started;
      const firedBefore = fired;
      await sleep(20);
      expect(fired).toBeGreaterThan(firedBefore);
    } finally {
      clearInterval(ticker);
    }
    expect(outcome.ok).toBe(true);
    expect(elapsed).toBeLessThan(50);
    expect(worstGap).toBeLessThan(50);
    expect(JSON.stringify(records)).toContain("outputSchema");
  });

  test("an output schema over the node bound is dropped (and recorded) rather than handed to the SDK", async () => {
    const wide = { type: "object", properties: Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`p${i}`, { type: "string", pattern: "^(a+)+$" }])) };
    const records: { type: string; payload: Record<string, unknown> }[] = [];
    const client = await McpClient.connect(server({ ...bad, outputSchema: wide }, { p0: `${"a".repeat(28)}!` }) as never, { capabilityId: CAP, version: "v", serverId: "f", record: async (e) => { records.push(e); } });
    const started = performance.now();
    expect((await client.callTool("t", {}, { timeoutMs: 5000, actorId: "t" })).ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(50);
    expect(records.some((r) => r.payload.reasonCode === "schema-refused" && String(r.payload.reason).includes("outputSchema"))).toBe(true);
  });
});

describe("J-CAP-t3-review-r2 finding 3: scrubbing covers UTF-16, and secrets that cannot be scrubbed are never delivered", () => {
  test("UTF-16LE and UTF-16BE forms (raw, base64, hex) of an 18-byte secret are scrubbed", () => {
    const secret = "tes-secret-18bytes";
    expect(Buffer.byteLength(secret)).toBe(18);
    const scrub = makeScrubber([{ name: "S", value: secret }]);
    const le = Buffer.from(secret, "utf16le");
    const be = Buffer.from(secret, "utf16le").swap16();
    for (const form of [le.toString("base64"), be.toString("base64"), le.toString("hex"), be.toString("hex"), le.toString("latin1"), be.toString("latin1")]) {
      expect(scrub.text(`x ${form} y`)).toBe("x [REDACTED:S] y");
    }
    expect(le.toString("base64").startsWith("dABlAHMA")).toBe(true);
  });

  test("a secret shorter than 8 bytes refuses the spawn and is recorded, before any intent or process", async () => {
    const refusals: { code: string; reason: string }[] = [];
    const events: LedgerEvent[] = [];
    const result = await spawnGoverned({
      registry: createExecutionWorldRegistry([localExecutionWorld()]), getPosture: () => LOCAL_POSTURE, resolveSecret: async () => "abc123", // 6 bytes
      ledger: async (_id, evs) => { events.push(...evs); }, recordRefusal: async (_r, code, reason) => { refusals.push({ code, reason }); },
      slots: { acquire: async () => ({ slotId: "s" }), release: async () => {} }, localHostSpawnAllowed: () => true, beforeIntent: async () => undefined,
    }, { capabilityId: CAP, version: "v", serverId: "stub", worldId: "local", argv: ["true"], cwd: "/", bundleDir: "/x", secrets: [{ env: "TOKEN", key: "short-key" }], restrictions: {}, stop: "graceful" });
    expect(result).toMatchObject({ ok: false, code: "secret-too-short" });
    expect(refusals[0]!.code).toBe("secret-too-short");
    expect(refusals[0]!.reason).toContain("TOKEN");
    expect(refusals[0]!.reason).not.toContain("abc123");
    expect(events.length).toBe(0);
  });
});

void alive; void waitUntil;
