// Journey J-CAP-safemode (T4a): presentation slots and safe mode, tested as properties with generated input (fast-check).
// Every oracle reads GROUND TRUTH where the guarantee is consumed: the rendered DOM (happy-dom), the durable event log
// (a hash of the memory store's whole log), and the mount table. FC_RUNS sets runs per property (default 200, CI; 2000+ locally).
//   A1  a fragment that faults in render / effect / event handling, at any depth, never unmounts the shell: the core fallback
//       renders and exactly one fault event is recorded
//   A2  only schema-valid descriptors register; every other one is refused and recorded; a governance id is a core violation
//       and safe mode
//   A3  in safe mode no non-core fragment renders and no bundle handler mounts
//   A4  two failed boots with the same extension set stay suspended until the operator-only clear; a non-operator clear is
//       refused and recorded
//   A5  safe mode writes only fault and safemode events; the rest of the log is byte-identical
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import React from "react";
import fc from "fast-check";
import { createMemoryStore } from "@godspeedai/cognate-store-memory";
import type { DurableStore } from "@godspeedai/cognate-events";
import { registerDom, releaseDom } from "./dom-env.ts";
import { LifecycleRecorder } from "../src/workbench/lifecycleRecorder.ts";
import { SAFE_MODE_EVENT_TYPES, SafeModeController, mountBundleHandlers, readBootExclusion, type MountTable } from "../src/workbench/safeMode.ts";

const RUNS = Number(process.env.FC_RUNS ?? 200);
let act: typeof import("@testing-library/react/pure").act;
let cleanup: typeof import("@testing-library/react/pure").cleanup;
let fireEvent: typeof import("@testing-library/react/pure").fireEvent;
let render: typeof import("@testing-library/react/pure").render;
let slot: typeof import("../src/ui/FragmentSlot.tsx");
beforeAll(async () => {
  registerDom();
  ({ act, cleanup, fireEvent, render } = await import("@testing-library/react/pure"));
  slot = await import("../src/ui/FragmentSlot.tsx");
});
afterAll(async () => { await releaseDom(); });
afterEach(async () => { await act(async () => { cleanup(); await Promise.resolve(); }); });

const TENANT = "t";
const settle = (ms = 4) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

// ---- ground truth readers ----
const logOf = async (store: DurableStore) => (await store.readAll()).map((e) => ({ type: e.eventType, stream: e.streamId, payload: e.payload }));
const hashOf = (rows: unknown[]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const faultsFor = async (store: DurableStore, key: string) => (await logOf(store)).filter((e) => e.type === "capability.presentation.faulted" && (e.payload as { fragmentKey: string }).fragmentKey === key);

// ---- generators (valid by construction; invalid by one named mutation) ----
const word = fc.stringMatching(/^[A-Za-z0-9 ]{1,20}$/);
const markup = fc.constantFrom("<img src=x onerror=alert(1)>", "<script>boom()</script>", "{{expr}}", "a < b && c > d");
const text = (max: number) => fc.oneof(word, markup).map((s) => s.slice(0, max)).filter((s) => s.length > 0);
const capId = fc.stringMatching(/^[a-z][a-z0-9.-]{2,20}$/);
const view = fc.oneof(
  fc.array(fc.record({ label: text(80), value: text(200) }), { maxLength: 5 }).map((rows) => ({ kind: "list", rows })),
  fc.array(fc.oneof(
    fc.record({ name: text(80), type: fc.constant("string"), value: text(200) }),
    fc.record({ name: text(80), type: fc.constant("number"), value: fc.integer() }),
    fc.record({ name: text(80), type: fc.constant("boolean"), value: fc.boolean() })), { maxLength: 5 }).map((fields) => ({ kind: "record", fields })),
);
const valid = fc.record({ slotId: fc.constant("capability.panel"), schemaVersion: fc.constant(1), payload: fc.record({ title: text(80), summary: fc.oneof(fc.constant(""), text(200)), capabilityId: capId, viewRef: view }) });
const bad = fc.tuple(valid, fc.constantFrom("longTitle", "longSummary", "extraKey", "extraPayloadKey", "version", "unknownSlot", "badView", "badType", "missingCap", "emptyTitle", "notObject", "badCapChars", "tooManyRows")).map(([d, m]): unknown => {
  const x = JSON.parse(JSON.stringify(d)) as { slotId: unknown; schemaVersion: unknown; payload: Record<string, unknown> } & Record<string, unknown>;
  switch (m) {
    case "longTitle": x.payload.title = "x".repeat(81); break;
    case "longSummary": x.payload.summary = "x".repeat(201); break;
    case "extraKey": x.html = "<b>hi</b>"; break;
    case "extraPayloadKey": x.payload.onClick = "alert(1)"; break;
    case "version": x.schemaVersion = 2; break;
    case "unknownSlot": x.slotId = "capability.other"; break;
    case "badView": x.payload.viewRef = { kind: "html", html: "<b/>" }; break;
    case "badType": x.payload.viewRef = { kind: "record", fields: [{ name: "n", type: "number", value: "7" }] }; break;
    case "missingCap": delete x.payload.capabilityId; break;
    case "emptyTitle": x.payload.title = ""; break;
    case "notObject": return fc.sample(fc.oneof(fc.integer(), fc.string(), fc.constant(null), fc.array(fc.integer())), 1)[0];
    case "badCapChars": x.payload.capabilityId = "../etc passwd"; break;
    case "tooManyRows": x.payload.viewRef = { kind: "list", rows: Array.from({ length: 51 }, () => ({ label: "l", value: "v" })) }; break;
  }
  return x;
});
const governance = fc.tuple(fc.constantFrom("governance", "core", "authority", "approvals", "safe-mode", "policy", "settlement", "identity", "evidence", "grants", "Governance"), fc.constantFrom("", ".banner", ":x", "/y", "-z"), valid)
  .map(([p, s, d]) => ({ ...d, slotId: p + s }));

async function newCtx(extensions: string[] = ["ext.a"]) {
  const store = createMemoryStore() as DurableStore;
  const safe = await SafeModeController.boot(store, TENANT, extensions);
  return { store, safe, registry: new slot.SlotRegistry(safe) };
}

// ======================= A1 =======================
describe("A1 a faulting fragment never unmounts the shell", () => {
  test("render / effect / event faults at any depth: fallback renders, shell stays, exactly one fault event", async () => {
    await fc.assert(fc.asyncProperty(
      fc.constantFrom("render", "effect", "event", "none"), fc.integer({ min: 0, max: 6 }), fc.array(valid, { minLength: 1, maxLength: 3 }), fc.nat(2),
      async (point, depth, descs, pick) => {
        await quiet(async () => {
          const { store, safe, registry } = await newCtx();
          const frags = [];
          for (const [i, d] of descs.entries()) { const r = await registry.register({ ...d, payload: { ...d.payload, capabilityId: `cap.${i}` } }); if (r.ok) frags.push(r.fragment); }
          expect(frags.length).toBe(descs.length);
          const target = frags[pick % frags.length]!;
          const Leaf: React.FC = () => {
            const guard = slot.useFragmentGuard();
            React.useEffect(() => { if (point === "effect") throw new Error("effect-fault"); }, []);
            if (point === "render") throw new Error("render-fault");
            return <button data-faulty-marker data-trigger onClick={guard(() => { if (point === "event") throw new Error("event-fault"); })}>go</button>;
          };
          const Nest: React.FC<{ n: number }> = ({ n }) => (n === 0 ? <Leaf /> : <div><Nest n={n - 1} /></div>);
          const View: React.FC<{ fragment: typeof target }> = ({ fragment }) => (fragment.key === target.key ? <Nest n={depth} /> : <slot.DefaultView fragment={fragment} />);
          const { container } = render(<div data-shell><span data-sentinel />{frags.map((f) => <slot.FragmentSlot key={f.key} fragment={f} read={safe.read()} faults={safe.faults} renderView={View} />)}</div>);
          const shell = container.querySelector("[data-shell]");
          await settle();
          if (point === "event") { await act(async () => { fireEvent.click(container.querySelector("[data-trigger]")!); }); }
          await settle(15);
          expect(container.querySelector("[data-shell]")).toBe(shell);
          expect(container.querySelector("[data-sentinel]")).not.toBeNull();
          expect(container.querySelectorAll("section.wb-slot-panel").length).toBe(point === "none" ? frags.length - 1 : frags.length - 1);
          expect(container.querySelector("[data-faulty-marker]") !== null).toBe(point === "none");
          expect(container.querySelectorAll("[data-slot-fallback=fault]").length).toBe(point === "none" ? 0 : 1);
          expect((await faultsFor(store, target.key)).length).toBe(point === "none" ? 0 : 1);
        });
      }), { numRuns: RUNS });
  });
});

// ======================= A2 =======================
describe("A2 only schema-valid descriptors register", () => {
  test("everything else is refused and recorded; a governance id is a core violation and safe mode; content is text", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.oneof(valid.map((d) => ({ d, kind: "ok" as const })), bad.map((d) => ({ d, kind: "refused" as const })), governance.map((d) => ({ d, kind: "gov" as const }))), { minLength: 1, maxLength: 8 }),
      async (items) => {
        const { store, safe, registry } = await newCtx();
        const outcomes: Awaited<ReturnType<typeof registry.register>>[] = [];
        for (const it of items) outcomes.push(await registry.register(it.d));
        items.forEach((it, i) => expect(it.kind === "ok" ? "ok" : it.kind === "gov" ? "core-violation" : "refused").toBe(outcomes[i]!.ok ? "ok" : (outcomes[i] as { outcome: string }).outcome));
        const okCount = items.filter((i) => i.kind === "ok").length;
        expect(registry.list().length).toBeLessThanOrEqual(okCount);
        const faults = (await logOf(store)).filter((e) => e.type === "capability.presentation.faulted");
        const distinct = (kind: string) => new Set(items.filter((i) => i.kind === kind).map((i) => JSON.stringify(i.d) ?? "undefined")).size;
        expect(faults.filter((f) => (f.payload as { faultClass: string }).faultClass === "refused").length).toBe(distinct("refused"));
        expect(faults.filter((f) => (f.payload as { faultClass: string }).faultClass === "core-violation").length).toBe(distinct("gov"));
        const anyGov = items.some((i) => i.kind === "gov");
        expect(safe.read().safe).toBe(anyGov);
        expect((await readBootExclusion(store, ["ext.a"])).safe).toBe(anyGov);
        // registered content renders as text, never as markup
        if (!anyGov) {
          const { container } = render(<div>{registry.list().map((f) => <slot.FragmentSlot key={f.key} fragment={f} read={safe.read()} faults={safe.faults} />)}</div>);
          expect(container.querySelectorAll("img, script, b").length).toBe(0);
        }
      }), { numRuns: RUNS });
  });
});

// ======================= A3 / A4: random boot sequences against a reference model =======================
type Op = { op: "boot"; set: "A" | "B"; ready: boolean } | { op: "violate" } | { op: "clear"; role: "operator" | "user" };
const ops = fc.array(fc.oneof(
  fc.record({ op: fc.constant("boot" as const), set: fc.constantFrom("A" as const, "B" as const), ready: fc.boolean() }),
  fc.record({ op: fc.constant("violate" as const) }),
  fc.record({ op: fc.constant("clear" as const), role: fc.constantFrom("operator" as const, "user" as const) })), { minLength: 1, maxLength: 9 });

interface Observed { safe: boolean; expectSafe: boolean; panels: number; mounted: number; handlerCalls: number }
async function runSequence(seq: Op[], store: DurableStore) {
  // model: failed-boot run (consecutive same-set attempts without ready), unresolved violation
  let run: string[] = []; let violation = false; let lastSafe: SafeModeController | undefined;
  const seen: Observed[] = []; const refusals: boolean[] = [];
  for (const s of seq) {
    if (s.op === "violate") {
      const c = lastSafe ?? new SafeModeController(store, TENANT, await readBootExclusion(store, ["ext.A"]), ["ext.A"]);
      await new slot.SlotRegistry(c).register({ slotId: "governance.banner", schemaVersion: 1, payload: { title: "t", summary: "", capabilityId: "c", viewRef: { kind: "list", rows: [] } } });
      violation = true;
    } else if (s.op === "clear") {
      const c = lastSafe ?? new SafeModeController(store, TENANT, await readBootExclusion(store, ["ext.A"]), ["ext.A"]);
      const r = await c.clear({ role: s.role, id: "u1" });
      refusals.push(r.ok);
      if (s.role === "operator") { violation = false; run = []; }
    } else {
      const set = `ext.${s.set}`; const h = s.set;
      if (run.length && run[run.length - 1] !== h) run = [];
      const expectSafe = violation || (run.length >= 2 && run.every((x) => x === h));
      const c = await SafeModeController.boot(store, TENANT, [set]); lastSafe = c;
      run.push(h);
      const table: MountTable = new Map(); let handlerCalls = 0;
      const mounted = mountBundleHandlers(c.read(), table, [1, 2].map((i) => ({ id: `h${i}`, mount: () => { handlerCalls++; } })));
      const reg = new slot.SlotRegistry(c);
      const frags = [];
      for (let i = 0; i < 2; i++) { const r = await reg.register({ slotId: "capability.panel", schemaVersion: 1, payload: { title: `p${i}`, summary: "", capabilityId: `cap.${i}`, viewRef: { kind: "list", rows: [] } } }); if (r.ok) frags.push(r.fragment); }
      const { container } = render(<div>{frags.map((f) => <slot.FragmentSlot key={f.key} fragment={f} read={c.read()} faults={c.faults} />)}</div>);
      seen.push({ safe: c.read().safe, expectSafe, panels: container.querySelectorAll("section.wb-slot-panel").length, mounted: table.size, handlerCalls: handlerCalls + mounted.length * 0 });
      if (s.ready && !c.read().safe) { await c.bootReady(); run = []; }
      await act(async () => { cleanup(); });
    }
  }
  return { seen, refusals };
}

describe("A3 safe mode renders and mounts nothing non-core", () => {
  test("in safe mode: zero panels, empty mount table, no handler called; outside it everything renders", async () => {
    await fc.assert(fc.asyncProperty(ops, async (seq) => {
      const store = createMemoryStore() as DurableStore;
      const { seen } = await runSequence(seq, store);
      for (const o of seen) {
        expect(o.safe).toBe(o.expectSafe);
        expect(o.panels).toBe(o.safe ? 0 : 2);
        expect(o.mounted).toBe(o.safe ? 0 : 2);
        expect(o.handlerCalls).toBe(o.safe ? 0 : 2);
      }
    }), { numRuns: RUNS });
  });
});

/** Repeated refusals by the same actor are one record per window; an operator clear opens a new window. */
const refusalWindows = (seq: Op[]): number => { let n = 0; let open = false; for (const s of seq) { if (s.op !== "clear") continue; if (s.role === "operator") open = false; else if (!open) { n++; open = true; } } return n; };
describe("A4 failed boots suspend until the operator-only clear", () => {
  test("model-checked over random boot/clear sequences; a non-operator clear is refused and recorded", async () => {
    await fc.assert(fc.asyncProperty(ops, async (seq) => {
      const store = createMemoryStore() as DurableStore;
      const { seen, refusals } = await runSequence(seq, store);
      for (const o of seen) expect(o.safe).toBe(o.expectSafe);
      const log = await logOf(store);
      const userClears = seq.filter((s) => s.op === "clear" && s.role === "user").length;
      const opClears = seq.filter((s) => s.op === "clear" && s.role === "operator").length;
      expect(log.filter((e) => e.type === "workbench.safemode.cleared").length).toBe(opClears);
      expect(log.filter((e) => e.type === "capability.presentation.faulted" && (e.payload as { faultClass: string }).faultClass === "unauthorized-clear").length).toBe(refusalWindows(seq));
      expect(refusals.filter((ok) => !ok).length).toBe(userClears);
    }), { numRuns: RUNS });
  });
  test("two failed boots, then a ready claim does not lift it, a user clear does not, the operator clear does", async () => {
    const store = createMemoryStore() as DurableStore;
    await SafeModeController.boot(store, TENANT, ["ext.A"]);
    await SafeModeController.boot(store, TENANT, ["ext.A"]);
    const c = await SafeModeController.boot(store, TENANT, ["ext.A"]);
    expect(c.read().safe).toBe(true);
    expect(await c.bootReady()).toBe(false);
    expect((await c.clear({ role: "user" })).ok).toBe(false);
    expect((await readBootExclusion(store, ["ext.A"])).safe).toBe(true);
    expect((await readBootExclusion(store, ["ext.B"])).safe).toBe(false);
    expect((await c.clear({ role: "operator" })).ok).toBe(true);
    expect((await readBootExclusion(store, ["ext.A"])).safe).toBe(false);
  });
});

// ======================= A5 =======================
describe("A5 safe mode writes only fault and safemode events", () => {
  test("the durable registry is byte-identical around safe-mode activity (log hash)", async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom("capability.activated", "capability.suspended", "authority.grant.issued"), { minLength: 1, maxLength: 5 }), fc.array(fc.oneof(bad, governance, valid), { maxLength: 5 }), fc.constantFrom("operator", "user"),
      async (seedTypes, attempts, role) => {
        const store = createMemoryStore() as DurableStore;
        const rec = new LifecycleRecorder(store, TENANT);
        for (const [i, t] of seedTypes.entries()) await rec.commitBatch(`cap.${i}`, [{ type: t, payload: { capabilityId: `cap.${i}`, level: "user" } }]);
        await SafeModeController.boot(store, TENANT, ["ext.A"]); await SafeModeController.boot(store, TENANT, ["ext.A"]);
        const before = await logOf(store);
        const c = await SafeModeController.boot(store, TENANT, ["ext.A"]);
        expect(c.read().safe).toBe(true);
        const reg = new slot.SlotRegistry(c);
        const frags = [];
        for (const a of attempts) { const r = await reg.register(a); if (r.ok) frags.push(r.fragment); }
        const { container } = render(<div>{frags.map((f) => <slot.FragmentSlot key={f.key} fragment={f} read={c.read()} faults={c.faults} />)}</div>);
        mountBundleHandlers(c.read(), new Map(), [{ id: "h", mount: () => {} }]);
        await c.bootReady(); await c.clear({ role });
        container.remove();
        const after = await logOf(store);
        const nonSafe = (rows: typeof after) => rows.filter((e) => !(SAFE_MODE_EVENT_TYPES as readonly string[]).includes(e.type));
        expect(hashOf(nonSafe(after))).toBe(hashOf(nonSafe(before)));
        expect(hashOf(after.slice(0, before.length))).toBe(hashOf(before));
        for (const e of after.slice(before.length)) expect((SAFE_MODE_EVENT_TYPES as readonly string[]).includes(e.type)).toBe(true);
      }), { numRuns: Math.min(RUNS, 100) });
  });
});
