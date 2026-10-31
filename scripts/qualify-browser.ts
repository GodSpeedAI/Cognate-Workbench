// Browser qualification for a running Cognate Workbench: the React/Astryx UI must render from the
// installed server's own assets, reach the Connect API with the boot session, and log no unexpected
// JavaScript errors. Fonts are third-party and may be unreachable on an offline host, so their load
// failures are reported but not treated as application errors.
//
//   bun scripts/qualify-browser.ts <url> <out-dir> [chromium-executable]
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const [url, outDir, executable] = process.argv.slice(2);
if (!url || !outDir) throw new Error("usage: bun scripts/qualify-browser.ts <url> <out-dir> [chromium-executable]");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: executable, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const appErrors: string[] = [];
const thirdPartyFailures: string[] = [];
const apiStatuses: number[] = [];
page.on("pageerror", (error) => appErrors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() !== "error") return;
  if (message.text().includes("Failed to load resource")) return; // resolved below by request URL
  appErrors.push(`console: ${message.text()}`);
});
page.on("requestfailed", (request) => {
  const target = request.url();
  if (target.startsWith("https://fonts.googleapis.com") || target.startsWith("https://fonts.gstatic.com")) thirdPartyFailures.push(target);
  else appErrors.push(`requestfailed: ${target} ${request.failure()?.errorText ?? ""}`);
});
page.on("response", (response) => {
  if (response.url().includes("/cognate.v1.RuntimeService/")) apiStatuses.push(response.status());
});

const response = await page.goto(url, { waitUntil: "load", timeout: 60_000 });
if (!response || !response.ok()) throw new Error(`document request failed: ${response?.status()}`);
await page.waitForFunction(() => (document.querySelector("#root")?.children.length ?? 0) > 0, undefined, { timeout: 60_000 });
await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
await page.screenshot({ path: `${outDir}/workbench.png`, fullPage: true });

// Navigation: dismiss the first-run dialogs (notice, then the API-key step), then open Settings.
// Each dismissal is a durable event; a dialog closes once its projection folds in, so wait for that.
const welcome = page.getByRole("button", { name: "Continue" });
if (await welcome.count()) await welcome.first().click();
const configureLater = page.getByRole("button", { name: "Configure later" });
await configureLater.first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => undefined);
if (await configureLater.count()) await configureLater.first().click();
await page.locator(".modal-backdrop").first().waitFor({ state: "detached", timeout: 60_000 });
await page.getByText("Settings", { exact: true }).first().click();
await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
// "Agent presets" is a Settings section label; the sidebar's "Settings" link alone would always match.
const settingsVisible = await page.getByText("Agent presets", { exact: true }).isVisible();
await page.screenshot({ path: `${outDir}/settings.png`, fullPage: true });

const text = (await page.innerText("body")).trim();
const result = {
  settingsVisible,
  title: await page.title(),
  renderedTextLength: text.length,
  apiResponses: apiStatuses.length,
  apiNon2xx: apiStatuses.filter((status) => status >= 300).length,
  thirdPartyFailures: thirdPartyFailures.length,
  appErrors,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();

if (text.length === 0) throw new Error("the page rendered no text");
if (appErrors.length > 0) throw new Error(`${appErrors.length} unexpected application error(s)`);
if (!settingsVisible) throw new Error("the Settings view did not open");
