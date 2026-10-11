// Browser acceptance for the Cognitive Frame (real server, aimock model, real Chromium).
// The WebMCP registry is polyfilled in-page with the `navigator.modelContext.provideContext` shape:
// what is proven is the adapter's tool set and behaviour, NOT native-browser WebMCP support.
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { chromium, type Page } from "playwright-core";
import { LOCAL_OPERATOR, startServer, type AppServer } from "../src/server.ts";
import { userToyMod } from "../src/cognitive/sentinel.ts";
import { bootAimock, withTempHome } from "./helpers.ts";
import { createClient } from "@godspeedai/cognate-client";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";

const clientFor = (app: AppServer) => createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
type Client = ReturnType<typeof clientFor>;
const sh = async (cwd: string, cmd: string) => { const p = Bun.spawn(["bash", "-lc", cmd], { cwd, stdout: "pipe", stderr: "pipe" }); await p.exited; };
const events = async (app: AppServer) => { const out: { position: number; eventType: string; payload: any }[] = []; for await (const e of app.runtime.service.events(LOCAL_OPERATOR, {})) out.push({ position: e.position, eventType: e.eventType, payload: e.payload }); return out; };

const WEBMCP_POLYFILL = `
  window.__webmcp = { tools: [] };
  Object.defineProperty(navigator, "modelContext", { value: { provideContext(c) { window.__webmcp.tools = c.tools; } }, configurable: true });
`;
const callTool = (page: Page, name: string, input: unknown = {}) => page.evaluate(async ([n, i]) => {
  const t = (window as any).__webmcp.tools.find((x: any) => x.name === n);
  if (!t) throw new Error("tool not exposed: " + n);
  return JSON.parse((await t.execute(i)).content[0].text);
}, [name, input] as const);
const toolNames = (page: Page) => page.evaluate(() => (window as any).__webmcp.tools.map((t: any) => t.name as string));

async function seed(client: Client, aimockPort: number, repo: string, workspaceId?: string) {
  await client.invoke("onboarding.dismiss", { step: "notice" });
  await client.invoke("onboarding.dismiss", { step: "apikey" });
  await client.invoke("model.configure", { providerId: "mock", baseURL: `http://127.0.0.1:${aimockPort}/v1`, protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
  return (await client.invoke("workspace.select", { path: repo })) as { workspaceId: string };
}

describe("E2E cognitive console", () => {
  test("destination/present/deviation/next move; focus -> 'why did this fail?'; agent-requested timeline; mutation needs the human; settlement reachable != settled", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const app = await startServer({ port: 0, home });
      const client = clientFor(app);
      const browser = await chromium.launch();
      try {
        const repo = join(home, "repo");
        await mkdir(repo, { recursive: true });
        await writeFile(join(repo, "a.txt"), "a");
        await seed(client, aimock.port, repo);
        await client.invoke("case.open", { caseId: "C17", desiredOutcome: "behavior preserved while generated output is rebuilt" });
        const { criterionHash } = (await client.invoke("criterion.freeze", { caseId: "C17", spec: { version: 1, requiredChecks: ["unit", "integration"], observed: ["ordering"], unobserved: [], guardrails: [], protectedInvariants: [] } })) as { criterionHash: string };
        const base = (await client.invoke("world.freeze", { caseId: "C17", kind: "baseline", worldId: "local", root: repo, criterionHash })) as { worldHash: string };
        await writeFile(join(repo, "a.txt"), "changed");
        const cand = (await client.invoke("world.freeze", { caseId: "C17", kind: "candidate", worldId: "local", root: repo, parentWorldHash: base.worldHash, criterionHash })) as { worldHash: string };
        await client.invoke("verification.run", { caseId: "C17", worldId: "local", root: repo, candidateHash: cand.worldHash, checks: [
          { id: "unit", argv: ["bash", "-c", "echo 'expected 2 got 3' >&2; exit 1"] },
          { id: "integration", argv: ["bash", "-c", "echo 'timeout in guest path' >&2; exit 2"] },
        ] });

        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.addInitScript(WEBMCP_POLYFILL);
        await page.goto(app.url);
        const frame = page.getByTestId("cognitive-frame");
        await frame.waitFor();

        // destination / present / deviation / next move are legible; candidate and settled never look alike
        expect(await frame.getByRole("heading", { name: "Destination" }).isVisible()).toBe(true);
        expect(await frame.getByText("behavior preserved while generated output is rebuilt").count()).toBe(1);
        const tags = frame.locator(".cf-hash");
        expect(await tags.count()).toBe(2);
        expect((await tags.nth(0).innerText()) + (await tags.nth(1).innerText())).toMatch(/Settled[\s\S]*Candidate/i);
        expect(await frame.locator(".cf-hash-candidate").count()).toBe(1);
        expect(await frame.locator(".cf-hash-settled").count()).toBe(1);
        expect(await frame.getByText(/^Required checks: 0 \/ 2 passed/).count()).toBe(1);
        expect(await frame.getByText(/2 required checks failed: unit, integration/).count()).toBe(1);
        expect(await frame.locator(".cf-primary strong").innerText()).toBe("Inspect first failing check");
        expect(await frame.getByText(/blocked · missing:verification.passed/).count()).toBe(1); // blocked op explains why
        expect(await frame.getByText(/Not reachable/).count()).toBe(1);
        expect(await frame.getByRole("button", { name: "Settle candidate", exact: true }).isDisabled()).toBe(true);
        expect(await frame.getByText("RECORDED · system-observed").count()).toBe(1);

        if (process.env.COG_SHOT) await page.screenshot({ path: process.env.COG_SHOT });
        // human focuses failure A -> WebMCP exposes only evidence-relevant tools + the semantic context
        await frame.getByRole("button", { name: /unit: FAILED/ }).click();
        await page.waitForFunction(() => (window as any).__webmcp.tools.some((t: any) => t.name === "retry_verification"));
        const names = await toolNames(page);
        expect(names).toEqual(expect.arrayContaining(["ui_context", "ui_focus", "inspect", "show_timeline", "compare_to_previous", "retry_verification"]));
        expect(names).not.toContain("compare_to_parent"); // candidate-only tool is not exposed for evidence focus
        const ctx = await callTool(page, "ui_context") as any;
        expect(ctx.neighborhood).toMatchObject({ case: "case:C17", meaning: "unit failed", recorded: { tail: "expected 2 got 3\n" } });
        expect(JSON.stringify(ctx)).not.toMatch(/<div|class=/); // semantic, not DOM

        // the user sends only "why did this fail?" — the agent resolves "this" from focus
        const before = (await events(app)).filter((e) => ["verification.observed", "world.settled", "world.candidate.frozen", "criterion.frozen"].includes(e.eventType)).length;
        const composer = page.getByRole("textbox", { name: /Message or run a task/ });
        await composer.fill("why did this fail?");
        await composer.press("Enter");
        await page.getByText("It failed because the unit check recorded: expected 2 got 3.").waitFor({ timeout: 20_000 });
        // the agent asked the console for a timeline; the UI rendered it, ordered, from recorded facts
        const view = frame.getByRole("region", { name: "Timeline" });
        await view.waitFor({ timeout: 10_000 });
        const items = await view.locator("li").allInnerTexts();
        expect(items.some((t) => t.includes("unit FAILED"))).toBe(true);
        const positions = items.map((t) => Number(/#(\d+)/.exec(t)?.[1]));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        // focus switch A -> B updates what the agent sees
        await frame.getByRole("button", { name: /integration: FAILED/ }).click();
        await page.waitForFunction(() => (window as any).__webmcp.tools.length > 0);
        expect(((await callTool(page, "ui_context")) as any).neighborhood.meaning).toBe("integration failed");
        await composer.fill("why did this fail?");
        await composer.press("Enter");
        await page.getByText("It failed because the integration check recorded: timeout in guest path.").waitFor({ timeout: 20_000 });
        // inspection changed nothing authoritative
        expect((await events(app)).filter((e) => ["verification.observed", "world.settled", "world.candidate.frozen", "criterion.frozen"].includes(e.eventType)).length).toBe(before);

        // a mutating WebMCP action does not execute: it asks the human, and cancel leaves truth untouched
        await frame.getByRole("button", { name: /integration: FAILED/ }).click();
        const verBefore = (await events(app)).filter((e) => e.eventType === "verification.observed").length;
        const proposed = await callTool(page, "retry_verification");
        expect(proposed).toMatchObject({ status: "awaiting-human-confirmation" });
        await frame.getByText(/Only you can authorise this/).waitFor();
        await frame.getByRole("button", { name: "Cancel" }).click();
        expect((await events(app)).filter((e) => e.eventType === "verification.observed").length).toBe(verBefore);

        // repair: a new candidate passes -> reachable, quiet deviation, NOT settled until the human settles
        await writeFile(join(repo, "a.txt"), "fixed");
        const cand2 = (await client.invoke("world.freeze", { caseId: "C17", kind: "candidate", worldId: "local", root: repo, parentWorldHash: base.worldHash, criterionHash })) as { worldHash: string };
        await client.invoke("verification.run", { caseId: "C17", worldId: "local", root: repo, candidateHash: cand2.worldHash, checks: [{ id: "unit", argv: ["true"] }, { id: "integration", argv: ["true"] }] });
        await frame.getByText(/Reachable — not yet settled/).waitFor({ timeout: 10_000 });
        expect(await frame.getByText("No material deviation recorded.").count()).toBe(1);
        expect(await frame.getByText(/Optional: Fresh-context critic/).count()).toBe(1);
        const settle = frame.getByRole("button", { name: "Settle candidate", exact: true });
        expect(await settle.isEnabled()).toBe(true);
        expect((await events(app)).some((e) => e.eventType === "world.settled")).toBe(false);
        await settle.click();
        await frame.getByText(/^Settled$/).waitFor({ timeout: 10_000 });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await app.stop();
        await aimock.stop();
      }
    });
  }, 180_000);

  test("preflight is semantic on the approval card; the lower-trust waiver is overruled; allow executes", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const app = await startServer({ port: 0, home, extraMediators: [userToyMod()] });
      const client = clientFor(app);
      const browser = await chromium.launch();
      try {
        const repo = join(home, "repo");
        await mkdir(join(repo, "generated"), { recursive: true });
        await writeFile(join(repo, "generated/a.txt"), "a");
        await writeFile(join(repo, "generated/b.txt"), "b");
        await sh(repo, "git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm base");
        await writeFile(join(repo, "generated/c.txt"), "dirty");
        await writeFile(join(repo, "generated/b.txt"), "b-edited");
        await seed(client, aimock.port, repo);
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        page.on("console", (m) => { if (m.type() === "error") console.log("PAGE-ERR:", m.text()); });
        page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
        await page.goto(app.url);
        const composer = page.getByRole("textbox", { name: /Message or run a task/ });
        await composer.fill("[[scenario:cleanup]] clean generated output");
        await composer.press("Enter");
        const card = page.locator("[data-approval-panel]");
        await card.waitFor({ timeout: 20_000 });
        const text = await card.innerText();
        expect(text).toContain("FILESYSTEM CHANGE");
        expect(text).toContain("rm -rf generated");
        expect(text).toMatch(/Files\s*3/);
        expect(text).toMatch(/Uncommitted\s*2/);
        expect(text).toContain("human approval required");
        expect(await readdir(repo)).toContain("generated"); // nothing ran before the human decided
        // The card renders from `tool.approval.requested`, a beat before `continuation.opened`; a human
        // can only decide once the continuation exists (pre-existing ordering in the console).
        for (let i = 0; i < 800; i++) { if ((await events(app)).some((e) => e.eventType === "continuation.opened")) break; await Bun.sleep(25); }
        await Bun.sleep(300);
        await card.getByRole("button", { name: "Allow once" }).click();
        await page.getByText("Removed the generated output.").waitFor({ timeout: 8_000 }).catch(async (e) => { console.log("BODY:", (await page.locator("body").innerText()).slice(0, 1500)); console.log("EVENTS:", (await events(app)).slice(-8).map((x) => x.eventType + " " + JSON.stringify(x.payload).slice(0, 160)).join("\n")); throw e; });
        expect(await readdir(repo)).not.toContain("generated");
        expect((await events(app)).filter((e) => e.eventType === "sentinel.finding")).toHaveLength(1);
      } finally {
        await browser.close();
        await app.stop();
        await aimock.stop();
      }
    });
  }, 120_000);

  test("method recommendation is visibly a candidate; the active method stays unchanged until accepted", async () => {
    await withTempHome(async (home) => {
      const aimock = await bootAimock();
      const app = await startServer({ port: 0, home });
      const client = clientFor(app);
      const browser = await chromium.launch();
      try {
        const repo = join(home, "repo");
        await mkdir(repo, { recursive: true });
        await writeFile(join(repo, "score.txt"), "1");
        await writeFile(join(repo, "guard.sh"), "test -f score.txt\n");
        await seed(client, aimock.port, repo);
        await client.invoke("case.open", { caseId: "S1", desiredOutcome: "reduce rebuild failures" });
        const { criterionHash } = (await client.invoke("criterion.freeze", { caseId: "S1", spec: { version: 1, requiredChecks: ["score"], observed: ["rebuild"], unobserved: [], guardrails: [], protectedInvariants: [] } })) as { criterionHash: string };
        const baseline = (await client.invoke("world.freeze", { caseId: "S1", kind: "baseline", worldId: "local", root: repo, criterionHash })) as { worldHash: string };
        const round = (roundId: string, apply: string, residual?: string) => client.invoke("experiment.round", { caseId: "S1", roundId, hypothesis: roundId, sourceRoot: repo, baselineHash: baseline.worldHash, applyArgv: ["bash", "-c", apply], scoreArgv: ["cat", "score.txt"], invariantArgv: ["bash", "guard.sh"], maxRounds: 5, ...(residual ? { residual } : {}) });
        await round("r1", "echo 4 > score.txt", "disconnected from application path");
        await round("r2", "echo 2 > score.txt", "disconnected from application path");
        await round("r3", "echo 6 > score.txt");
        await client.invoke("method.review", { caseId: "S1", scope: "cross-cutting feature changes" });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await page.goto(app.url);
        const frame = page.getByTestId("cognitive-frame");
        await frame.waitFor();
        const rec = frame.getByRole("region", { name: "Method recommendation" });
        await rec.waitFor();
        expect(await rec.innerText()).toMatch(/candidate · not active/);
        expect(await rec.innerText()).toMatch(/Active method unchanged/);
        expect(await frame.getByRole("list", { name: "Experiment rounds" }).locator("li").count()).toBe(3);
        expect(await frame.locator("p", { hasText: "· locked" }).count()).toBe(1);
        const active = ((await client.invoke("method.active", {})) as { methodHash: string }).methodHash;
        await rec.getByRole("button", { name: "Accept into method" }).click();
        await page.waitForFunction(async () => true);
        await Bun.sleep(500);
        expect(((await client.invoke("method.active", {})) as { methodHash: string }).methodHash).not.toBe(active);
        expect((await events(app)).some((e) => e.eventType === "world.settled")).toBe(false); // search never settles
      } finally {
        await browser.close();
        await app.stop();
        await aimock.stop();
      }
    });
  }, 120_000);
});
