// Single Bun process: runtime + Connect RuntimeService + bundled React UI + CSS.
// See docs/explanation/why-single-bun-process.md for why this is a hand-composed
// `createRuntime` rather than `createHarness`.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowCapabilities, rulePolicy } from "@godspeedai/cognate-kernel-api";
import type { Policy } from "@godspeedai/cognate-kernel-api";
import type { Caller, RuntimeService } from "@godspeedai/cognate-runtime-api";
import { createRuntime } from "@godspeedai/cognate-runtime-bun";
import { storeConfigFor } from "./store.ts";
import { EXECUTION_POSTURE_ENV, parseExecutionPosture, postureRegistry, type ExecutionPosture } from "./executionPosture.ts";
import type { ActionPolicy, Runtime } from "@godspeedai/cognate-runtime-bun";
import { devTokenAuthenticator } from "@godspeedai/cognate-protocol-connect-bun";
import { registerRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { stylesheetPaths } from "@godspeedai/cognate-ui-astryx/styles";

import { bindRuntimeExecution, bindScheduleCapabilities, SCHEDULE_CAPABILITY_ANCHORS, bindCognitiveCapabilities, bindExpertCapabilities, EXPERT_CAPABILITY_ANCHORS, bindExecutionWorlds, bindWorkbench, bindTranche5, bindTranche7, bindTranche9, bindTranche10, bindTranche11, bindUsage2, bindUsage3, bindT8Identity, bindRedJourneys, loadDomain } from "../domain/index.ts";
import { SchedulesService, schedulesComponent } from "./schedules/service.ts";
import { ScheduleEvaluator } from "./schedules/evaluator.ts";
import { SCHEDULES_THREAD } from "./schedules/types.ts";
import { agentExpert } from "./agents/agentExpert.ts";
import { expertsComponent, ExpertsService } from "./experts/service.ts";
import { ExpertCompletionBridge } from "./experts/bridge.ts";
import { reconcileBilling, runInvocationInspector } from "./experts/billing.ts";
import { EXPERT_AGENT, EXPERTS_THREAD } from "./experts/types.ts";
import { expertsProjection } from "./projections/experts.ts";
import { expertsBillingProjection } from "./projections/expertsBilling.ts";
import { providerRoutesProjection } from "./projections/providerRoutes.ts";
import { expertModelGenerateComponent, type ExpertModelGenerateOptions } from "./capabilities/expertModel.ts";
import { containedWorkspaceComponent, validateContainmentConfig, type ContainmentConfig } from "./capabilities/containedWorkspace.ts";
import { runtimeExecutionComponent, RUNTIME_EXECUTION_INSPECT } from "./capabilities/runtimeExecution.ts";
import { createExpertAdmissionResourceKeys, parseExpertAdmissionCapacity } from "./experts/admission.ts";
import { expertEffectComponent } from "./capabilities/expertEffect.ts";
import { expertGovernedService } from "./experts/governance.ts";
import { agentConfigAgent } from "./agents/agentConfig.ts";
import { agentCodingAgent } from "./agents/agentCoding.ts";
import { secretPutComponent } from "./capabilities/secretPut.ts";
import { identityAdminComponent } from "./capabilities/identityAdmin.ts";
import { aggregateContainedRegistry, CONTAINMENT_THREAD, reconcileContainmentAtBoot } from "./capabilities/aggregateContainment.ts";
import { ageExpiredSessions, createSessionAuthenticator, ensureIdentity, issueSession, OPERATOR_SESSION_TTL_MS, supersedeBootSessions, BOOT_SESSION_CAUSE, IDENTITY_THREAD } from "./auth/identity.ts";
import { sessionHistoryComponent } from "./capabilities/sessionHistory.ts";
import { sessionCreateComponent } from "./capabilities/sessionCreate.ts";
import { sessionTaskBindComponent } from "./capabilities/sessionTaskBind.ts";
import { sessionTaskBindingsProjection } from "./projections/sessionTaskBindings.ts";
import { modelConfigureComponent } from "./capabilities/modelConfigure.ts";
import { EXECUTION_CAPABILITY_IDS, createExecutionWorldRegistry, executionWorldsComponent, localExecutionWorld } from "@godspeedai/cognate-execution";
import { executionWorldsManageComponent, restoreExecutionWorlds } from "./capabilities/executionWorlds.ts";
import { executionWorldsProjection } from "./projections/executionWorlds.ts";
import { cognitiveComponent } from "./capabilities/cognitive.ts";
import { agentCognitiveAgent } from "./agents/agentCognitive.ts";
import type { MediatorSpec } from "./cognitive/mediation.ts";
import { workspaceSelectComponent } from "./capabilities/workspaceSelect.ts";
import { workspaceDirectorySuggestComponent } from "./capabilities/workspaceDirectorySuggest.ts";
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

export interface RunOwnershipMode {
  readonly mode: "single-process" | "multi-process";
}

/** T7 (J-EXPERT-PARALLEL): resolve the multi-process run-ownership configuration. "multi-process"
 * is exposed only behind this verified configuration, backed by the published fenced run-write
 * ownership release: every execution pass claims authoritative store-time ownership, a stale
 * owner's late run-scoped writes are fenced, and a killed process's in-flight effect requires
 * explicit reconciliation instead of a blind repeat (ambiguousSteps: "wait"). The default keeps
 * the historical single-process restart semantics. */
export function parseRunOwnershipMode(raw: string | undefined): "single-process" | "multi-process" {
  if (raw === undefined || raw === "") return "single-process";
  if (raw === "single-process" || raw === "multi-process") return raw;
  throw new Error("COGNATE_RUN_OWNERSHIP must be 'single-process' or 'multi-process'");
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The server binds loopback only, but a browser page whose name DNS-rebinds to 127.0.0.1 is
 *  same-origin with it, and the UI bundle carries the operator session. The Host header (and
 *  Origin, when a browser sends one) is the only signal of that, so any non-loopback name is
 *  refused before routing. Ports are not compared, so local port forwards keep working. */
export function loopbackRefusal(headers: Headers): { status: number; reason: string } | undefined {
  const hostname = (value: string): string | undefined => {
    try { return new URL(value).hostname.toLowerCase(); } catch { return undefined; }
  };
  const host = headers.get("host");
  const h = host === null ? undefined : hostname(`http://${host}`);
  if (h === undefined || !LOOPBACK_HOSTNAMES.has(h)) return { status: 421, reason: "misdirected request: non-loopback Host" };
  const origin = headers.get("origin");
  if (origin !== null) {
    const o = hostname(origin);
    if (o === undefined || !LOOPBACK_HOSTNAMES.has(o)) return { status: 403, reason: "forbidden: non-loopback Origin" };
  }
  return undefined;
}

/** T8 (J-AUTH-SESSION): the dev authenticator is opt-in and loud. Any value other than an explicit
 *  "1" keeps the production posture (durable sessions only). */
export function parseDevAuth(raw: string | undefined): boolean {
  if (raw === undefined || raw === "") return false;
  if (raw === "1") return true;
  throw new Error("COGNATE_DEV_AUTH must be '1' (explicit test/dev arming) or unset");
}

export interface ServerOptions {
  readonly port: number;
  readonly home: string;
  /** Host startup capacity; default one. Eligibility never widens captured Expert authority. */
  readonly runCapacity?: 1 | 2 | 4 | 8;
  /** T7: verified multi-process run-ownership configuration (defaults to COGNATE_RUN_OWNERSHIP,
   * then "single-process"). Multi-process semantics: fenced run writes + ambiguous-effect
   * reconciliation; single-process keeps the historical restart behavior. */
  readonly runOwnership?: "single-process" | "multi-process";
  /** Test hook: extra lower-trust mediators placed under Sentinel in `risk.assess`. */
  readonly extraMediators?: readonly MediatorSpec[];
  /** Deterministic provider seam; normal execution uses the published provider adapters. */
  readonly expertProviderFactory?: ExpertModelGenerateOptions["providerFactory"];
  /** Controlled fixture seam; normal application startup always evaluates durable schedules. */
  readonly enableScheduleEvaluation?: boolean;
  /** Trusted host configuration only; browser and agent inputs cannot supply binary provenance. */
  readonly containmentConfig?: ContainmentConfig;
  /** T8: the production posture authenticates durable server-issued sessions only. This explicit
   *  dev/test opt-in re-arms the legacy client-claimed `Bearer <tenant>:<actorId>` format for the
   *  test harness; a production deployment never sets it (default COGNATE_DEV_AUTH, unset). */
  readonly devAuth?: boolean;
  /** Where agent effects may run (default COGNATE_EXECUTION_POSTURE, unset = "contained"). Under
   *  "contained", commands and writes in uncontained `local` worlds are refused; "uncontained-local"
   *  is the operator's explicit opt-in to run them on this host as this user (src/executionPosture.ts). */
  readonly executionPosture?: ExecutionPosture;
}

export interface AppServer {
  readonly url: string;
  readonly runtime: Runtime;
  readonly executionPosture: ExecutionPosture;
  /** T8: this boot's operator browser session token (the session-authenticated HTTP test seam). */
  readonly operatorSessionToken: string;
  stop(): Promise<void>;
}

const GRANTED_CAPABILITIES = [
  RUNTIME_EXECUTION_INSPECT,
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
  "workspace.contained.select", "execution.containment.inspect",
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
  "settings.changeSpending",
  "settings.changeContainment",
  "identity.session.issue",
  "identity.session.revoke",
  "identity.inspect",
  "session.setArchived",
  "session.create",
  "session.task.bind",
  "workspace.directory.suggest",
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
        // T8: kind "user" grants belong to exactly the one durable operator identity this
        // single-operator application boots with. A server-issued session for any other
        // provisioned identity authenticates (its own tenant partition) but holds no workbench
        // capability authority — cross-tenant capability escalation is refused here.
        if (request.actor.kind === "system" && GRANTED_CAPABILITIES.includes(request.capability.id)) {
          return { allow: true, policyId: "deepseek-harness-app", reason: `system may invoke ${request.capability.id}` };
        }
        if (request.actor.kind === "user"
          && request.tenant === LOCAL_OPERATOR.tenant
          && request.actor.id === LOCAL_OPERATOR.actor.id
          && GRANTED_CAPABILITIES.includes(request.capability.id)) {
          return { allow: true, policyId: "deepseek-harness-app", reason: `operator may invoke ${request.capability.id}` };
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
      // T8: the identity/session ledger and the aggregate containment ledger are system-owned
      // truth. A session (or any non-system caller) writing them directly could forge an operator
      // session, revive a revoked one, or free containment slots by hand — refused here; the
      // identity-admin and settings capabilities are the only validated writers.
      if (request.action === "thread.state.update" && (request.resource === IDENTITY_THREAD || request.resource === CONTAINMENT_THREAD) && (request.caller.actor.kind !== "system" || request.caller.actor.id !== SYSTEM_CALLER.actor.id)) return {allow:false,reason:"Identity and containment ledgers are system-owned; use the validated capabilities"};
      // The identity ledger also carries session token hashes: reads go through the sanitized
      // identity.inspect capability, never a raw thread read.
      if (request.action === "thread.state.read" && request.resource === IDENTITY_THREAD && (request.caller.actor.kind !== "system" || request.caller.actor.id !== SYSTEM_CALLER.actor.id)) return {allow:false,reason:"The identity ledger is system-owned; use identity.inspect"};
      return { allow: true, reason: "local single-operator app: default deny is enforced at the capability layer" };
    },
  };
}

// T8 hardening note: the optional Google Fonts stylesheet must never block the local app's
// bootstrap (a held font response cannot delay DOMContentLoaded — the browser journeys prove
// this), and the CSP forbids inline event handlers — so the document only preconnects, and the
// entry module below appends the stylesheet link dynamically (parser-async by construction).
const BROWSER_ENTRY_TEMPLATE = (caller: { readonly tenant: string; readonly actorId: string }, authToken: string) => `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@godspeedai/cognate-client";
import { CognateProvider } from "@godspeedai/cognate-react";
import { connectTransport } from "@godspeedai/cognate-protocol-connect-bun";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { App } from "../src/ui/App.tsx";

const caller = { tenant: ${JSON.stringify(caller.tenant)}, actor: { id: ${JSON.stringify(caller.actorId)}, kind: "user" } };
// T8: the browser presents the server-issued session token for this boot; the server resolves it
// against the durable session ledger on every request and never trusts this string as an identity.
const authToken = ${JSON.stringify(authToken)};
const transport = connectTransport(window.location.origin);
const service = createRemoteRuntimeService(transport, () => authToken);
const client = createClient({ service, caller });

const root = document.getElementById("root");

// T8: the optional Google Fonts stylesheet loads from here — dynamically appended, so a slow
// or held font response never blocks DOMContentLoaded or the local app's bootstrap, and the
// document itself carries no inline event handler (the CSP forbids it).
const fonts = document.createElement("link");
fonts.rel = "stylesheet";
fonts.href = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap";
document.head.append(fonts);

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
  const runCapacity = parseExpertAdmissionCapacity(options.runCapacity === undefined ? process.env.COGNATE_RUN_CAPACITY : String(options.runCapacity));
  const runOwnershipMode = options.runOwnership ?? parseRunOwnershipMode(process.env.COGNATE_RUN_OWNERSHIP);
  const executionPosture = options.executionPosture ?? parseExecutionPosture(process.env[EXECUTION_POSTURE_ENV]);
  let containmentConfig = options.containmentConfig;
  const containmentConfigPath = process.env.COGNATE_LINUX_CONTAINMENT_CONFIG;
  if (!containmentConfig && containmentConfigPath) {
    const contents = await readFile(containmentConfigPath, "utf8");
    try { containmentConfig = JSON.parse(contents) as ContainmentConfig; }
    catch { throw new Error("Invalid host Linux containment configuration JSON"); }
  }
  // Freeze this server's policy by value; caller-owned options cannot reroute an active world.
  if (containmentConfig) containmentConfig = validateContainmentConfig(structuredClone(containmentConfig));
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
  const runtimeExecutionRef = bindRuntimeExecution(domain);
  // T8: identity-administration capabilities (session issue/revoke/inspect) and the aggregate
  // containment quota setting. The containment semanticRef sits at SETTING_FIELDS index 11
  // (`settings.changeContainment`), appended to the usage-2 refs in that component's order.
  const t8 = bindT8Identity(domain);
  // RED journeys (J-SESSION-draft / J-WS-directory-discovery / J-TASK-scope / J-TASK-move):
  // explicit bindings for the new capabilities; see RED_JOURNEY_ANCHORS in domain/index.ts.
  const redRefs = bindRedJourneys(domain);

  const serviceRef: { current: RuntimeService | undefined } = { current: undefined };
  const getService = () => {
    if (!serviceRef.current) throw new Error("runtime not ready");
    return serviceRef.current;
  };
  let experts: ExpertsService;
  let finishExpertsBoot!: (value: ExpertsService) => void;
  const expertsBoot = new Promise<ExpertsService>(resolve => { finishExpertsBoot = resolve; });
  // Runtime-service readiness is independent of Expert boot: configuration and coding runs derive
  // their resource keys from projections and must never wait on the Experts registry seed.
  let finishServiceBoot!: (value: RuntimeService) => void;
  const serviceBoot = new Promise<RuntimeService>(resolve => { finishServiceBoot = resolve; });
  const awaitService = (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (serviceRef.current) return Promise.resolve(serviceRef.current);
    return new Promise<RuntimeService>((resolve, reject) => {
      const aborted = () => {
        signal?.removeEventListener("abort", aborted);
        reject(signal?.reason ?? new Error("Admission cancelled during runtime boot"));
      };
      signal?.addEventListener("abort", aborted, { once: true });
      void serviceBoot.then(value => {
        signal?.removeEventListener("abort", aborted);
        resolve(value);
      });
    });
  };
  const admissionKeys = createExpertAdmissionResourceKeys({
    getService: awaitService,
    ready: signal => {
      signal?.throwIfAborted();
      if (experts) return Promise.resolve(experts);
      return new Promise<ExpertsService>((resolve, reject) => {
        const aborted = () => {
          signal?.removeEventListener("abort", aborted);
          reject(signal?.reason ?? new Error("Expert admission cancelled during boot"));
        };
        signal?.addEventListener("abort", aborted, { once: true });
        void expertsBoot.then(value => {
          signal?.removeEventListener("abort", aborted);
          resolve(value);
        });
      });
    },
  });
  let schedules: SchedulesService;
  let scheduleEvaluator: ScheduleEvaluator;
  const knownWorkspaceIds = new Set<string>();
  // Execution worlds: where a workspace's files live and its commands run. Local today; other
  // providers (ssh, wsl, sandbox forks) register here without touching the tools or the agent.
  // T8: the registry is wrapped so every CONTAINED provider's executions pass the aggregate
  // containment ledger first — one operator-configured ceiling across processes, fail closed.
  // The execution posture wraps the registry first, so every `local`-kind provider — the base
  // world and any directory-copy fork registered later — is effect-refused under "contained".
  const executionWorlds = aggregateContainedRegistry(postureRegistry(createExecutionWorldRegistry([localExecutionWorld()]), executionPosture), { getService, systemCaller: SYSTEM_CALLER });
  // T11: the plugin catalog registry. Constructed here (not inside the component) so the same
  // instance can be handed to any future surface that needs to resolve a catalog entry, and so an
  // additional `PluginSource` can be registered at boot without touching the capability.
  const pluginRegistry = new PluginRegistry();

  const runtime: Runtime = await createRuntime({
    store,
    // Preserve the serial compatibility path. Opt-in capacity uses only native SDK admission;
    // frozen intrinsic-return work may overlap, while every workspace-capable run shares a key.
    ...(runCapacity > 1 || runOwnershipMode === "multi-process"
      ? {
        execution: {
          ...(runCapacity > 1 ? { maxConcurrentRuns: runCapacity, resourceKeys: admissionKeys } : {}),
          ...(runOwnershipMode === "multi-process" ? { runOwnership: { ambiguousSteps: "wait" as const } } : {}),
        },
      }
      : {}),
    // Usage pass U6 (RealityTrace, Option A): trace-worthy events get an observation intent
    // committed atomically with the event (the runtime's generic hook — no runtime dependency on
    // RealityTrace; the adapter only drains the outbox).
    outboxFor: observationOutboxFor,
    policy: buildPolicy(),
    actions: buildActionPolicy(),
    agents: [agentConfigAgent, agentCodingAgent, agentCognitiveAgent, agentExpert],
    components: [
      runtimeExecutionComponent({ configuredCapacity: runCapacity, semanticRef: runtimeExecutionRef }),
      schedulesComponent({getSchedules:()=>schedules,getEvaluator:()=>scheduleEvaluator,semanticRefs:scheduleRefs}),
      expertsComponent({getExperts:()=>experts,semanticRefs:expertRefs}),
      expertModelGenerateComponent({secrets,getService,authorize:(ctx,route)=>experts.authorizeModel(ctx,route),semanticRef:expertRefs["expert.model.generate"],providerFactory:options.expertProviderFactory}),
      expertEffectComponent({getRuntime:()=>runtime,getExperts:()=>experts,semanticRef:expertRefs["expert.tool.invoke"],resolveSemanticRef:expertRefs["expert.effect.resolve"]}),
      executionWorldsComponent(executionWorlds, { semanticRef: worldBindings.family }),
      executionWorldsManageComponent({ getService, systemCaller: SYSTEM_CALLER, registry: executionWorlds, secrets, semanticRefs: worldBindings, containmentConfig }),
      containedWorkspaceComponent({ executionPosture, getService, systemCaller: SYSTEM_CALLER, registry: executionWorlds, getKnownWorkspaceIds: () => knownWorkspaceIds, config: containmentConfig, protectedHome: home, semanticRefs: worldBindings }),
      cognitiveComponent({ getService, systemCaller: SYSTEM_CALLER, registry: executionWorlds, extraMediators: options.extraMediators ?? [], semanticRefs: cognitiveRefs }),
      secretPutComponent(secrets, bindings.secretPut.semanticRef),
      identityAdminComponent({ getService, systemCaller: SYSTEM_CALLER, operatorTenant: LOCAL_OPERATOR.tenant, operatorActorId: LOCAL_OPERATOR.actor.id, semanticRefs: t8.identity }),
      sessionHistoryComponent(getService, bindings.sessionHistory.semanticRef),
      sessionCreateComponent({ getService, systemCaller: SYSTEM_CALLER, getKnownWorkspaceIds: () => knownWorkspaceIds, semanticRef: redRefs["session.create"] }),
      sessionTaskBindComponent({ getService, systemCaller: SYSTEM_CALLER, semanticRef: redRefs["session.task.bind"] }),
      workspaceDirectorySuggestComponent({ registry: executionWorlds, protectedHome: home, semanticRef: redRefs["workspace.directory.suggest"] }),
      workspacePathComponent(getService, toolBindings.workspacePath.semanticRef),
      toolCapabilitiesComponent(toolBindings.toolRead.semanticRef),
      planStateComponent(getService, planBindings.planState.semanticRef),
      subagentStartComponent({ getService, systemActor: SYSTEM_CALLER.actor, semanticRef: subagentBindings.subagentStart.semanticRef }),
      onboardingDismissComponent({ getService, systemCaller: SYSTEM_CALLER }),
      settingsChangeComponent({ getService, systemCaller: SYSTEM_CALLER, semanticRefs: [...usage2.settingsChange, t8.containment], shortcutsSemanticRef: t11["settings.changeShortcuts"] }),
      workspaceManageComponent({ getService, systemCaller: SYSTEM_CALLER, semanticRefs: usage3 }),
      workbenchComponent({ getService, systemCaller: SYSTEM_CALLER, semanticRefs: workbenchRefs, getKnownWorkspaceIds: () => knownWorkspaceIds }),
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
      { projection: expertsBillingProjection, public: true },
      { projection: providerRoutesProjection, public: true },
      { projection: modelConfigProjection, public: true },
      { projection: workspacesProjection, public: true },
      { projection: cognitiveProjection, public: true },
      { projection: executionWorldsProjection, public: true },
      { projection: sessionsProjection, public: true },
      { projection: sessionTaskBindingsProjection, public: true },
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
  finishServiceBoot(governedService);
  experts = new ExpertsService(governedService,SYSTEM_CALLER);
  finishExpertsBoot(experts);

  // T8 (J-AUTH-SESSION): the durable identity ledger is the authentication truth. Boot seeds the
  // operator identity idempotently, ages expired sessions (they were already refused; the ledger's
  // own status becomes truthful), and issues exactly one fresh session for THIS boot's browser
  // entry — a restart therefore invalidates the previous browser token, and the operator can
  // revoke it live. The cleartext token exists in memory and the generated entry only.
  const operatorIdentity = await ensureIdentity(governedService, SYSTEM_CALLER, { tenant: LOCAL_OPERATOR.tenant, actorId: LOCAL_OPERATOR.actor.id, label: "operator browser session" });
  await ageExpiredSessions(governedService, SYSTEM_CALLER);
  await supersedeBootSessions(governedService, SYSTEM_CALLER, operatorIdentity.id);
  const operatorSession = await issueSession(governedService, SYSTEM_CALLER, { identityId: operatorIdentity.id, ttlMs: OPERATOR_SESSION_TTL_MS, cause: BOOT_SESSION_CAUSE });
  // T8 (J-RW-AGGREGATE-CONTAINMENT): reap any aggregate slots whose holder died mid-execution so
  // a crashed process cannot hold the configured ceiling shut.
  try {
    await reconcileContainmentAtBoot(governedService, SYSTEM_CALLER);
  } catch (error) {
    console.warn(`[cognate-workbench] containment: boot reconciliation failed (${error instanceof Error ? error.message : String(error)}); lapsed slots stay booked until a later admission reaps them`);
  }

  // Seed `knownWorkspaceIds` from the persisted projection (survives restart).
  for (const row of ((await runtime.service.readProjection(LOCAL_OPERATOR, { name: "workspaces" }))).rows) {
    if (row.key.startsWith("record/")) knownWorkspaceIds.add(row.key.slice("record/".length));
  }

  // Re-register durable SSH/WSL worlds (lazy: nothing connects until a workspace uses one).
  await restoreExecutionWorlds({ getService, systemCaller: SYSTEM_CALLER, registry: executionWorlds, secrets, containmentConfig });

  // J-CONTEXT-BUDGET: the billing ledger backs every ordinary-session dispatch with a durable
  // reservation and enforces the operator's spending ceilings. Prices and protocol resolve from
  // the registry's current configuration at dispatch time, never from run input.
  const registry = new ProviderRegistry(runtime.kernel, bindings.modelGenerate.semanticRef, {
    getService: () => runtime.service,
    systemCaller: LOCAL_OPERATOR,
    prices: () => registry.current?.prices ?? null,
    protocol: () => registry.current?.protocol,
  });
  await runtime.kernel.mount(
    workspaceSelectComponent({
      getService,
      systemCaller: SYSTEM_CALLER,
      getKnownWorkspaceIds: () => knownWorkspaceIds,
      noteKnownWorkspace: (workspaceId) => {
        knownWorkspaceIds.add(workspaceId);
      },
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
    | { readonly providerId: string; readonly baseURL: string; readonly protocol: "openai-compatible"; readonly model: string; readonly prices?: { inputUsdPerMillion: number; outputUsdPerMillion: number } }
    | undefined;
  if (currentModelConfig) {
    await registry.swap(
      { providerId: currentModelConfig.providerId, baseURL: currentModelConfig.baseURL, protocol: currentModelConfig.protocol, model: currentModelConfig.model, ...(currentModelConfig.prices ? { prices: currentModelConfig.prices } : {}) },
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

  // J-CONTEXT-BUDGET: reconcile reservations whose owner died between reservation and outcome.
  // Committed invocation evidence settles them; anything unresolvable books conservatively as
  // unknown — never zero, never blindly repeated. Reconciliation failure never blocks boot: the
  // reserved entries themselves fail closed until a later reconciliation resolves them.
  try {
    const reconciled = await reconcileBilling(runtime.service, LOCAL_OPERATOR, runInvocationInspector(runtime.service, LOCAL_OPERATOR));
    if (reconciled.settled + reconciled.released + reconciled.unknown > 0) {
      console.warn(`[cognate-workbench] billing: reconciled ${reconciled.settled} settled, ${reconciled.released} released, ${reconciled.unknown} unknown reservation(s)`);
    }
  } catch (error) {
    console.warn(`[cognate-workbench] billing: boot reconciliation failed (${error instanceof Error ? error.message : String(error)}); interrupted reservations stay fail-closed`);
  }

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
  // T8 (J-AUTH-SESSION): the production posture resolves every request against the durable session
  // ledger — a server-issued, revocable credential bound to one identity and tenant. The legacy
  // client-claimed dev format is armed only behind the explicit devAuth opt-in (tests); an armed
  // dev posture ALSO accepts sessions so the browser entry (always session-tokened) keeps working.
  const devAuthArmed = options.devAuth ?? parseDevAuth(process.env.COGNATE_DEV_AUTH);
  const sessionAuth = createSessionAuthenticator(governedService, SYSTEM_CALLER);
  const authenticate: (headers: Headers) => Promise<Caller | undefined> | Caller | undefined = devAuthArmed
    ? (headers) => {
        const dev = devTokenAuthenticator(headers);
        return dev !== undefined ? dev : sessionAuth(/^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1]?.trim() ?? "");
      }
    : (headers) => sessionAuth(/^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1]?.trim() ?? "");
  if (devAuthArmed) {
    console.warn("[cognate-workbench] dev auth ARMED: client-claimed bearer identities are trusted; never use this posture in production");
  }
  registerRuntimeService(connectRouter, governedService, { authenticate, maxJsonDepth: 32 });
  const connectHandlersByPath = new Map<string, (req: Request) => Promise<Response>>();
  for (const uHandler of connectRouter.handlers) {
    connectHandlersByPath.set(uHandler.requestPath, (request) => createFetchHandler(uHandler, { httpVersion: "1.1" })(request).then(response => {
      // T8: the Connect API's own responses carry the hardening headers too — the review found
      // they were only on the hand-served routes. The body (including server streams) passes
      // through untouched; only headers are added.
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries({
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
      })) headers.set(name, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }));
  }

  const appDir = fileURLToPath(new URL("..", import.meta.url));
  const generatedDir = join(appDir, ".generated");
  await mkdir(generatedDir, { recursive: true });
  const entryPath = join(generatedDir, "entry.tsx");
  await writeFile(entryPath, BROWSER_ENTRY_TEMPLATE({ tenant: LOCAL_OPERATOR.tenant, actorId: LOCAL_OPERATOR.actor.id }, operatorSession.token));
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
  // T8 deployment hardening: every response carries the browser hardening headers (the Connect
  // API replies with application/json content-type, which is not CORS-safelisted, so a hostile page
  // cannot make the browser send a credentialed preflightable request that would execute; no CORS
  // headers are ever emitted). The body ceiling bounds request sizes at the socket layer; the
  // Connect protocol's own 32-level JSON depth limit bounds structure.
  const hardened = (headers: Record<string, string> = {}): Record<string, string> => ({
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    ...headers,
  });
  const server = Bun.serve({
    port: options.port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    maxRequestBodySize: 64 * 1024 * 1024,
    async fetch(request) {
      const refusal = loopbackRefusal(request.headers);
      if (refusal) return new Response(refusal.reason, { status: refusal.status, headers: hardened() });
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return Response.json({ ok: true, semantic: { objects: domain.projection.objects.length, digest: domain.projection.source.digest }, execution: { posture: executionPosture, linuxContainmentConfigured: containmentConfig !== undefined } }, { headers: hardened() });
      }
      if (url.pathname.startsWith("/cognate.v1.RuntimeService/")) {
        const handler = connectHandlersByPath.get(url.pathname);
        return handler ? handler(request) : new Response("not found", { status: 404, headers: hardened() });
      }
      // The bundle is rebuilt at every boot, so the browser must never hold one across restarts —
      // no-store keeps a stale UI (with stale handlers) from surviving a harness restart.
      if (url.pathname === "/app.js") return new Response(bundleJs, { headers: hardened({ "content-type": "text/javascript", "cache-control": "no-store" }) });
      if (url.pathname === "/astryx.css" && cssPaths[0]) return new Response(Bun.file(cssPaths[0]), { headers: hardened() });
      if (url.pathname === "/theme.css" && cssPaths[1]) return new Response(Bun.file(cssPaths[1]), { headers: hardened() });
      if (url.pathname === "/app.css") return new Response(appCss, { headers: hardened({ "content-type": "text/css", "cache-control": "no-store" }) });
      if (url.pathname === "/") return new Response(indexHtml(), { headers: hardened({
        "content-type": "text/html",
        "cache-control": "no-store",
        // The document never needs anything beyond its own origin, the two Google Fonts hosts and
        // inline styles (theme + component CSS-in-JS conventions); the boot-token-bearing bundle is
        // same-origin script and nothing else may execute.
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      }) });
      return new Response("not found", { status: 404, headers: hardened() });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    runtime: {...runtime,service:governedService},
    executionPosture,
    /** T8: this boot's browser session token — the test seam for session-authenticated HTTP.
     *  In the real browser it never leaves the generated entry; production never logs it. */
    operatorSessionToken: operatorSession.token,
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
  console.log(`[cognate-workbench] auth: durable session posture (browser entry holds this boot's revocable session); dev auth is ${parseDevAuth(process.env.COGNATE_DEV_AUTH) ? "ARMED (test/dev only)" : "off"}`);
  if (app.executionPosture === "contained") {
    console.log(`[cognate-workbench] execution: contained — agent commands and writes run only in Linux-contained or explicitly connected remote workspaces; local workspaces are read-only to agents (${EXECUTION_POSTURE_ENV}=uncontained-local to opt out)`);
  } else {
    console.warn(`[cognate-workbench] execution: UNCONTAINED LOCAL — agents run commands and write files on this host as this user; path checks are not a sandbox (${EXECUTION_POSTURE_ENV}=uncontained-local)`);
  }
}
