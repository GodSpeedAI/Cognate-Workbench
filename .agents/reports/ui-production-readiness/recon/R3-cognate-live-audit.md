# R3 Cognate Workbench live UI audit

Scope: live browser audit of the current Cognate Workbench UI (Playwright-core, Chromium), two scenarios: (A) fresh first run, (B) configured with a mock model and workspaces. No files under `src/` or `test/` were modified.

Caveat on the build under test: at boot the working tree had uncommitted changes in `src/ui/DirectoryField.tsx`, `src/ui/app.css`, `src/capabilities/workspaceDirectorySuggest.ts`, `.sea/interaction/canonical-journey-catalog.md` and `test/E2E-workspace-session-ux.red.test.ts`. The folder-autocomplete findings describe that in-progress state, not the last commit.

Screenshots: `/home/sprime01/projects/cognate-workbench/.agents/reports/ui-production-readiness/evidence/before/NN-<name>.png` (NN = capture order, names as listed below). Screens marked "DOM-only" were verified by DOM text and bounding boxes, not by looking at the image.

## How to boot

Both scripts live in `/tmp/claude-1000/-home-sprime01-projects-cognate-workbench/d3716090-fd73-45cd-a4b7-a5539e33a75a/scratchpad/r3/`.

`boot.ts` (boots the real app on a fresh temp home; `configured` adds a mock model, dismisses onboarding and adds a workspace with three files):

```ts
// Usage: bun boot.ts <fresh|configured> <outFile>
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootApp, inv, waitUntil } from "/home/sprime01/projects/cognate-workbench/test/wb-helpers.ts";
import { LOCAL_OPERATOR } from "/home/sprime01/projects/cognate-workbench/src/server.ts";

const [mode, outFile] = process.argv.slice(2);
const home = await mkdtemp(join(tmpdir(), "r3-home-"));
const { app, client } = await bootApp(home);
const info: Record<string, string> = { mode, home, url: app.url };
if (mode === "configured") {
  const repo = join(home, "projects-demo", "cognate-sample");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "docs"), { recursive: true });
  await writeFile(join(repo, "README.md"), "# Sample\n\nA sample workspace for the audit.\n");
  await writeFile(join(repo, "src", "index.ts"), "export const hello = () => 'hi';\n");
  await writeFile(join(repo, "docs", "notes.md"), "notes\n");
  await mkdir(join(home, "projects-demo", "second-project"), { recursive: true });
  await inv(client, "model.configure", { providerId: "mock", baseURL: "http://127.0.0.1:59999/v1", protocol: "openai-compatible", model: "mock-model-1", apiKey: "" });
  await inv(client, "onboarding.dismiss", { step: "notice" });
  await inv(client, "onboarding.dismiss", { step: "apikey" });
  const { workspaceId } = (await inv(client, "workspace.select", { path: repo })) as { workspaceId: string };
  await waitUntil("workspace visible", async () => {
    const rows = (await app.runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" })).rows;
    return rows.some(r => r.key === `record/${workspaceId}`) || undefined;
  });
  info.repo = repo;
  info.workspaceId = workspaceId;
}
await writeFile(outFile, JSON.stringify(info, null, 2));
console.log("READY", JSON.stringify(info));
setInterval(() => {}, 1 << 30);
```

Commands (run from the repo, in the background):

```sh
cd /home/sprime01/projects/cognate-workbench
nohup bun $S/boot.ts configured $S/configured.json > $S/boot-configured.log 2>&1 &
nohup bun $S/boot.ts fresh      $S/fresh.json      > $S/boot-fresh.log      2>&1 &
# wait for the "READY" line in each log; app.url is in the json file
```

Driving: `playwright-core` from `/home/sprime01/projects/cognate-workbench/node_modules`, `chromium.launch()`, `goto(url, { waitUntil: "load" })`. Do not use `networkidle`; the page keeps a connection open and the wait times out. Use `exact: true` for button names, because "Continue" also matches "Save and continue".

Stop: `kill <pid>` on the two `boot.ts` processes. Do not `pkill -f boot.ts` from a shell whose own command line contains that string. Both were stopped and verified gone.

## Screens

| # | Screenshot | How reached | What is visible |
|---|---|---|---|
| A1 | 01-A01-fresh-initial.png | Fresh home, first load | Welcome notice modal ("Welcome to Cognate Console", Continue). Behind it: "No workspace selected", "Unable to create default workspace. Use Choose workspace to select a folder.", folder path field, Choose workspace. |
| A2 | 02-A02-after-continue.png | Continue | "Add an API key to get started". One password input labelled "API key". Buttons: Configure later, Save and continue (disabled until typed). No provider, base URL, protocol or model field. |
| A3 | 03-A03-apikey-filled.png | Type a key | Save enabled. Dummy key `sk-audit-dummy-0000` (test home only). |
| A4 | 04-A04-after-save-apikey.png | Save and continue | Modal gone. Main area is the same empty "Unable to create default workspace" card, with path field placeholder `/path/to/project` and disabled Choose workspace. Nothing says a model is now configured. |
| B1 | 05-B-settings-open.png | Settings in sidebar | Settings modal, Models section. Existing mock provider with Edit/Delete, API key field, Apply/Cancel, Add model provider. Close X on the right (x 1050). "Open configuration file" link top right. |
| B2 | 06-B-settings-general.png | Settings > General | Permission select, Language select, Appearance Light/Dark/System (unstyled browser buttons), font size stepper with raw +/- buttons, Work details, Performance & usage, Coding Tools (cut off at bottom, scrolls). |
| B3 | 07-B-settings-plugins.png | Settings > Built-in plugins | Search plugins, session plugins mode select, six plugin cards (File read, File edit, Terminal, To-dos, ...). |
| B4 | 08-B-settings-presets.png | Settings > Agent presets | Standard (new task default, disabled button), PTC, Minimal presets with Mode details / View configuration. |
| B5 | 09-B-settings-governance.png | Settings > Governance & evidence | Authority and Settlement cards quoting env var names and `docs/sea-forge-authority.md`. Proof form: Command textarea (`bun` / `test`), Working directory, Timeout, "Declare proof" button cut off at bottom edge. |
| B6 | 10-B-settings-open-config-click.png | Open configuration file | Second centered modal "Configuration file" stacked on Settings. Home directory, config path, Copy path, Download configuration, read-only JSON of settings in effect, environment variable table. Its close X is at the top left (x 537). |
| B7 | 11-B-settings-add-provider.png | Models > Add model provider > Custom model API | Provider ID, Display name, Base URL, API protocol (native select, 19 px tall, next to 33 px inputs), API key, Models block (Fetch available models, Add model), Cancel, Create provider. Third-party tab also present. |
| B8 | 12-B-add-workspace-empty.png | Sidebar + (Add workspace) | Add workspace modal: This computer / SSH / WSL tabs, path input, execution mode radios (Linux child containment disabled, "host containment configuration is unavailable"), Cancel, Open. |
| B9 | 13-B-add-workspace-type-proj.png | type `proj` | No suggestions. |
| B10 | 14-B-add-workspace-type-tmp-prefix.png | type `/tmp/r3-home-` | Dark dropdown, two entries, each shown twice (name and path lines). Name text barely visible. |
| B11 | 15-B-add-workspace-type-full-dir.png | type `<home>/projects-demo/` | No suggestions. |
| B12 | 16-B-add-workspace-type-partial-name.png | type `<home>/projects-demo/sec` | No suggestions. Raw error text appears under the input (see issue 2). |
| B13 | 17-B-add-workspace-type-tilde.png | type `~/` | No suggestions; `~` not expanded. |
| B14 | 18-B-add-workspace-type-tilde-doc.png | type `~/Doc` | No suggestions. |
| B15 | 19-B-add-ws-realhome-pro.png | type `/home/sprime01/pro` | Dark dropdown with `projects`. Works. |
| B16 | 20-B-add-ws-realhome-partial.png | type `/home/sprime01/projects/cog` | Three matches (cognate, cognate-workbench, cognate-workbench-base). Works. |
| B17 | 21-B-add-ws-work-dir.png | type `<dir>/` (trailing slash) | Dark dropdown lists the typed folder itself (`work`), not its children. |
| B18 | 22-B-add-ws-work-partial.png | type `<dir>/pro` | Two matches (proj-alpha, proj-beta). Dark dropdown. |
| B19 | 23-B-add-ws-work-partial2.png | type `<dir>/proj-a` | One match. |
| B20 | 24-B-add-ws-after-open-alpha.png | Open with a full path | Modal closes; proj-alpha appears in the sidebar. Works. |
| B21 | 25-B-view-experts.png | Experts and Teams | Header, "Back to conversation", Schedules, Host startup config (Native execution capacity, read-only COGNATE_RUN_CAPACITY), Spending and billing, Teams and Experts lists, team members with Private conversation / Make Orchestrator / Remove. |
| B22 | 26-B-view-plugins.png | Plugins | Not visually reviewed. DOM: 13 plugins with View buttons, Refresh, Add plugin, close × (right). |
| B23 | 27-B-view-remote.png | Mobile remote control | "Control from your phone" modal over the Plugins page. Turn on remote control, Close (text button, no ×). Not turned on. |
| B24 | 28-B-view-workbench.png | Workbench | Tabs: Tasks, Workflows, Capabilities, Automations. "Back to conversation" top right. Tasks: "0 tasks", empty copy, New task. |
| B25 | 29-B-workbench-workflows.png | Workbench > Workflows | Workflow select (native), Start an instance for this workspace, DAG of five stages. Right-most stage clipped at container edge. |
| B26 | 30-B-workbench-capabilities.png | Workbench > Capabilities | "Built is not installed. Installed is not enabled. Enabled is not verified." Capability groups ACTUALIZE / EXTEND with tag chips. |
| B27 | 31-B-workbench-automations.png | Workbench > Automations | Explainer copy. DOM-only review. |
| B28 | 32-B-workbench-tasks.png | Workbench > Tasks | Not visually reviewed. DOM: "0 tasks", New task. |
| B29 | 33-B-workbench-new-task.png | New task | Name input, Task visibility fieldset (This workspace / This session), Create task (disabled), Cancel, hint "Enter a name to continue." |
| B30 | 34-B-sidebar-view-options.png | Sidebar filter icon | Popover: Group by (WorkSpace, Workspace Tree, In one list), Order by (Manual, Last updated), Filter (Hide archived, All conversations). Selection shown only by bold. |
| B31 | 35-B-sidebar-search-sessions.png | Sidebar search icon | "Search session names" input under the Workspaces header, clear X. |
| B32 | 36-B-sidebar-workspace-actions.png | Workspace row "..." (hover) | Menu: Rename, Delete workspace. Not visually reviewed (DOM text confirmed). |
| B33 | 37-B-composer-access-mode.png | Access mode chip | Menu: Read Only, Workspace Write, Full access. Not visually reviewed (DOM text confirmed). |
| B34 | 38-B-composer-model-picker.png | Click `mock-model-1` chip | Nothing opens. No menu, no picker. |
| B35 | 39-B-composer-typed.png | Type in new session composer | Not visually reviewed. |
| B36 | 40-B-session-send-error.png | Send a message (~6 s) | Session view: "Deep diving for 6s", RUNNING, Stop generating button. Not visually reviewed. |
| B37 | 41-B-session-error-after-45s.png | Same session at 45 s | Still RUNNING, "Deep diving for 45s". Not visually reviewed. |
| B38 | 42-B-kbd-after-ctrl-k.png | Ctrl+K, Ctrl+, , Ctrl+/, Ctrl+N, Meta variants | No palette, no settings opened. Not visually reviewed. |
| B39 | 43-B-kbd-ctrl-k.png | Ctrl+K | Sidebar and conversation unchanged. No command palette. |
| B40 | 44-B-mobile-390-home.png | 390x844 load | Sidebar collapsed to a 56 px icon rail (logo, expand, New session, theme). Conversation column fits, composer fits. No horizontal scroll (scrollWidth 390). |
| B41 | 45-B-session-error-after-150s.png | Same session at 150 s | RUNNING "150s", "Retried model request (1/5) · 150s" in a native select, Stop button. No failure shown. |
| B42 | 46-B-mobile-390-settings.png | 390 Settings | Settings modal fits; close X top right at x 324. Tabs wrap to two rows. Models section readable. |
| B43 | 47-B-mobile-390-add-workspace.png | 390 Add workspace | Add workspace is not in the collapsed rail; the click had no target. Shows the rail state. |
| B44 | 48-B-mobile-390-experts.png | 390 Experts click | Collapsed rail; Experts & Teams is not reachable without expanding the sidebar. |
| B45 | 49-B-plugins-add-plugin.png | Plugins > Add plugin | Dialog: "RealityTrace observations", one-line description, Install. Not visually reviewed. |
| B46 | 50-B-plugins-view-model-provider.png | Plugins > View (Model provider) | Plugin detail: identifier, lifecycle core, status "Always on". No actions. |
| B47 | 51-B-experts-new-expert.png | Experts > New Expert | Booked cost copy and run list above; Create Expert form (Name, Specialization, Instructions, Use Workbench default select, Cancel, Create Expert). |
| B48 | 52-B-workbench-start-instance.png | Workflows > Start an instance | Text "Workflow instance started." appears. Not visually reviewed. |
| B49 | 53-B-mobile-390-sidebar-toggled.png | 390 with sidebar icon | Rail buttons only: Expand sidebar, New session, Settings. DOM-only. |
| B50 | 54-B-mobile-390-sidebar-expanded.png | 390 Expand sidebar | Sidebar takes ~280 px and pushes the conversation into a ~110 px column. "Start a session" and composer clipped. |
| B51 | 55-B-settings-governance-bottom.png | Governance section at 1440x900 | Declare proof button bottom at y 825, dialog bottom at y 808. |
| B52 | 56-B-workspace-delete-confirm.png | Workspace row menu > Delete workspace | Captured after the click. No confirmation dialog. Workspace removed. Not visually reviewed. |
| B53 | 57-B-sidebar-after-delete-attempt.png | After delete | Sidebar row for the deleted workspace now reads `262abcddc317bcbc` (raw id) with its session still listed. Main area: "Unable to create default workspace". |

Not visually reviewed (DOM or console verified only): 26, 31, 32, 36, 37, 39, 40, 41, 42, 49, 52, 53, 56.

## Issues

Severity: P1 = blocks or misleads a core flow, or is a user-visible error; P2 = visible defect or gap with a workaround.

### P1

1. **Folder autocomplete misses most typed paths.** Typing `proj` (relative) gives nothing. `~/` and `~/Doc` are not expanded and give nothing. Typing `<dir>/` shows only `<dir>` itself, not its children, so a user can't browse. Partial leaf names work only with an absolute prefix (`/home/sprime01/pro` gives `projects`; `<dir>/pro` gives proj-alpha and proj-beta). Repro: Add workspace, type `/tmp/claude-…/scratchpad/r3/work/`, observe one entry named `work`. Screens: 13, 15, 16, 17, 18, 21, 22. Note: the in-progress `workspaceDirectorySuggest.ts` / `DirectoryField.tsx` changes were present at boot.

2. **Raw error payload shown in the Add workspace dialog, and a 400 on every keystroke.** Typing a folder inside the Workbench's own home (`/tmp/r3-home-…/projects-demo/…`) puts this under the input: `workspace.directory.suggest: the Workbench's own application folder is protected and not browseable — choose a project folder elsewhere","name":"Error`. The text is JSON fragments, not copy. The suggest endpoint returned HTTP 400 on each lookup in that run (four `Failed to load resource: 400` console errors). Screens: 16.

3. **Suggestion dropdown is dark, low contrast, and duplicated.** It is the only dark surface in the light theme. Entry names are barely legible. Entries appear twice (name line and path line) when the path matches several folders. Paths are truncated with an ellipsis. Screens: 14, 21, 22.

4. **"Open configuration file" opens a stacked read-only modal, not an editable side panel.** Clicking it adds a second centered dialog ("Configuration file") over Settings. It has Copy path and Download configuration only. Its close X is at the top left (x 537, y 147), the reverse of the rest of the app. This confirms the reported complaint. Screens: 10.

5. **First-run API key step asks only for a key, and the dismiss path leads to a dead end.** The step shows one password field and no provider, base URL, protocol or model. The full form exists only later under Settings > Models > Add model provider. "Save and continue" with a key closes the modal and returns to the empty "Unable to create default workspace" card with no sign that a model is configured. "Configure later" does the same. Screens: 02, 03, 04. Confirms the reported complaint.

6. **A failing model call looks like a hang.** With an unreachable base URL the session shows "Deep diving for Ns", RUNNING, and only Stop generating. After 150 s the only detail is `Retried model request (1/5) · 150s`, in a native select. No error is surfaced. The retry count moves slowly and the user has no hint the provider is unreachable. Screens: 40, 41, 45.

7. **Delete workspace has no confirmation and leaves a broken row.** The row menu item "Delete workspace" removed proj-alpha on one click. The row now reads `262abcddc317bcbc` (raw id) with its session still listed, and the main area shows "Unable to create default workspace." The folder on disk was not removed. Repro: hover the workspace row, open the `…` menu, click Delete workspace. Screens: 56, 57.

8. **Experts & Teams cost copy contradicts itself.** The header says "Unknown prices are never treated as zero", then reads "Booked cost at operator-configured prices: USD 0.000000. 1 reservation(s) have unknown prices." The run row says "Cost unknown … the provider dispatch failed" while the cost shows USD 0.000000. Screens: 51.

9. **Mobile: expanding the sidebar squeezes the conversation.** At 390 px, Expand sidebar opens a ~280 px sidebar in normal flow, so the main column drops to ~110 px. The start-session copy and composer wrap and clip, with no overlay or scrim. Screens: 54.

10. **Settings > Governance: the primary action is clipped.** At 1440x900 the "Declare proof" button extends about 17 px past the bottom edge of the dialog, so its lower half is cut. The section needs scrolling, but the button is visibly cut, not offered as a scroll target. Screens: 09, 55.

### P2

11. **Close affordances are inconsistent.** Settings and Plugins use a right-side ×. The Configuration file panel uses a left-side × (issue 4). The Remote "Control from your phone" modal has only a text Close button, no ×. The Settings close X is on the right (x 1050) at 1440 wide, so the reported "settings X on the left" was not reproduced there; the left X is in the config panel. Screens: 05, 10, 27.

12. **Composer model chip looks like a control but does nothing.** `mock-model-1` next to the mode chip has no hover or click response. The only way to change the model is Settings. Screens: 38.

13. **Native and unstyled controls break the design system.** Settings > General: Light / Dark / System and the font-size +/- use default browser button styling. Native selects are used for Permission, Language, Work details, Performance, Workflow, and API protocol. In Add model provider, the API protocol select is 19 px tall next to 33 px inputs. Screens: 06, 11, 29.

14. **Settings modal height jumps between sections.** The modal re-centres for each section's height (top edge at y 93, 131, 178 across sections). Switching sections moves the whole dialog. Screens: 06, 08, 05.

15. **Internal names and jargon in user-facing copy.** Examples: `COGNATE_RUN_CAPACITY` (read-only label on Experts), `COGNATE_GOVERNANCE=sea-forge`, `COGNATE_REALITYTRACE_BIN` and similar (Governance), `docs/sea-forge-authority.md`, env table with `SXR_BIN`, `COGNATE_PG`, `MODEL_RETRY_BACKOFF_MS` (config panel), and "Built is not installed. Installed is not enabled. Enabled is not verified." (Capabilities). Screens: 09, 10, 25, 30.

16. **Archive control uses a backspace glyph.** The session row's archive button shows ⌫ with an "Archive" label. Screens: 45.

17. **View options popover is hard to read.** Group by lists both "WorkSpace" and "Workspace Tree" (differing only in capitalization and meaning). The selected option is shown only by bold weight. Screens: 34.

18. **No keyboard shortcuts or palette discoverable.** Ctrl+K opens nothing, Ctrl+, does not open Settings, Ctrl+N does nothing. Escape does close Settings. There is no shortcut list in the UI (the config JSON has an empty `shortcuts: {}`). Screens: 42, 43.

19. **Experts & Teams alignment.** The page header and team list start at x 312, the Create Expert form at x 435, so the form looks indented on its own axis. Screens: 51.

20. **Workflow DAG overflows its card.** The rightmost stage (anchor-implementation) is cut at the container edge, with no scroll bar or fade. Screens: 29.

21. **Plugin detail is a dead end.** Model provider's detail shows identifier, lifecycle and status with no link to configure the provider. Screens: 50.

22. **Mobile: the collapsed rail hides navigation.** At 390 px only Expand sidebar, New session, Settings and a theme icon are visible. Experts & Teams, Plugins, Remote, Workbench and Add workspace are unreachable until the sidebar is expanded (which triggers issue 9). Screens: 44, 47, 48.

23. **First run shows an error before any user action.** "Unable to create default workspace. Use Choose workspace to select a folder." appears behind the welcome modal on a fresh home. It reads as a failure. Screens: 01.

24. **Sidebar workspace badges truncate.** "LOCAL · U…" and "LOCAL · UNCONTA…" are cut mid-word. Screens: 44, 53.

25. **Add workspace: home-subtree refusal is unexplained.** Folders under the Workbench's own home (`COGNATE_WORKBENCH_HOME`) can't be browsed, and the copy in issue 2 does not say why. Screens: 16. Covered by issue 2 for the copy problem.

26. **Customized settings link is a 15 px target.** Screens: 05.

## What worked

- Opening a workspace by full path works and appears in the sidebar (24).
- Settings > Models > Add model provider has labelled fields with hints (11).
- Settings close X and Escape both close Settings.
- At 390 px the default conversation view has no horizontal page scroll (44, scrollWidth 390).
- Workbench New task validates ("Enter a name to continue.") and disables Create task until a name is typed (33).
- Start an instance shows "Workflow instance started." feedback (52, DOM).

## Console

Browser console (error and warning) across all runs: no `pageerror` events. `console.error` only for 400s from the folder suggest endpoint (issue 2).

## Top 10 issues

1. Folder autocomplete misses relative, `~` and folder-children cases (issue 1).
2. Raw JSON error text in Add workspace, plus a 400 per keystroke (issue 2).
3. Suggestion dropdown is dark, low contrast and duplicated (issue 3).
4. Open configuration file is a stacked read-only modal with a left X (issue 4).
5. First-run API key step has only a key field; dismiss leads to an "Unable to create default workspace" dead end (issue 5).
6. A failing model run shows "Deep diving" with no error for 150 s+ (issue 6).
7. Delete workspace removes immediately with no confirm and leaves a raw-id row (issue 7).
8. Experts & Teams cost copy says both USD 0.000000 and unknown prices (issue 8).
9. Mobile expanded sidebar squeezes the conversation to about 110 px (issue 9).
10. Governance "Declare proof" button is clipped by the dialog (issue 10).
