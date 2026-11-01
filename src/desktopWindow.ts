// Opening the Workbench like a desktop app: a Chromium-family browser in `--app` mode with its own profile
// directory, so the window is a process this launcher owns and can wait on. No dependency, no webview.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

type Env = Readonly<Record<string, string | undefined>>;
const WIN_BROWSERS: ReadonlyArray<readonly string[]> = [
  ["Microsoft", "Edge", "Application", "msedge.exe"],
  ["Google", "Chrome", "Application", "chrome.exe"],
  ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
];
const MAC_BROWSERS: ReadonlyArray<readonly [app: string, binary: string]> = [
  ["Google Chrome", "Google Chrome"], ["Microsoft Edge", "Microsoft Edge"], ["Chromium", "Chromium"], ["Brave Browser", "Brave Browser"],
];
const LINUX_BROWSERS = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"];

/** The first installed Chromium-family browser that supports `--app`, or undefined. Pure: the caller injects the platform view. */
export function findAppBrowser(platform: NodeJS.Platform, env: Env, exists: (path: string) => boolean = existsSync): string | undefined {
  const override = env.COGNATE_APP_BROWSER;
  if (override && exists(override)) return override;
  if (platform === "win32") {
    const roots = [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA].filter((r): r is string => !!r);
    for (const parts of WIN_BROWSERS) for (const root of roots) {
      const path = `${root.replace(/[\\/]+$/, "")}\\${parts.join("\\")}`;
      if (exists(path)) return path;
    }
    return undefined;
  }
  if (platform === "darwin") {
    const roots = ["/Applications", join(env.HOME ?? homedir(), "Applications")];
    for (const [app, binary] of MAC_BROWSERS) for (const root of roots) {
      const path = `${root}/${app}.app/Contents/MacOS/${binary}`;
      if (exists(path)) return path;
    }
    return undefined;
  }
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const name of LINUX_BROWSERS) for (const dir of dirs) {
    const path = `${dir}/${name}`;
    if (exists(path)) return path;
  }
  return undefined;
}

export function appWindowArgs(url: string, profileDir: string): string[] {
  return [`--app=${url}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", "--window-size=1440,920", "--class=CognateWorkbench"];
}

/** Hand the URL to the OS default browser. Never throws. */
export function openDefaultBrowser(url: string, platform: NodeJS.Platform = process.platform): boolean {
  const command = platform === "win32" ? ["rundll32", "url.dll,FileProtocolHandler", url] : platform === "darwin" ? ["open", url] : ["xdg-open", url];
  try {
    Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

export interface AppWindow {
  readonly exited: Promise<number>;
  unref(): void;
}

/** Spawn the browser in app mode with the dedicated profile `<home>/app-window`. */
export function launchAppWindow(browser: string, url: string, home: string): AppWindow {
  const child = Bun.spawn([browser, ...appWindowArgs(url, join(home, "app-window"))], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  return { exited: child.exited, unref: () => child.unref() };
}
