// Journey J-REMOTE-diagnostics: remote-control transitions (start/stop, pairing errors) are durable
// `workbench.remote.*` events folded into the workbench projection's `remote/control` row — they
// survive a restart, the polls record nothing, and the row never carries a pairing secret.
import { describe, expect, test } from "bun:test";
import { LOCAL_OPERATOR, type AppServer } from "../src/server.ts";
import { bootApp, withTempHome } from "./helpers.ts";

type Client = Awaited<ReturnType<typeof bootApp>>["client"];

interface RemoteRow {
  readonly state?: string;
  readonly lastError?: string;
  readonly events?: readonly { readonly at: string; readonly text: string }[];
}

async function remoteRow(app: AppServer): Promise<RemoteRow | undefined> {
  await app.runtime.idle();
  const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workbench" })).rows;
  return rows.find((r) => r.key === "remote/control" || r.key.endsWith("/remote/control"))?.value as RemoteRow | undefined;
}

/** The desktop-bearer control path the Remote dialog itself uses. */
async function control(app: AppServer, path: "/remote/start" | "/remote/stop" | "/remote/status"): Promise<Response> {
  return fetch(`${app.url}${path}`, { method: path === "/remote/status" ? "GET" : "POST", headers: { authorization: `Bearer ${app.operatorSessionToken}` } });
}

describe("J-REMOTE-diagnostics", () => {
  test("start and stop are recorded as durable transitions; polls record nothing; the row carries no secret", async () => {
    await withTempHome(async (home) => {
      let snapshot: RemoteRow | undefined;
      {
        const { app, client } = await bootApp(home);
        try {
          expect(await remoteRow(app)).toBeUndefined();
          const started = await control(app, "/remote/start");
          expect(started.status).toBe(200);
          const afterStart = await remoteRow(app);
          expect(afterStart?.state).toBe("waiting");
          expect(afterStart?.events?.at(-1)?.text).toBe("Connection waiting");

          // The 2 s poll the dialog runs must never be recorded: two status reads change nothing.
          await control(app, "/remote/status");
          await control(app, "/remote/status");
          expect(await remoteRow(app)).toEqual(afterStart);

          // A stopped remote is a transition too.
          const stopped = await control(app, "/remote/stop");
          expect(stopped.status).toBe(200);
          const afterStop = await remoteRow(app);
          expect(afterStop?.state).toBe("off");
          expect(afterStop?.events?.map((e) => e.text)).toEqual(["Connection waiting", "Connection off"]);
          snapshot = afterStop;
        } finally {
          await client.close();
          await app.stop();
        }
      }
      {
        const { app, client } = await bootApp(home);
        try {
          // The history survives a full restart.
          expect(await remoteRow(app)).toEqual(snapshot);
        } finally {
          await client.close();
          await app.stop();
        }
      }
    });
  });
});
