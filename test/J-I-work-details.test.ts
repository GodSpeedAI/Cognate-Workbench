// Settings -> General -> "Work details" (reference-behavior-matrix.md §10a): confirms the setting
// is durable event-log state, not component-local memory — it survives a full runtime restart
// against the same SQLite store, the same durability every other setting in this app has
// (model-config, onboarding). Mirrors J-G-persistence.test.ts's close-runtime/reopen-same-store shape.
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, startServer } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";

describe("J-I-work-details", () => {
  test("Work details preference survives a runtime restart against the same store", async () => {
    await withTempHome(async (home) => {
      // A fresh home has no `settings.changed` events yet — the "current" row is absent, which is
      // what makes the UI fall back to the default mode ("standard").
      {
        const { app } = await bootApp(home);
        try {
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
          expect(rows.find((r) => r.key === "current")).toBeUndefined();
        } finally {
          await app.stop();
        }
      }

      {
        const { app, client } = await bootApp(home);
        try {
          await client.invoke("settings.changeWorkDetails", { workDetails: "verbose" });
          await app.runtime.idle();
          const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
          const current = rows.find((r) => r.key === "current")?.value as { readonly workDetails?: string } | undefined;
          expect(current?.workDetails).toBe("verbose");
        } finally {
          await app.stop();
        }
      }

      // Reopen the same SQLite file in a fresh process-equivalent server instance — durable across a
      // full runtime restart, not just a client reload.
      const reopened = await startServer({ port: 0, home });
      try {
        await reopened.runtime.idle();
        const rows = (await reopened.runtime.service.readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
        const current = rows.find((r) => r.key === "current")?.value as { readonly workDetails?: string } | undefined;
        expect(current?.workDetails).toBe("verbose");
      } finally {
        await reopened.stop();
      }
    });
  });

  test("settings.changeWorkDetails rejects an unknown mode", async () => {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      try {
        await expect(client.invoke("settings.changeWorkDetails", { workDetails: "extreme" })).rejects.toThrow();
      } finally {
        await app.stop();
      }
    });
  });
});
