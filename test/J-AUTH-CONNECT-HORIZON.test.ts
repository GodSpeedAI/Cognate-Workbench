// J-AUTH-CONNECT-HORIZON: the operator's "Connect Horizon" action mints a session for Horizon and
// writes the key beside the setup (never to the browser). Runs against actual PostgreSQL (pg0).
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";

const clientFor = (app: AppServer, token: string) => createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => token), caller: LOCAL_OPERATOR });

async function withApp<T>(body: (app: AppServer, setupRoot: string) => Promise<T>): Promise<T> {
  const setupRoot = await mkdtemp(join(tmpdir(), "wb-connect-horizon-"));
  // COGNATE_WORKBENCH_HOME is <setup root>/workbench; the key goes to <setup root>/secrets.
  const home = join(setupRoot, "workbench");
  await mkdir(home, { recursive: true });
  let app: AppServer | undefined;
  try {
    app = await startServer({ executionPosture: "uncontained-local", port: 0, home });
    return await body(app, setupRoot);
  } finally {
    await app?.stop();
    await rm(setupRoot, { recursive: true, force: true });
  }
}

test("connect-horizon refuses more than 90 days", async () => {
  await withApp(async (app, root) => {
    const operator = clientFor(app, app.operatorSessionToken);
    await expect(operator.invoke("identity.connectHorizon", { ttlHours: 24 * 90 + 1 } as never)).rejects.toThrow("90 days");
    await expect(operator.invoke("identity.connectHorizon", { ttlHours: 0 } as never)).rejects.toThrow();
    await expect(operator.invoke("identity.connectHorizon", { token: "x" } as never)).rejects.toThrow("ttlHours only");
    await expect(stat(join(root, "secrets", "workbench.key"))).rejects.toThrow();
  });
}, 60_000);

test("connect-horizon writes the key with mode 0600", async () => {
  await withApp(async (app, root) => {
    const operator = clientFor(app, app.operatorSessionToken);
    const result = (await operator.invoke("identity.connectHorizon", { ttlHours: 24 })) as { sessionId: string; expiresAt: string };
    const keyPath = join(root, "secrets", "workbench.key");
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect((await stat(`${keyPath}.json`)).mode & 0o777).toBe(0o600);
    const token = (await readFile(keyPath, "utf8")).trim();
    expect(token.startsWith("wbs1.")).toBe(true);
    const companion = JSON.parse(await readFile(`${keyPath}.json`, "utf8")) as Record<string, string>;
    expect(companion).toEqual({ sessionId: result.sessionId, expiresAt: result.expiresAt });
    // The key works as a session for the operator identity.
    await expect(createRemoteRuntimeService(connectTransport(app.url), () => token).readProjection(LOCAL_OPERATOR, { name: "settings" })).resolves.toBeTruthy();
    // The ledger holds hashes only: inspection never carries the key.
    expect(JSON.stringify(await operator.invoke("identity.inspect", {}))).not.toContain(token);
  });
}, 60_000);

test("connect-horizon never returns the token to the browser", async () => {
  await withApp(async (app, root) => {
    const operator = clientFor(app, app.operatorSessionToken);
    const result = await operator.invoke("identity.connectHorizon", {});
    const token = (await readFile(join(root, "secrets", "workbench.key"), "utf8")).trim();
    expect(Object.keys(result as object).sort()).toEqual(["expiresAt", "sessionId"]);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("wbs1.");
    // A Horizon key cannot connect Horizon again for someone else: only the operator's own boot session is a human operator act of this kind,
    // and a forged raw token is refused.
    const forged = clientFor(app, `${LOCAL_OPERATOR.tenant}:${LOCAL_OPERATOR.actor.id}`);
    await expect(forged.invoke("identity.connectHorizon", {})).rejects.toThrow();
  });
}, 60_000);
