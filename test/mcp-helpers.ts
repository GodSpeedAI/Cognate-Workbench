// Shared fixtures for the executable-payload journeys (J-CAP-mcp, J-CAP-suspend): the stdio MCP stub
// bundle, its manifest, and event queries.
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PostureRecord } from "../src/capabilities/execSpawn.ts";
import { allEvents, type AppServer } from "./wb-helpers.ts";

export const STUB = join(import.meta.dir, "fixtures/mcp-stub/server.mjs");

/** The operator's honest record for the local host-process path (design 6.2): what the matrix cannot enforce there. */
export const LOCAL_POSTURE: PostureRecord = {
  worldId: "local",
  authorizes: {
    network: { level: "not-enforced", note: "local host process: no network namespace; the server may reach the network" },
    subprocess: { level: "not-enforced", note: "local host process: child-process denial is not enforceable" },
  },
};

export type ServerDecl = Record<string, unknown>;

export const stubManifest = (servers: ServerDecl[] = [{ id: "stub", command: ["bun", "${bundleDir}/server.mjs"] }], extra: Record<string, unknown> = {}) => ({
  name: "MCP stub",
  purpose: "stdio MCP stub for the capability runtime journeys",
  skills: [{ name: "readme", entry: "README.md", isEntryDocument: true }],
  requirements: ["capability.invoke", "skill.load", "mcp.server"],
  mcpServers: servers,
  ...extra,
});

export async function authorStub(home: string, label: string): Promise<string> {
  const dir = join(home, "authoring", label);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "# MCP stub\n");
  await copyFile(STUB, join(dir, "server.mjs"));
  return dir;
}

export const eventsOfType = async (app: AppServer, ...types: string[]) => (await allEvents(app)).filter((e) => types.includes(e.eventType));
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
