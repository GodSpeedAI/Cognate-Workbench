// J-DESKTOP-launch: the Workbench opens in its own app window and quits with it.
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { appWindowArgs, findAppBrowser } from "../src/desktopWindow.ts";

const set = (...paths: string[]) => (p: string) => paths.includes(p);

describe("J-DESKTOP-launch findAppBrowser", () => {
  test("windows prefers Edge over Chrome and checks each root", () => {
    const env = { "ProgramFiles(x86)": "C:\\PF86", ProgramFiles: "C:\\PF", LOCALAPPDATA: "C:\\L" };
    const edge = "C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe";
    const chrome = "C:\\PF\\Google\\Chrome\\Application\\chrome.exe";
    expect(findAppBrowser("win32", env, set(edge, chrome))).toBe(edge);
    expect(findAppBrowser("win32", env, set(chrome))).toBe(chrome);
    expect(findAppBrowser("win32", env, set("C:\\L\\Microsoft\\Edge\\Application\\msedge.exe"))).toBe("C:\\L\\Microsoft\\Edge\\Application\\msedge.exe");
    expect(findAppBrowser("win32", env, set("C:\\PF\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"))).toContain("brave.exe");
    expect(findAppBrowser("win32", env, set())).toBeUndefined();
  });
  test("macOS checks /Applications then ~/Applications", () => {
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const userEdge = "/Users/u/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    expect(findAppBrowser("darwin", { HOME: "/Users/u" }, set(chrome, userEdge))).toBe(chrome);
    expect(findAppBrowser("darwin", { HOME: "/Users/u" }, set(userEdge))).toBe(userEdge);
    expect(findAppBrowser("darwin", { HOME: "/Users/u" }, set())).toBeUndefined();
  });
  test("linux searches PATH in preference order", () => {
    const env = { PATH: "/usr/local/bin:/usr/bin" };
    expect(findAppBrowser("linux", env, set("/usr/bin/chromium", "/usr/local/bin/google-chrome"))).toBe("/usr/local/bin/google-chrome");
    expect(findAppBrowser("linux", env, set("/usr/bin/brave-browser"))).toBe("/usr/bin/brave-browser");
    expect(findAppBrowser("linux", env, set())).toBeUndefined();
  });
  test("COGNATE_APP_BROWSER wins when it exists", () => {
    expect(findAppBrowser("linux", { COGNATE_APP_BROWSER: "/x/fake", PATH: "/usr/bin" }, set("/x/fake", "/usr/bin/chromium"))).toBe("/x/fake");
    expect(findAppBrowser("linux", { COGNATE_APP_BROWSER: "/x/missing", PATH: "/usr/bin" }, set("/usr/bin/chromium"))).toBe("/usr/bin/chromium");
  });
});

test("J-DESKTOP-launch appWindowArgs", () => {
  expect(appWindowArgs("http://127.0.0.1:3180", "/h/app-window")).toEqual([
    "--app=http://127.0.0.1:3180", "--user-data-dir=/h/app-window", "--no-first-run", "--no-default-browser-check", "--window-size=1440,920", "--class=CognateWorkbench",
  ]);
});

const cli = join(import.meta.dir, "..", "src", "cli.ts");

async function freePort(): Promise<number> {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

async function portOpen(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(process.platform === "win32")("J-DESKTOP-launch launch (fake browser)", () => {
  test("opens the app window, quits with it, and a second launch reuses the running instance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "launch-"));
    const port = await freePort();
    try {
      const record = join(dir, "argv.txt");
      const browser = join(dir, "fake-browser");
      // Records argv, fetches /health from the --app URL, then stays open for MS milliseconds like a window.
      await writeFile(browser, `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\nconst url = process.argv.find((a) => a.startsWith("--app="))!.slice(6);\nconst health = await fetch(url + "/health").then((r) => r.status).catch(() => "down");\nappendFileSync(process.env.RECORD!, JSON.stringify({ argv: process.argv.slice(2), health }) + "\\n");\nawait Bun.sleep(Number(process.env.MS ?? 0));\n`);
      await chmod(browser, 0o755);
      const env = { ...process.env, COGNATE_APP_BROWSER: browser, COGNATE_WORKBENCH_HOME: join(dir, "home"), PORT: String(port), RECORD: record, MS: "3500" };
      const first = Bun.spawn([process.execPath, cli, "launch"], { env, stdout: "pipe", stderr: "pipe" });

      let lines: string[] = [];
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (existsSync(record)) { lines = (await readFile(record, "utf8")).trim().split("\n"); if (lines[0]) break; }
        await Bun.sleep(200);
      }
      const seen = JSON.parse(lines[0]!) as { argv: string[]; health: number };
      expect(seen.argv).toContain(`--app=http://127.0.0.1:${port}`);
      expect(seen.argv).toContain(`--user-data-dir=${join(dir, "home", "app-window")}`);
      expect(seen.health).toBe(200);

      // Second launch while the first window is still open: reuses the instance, opens a window, exits 0.
      const second = Bun.spawn([process.execPath, cli, "launch"], { env: { ...env, MS: "0" }, stdout: "pipe", stderr: "pipe" });
      expect(await second.exited).toBe(0);
      const all = (await readFile(record, "utf8")).trim().split("\n");
      expect(all.length).toBe(2);
      expect(JSON.parse(all[1]!).argv).toContain(`--app=http://127.0.0.1:${port}`);
      expect(await portOpen(port)).toBe(true);

      // The first window closes; the launcher shuts the server down by itself.
      expect(await Promise.race([first.exited, Bun.sleep(30_000).then(() => "timeout")])).toBe(0);
      expect(await portOpen(port)).toBe(false);
      expect(existsSync(join(dir, "home", "server.lock"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
