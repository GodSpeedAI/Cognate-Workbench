// The model picker's "Checking for more models…" note is tied to a lookup that is really in flight:
// it settles to ready or failed (timeout included) and the note disappears.
import { describe, expect, test } from "bun:test";
import { catalogNote, settleCatalog } from "../src/ui/models/ModelPicker.tsx";

describe("model picker catalog lookup", () => {
  test("the note shows only while loading", () => {
    expect(catalogNote({ state: "loading" }, true)).toBe("Checking for more models…");
    expect(catalogNote({ state: "loading" }, false)).toBe("Loading models…");
    expect(catalogNote({ state: "ready", models: ["a"] }, true)).toBeUndefined();
    expect(catalogNote({ state: "failed", reason: "x" }, true)).toBeUndefined();
    expect(catalogNote(undefined, true)).toBeUndefined();
  });

  test("a lookup that answers settles to ready, so the note is gone", async () => {
    const next = await settleCatalog(async () => ({ ok: true, models: ["m1", "m2"] }), 1000);
    expect(next).toEqual({ state: "ready", models: ["m1", "m2"] });
    expect(catalogNote(next, true)).toBeUndefined();
  });

  test("a lookup that never answers settles to failed after the timeout", async () => {
    const started = Date.now();
    const next = await settleCatalog(() => new Promise(() => {}), 30);
    expect(next.state).toBe("failed");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(catalogNote(next, true)).toBeUndefined();
  });

  test("a rejected or not-ok lookup settles to failed", async () => {
    expect((await settleCatalog(async () => { throw new Error("boom"); }, 1000)).state).toBe("failed");
    expect(await settleCatalog(async () => ({ ok: false, reason: "no", models: [] }), 1000)).toEqual({ state: "failed", reason: "no" });
  });
});
