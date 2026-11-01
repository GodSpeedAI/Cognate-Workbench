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
import { LOCAL_OPERATOR, bootApp, bootAimock, inv, waitUntil, withTempHome } from "../test/wb-helpers.ts";
import { bootHarnessApp, makeFakeHost } from "../test/harness-helpers.ts";

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
type ViewportName = keyof typeof VIEWPORTS;
type Theme = "light" | "dark";

export interface ShotContext {
  /** Absolute path of the primary temp workspace. */
  readonly repo: string | undefined;
  /** The app's protected data home (the temp home the server runs on). */
  readonly home: string;
  readonly viewport: ViewportName;
  readonly theme: Theme;
  /** The app's capability client, for harness-side data hygiene (human session titles). */
  readonly client?: Parameters<typeof inv>[0];
  readonly readSessions?: () => Promise<readonly { readonly id: string; readonly title: string }[]>;
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
  const settingsBtn = page.getByRole("button", { name: "Settings", exact: false }).first();
  if (!(await settingsBtn.isVisible())) await page.getByRole("button", { name: "Expand sidebar" }).click(); // phone: sidebar is a drawer
  await settingsBtn.click();
  await page.getByRole("region", { name: "Settings" }).or(page.locator("section.settings-page")).first().waitFor();
  if (section) await page.getByRole("tab", { name: section, exact: true }).click();
  await settle(page);
}

/** WCAG contrast of every visible, enabled button/link/input text against its effective background. */
async function auditContrast(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    const rgba = (c: string): [number, number, number, number] => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0]!, d[1]!, d[2]!, d[3]! / 255]; };
    const lum = (r: number, g: number, b: number) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = (el: Element): [number, number, number] => {
      const layers: [number, number, number, number][] = [];
      for (let e: Element | null = el; e; e = e.parentElement) { const a = rgba(getComputedStyle(e).backgroundColor); if (a[3] > 0) { layers.push(a); if (a[3] >= 1) break; } }
      let base: [number, number, number] = rgba(getComputedStyle(document.body).backgroundColor).slice(0, 3) as [number, number, number];
      if (layers.length && layers[layers.length - 1]![3] >= 1) base = layers.pop()!.slice(0, 3) as [number, number, number];
      for (const l of layers.reverse()) base = [0, 1, 2].map((i) => l[i]! * l[3] + base[i]! * (1 - l[3])) as [number, number, number];
      return base;
    };
    const out: string[] = [];
    let checked = 0;
    for (const el of document.querySelectorAll("button, a[href], [role=button], [role=tab], input:not([type=checkbox]):not([type=radio]), select")) {
      const h = el as HTMLElement;
      if ((h as HTMLButtonElement).disabled || h.getAttribute("aria-disabled") === "true") continue;
      const r = h.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || getComputedStyle(h).visibility === "hidden") continue;
      const txt = (h.textContent ?? "").trim() || (h as HTMLInputElement).placeholder || ""; if (!txt) continue;
      checked += 1;
      const st = getComputedStyle(h); const fg = rgba(st.color); const bg = bgOf(h);
      const fgc = [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3])) as [number, number, number];
      const L1 = lum(...fgc), L2 = lum(...bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      if (ratio < 4.5) out.push(`${ratio.toFixed(2)}:1 "${txt.slice(0, 30)}" <${h.tagName.toLowerCase()} class="${h.className.toString().slice(0, 40)}"> at ${Math.round(r.x)},${Math.round(r.y)}`);
    }
    out.push(`(checked ${checked} controls)`);
    return out;
  });
}

async function runEditTurn(page: Page, ctx: ShotContext): Promise<void> {
  // Every state edits the same file; restore it so each capture starts from the same content.
  if (ctx.repo) await writeFile(join(ctx.repo, "src", "greet.ts"), "export const greet = () => 'Hello, world';\n");
  if (ctx.viewport === "mobile") await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.getByRole("button", { name: "New Session" }).first().click();
  await settle(page, 400);
  if (ctx.viewport === "mobile") await page.keyboard.press("Escape");
  const box = page.getByRole("textbox", { name: /Message or run a task/ });
  await box.fill("[[scenario:edit]] change the greeting");
  await box.press("Enter");
  await page.getByText(/Updated the greeting/).first().waitFor({ timeout: 30_000 });
}

/** The aimock scenario marker is test plumbing, not something a person would type. Real session titles derive
 *  from the person's first prompt (trimmed to 60 chars, src/projections/sessions.ts); the harness renames
 *  marker-titled sessions through the real `session.rename` capability so evidence reads like real use.
 *  Rename any session still carrying a harness scenario marker, so product screenshots show human titles. */
async function humanizeSessionTitles(page: Page, ctx: ShotContext): Promise<void> {
  if (!ctx.client || !ctx.readSessions) return;
  for (const row of await ctx.readSessions()) {
    if (!row.title.includes("[[scenario:")) continue;
    const human = row.title.replace(/\[\[scenario:[^\]]*\]\]\s*/, "").replace(/^./, (c) => c.toUpperCase());
    await inv(ctx.client, "session.rename", { sessionId: row.id, title: human });
  }
  await settle(page, 600);
}

/** First-run shots share one home across viewports/themes, so Welcome may already be dismissed. */
async function continueIfWelcome(page: Page): Promise<void> {
  await page.getByRole("dialog").waitFor({ timeout: 4000 }).catch(() => undefined);
  const btn = page.getByRole("button", { name: "Continue", exact: true });
  if (await btn.count()) await btn.click();
}

async function ensureInspector(page: Page, tab: string): Promise<void> {
  const toggle = page.getByRole("button", { name: "Toggle inspector" });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await settle(page, 300);
}

/** D-4 folder autocomplete: browse a seeded user home (projects/, Documents/, work/alpha ...). The app runs
 *  in this process and the suggest capability reads $HOME per call, so pointing HOME at the seeded
 *  folder for the duration of the capture is enough. */
async function seedBrowseHome(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "ui-shots-home-"));
  for (const dir of ["projects/cognate-workbench", "projects/prototype-lab", "Documents/taxes", "work/alpha", "work/beta", "Downloads"]) await mkdir(join(base, dir), { recursive: true });
  process.env.HOME = base;
  return base;
}

async function openAddWorkspaceInput(page: Page, ctx: ShotContext) {
  if (ctx.viewport === "mobile") await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page.getByRole("button", { name: "Add workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "Add workspace" });
  await dialog.waitFor();
  const input = dialog.getByRole("combobox").first();
  return { dialog, input };
}

export const STATES: Record<string, ShotState> = {
  shell: { tag: "t1a", describe: "Main shell, workspace with sessions", viewports: ["desktop", "mobile"], setup: async (page) => { await page.locator(".session-row-wrap").first().waitFor().catch(() => undefined); await settle(page); } },
  "settings-general": { tag: "t1a", describe: "Settings > General", viewports: ["desktop", "mobile"], setup: (page) => openSettings(page, "General") },
  "settings-appearance": { tag: "t1a", describe: "Settings > Appearance", setup: (page) => openSettings(page, "Appearance") },
  "settings-models": { tag: "t1a", describe: "Settings > Models", setup: (page) => openSettings(page, "Providers") },
  "settings-models-wizard": {
    tag: "t1a", describe: "Settings > Models > Add model provider (custom)", viewports: ["desktop", "mobile"], themes: ["light"],
    setup: async (page) => {
      await openSettings(page, "Providers");
      await page.getByRole("button", { name: "Add provider" }).click();
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
  "add-workspace-dialog": {
    tag: "t1a", describe: "Add workspace dialog header", themes: ["light"],
    setup: async (page) => {
      await page.getByRole("button", { name: "Add workspace" }).click();
      await page.getByRole("dialog", { name: "Add workspace" }).waitFor();
      await settle(page);
    },
  },
  "dir-suggest-empty": {
    tag: "d4", describe: "Add workspace: empty field focused (home folders offered)", themes: ["light"],
    setup: async (page, ctx) => { await seedBrowseHome(); const { input } = await openAddWorkspaceInput(page, ctx); await input.focus(); await settle(page, 800); },
  },
  "dir-suggest-fragment": {
    tag: "d4", describe: "Add workspace: partial fragment 'pro' matches projects/", themes: ["light"],
    setup: async (page, ctx) => { await seedBrowseHome(); const { input } = await openAddWorkspaceInput(page, ctx); await input.pressSequentially("pro", { delay: 20 }); await settle(page, 800); },
  },
  "dir-suggest-tilde": {
    tag: "d4", describe: "Add workspace: '~/' lists the home folders", themes: ["light"],
    setup: async (page, ctx) => { await seedBrowseHome(); const { input } = await openAddWorkspaceInput(page, ctx); await input.pressSequentially("~/", { delay: 20 }); await settle(page, 800); },
  },
  "dir-suggest-fuzzy": {
    tag: "d4", describe: "Add workspace: fuzzy fragment 'cgw' reaches a nested name", themes: ["light"],
    setup: async (page, ctx) => { await seedBrowseHome(); const { input } = await openAddWorkspaceInput(page, ctx); await input.pressSequentially("~/projects/cgw", { delay: 20 }); await settle(page, 800); },
  },
  "dir-suggest-drilldown": {
    tag: "d4", describe: "Add workspace: Tab completes 'wo' to work/ and lists its children", themes: ["light"],
    setup: async (page, ctx) => { await seedBrowseHome(); const { input } = await openAddWorkspaceInput(page, ctx); await input.pressSequentially("wo", { delay: 20 }); await settle(page, 600); await input.press("Tab"); await settle(page, 900); },
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
  // f1: a real agent turn that edits a file (aimock `[[scenario:edit]]`: read, then edit src/greet.ts).
  "f1-turn-changes": {
    tag: "f1", describe: "After an edit turn: the 'Files changed during this turn' card in the conversation", themes: ["light", "dark"], viewports: ["desktop", "mobile"],
    setup: async (page, ctx) => { await runEditTurn(page, ctx); await page.getByRole("region", { name: "Files changed during this turn" }).waitFor(); await settle(page, 500); },
  },
  "f1-diff-view": {
    tag: "f1", describe: "Inspector Changes tab populated: the diff opened from the card's Open diff", themes: ["light", "dark"],
    setup: async (page, ctx) => {
      await runEditTurn(page, ctx);
      await page.getByRole("region", { name: "Files changed during this turn" }).getByRole("button", { name: "Open diff" }).click();
      await page.locator(".review-right-panel, .review-panel").first().waitFor();
      await settle(page, 600);
    },
  },
  "f1-add-workspace-protected": {
    tag: "f1", describe: "Add workspace with a path inside the app's protected home: plain refusal, no raw error", themes: ["light"],
    setup: async (page, ctx) => {
      let bad = 0;
      page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/cognate.v1.")) bad += 1; });
      await page.getByRole("button", { name: "Add workspace" }).click();
      const dialog = page.getByRole("dialog", { name: "Add workspace" });
      await dialog.waitFor();
      const input = dialog.getByRole("combobox").or(dialog.getByRole("textbox")).first();
      await input.pressSequentially(`${ctx.home}/sub`, { delay: 15 });
      await settle(page, 600);
      await dialog.getByRole("button", { name: /Choose workspace|Add|Open/ }).last().click().catch(() => undefined);
      await settle(page, 800);
      console.log(`  HTTP error responses while typing and submitting: ${bad}`);
    },
  },
  "f1-experts-form": {
    tag: "f1", describe: "Experts and Teams: New Expert form alignment", themes: ["light"],
    setup: async (page) => {
      await page.getByRole("button", { name: "Experts and Teams", exact: true }).click();
      await page.getByRole("button", { name: "New Expert" }).click();
      await settle(page, 600);
    },
  },
  "f1-experts-spending": {
    tag: "f1", describe: "Experts and Teams: spending status", themes: ["light"],
    setup: async (page) => { await page.getByRole("button", { name: "Experts and Teams", exact: true }).click(); await page.getByTestId("spending-status").scrollIntoViewIfNeeded(); await settle(page, 600); },
  },
  "f1-workbench-workflows": {
    tag: "f1", describe: "Workbench Workflows tab (DAG inside its card)", themes: ["light"],
    setup: async (page) => {
      await page.getByRole("button", { name: "Workbench", exact: true }).first().click();
      await page.getByRole("tab", { name: "Workflows" }).click();
      await settle(page, 800);
    },
  },
  "f1-plugin-detail": {
    tag: "f1", describe: "Plugins page: a plugin opened for detail", themes: ["light"],
    setup: async (page) => {
      await page.getByRole("button", { name: "Plugins", exact: true }).first().click();
      await settle(page, 600);
      const row = page.locator(".plugin-row").first();
      if (await row.count()) await row.click().catch(() => undefined);
      await settle(page, 500);
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
  "t3-files-split": {
    tag: "t3", describe: "Files tab with the inspector widened: the tree stays beside the open file (D-14)", themes: ["light"], viewports: ["desktop"],
    setup: async (page) => {
      await ensureInspector(page, "Files");
      await page.getByRole("separator", { name: "Resize inspector" }).focus();
      for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowLeft");
      await page.getByRole("treeitem", { name: /src/ }).first().click();
      await page.getByRole("treeitem", { name: /index\.ts/ }).first().click();
      await settle(page, 500);
    },
  },
  // t4: robustness + polish.
  "t4-inspector-tabs": {
    tag: "t4", describe: "Inspector with all five tabs at 340px (icon-only except the selected)", themes: ["light", "dark"], viewports: ["desktop"],
    setup: async (page) => { await ensureInspector(page, "Files"); },
  },
  "t4-config-tab": {
    tag: "t4", describe: "Config tab: header path, status chip, framed editor, sticky footer", themes: ["light", "dark"], viewports: ["desktop", "mobile"],
    setup: async (page) => { await ensureInspector(page, "Config"); },
  },
  "t4-view-options": {
    tag: "t4", describe: "Sidebar view options popover", themes: ["light", "dark"], viewports: ["desktop"],
    setup: async (page) => { await page.getByRole("button", { name: "View options" }).click(); await settle(page, 300); },
  },
  "t4-delete-workspace": {
    tag: "t4", describe: "Delete workspace confirmation", themes: ["light", "dark"], viewports: ["desktop"],
    setup: async (page) => {
      await page.locator(".workspace-row-label").first().hover();
      await page.getByRole("button", { name: /^Workspace actions for/ }).first().click();
      await page.getByRole("menuitem", { name: "Delete workspace" }).click();
      await page.getByRole("dialog").waitFor();
      await settle(page, 300);
    },
  },
  "t4-experts": {
    tag: "t4", describe: "Experts and Teams", themes: ["light", "dark"], viewports: ["desktop"],
    setup: async (page) => { await page.getByRole("button", { name: /Experts/ }).first().click(); await settle(page, 600); },
  },
  "t4-governance": {
    tag: "t4", describe: "Settings > Governance with plain-language copy", themes: ["light"], viewports: ["desktop"],
    setup: (page) => openSettings(page, "Governance & evidence"),
  },
  // ---- U5: providers and agent CLIs (booted with three providers on aimock and fake harness CLIs on PATH) ----
  "providers-list": { tag: "u5", describe: "Settings > Providers list", viewports: ["desktop", "mobile"], setup: async (page) => { await openSettings(page, "Providers"); await page.locator("[data-provider]").first().waitFor(); await settle(page); } },
  "providers-card-test": {
    tag: "u5", describe: "Providers: active card expanded with a passing test", themes: ["light"],
    setup: async (page) => {
      await openSettings(page, "Providers");
      const card = page.locator('[data-provider="work-gateway"]');
      await card.getByRole("button").first().click();
      await card.getByRole("button", { name: /Test connection/ }).click();
      await card.locator('[data-test-result="ok"]').waitFor({ timeout: 20_000 });
      await settle(page);
    },
  },
  "providers-wizard": {
    tag: "u5", describe: "Add provider: grouped presets", viewports: ["desktop", "mobile"], themes: ["light"],
    setup: async (page) => {
      await openSettings(page, "Providers");
      await page.getByRole("button", { name: "Add provider" }).click();
      await page.getByRole("radio", { name: /^DeepSeek/ }).click();
      await settle(page);
    },
  },
  "providers-azure": {
    tag: "u5", describe: "Add provider: Azure fields", themes: ["light"],
    setup: async (page) => {
      await openSettings(page, "Providers");
      await page.getByRole("button", { name: "Add provider" }).click();
      await page.getByRole("radio", { name: /^Azure OpenAI/ }).click();
      await page.getByLabel("API version").scrollIntoViewIfNeeded();
      await settle(page);
    },
  },
  "model-picker": {
    tag: "u5", describe: "Composer model picker with three providers", themes: ["light", "dark"], viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await page.getByRole("button", { name: /^Model / }).click();
      await page.getByRole("dialog", { name: "Switch model" }).getByRole("group", { name: "Ollama" }).waitFor();
      await settle(page, 600);
    },
  },
  "agents-settings": { tag: "u5", describe: "Settings > Agents", viewports: ["desktop", "mobile"], setup: async (page) => { await openSettings(page, "Agents"); await page.locator('[data-harness="claude"]').waitFor(); await settle(page); } },
  "agent-chip-menu": {
    tag: "u5", describe: "Composer Agent chip menu open (Claude Code listed with its status)", themes: ["light", "dark"], viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await page.getByRole("button", { name: /^Agent: / }).click();
      await page.getByRole("menuitemradio", { name: /^Claude Code/ }).waitFor();
      await settle(page, 400);
    },
  },
  "harness-approval": {
    tag: "u5", describe: "Harness session mid-approval", themes: ["light", "dark"], viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await page.getByRole("button", { name: /^Agent: / }).click();
      await page.getByRole("menuitemradio", { name: /^Claude Code/ }).click();
      await page.keyboard.press("Escape");
      const composer = page.getByRole("textbox", { name: /Message or run a task|describe your task/i });
      await composer.fill("please ask then edit hello.txt");
      await composer.press("Enter");
      await page.getByRole("button", { name: "Allow once" }).waitFor({ timeout: 20_000 });
      await settle(page, 400);
    },
  },
  "harness-auth-error": {
    tag: "u5", describe: "Harness turn failed: sign-in hint", themes: ["light", "dark"], viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await page.getByRole("button", { name: /^Agent: / }).click();
      await page.getByRole("menuitemradio", { name: /^Claude Code/ }).click();
      await page.keyboard.press("Escape");
      const composer = page.getByRole("textbox", { name: /Message or run a task|describe your task/i });
      await composer.fill("authfail please");
      await composer.press("Enter");
      await page.locator('[data-harness-hint="sign-in"]').waitFor({ timeout: 20_000 });
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
    "src/greet.ts": "export const greet = () => 'Hello, world';\n",
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
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] }); // real scrollbars show in evidence, as they do for users
  try {
    const u5 = opts.states.some((n) => STATES[n]!.tag === "u5");
    const needsAimock = u5 || opts.states.some((n) => STATES[n]!.tag === "f1");
    const fake = u5 ? await makeFakeHost() : undefined;
    const aimock = needsAimock ? await bootAimock() : undefined;
    await withTempHome(async (home) => {
      const { app, client } = u5 ? await bootHarnessApp(home, fake!) : await bootApp(home);
      let repo: string | undefined;
      try {
        if (u5) {
          const url = `http://127.0.0.1:${aimock!.port}/v1`;
          await inv(client, "model.configure", { providerId: "openrouter", baseURL: "https://openrouter.ai/api/v1", protocol: "openai-compatible", model: "openai/gpt-4.1-mini", apiKey: "sk-or-demo", displayName: "OpenRouter" });
          await inv(client, "model.configure", { providerId: "ollama", baseURL: url, protocol: "openai-compatible", model: "qwen3-coder:30b", auth: "none", displayName: "Ollama" });
          await inv(client, "model.configure", { providerId: "work-gateway", baseURL: url, protocol: "openai-compatible", model: "gpt-4.1", apiKey: "sk-demo", displayName: "Work gateway" });
        } else if (opts.model) await inv(client, "model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimock && opts.states.every((n) => STATES[n]!.tag === "f1") ? aimock.port : 59999}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
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
          const seeded: string[] = [];
          for (let i = 0; i < 3; i++) seeded.push(((await inv(client, "session.create", { workspaceId, requestId: crypto.randomUUID() })) as { sessionId: string }).sessionId);
          await waitUntil("sessions visible", async () => {
            const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows;
            return rows.length >= 3 || undefined;
          });
          // Two named conversations and one untitled draft, like a workspace in real use.
          await inv(client, "session.rename", { sessionId: seeded[0]!, title: "Refactor the greeting helper" });
          await inv(client, "session.rename", { sessionId: seeded[1]!, title: "Add API docs to the guide" });
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
                const shotCtx: ShotContext = {
                  repo, home, viewport: vp, theme, client,
                  readSessions: async () => (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "sessions" })).rows.map((r) => ({ id: (r.value as { id: string }).id, title: (r.value as { title: string }).title })),
                };
                await state.setup(page, shotCtx);
                await humanizeSessionTitles(page, shotCtx);
                const file = join(opts.out, `${name}.${vp}.${theme}.png`);
                await page.screenshot({ path: file });
                if (process.env.UI_SHOTS_EVAL) console.log(`  EVAL ${name}.${vp}.${theme}: ${JSON.stringify(await page.evaluate(process.env.UI_SHOTS_EVAL))}`);
                if (process.env.UI_SHOTS_CONTRAST) for (const line of await auditContrast(page)) console.log(`  CONTRAST ${name}.${vp}.${theme}: ${line}`);
                console.log(`wrote ${file}${errors.length ? `  (page errors: ${errors.join(" | ")})` : ""}`);
              } catch (error) {
                console.error(`FAILED ${name} ${vp} ${theme}: ${error instanceof Error ? error.message.split("\n").slice(0, 8).join(" | ") : String(error)}`);
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
        await aimock?.stop();
      }
    });
  } finally {
    await browser.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
