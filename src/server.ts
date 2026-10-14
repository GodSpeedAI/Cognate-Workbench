// Single Bun process: runtime + Connect RuntimeService + bundled React UI + CSS.
// See docs/explanation/why-single-bun-process.md for why this is a hand-composed
// `createRuntime` rather than `createHarness`.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowCapabilities, rulePolicy } from "@godspeedai/cognate-kernel-api";
import type { Policy } from "@godspeedai/cognate-kernel-api";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import { createRuntime } from "@godspeedai/cognate-runtime-bun";
import { storeConfigFor } from "./store.ts";
import type { ActionPolicy, Runtime } from "@godspeedai/cognate-runtime-bun";
import { devToken, devTokenAuthenticator } from "@godspeedai/cognate-protocol-connect-bun";
import { registerRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { stylesheetPaths } from "@godspeedai/cognate-ui-astryx/styles";

import { bindScheduleCapabilities, SCHEDULE_CAPABILITY_ANCHORS, bindCognitiveCapabilities, bindExpertCapabilities, EXPERT_CAPABILITY_ANCHORS, bindExecutionWorlds, bindWorkbench, bindTranche5, bindTranche7, bindTranche9, bindTranche10, bindTranche11, bindUsage2, bindUsage3, loadDomain } from "../domain/index.ts";
import { SchedulesService, schedulesComponent } from "./schedules/service.ts";
import { ScheduleEvaluator } from "./schedules/evaluator.ts";
import { SCHEDULES_THREAD } from "./schedules/types.ts";
import { agentExpert } from "./agents/agentExpert.ts";
import { expertsComponent, ExpertsService } from "./experts/service.ts";
import { ExpertCompletionBridge } from "./experts/bridge.ts";
import { EXPERT_AGENT, EXPERTS_THREAD } from "./experts/types.ts";
import { expertsProjection } from "./projections/experts.ts";
import { providerRoutesProjection } from "./projections/providerRoutes.ts";
import { expertModelGenerateComponent, type ExpertModelGenerateOptions } from "./capabilities/expertModel.ts";
import { expertEffectComponent } from "./capabilities/expertEffect.ts";
import { expertGovernedService } from "./experts/governance.ts";
import { agentConfigAgent } from "./agents/agentConfig.ts";
import { agentCodingAgent } from "./agents/agentCoding.ts";
import { secretPutComponent } from "./capabilities/secretPut.ts";
import { sessionHistoryComponent } from "./capabilities/sessionHistory.ts";
import { modelConfigureComponent } from "./capabilities/modelConfigure.ts";
import { EXECUTION_CAPABILITY_IDS, createExecutionWorldRegistry, executionWorldsComponent, localExecutionWorld } from "@godspeedai/cognate-execution";
import { executionWorldsManageComponent, restoreExecutionWorlds } from "./capabilities/executionWorlds.ts";
import { executionWorldsProjection } from "./projections/executionWorlds.ts";
import { cognitiveComponent } from "./capabilities/cognitive.ts";
import { agentCognitiveAgent } from "./agents/agentCognitive.ts";
import type { MediatorSpec } from "./cognitive/mediation.ts";
import { workspaceSelectComponent } from "./capabilities/workspaceSelect.ts";
import { workspacePathComponent } from "./capabilities/workspacePath.ts";
import { toolCapabilitiesComponent } from "./capabilities/tools.ts";
import { planStateComponent } from "./capabilities/planState.ts";
import { subagentStartComponent } from "./capabilities/subagentStart.ts";
import { onboardingDismissComponent } from "./capabilities/onboardingDismiss.ts";
import { settingsChangeComponent } from "./capabilities/settingsChange.ts";
import { sessionArchiveComponent } from "./capabilities/sessionArchive.ts";
import { providerManageComponent } from "./capabilities/providerManage.ts";
import { configPathComponent } from "./capabilities/configPath.ts";
import { pluginInstallComponent } from "./capabilities/pluginInstall.ts";
import { pluginsProjection } from "./projections/plugins.ts";
import { PluginRegistry } from "./components/pluginRegistry.ts";
import { observationCapabilityComponent, observationOutboxFor, wireObservations, defaultSxrBin, type ObservationWiring } from "./observations.ts";
import { workspaceManageComponent } from "./capabilities/workspaceManage.ts";
import { workbenchComponent, WORKBENCH_CAPABILITY_IDS } from "./capabilities/workbench.ts";
import { workbenchProjection } from "./projections/workbench.ts";
import { ProviderRegistry } from "./components/providerRegistry.ts";
import { modelConfigProjection } from "./projections/modelConfig.ts";
import { cognitiveProjection } from "./projections/cognitive.ts";
import { workspacesProjection } from "./projections/workspaces.ts";
import { sessionsProjection } from "./projections/sessions.ts";
import { plansProjection } from "./projections/plans.ts";
import { subagentsProjection } from "./projections/subagents.ts";
import { onboardingProjection } from "./projections/onboarding.ts";
import { settingsProjection } from "./projections/settings.ts";
import { sessionTraceProjection } from "./projections/sessionTrace.ts";
import { secretStore } from "./secrets.ts";

export const LOCAL_OPERATOR = { actor: { id: "operator", kind: "user" as const }, tenant: "local" };
const SYSTEM_CALLER = { actor: { id: "system", kind: "system" as const }, tenant: "local" };

export interface ServerOptions {
  readonly port: number;
  readonly home: string;
  /** Test hook: extra lower-trust mediators placed under Sentinel in `risk.assess`. */
  readonly extraMediators?: readonly MediatorSpec[];
  /** Deterministic provider seam; normal execution uses the published provider adapters. */
  readonly expertProviderFactory?: ExpertModelGenerateOptions["providerFactory"];
  /** Controlled fixture seam; normal application startup always evaluates durable schedules. */
  readonly enableScheduleEvaluation?: boolean;
}

export interface AppServer {
  readonly url: string;
  readonly runtime: Runtime;
  stop(): Promise<void>;
}

const GRANTED_CAPABILITIES = [
  ...Object.keys(SCHEDULE_CAPABILITY_ANCHORS),
  ...Object.keys(EXPERT_CAPABILITY_ANCHORS),
  "model.generate",
  "model.configure",
  "secret.put",
  "workspace.select",
  "workspace.path",
  "workspace.rename",
  "workspace.delete",
  "session.history",
  ...EXECUTION_CAPABILITY_IDS,
  "execution.world.probe", "execution.wsl.list", "execution.world.connect", "execution.world.check", "execution.world.disconnect",
  "case.open", "criterion.freeze", "world.freeze", "world.fork", "world.attach", "world.discard", "verification.run", "case.derive", "world.settle", "risk.assess", "case.observe", "ui.focus.publish", "ui.context", "ui.request", "ui.pending", "experiment.round", "experiment.status", "method.review", "method.accept", "method.active",
  "tool.read",
  "tool.edit",
  "tool.bash",
  "tool.run_code",
  "plan.state",
  "subagent.start",
  "onboarding.dismiss",
  "settings.changeWorkDetails",
  "settings.changePermission",
  "settings.changeLanguage",
  "settings.changeAppearance",
  "settings.changeFontSize",
  "settings.changePerformanceDetail",
  "settings.changeCodingTools",
  "settings.changeSendBehavior",
  "settings.changePreset",
  "settings.changePlugin",
  "settings.changeShortcuts",
  "session.setArchived",
  "provider.delete",
  "model.catalog",
  "config.path",
  "plugin.catalog",
  "plugin.install",
  "plugin.uninstall",
  "observation.status",
  "observation.record",
  ...WORKBENCH_CAPABILITY_IDS,
];

function buildPolicy(): Policy {
  return rulePolicy(
    "deepseek-harness-app",
    [
      (request) => {
        const isOperatorOrSystem = request.actor.kind === "user" || request.actor.kind === "system";
        if (isOperatorOrSystem && GRANTED_CAPABILITIES.includes(request.capability.id)) {
          return { allow: true, policyId: "deepseek-harness-app", reason: `operator/system may invoke ${request.capability.id}` };
        }
        return undefined;
      },
    ],
  );
}

function buildActionPolicy(): ActionPolicy {
  return {
    authorize: (request) => {
      if (request.action === "run.start" && request.resource === EXPERT_AGENT && (request.caller.actor.kind !== "system" || request.caller.actor.id !== SYSTEM_CALLER.actor.id)) return {allow:false,reason:"Expert runs start only from authorized durable Assignments"};
      if (request.action === "thread.state.update" && (request.resource === EXPERTS_THREAD || request.resource.startsWith("experts:partition:") || request.resource === SCHEDULES_THREAD) && (request.caller.actor.kind !== "system" || request.caller.actor.id !== SYSTEM_CALLER.actor.id)) return {allow:false,reason:"Experts and schedule state mutations require validated capabilities"};
      return { allow: true, reason: "local single-operator app: default deny is enforced at the capability layer" };
    },
  };
}

const BROWSER_ENTRY_TEMPLATE = (caller: { readonly tenant: string; readonly actorId: string }) => `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@godspeedai/cognate-client";
import { CognateProvider } from "@godspeedai/cognate-react";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { App } from "../src/ui/App.tsx";

const caller = { tenant: ${JSON.stringify(caller.tenant)}, actor: { id: ${JSON.stringify(caller.actorId)}, kind: "user" } };
const transport = connectTransport(window.location.origin);
const service = createRemoteRuntimeService(transport, () => devToken(caller));
const client = createClient({ service, caller });

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(createElement(CognateProvider, { client }, createElement(App)));
}
`;

function indexHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Cognate Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="preload" as="style" onload="this.onload=null;this.rel='stylesheet'" />
<link rel="stylesheet" href="/astryx.css" />
<link rel="stylesheet" href="/theme.css" />
<link rel="stylesheet" href="/app.css" />
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
}

export async function startServer(options: ServerOptions): Promise<AppServer> {
  const home = options.home;
  await mkdir(home, { recursive: true });
  const store = storeConfigFor(home, "harness");
  const secretsPath = join(home, "secrets.json");
  const secrets = secretStore(secretsPath);

  const domain = await loadDomain();
  const cognitiveRefs = bindCognitiveCapabilities(domain);
  const bindings = bindTranche5(domain);
  const toolBindings = bindTranche7(domain);
  const planBindings = bindTranche9(domain);
  const subagentBindings = bindTranche10(domain);
  const usage2 = bindUsage2(domain);
  const usage3 = bindUsage3(domain);
  const worldBindings = bindExecutionWorlds(domain);
  const workbenchRefs = bindWorkbench(domain);
  const t11 = bindTranche11(domain);
  const expertRefs = bindExpertCapabilities(domain);
  const scheduleRefs = bindScheduleCapabilities(domain);

  const serviceRef: { current: RuntimeService | undefined } = { current: undefined };
  const getService = () => {
    if (!serviceRef.current) throw new Error("runtime not ready");
    return serviceRef.current;
  };
  let experts: ExpertsService;
  let schedules: SchedulesService;
  let scheduleEvaluator: ScheduleEvaluator;
  const knownWorkspaceIds = new Set<string>();
  // Execution worlds: where a workspace's files live and its commands run. Local today; other
  // providers (ssh, wsl, sandbox forks) register here without touching the tools or the agent.
  const executionWorlds = createExecutionWorldRegistry([localExecutionWorld()]);
  // T11: the plugin catalog registry. Constructed here (not inside the component) so the same
  // instance can be handed to any future surface that needs to resolve a catalog entry, and so an
  // additional `PluginSource` can be registered at boot without touching the capability.
  const pluginRegistry = new PluginRegistry();

  const runtime: Runtime = await createRuntime({
    store,
    // Usage pass U6 (RealityTrace, Option A): trace-worthy events get an observation intent
    // committed atomically with the event (the runtime's generic hook — no runtime dependency on
    // RealityTrace; the adapter only drains the outbox).
    outboxFor: observationOutboxFor,
    policy: buildPolicy(),
    actions: buildActionPolicy(),
    agents: [agentConfigAgent, agentCodingAgent, agentCognitiveAgent, agentExpert],
    components: [
      schedulesComponent({getSchedules:()=>schedules,getEvaluator:()=>scheduleEvaluator,semanticRefs:scheduleRefs}),
      expertsComponent({getExperts:()=>experts,semanticRefs:expertRefs}),
      expertModelGenerateComponent({secrets,getService,authorize:(ctx,route)=>experts.authorizeModel(ctx,route),semanticRef:expertRefs["expert.model.generate"],providerFactory:options.expertProviderFactory}),
      expertEffectComponent({getRuntime:()=>runtime,getExperts:()=>experts,semanticRef:expertRefs["expert.tool.invoke"],resolveSemanticRef:expertRefs["expert.effect.resolve"]}),
      executionWorldsComponent(executionWorlds, { semanticRef: worldBindings.family }),
      executionWorldsManageComponent({ getService, systemCaller: SYSTEM_CALLER, registry: executionWorlds, secrets, semanticRefs: worldBindings }),
      cognitiveComponent({ getService, systemCaller: SYSTEM_CALLER, registry: executionWorlds, extraMediators: options.extraMediators ?? [], semanticRefs: cognitiveRefs }),
      secretPutComponent(secrets, bindings.secretPut.semanticRef),
      sessionHistoryComponent(getService, bindings.sessionHistory.semanticRef),
      workspacePathComponent(getService, toolBindings.workspacePath.semanticRef),
      toolCapabilitiesComponent(toolBindings.toolRead.semanticRef),
      planStateComponent(getService, planBindings.planState.semanticRef),
      subagentStartComponent({ getService, systemActor: SYSTEM_CALLER.actor, semanticRef: subagentBindings.subagentStart.semanticRef }),
      onboardingDismissComponent({ getService, systemCaller: SYSTEM_CALLER }),
      settingsChangeComponent({ getService, systemCaller: SYSTEM_CALLER, semanticRefs: usage2.settingsChange, shortcutsSemanticRef: t11["settings.changeShortcuts"] }),
      workspaceManageComponent({ getService, systemCaller: SYSTEM_CALLER, semanticRefs: usage3 }),
      workbenchComponent({ getService, systemCaller: SYSTEM_CALLER, semanticRefs: workbenchRefs }),
      sessionArchiveComponent({ getService, systemCaller: SYSTEM_CALLER, semanticRef: t11["session.setArchived"] }),
      configPathComponent({ home, getService, systemCaller: SYSTEM_CALLER, semanticRef: t11["config.path"] }),
      pluginInstallComponent({
        getService,
        systemCaller: SYSTEM_CALLER,
        plugins: pluginRegistry,
        installSemanticRef: t11["plugin.install"],
        uninstallSemanticRef: t11["plugin.uninstall"],
        catalogSemanticRef: t11["plugin.install"],
      }),
    ],
    projections: [
      { projection: expertsProjection, public: true },
      { projection: providerRoutesProjection, public: true },
      { projection: modelConfigProjection, public: true },
      { projection: workspacesProjection, public: true },
      { projection: cognitiveProjection, public: true },
      { projection: executionWorldsProjection, public: true },
      { projection: sessionsProjection, public: true },
      { projection: plansProjection, public: true },
      { projection: subagentsProjection, public: true },
      { projection: onboardingProjection, public: true },
      { projection: settingsProjection, public: true },
      { projection: sessionTraceProjection, public: true },
      { projection: workbenchProjection, public: true },
      { projection: pluginsProjection, public: true },
    ],
    system: SYSTEM_CALLER.actor,
  });
  const governedService = expertGovernedService(runtime.service,SYSTEM_CALLER);
  serviceRef.current = governedService;
  experts = new ExpertsService(governedService,SYSTEM_CALLER);

  // Seed `knownWorkspaceIds` from the persisted projection (survives restart).
  for (const row of ((await runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" }))).rows) {
    if (row.key.startsWith("record/")) knownWorkspaceIds.add(row.key.slice("record/".length));
  }

  // Re-register durable SSH/WSL worlds (lazy: nothing connects until a workspace uses one).
  await restoreExecutionWorlds({ getService, systemCaller: SYSTEM_CALLER, registry: executionWorlds, secrets });

  const registry = new ProviderRegistry(runtime.kernel, bindings.modelGenerate.semanticRef);
  await runtime.kernel.mount(
    workspaceSelectComponent({
      getService,
      systemCaller: SYSTEM_CALLER,
      getKnownWorkspaceIds: () => knownWorkspaceIds,
      registry: executionWorlds,
      semanticRef: bindings.workspaceSelect.semanticRef,
    }),
  );
  await runtime.kernel.mount(
    modelConfigureComponent({ registry, secrets, getService, systemCaller: SYSTEM_CALLER, semanticRef: bindings.modelConfigure.semanticRef }),
  );
  // T11: `provider.delete` / `model.catalog` need the same live `ProviderRegistry` the configure
  // component uses, so they mount here rather than in the `createRuntime` component list.
  await runtime.kernel.mount(
    providerManageComponent({
      registry,
      secrets,
      getService,
      systemCaller: SYSTEM_CALLER,
      deleteSemanticRef: t11["provider.delete"],
      catalogSemanticRef: t11["model.catalog"],
    }),
  );

  // Re-mount the last-configured provider on boot (survives restart): `model.generate` is not
  // itself durable state, only the fact `model.configured` is (via `model-config`) — a run resumed
  // after a restart (e.g. one paused on an open approval continuation) needs a live provider before
  // it can call `model.generate` again.
  const modelConfigRows = ((await runtime.service.readProjection(LOCAL_OPERATOR, { name: "model-config" }))).rows;
  const currentModelConfig = modelConfigRows.find((r) => r.key === "current")?.value as
    | { readonly providerId: string; readonly baseURL: string; readonly protocol: "openai-compatible"; readonly model: string }
    | undefined;
  if (currentModelConfig) {
    await registry.swap(
      { providerId: currentModelConfig.providerId, baseURL: currentModelConfig.baseURL, protocol: currentModelConfig.protocol, model: currentModelConfig.model },
      secrets,
    );
  }

  // Restore the legacy model route before feature initialization: recovered ordinary coding
  // runs must not spend their provider-retry budget waiting for unrelated seed work.
  await experts.seed(LOCAL_OPERATOR.tenant);
  schedules=new SchedulesService(experts);
  scheduleEvaluator=new ScheduleEvaluator(schedules,experts);
  await scheduleEvaluator.reconcile(LOCAL_OPERATOR.tenant);
  const expertBridge = new ExpertCompletionBridge(experts,LOCAL_OPERATOR.tenant);
  await expertBridge.start();

  // Usage pass U6: the RealityTrace observation adapter — an at-least-once background drain from
  // the committed outbox to the pinned SXR CLI. SXR-down never blocks or breaks the app (the
  // adapter retries, then poisons for reconciliation); without the binary the app boots with
  // observations queued and the dev tools fully working (traces come from the event log, not SXR).
  let observations: ObservationWiring | undefined;
  const sxrBin = defaultSxrBin();
  if (sxrBin) {
    try {
      observations = await wireObservations({
        store: runtime.store,
        bin: sxrBin,
        repoDir: join(home, "sxr-repo"),
        env: { XDG_DATA_HOME: join(home, "sxr-data"), XDG_STATE_HOME: join(home, "sxr-state") },
        // Usage pass U7: the drain respects the durable RealityTrace plugin state
        // (`settings.changePlugin` → `settings.changed` → `settings` projection). The read is
        // per drain cycle, so a toggle takes effect without a restart, and a failed read is
        // fail-closed: observations queue (at-least-once) and deliver once the plugin enables.
        enabled: async () => {
          try {
            const rows = (await getService().readProjection(LOCAL_OPERATOR, { name: "settings" })).rows;
            const current = rows.find((row) => row.key === "current")?.value as { plugins?: Record<string, boolean> } | undefined;
            return current?.plugins?.realitytrace === true;
          } catch {
            return false;
          }
        },
      });
    } catch (error) {
      console.warn(`[cognate-workbench] realitytrace: wiring failed (${error instanceof Error ? error.message : String(error)}); observations stay queued`);
      observations = undefined;
    }
  } else {
    console.warn("[cognate-workbench] realitytrace: SXR binary not found; observations stay queued (dev tools unaffected)");
  }
  // The read side is mounted unconditionally: the inspector shows honest queued states when no SXR
  // target is configured, instead of erroring.
  await runtime.kernel.mount(
    observationCapabilityComponent({ getService, delivery: observations?.delivery, port: observations?.port, operatorCaller: LOCAL_OPERATOR }),
  );

  // Track newly added workspaces (so workspace.select can tell "add" from "reselect") by following
  // the tenant's event stream live; torn down on `stop()` via AbortController. (T10's `subagent` tool
  // is fire-and-forget — reference-behavior-matrix.md §6.4 — so there is no parent-side completion
  // wait/watcher to run here; the child's own events are what the `subagents` projection folds.)
  const eventsController = new AbortController();
  void (async () => {
    try {
      for await (const event of runtime.service.events(LOCAL_OPERATOR, { follow: true, signal: eventsController.signal })) {
        if (event.eventType === "workspace.added") {
          const payload = event.payload as { readonly workspaceId: string };
          knownWorkspaceIds.add(payload.workspaceId);
        }
      }
    } catch {
      // aborted on shutdown
    }
  })();

  // Connect RuntimeService handled in-process (same Bun.serve as the UI), not via a second
  // `serveRuntime` server proxied by `fetch()` (the pattern in packages/cli/src/index.ts `dev()`) —
  // that double Bun.serve hop was observed to leave `internal.stop()` hanging after an error
  // response reached the outer proxy in this app's tests. Building the fetch handler directly with
  // the same public `@connectrpc/connect` + `registerRuntimeService` calls `serveRuntime` uses
  // internally keeps this a genuinely single Bun process with no proxy layer to hang.
  const connectRouter = createConnectRouter({});
  registerRuntimeService(connectRouter, governedService, { authenticate: devTokenAuthenticator, maxJsonDepth: 32 });
  const connectHandlersByPath = new Map<string, (req: Request) => Promise<Response>>();
  for (const uHandler of connectRouter.handlers) {
    connectHandlersByPath.set(uHandler.requestPath, createFetchHandler(uHandler, { httpVersion: "1.1" }));
  }

  const appDir = fileURLToPath(new URL("..", import.meta.url));
  const generatedDir = join(appDir, ".generated");
  await mkdir(generatedDir, { recursive: true });
  const entryPath = join(generatedDir, "entry.tsx");
  await writeFile(entryPath, BROWSER_ENTRY_TEMPLATE({ tenant: LOCAL_OPERATOR.tenant, actorId: LOCAL_OPERATOR.actor.id }));
  const build = await Bun.build({ entrypoints: [entryPath], target: "browser", format: "esm" });
  if (!build.success) throw new Error(`server: failed to bundle the UI: ${build.logs.map((log) => String(log)).join("; ")}`);
  const bundleJs = await build.outputs[0]!.text();
  const cssPaths = stylesheetPaths();
  const appCssPath = fileURLToPath(new URL("./ui/app.css", import.meta.url));
  // The workbench cockpit's styles are layered after app.css: shared primitives first, then each
  // component's layout-only sheet (the server concatenates; components never import CSS).
  const WORKBENCH_CSS = ["base", "contract", "tasks", "review", "skills", "workflow", "automation", "cockpit"];
  const cssParts: string[] = [];
  for (const file of [appCssPath, ...WORKBENCH_CSS.map((n) => fileURLToPath(new URL(`./ui/workbench/${n}.css`, import.meta.url))), fileURLToPath(new URL("./ui/experts/experts.css",import.meta.url))]) {
    if (existsSync(file)) cssParts.push(await Bun.file(file).text());
  }
  const appCss = cssParts.join("\n");

  if(options.enableScheduleEvaluation!==false)await scheduleEvaluator.start(LOCAL_OPERATOR.tenant);
  const server = Bun.serve({
    port: options.port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return Response.json({ ok: true, semantic: { objects: domain.projection.objects.length, digest: domain.projection.source.digest } });
      }
      if (url.pathname.startsWith("/cognate.v1.RuntimeService/")) {
        const handler = connectHandlersByPath.get(url.pathname);
        return handler ? handler(request) : new Response("not found", { status: 404 });
      }
      // The bundle is rebuilt at every boot, so the browser must never hold one across restarts —
      // no-store keeps a stale UI (with stale handlers) from surviving a harness restart.
      if (url.pathname === "/app.js") return new Response(bundleJs, { headers: { "content-type": "text/javascript", "cache-control": "no-store" } });
      if (url.pathname === "/astryx.css" && cssPaths[0]) return new Response(Bun.file(cssPaths[0]));
      if (url.pathname === "/theme.css" && cssPaths[1]) return new Response(Bun.file(cssPaths[1]));
      if (url.pathname === "/app.css") return new Response(appCss, { headers: { "content-type": "text/css", "cache-control": "no-store" } });
      if (url.pathname === "/") return new Response(indexHtml(), { headers: { "content-type": "text/html" } });
      return new Response("not found", { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    runtime: {...runtime,service:governedService},
    async stop() {
      eventsController.abort();
      await scheduleEvaluator.stop();
      await expertBridge.stop();
      observations?.stop();
      server.stop(true);
      await runtime.close();
      // Close every SSH/SFTP connection and WSL session this process opened.
      await executionWorlds.dispose();
    },
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3180);
  const home = process.env.COGNATE_WORKBENCH_HOME ?? process.env.COGNATE_HARNESS_HOME ?? join(dirname(fileURLToPath(new URL(".", import.meta.url))), "..", ".data");
  const app = await startServer({ port, home });
  console.log(`[cognate-workbench] listening on ${app.url} (home: ${home})`);
  console.log(`[cognate-workbench] dev auth: Authorization: Bearer ${devToken(LOCAL_OPERATOR)}`);
}
