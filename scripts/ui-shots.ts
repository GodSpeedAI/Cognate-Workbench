#!/usr/bin/env bun
// Reusable UI screenshot harness. Boots the REAL app (dev bundle, mock model) on a fresh temp home,
// builds a temp workspace with nested files, then drives playwright-core chromium through named
// states and writes one PNG per (state x viewport x theme).
//
//   bun scripts/ui-shots.ts --out <dir> [--states a,b,c | --tag t1a | --all] [--list]
//        [--viewports desktop,mobile] [--themes light,dark]
//        [--no-model] [--no-onboarding-dismiss] [--no-workspace] [--fresh]
//
//   --fresh                    = --no-model --no-onboarding-dismiss --no-workspace (first-run home)
//   --no-model                 skip model.configure (no provider configured)
//   --no-onboarding-dismiss    leave the welcome / API-key dialogs showing
//   --no-workspace             do not create or select a workspace (and no sessions)
//
// Files are named `<state>.<viewport>.<theme>.png` (viewports: desktop 1440x900, mobile 390x844).
// Later tranches add states to STATES below; keep `setup` self-contained (it receives a freshly
// loaded page) and give each state the tag of the tranche that owns it.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { LOCAL_OPERATOR, bootApp, inv, waitUntil, withTempHome } from "../test/wb-helpers.ts";

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = "light" | "dark";

export interface ShotContext {
  /** Absolute path of the primary temp workspace. */
  readonly repo: string | undefined;
  readonly viewport: ViewportName;
  readonly theme: Theme;
}

export interface ShotState {
  readonly tag: string;
  readonly describe: string;
  readonly viewports?: readonly ViewportName[];
  readonly themes?: readonly Theme[];
  /** Drive the freshly loaded page into the state to capture. */
  readonly setup: (page: Page, ctx: ShotContext) => Promise<void>;
}

const settle = (page: Page, ms = 250) => page.waitForTimeout(ms);

async function openSettings(page: Page, section?: string): Promise<void> {
  await page.getByRole("button", { name: "Settings", exact: false }).first().click();
  await page.getByRole("region", { name: "Settings" }).or(page.locator("section.settings-page")).first().waitFor();
  if (section) await page.getByRole("tab", { name: section, exact: true }).click();
  await settle(page);
}

/** First-run shots share one home across viewports/themes, so Welcome may already be dismissed. */
async function continueIfWelcome(page: Page): Promise<void> {
  await page.getByRole("dialog").waitFor({ timeout: 4000 }).catch(() => undefined);
  const btn = page.getByRole("button", { name: "Continue" });
  if (await btn.count()) await btn.click();
}

async function ensureInspector(page: Page, tab: string): Promise<void> {
  const toggle = page.getByRole("button", { name: "Toggle inspector" });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await settle(page, 300);
}

export const STATES: Record<string, ShotState> = {
  shell: { tag: "t1a", describe: "Main shell, workspace with sessions", viewports: ["desktop", "mobile"], setup: async (page) => { await page.locator(".session-row-wrap").first().waitFor().catch(() => undefined); await settle(page); } },
  "settings-general": { tag: "t1a", describe: "Settings > General", viewports: ["desktop", "mobile"], setup: (page) => openSettings(page, "General") },
  "settings-appearance": { tag: "t1a", describe: "Settings > Appearance", setup: (page) => openSettings(page, "Appearance") },
  "settings-models": { tag: "t1a", describe: "Settings > Models", setup: (page) => openSettings(page, "Models") },
  "settings-models-wizard": {
    tag: "t1a", describe: "Settings > Models > Add model provider (custom)", viewports: ["desktop", "mobile"], themes: ["light"],
    setup: async (page) => {
      await openSettings(page, "Models");
      await page.getByRole("button", { name: "Add model provider" }).click();
      await settle(page);
    },
  },
  "settings-plugins": { tag: "t1a", describe: "Settings > Plugins", setup: (page) => openSettings(page, "Plugins") },
  "settings-presets": { tag: "t1a", describe: "Settings > Agent presets", setup: (page) => openSettings(page, "Agent presets") },
  "settings-governance": { tag: "t1a", describe: "Settings > Governance & evidence", viewports: ["desktop", "mobile"], setup: (page) => openSettings(page, "Governance & evidence") },
  "settings-shortcuts": {
    tag: "t1a", describe: "Settings > Keyboard shortcuts (reached via Ctrl+/)",
    setup: async (page) => {
      await page.locator("textarea").first().focus().catch(() => undefined);
      await page.keyboard.press("Control+/");
      await page.getByRole("tab", { name: "Keyboard shortcuts", selected: true }).waitFor();
      await settle(page);
    },
  },
  "settings-about": { tag: "t1a", describe: "Settings > About", themes: ["light"], setup: (page) => openSettings(page, "About") },
  "config-dialog": {
    tag: "t1a", describe: "Configuration file dialog header over Settings", themes: ["light"],
    setup: async (page) => {
      await openSettings(page, "General");
      await page.getByRole("button", { name: "Open configuration file" }).click();
      await page.getByRole("dialog", { name: "Configuration file" }).waitFor();
      await settle(page);
    },
  },
  "add-workspace-dialog": {
    tag: "t1a", describe: "Add workspace dialog header", themes: ["light"],
    setup: async (page) => {
      await page.getByRole("button", { name: "Add workspace" }).click();
      await page.getByRole("dialog", { name: "Add workspace" }).waitFor();
      await settle(page);
    },
  },
  "remote-dialog": {
    tag: "t1a", describe: "Control from your phone dialog (X on the right)", themes: ["light"],
    setup: async (page) => {
      await page.getByRole("button", { name: "Mobile remote control" }).click();
      await page.getByRole("dialog", { name: "Control from your phone" }).waitFor();
      await settle(page, 600);
    },
  },
  "plugins-panel": {
    tag: "t1a", describe: "Plugins page header (close X right)", themes: ["light"],
    setup: async (page) => {
      await page.getByRole("button", { name: "Plugins", exact: true }).click();
      await page.getByRole("button", { name: "Close plugins panel" }).waitFor();
      await settle(page, 500);
    },
  },
  "rename-workspace-dialog": {
    tag: "t1a", describe: "Rename workspace dialog", themes: ["light"],
    setup: async (page) => {
      // The row's action button is hover-revealed; click it through the DOM so the state is deterministic.
      await page.locator('button[aria-label^="Workspace actions for"]').first().evaluate((el) => (el as HTMLElement).click());
      await page.getByRole("menuitem", { name: "Rename" }).click();
      await page.getByRole("dialog", { name: "Rename workspace" }).waitFor();
      await settle(page);
    },
  },
  "palette-open": {
    tag: "t1a", describe: "Command palette, empty query", themes: ["light", "dark"],
    setup: async (page) => {
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Command palette" }).waitFor();
      await settle(page);
    },
  },
  "palette-filtered": {
    tag: "t1a", describe: "Command palette filtered by 'sett'", themes: ["light", "dark"],
    setup: async (page) => {
      await page.keyboard.press("Control+k");
      await page.getByRole("combobox", { name: /Search actions/ }).fill("sett");
      await settle(page);
    },
  },
  "toast-undo": {
    tag: "t1a", describe: "Session archived toast with Undo", themes: ["light", "dark"],
    setup: async (page) => {
      const row = page.locator(".session-row-wrap").first();
      await row.hover();
      await row.getByRole("button", { name: /^Session actions/ }).click();
      await row.getByRole("menuitem", { name: /^Archive/ }).click();
      await page.getByRole("status").getByText("Session archived").waitFor();
      await settle(page, 300);
    },
  },

  // ---- T1b: header, inspector, context bar, sidebar, drawer ----
  "t1b-shell": { tag: "t1b", describe: "Shell: header view switch, sidebar, hero with context bar, inspector (Context)", viewports: ["desktop", "mobile"], themes: ["light", "dark"], setup: async (page) => { await page.locator(".session-row-wrap").first().waitFor().catch(() => undefined); await settle(page, 400); } },
  "t1b-inspector-context": { tag: "t1b", describe: "Inspector open on Context", themes: ["light"], setup: async (page) => { await ensureInspector(page, "Context"); } },
  "t1b-inspector-changes": { tag: "t1b", describe: "Inspector open on Changes (empty state)", themes: ["light", "dark"], setup: async (page) => { await ensureInspector(page, "Changes"); } },
  "t1b-inspector-details": { tag: "t1b", describe: "Inspector open on Details (empty state)", themes: ["light"], setup: async (page) => { await ensureInspector(page, "Details"); } },
  "t1b-inspector-wide": {
    tag: "t1b", describe: "Inspector resized wide with the keyboard", themes: ["light"],
    setup: async (page) => {
      await ensureInspector(page, "Context");
      await page.getByRole("separator", { name: "Resize inspector" }).focus();
      for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowLeft");
      await settle(page);
    },
  },
  "t1b-mobile-drawer": { tag: "t1b", describe: "Mobile: sidebar drawer open with scrim", viewports: ["mobile"], themes: ["light", "dark"], setup: async (page) => { await page.getByRole("button", { name: "Expand sidebar" }).click(); await settle(page, 400); } },
  "t1b-mobile-inspector": { tag: "t1b", describe: "Mobile: inspector as a full-screen sheet", viewports: ["mobile"], themes: ["light"], setup: async (page) => { await page.getByRole("button", { name: "Toggle inspector" }).click(); await settle(page, 400); } },
  "t1b-session-row-menu": {
    tag: "t1b", describe: "Sidebar session row hover with the actions menu", themes: ["light", "dark"],
    setup: async (page) => {
      const row = page.locator(".session-row-wrap").first();
      await row.waitFor();
      await row.hover();
      await row.getByRole("button", { name: /^Session actions/ }).click();
      await settle(page, 200);
    },
  },
  "t1b-task-menu": {
    tag: "t1b", describe: "Context bar: task chip menu", themes: ["light"],
    setup: async (page) => {
      await page.getByRole("button", { name: /^Task:/ }).click();
      await settle(page, 200);
    },
  },
  "t1b-running-turn": {
    tag: "t1b", describe: "Session with a running turn: context bar shows RUNNING", themes: ["light", "dark"], viewports: ["desktop", "mobile"],
    setup: async (page, ctx) => {
      if (ctx.viewport === "mobile") await page.getByRole("button", { name: "Expand sidebar" }).click();
      await page.locator(".session-row-wrap").first().click();
      const box = page.getByRole("textbox", { name: /Message or run a task/ });
      await box.fill("Summarise the README");
      await box.press("Enter");
      await page.getByRole("button", { name: "Stop generating" }).waitFor();
      await settle(page, 2500);
    },
  },
  "t1b-settings-inspector": {
    tag: "t1b", describe: "Settings page with the inspector open beside it", themes: ["light"],
    setup: async (page) => {
      await ensureInspector(page, "Context");
      await openSettings(page, "General");
    },
  },
  "t1b-view-workbench": { tag: "t1b", describe: "Header view switch on Workbench", themes: ["light"], setup: async (page) => { await page.getByRole("button", { name: "Workbench", exact: true }).click(); await settle(page, 500); } },
  "t1b-view-experts": { tag: "t1b", describe: "Header view switch on Experts & Teams", themes: ["light"], setup: async (page) => { await page.getByRole("button", { name: "Experts and Teams", exact: true }).click(); await settle(page, 500); } },
  "t1b-first-run": { tag: "t1b", describe: "No workspace: Choose a folder to work in", themes: ["light"], setup: async (page) => { await settle(page, 400); } },
  // t2: first-run flow (run with --fresh) and the composer model picker (default home).
  "t2-welcome": { tag: "t2", describe: "First run: Welcome step (--fresh)", viewports: ["desktop", "mobile"], setup: async (page) => { await page.getByRole("dialog").waitFor(); await settle(page, 400); } },
  "t2-provider-step": {
    tag: "t2", describe: "First run: Connect a model provider (--fresh)", viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await continueIfWelcome(page);
      await page.getByRole("heading", { name: "Connect a model provider" }).waitFor();
      await page.getByRole("radio", { name: /Custom OpenAI-compatible/ }).click();
      await page.getByLabel("Display name").fill("Acme gateway");
      await page.getByLabel("Base URL", { exact: true }).fill("https://gateway.example/v1");
      await settle(page, 400);
    },
  },
  "t2-folder-step": {
    tag: "t2", describe: "First run: Choose a folder (--fresh)", themes: ["light"],
    setup: async (page) => {
      await continueIfWelcome(page);
      await page.getByRole("radio", { name: /Ollama/ }).click();
      await page.getByLabel("Model", { exact: true }).fill("llama3.1");
      await page.getByRole("button", { name: "Save and continue" }).click();
      await page.getByRole("heading", { name: "Choose a folder to work in" }).waitFor();
      await settle(page, 400);
    },
  },
  "t2-empty-state": {
    tag: "t2", describe: "Configure later: friendly empty state (--fresh)", themes: ["light"], viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await continueIfWelcome(page);
      const later = page.getByRole("button", { name: "Configure later" });
      if (await later.count()) await later.click();
      await page.getByText("No model provider connected").waitFor();
      await settle(page, 400);
    },
  },
  "t2-model-picker": {
    tag: "t2", describe: "Composer model picker open", themes: ["light", "dark"],
    setup: async (page) => {
      await page.getByRole("button", { name: /^Model / }).click();
      await page.getByRole("dialog", { name: "Switch model" }).waitFor();
      await settle(page, 500);
    },
  },
  // t3: inspector Files and Config tabs.
  "t3-settings-config": {
    tag: "t3", describe: "Settings > Open configuration file opens the editable Config tab beside the page", themes: ["light", "dark"],
    setup: async (page) => {
      await openSettings(page, "General");
      await page.getByRole("button", { name: "Open configuration file" }).click();
      await page.getByRole("textbox", { name: /configuration/i }).first().waitFor();
      await settle(page, 400);
    },
  },
  "t3-files-tree": {
    tag: "t3", describe: "Files tab: workspace tree with a folder expanded and a file open", themes: ["light", "dark"], viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await ensureInspector(page, "Files");
      await page.getByRole("treeitem", { name: /src/ }).first().click();
      await page.getByRole("treeitem", { name: /index\.ts/ }).first().click();
      await settle(page, 400);
    },
  },
};

interface Options {
  out: string;
  states: string[];
  viewports: ViewportName[] | undefined;
  themes: Theme[] | undefined;
  model: boolean;
  onboardingDismiss: boolean;
  workspace: boolean;
  list: boolean;
}

function parseArgs(argv: string[]): Options {
  const o: Options = { out: "", states: [], viewports: undefined, themes: undefined, model: true, onboardingDismiss: true, workspace: true, list: false };
  let tag: string | undefined;
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (a === "--out") o.out = next();
    else if (a === "--states") o.states = next().split(",").filter(Boolean);
    else if (a === "--tag") tag = next();
    else if (a === "--all") all = true;
    else if (a === "--viewports") o.viewports = next().split(",") as ViewportName[];
    else if (a === "--themes") o.themes = next().split(",") as Theme[];
    else if (a === "--no-model") o.model = false;
    else if (a === "--no-onboarding-dismiss") o.onboardingDismiss = false;
    else if (a === "--no-workspace") o.workspace = false;
    else if (a === "--fresh") { o.model = false; o.onboardingDismiss = false; o.workspace = false; }
    else if (a === "--list") o.list = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (all) o.states = Object.keys(STATES);
  if (tag) o.states = Object.entries(STATES).filter(([, s]) => s.tag === tag).map(([n]) => n);
  return o;
}

async function makeRepo(parent: string, name: string): Promise<string> {
  const repo = join(parent, name);
  const files: Record<string, string> = {
    "README.md": `# ${name}\n\nSample workspace for screenshots.\n`,
    "package.json": JSON.stringify({ name, version: "0.0.1" }, null, 2),
    "src/index.ts": "export const hello = () => 'hello';\n",
    "src/ui/App.tsx": "export const App = () => null;\n",
    "src/ui/theme/tokens.css": ":root { --accent: #2f6feb; }\n",
    "docs/guide/getting-started.md": "# Getting started\n",
    "docs/guide/api.md": "# API\n",
    "test/index.test.ts": "import { test } from 'bun:test';\ntest('x', () => {});\n",
  };
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(join(repo, rel, ".."), { recursive: true });
    await writeFile(join(repo, rel), body);
  }
  return repo;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.list) {
    for (const [name, s] of Object.entries(STATES)) console.log(`${name.padEnd(26)} [${s.tag}] ${s.describe}`);
    return;
  }
  if (!opts.out) throw new Error("--out <dir> is required");
  if (opts.states.length === 0) throw new Error("choose states with --states, --tag or --all (see --list)");
  const unknown = opts.states.filter((n) => STATES[n] === undefined);
  if (unknown.length > 0) throw new Error(`unknown state(s): ${unknown.join(", ")}`);
  await mkdir(opts.out, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), "ui-shots-"));
  const browser = await chromium.launch();
  try {
    await withTempHome(async (home) => {
      const { app, client } = await bootApp(home);
      let repo: string | undefined;
      try {
        if (opts.model) await inv(client, "model.configure", { providerId: "mock", baseURL: "http://127.0.0.1:59999/v1", protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
        if (opts.onboardingDismiss) {
          await inv(client, "onboarding.dismiss", { step: "notice" });
          await inv(client, "onboarding.dismiss", { step: "apikey" });
        }
        if (opts.workspace) {
          const second = await makeRepo(scratch, "docs-site");
          await inv(client, "workspace.select", { path: second });
          repo = await makeRepo(scratch, "cognate-sample");
          const { workspaceId } = (await inv(client, "workspace.select", { path: repo })) as { workspaceId: string };
          await waitUntil("workspace visible", async () => {
            const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
            return rows.some((r) => r.key === `record/${workspaceId}`) || undefined;
          });
          for (let i = 0; i < 3; i++) await inv(client, "session.create", { workspaceId, requestId: crypto.randomUUID() });
          await waitUntil("sessions visible", async () => {
            const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
            return rows.length >= 3 || undefined;
          });
        }
        for (const name of opts.states) {
          const state = STATES[name]!;
          for (const vp of opts.viewports ?? state.viewports ?? (["desktop"] as const)) {
            for (const theme of opts.themes ?? state.themes ?? (["light", "dark"] as const)) {
              const context = await browser.newContext({ viewport: VIEWPORTS[vp], colorScheme: theme });
              const page = await context.newPage();
              const errors: string[] = [];
              page.on("pageerror", (e) => errors.push(e.message));
              try {
                await page.goto(app.url, { waitUntil: "load" });
                await page.getByRole("button", { name: "Settings" }).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
                await state.setup(page, { repo, viewport: vp, theme });
                const file = join(opts.out, `${name}.${vp}.${theme}.png`);
                await page.screenshot({ path: file });
                console.log(`wrote ${file}${errors.length ? `  (page errors: ${errors.join(" | ")})` : ""}`);
              } catch (error) {
                console.error(`FAILED ${name} ${vp} ${theme}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
                await page.screenshot({ path: join(opts.out, `FAILED-${name}.${vp}.${theme}.png`) }).catch(() => undefined);
                process.exitCode = 1;
              } finally {
                await context.close();
              }
            }
          }
        }
      } finally {
        await client.close();
        await app.stop();
      }
    });
  } finally {
    await browser.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
