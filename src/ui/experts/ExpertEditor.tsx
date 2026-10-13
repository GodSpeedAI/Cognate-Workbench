// Focused Expert identity editor for specialization, route, tools and context limits.
// Serves J-EXPERT-CREATE while keeping credentials in the existing provider settings flow.
import { useState } from "react";
import type { FormEvent } from "react";
import type { ModelConfig } from "../../components/providerRegistry.ts";
import { EXPERT_TOOLS, type Expert, type ExpertTool } from "../../experts/types.ts";

const TOOL_LABELS: Readonly<Record<ExpertTool, string>> = {
  read: "Read files",
  edit: "Edit files",
  bash: "Run shell commands",
  run_code: "Run code",
  team_delegate: "Delegate to a Specialist",
  team_message: "Send addressed messages",
  expert_memory_read: "Read scoped memory",
  expert_memory_write: "Write scoped memory",
  expert_return: "Return result, abstain or decline",
};

export interface ExpertDraft {
  readonly name: string;
  readonly specialization: string;
  readonly instructions: string;
  readonly route: ModelConfig | null;
  readonly tools: ExpertTool[];
  readonly contextBudget: number;
  readonly maxSteps: number;
}

export function ExpertEditor({ initial, copying = false, defaultRoute, routes, busy, onCancel, onSave, onOpenSettings }: {
  readonly initial: Expert | undefined;
  readonly copying?: boolean;
  readonly defaultRoute: ModelConfig | undefined;
  readonly routes: readonly ModelConfig[];
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (draft: ExpertDraft) => void;
  readonly onOpenSettings: () => void;
}) {
  const [name, setName] = useState(initial ? (copying ? `${initial.name} copy` : initial.name) : "");
  const [specialization, setSpecialization] = useState(initial?.definition.specialization ?? "");
  const [instructions, setInstructions] = useState(initial?.definition.instructions ?? "");
  const [route, setRoute] = useState<ModelConfig | null>(initial?.definition.route ?? null);
  const [inheritDefault, setInheritDefault] = useState(!initial?.definition.route);
  const [tools, setTools] = useState<ExpertTool[]>(initial?.definition.tools ?? ["read"]);
  const [contextBudget, setContextBudget] = useState(initial?.definition.contextBudget ?? 16000);
  const [maxSteps, setMaxSteps] = useState(initial?.definition.maxSteps ?? 12);

  const toggleTool = (tool: ExpertTool, checked: boolean) => setTools((current) => checked ? [...new Set([...current, tool])] : current.filter((value) => value !== tool));
  const selectRoute = (providerId: string) => {
    if (providerId === "inherit") { setInheritDefault(true); setRoute(null); return; }
    if (providerId === "manual") { setInheritDefault(false); setRoute({ providerId: "", baseURL: "", protocol: "openai-compatible", model: "" }); return; }
    const selected = routes.find((candidate) => candidate.providerId === providerId) ?? (defaultRoute?.providerId === providerId ? defaultRoute : undefined);
    if (selected) { setInheritDefault(false); setRoute({ ...selected }); }
  };
  const routeOption = inheritDefault ? "inherit" : route && [...routes, ...(defaultRoute ? [defaultRoute] : [])].some((candidate) => candidate.providerId === route.providerId && candidate.baseURL === route.baseURL && candidate.protocol === route.protocol && candidate.model === route.model) ? route.providerId : "manual";
  const effectiveRoute = inheritDefault ? null : route;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ name: name.trim(), specialization: specialization.trim(), instructions: instructions.trim(), route: effectiveRoute, tools, contextBudget, maxSteps });
  };

  return <section className="experts-editor" aria-labelledby="expert-editor-heading"><header className="experts-section-head"><div><p className="experts-eyebrow">Expert definition</p><h2 id="expert-editor-heading">{copying ? "Copy Expert" : initial ? "Edit Expert" : "Create Expert"}</h2><p>Identity and configuration persist across runs. Memory remains scoped to this Expert.</p></div></header>
    <form className="experts-form" onSubmit={submit}>
      <label htmlFor="expert-name">Name<input id="expert-name" required maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)} /></label>
      <label htmlFor="expert-specialization">Specialization<input id="expert-specialization" required maxLength={500} value={specialization} onChange={(event) => setSpecialization(event.currentTarget.value)} /></label>
      <label htmlFor="expert-instructions">Instructions<textarea id="expert-instructions" required rows={5} value={instructions} onChange={(event) => setInstructions(event.currentTarget.value)} /></label>
      <fieldset><legend>Model route</legend>
        <label htmlFor="expert-route-select">Configured provider<select id="expert-route-select" value={routeOption} onChange={(event) => selectRoute(event.currentTarget.value)}>
          <option value="inherit">Use Workbench default{defaultRoute ? ` (${defaultRoute.providerId} · ${defaultRoute.model})` : " (not configured)"}</option>
          {routes.map((candidate) => <option key={`${candidate.providerId}:${candidate.model}`} value={candidate.providerId}>{candidate.providerId} · {candidate.model}</option>)}
          {defaultRoute && !routes.some((candidate) => candidate.providerId === defaultRoute.providerId) && <option value={defaultRoute.providerId}>{defaultRoute.providerId} · {defaultRoute.model}</option>}
          <option value="manual">Enter a route</option>
        </select></label>
        {!inheritDefault && route && <div className="experts-route-fields">
          <label htmlFor="expert-route-provider">Provider ID<input id="expert-route-provider" required value={route.providerId} onChange={(event) => setRoute({ ...route, providerId: event.currentTarget.value })} /></label>
          <label htmlFor="expert-route-url">Base URL<input id="expert-route-url" required type="url" value={route.baseURL} onChange={(event) => setRoute({ ...route, baseURL: event.currentTarget.value })} /></label>
          <label htmlFor="expert-route-protocol">Protocol<select id="expert-route-protocol" value={route.protocol} onChange={(event) => setRoute({ ...route, protocol: event.currentTarget.value as ModelConfig["protocol"] })}><option value="openai-compatible">OpenAI compatible</option><option value="openai-completions">OpenAI completions</option><option value="openai-responses">OpenAI responses</option><option value="anthropic-messages">Anthropic messages</option></select></label>
          <label htmlFor="expert-route-model">Model<input id="expert-route-model" required value={route.model} onChange={(event) => setRoute({ ...route, model: event.currentTarget.value })} /></label>
        </div>}
        {!inheritDefault && !route && <div className="experts-route-fields"><label htmlFor="expert-route-provider">Provider ID<input id="expert-route-provider" required value="" onChange={(event) => setRoute({ providerId: event.currentTarget.value, baseURL: "", protocol: "openai-compatible", model: "" })} /></label></div>}
        <p className="experts-muted">Provider credentials stay in Settings. Route edits apply to new runs.</p><button type="button" className="global-panel-btn" onClick={onOpenSettings}>Configure provider and credentials in Settings</button>
      </fieldset>
      <fieldset><legend>Allowed capabilities</legend><div className="experts-tool-list">{EXPERT_TOOLS.map((tool) => <label key={tool}><input type="checkbox" checked={tools.includes(tool)} onChange={(event) => toggleTool(tool, event.currentTarget.checked)} />{TOOL_LABELS[tool]}</label>)}</div></fieldset>
      <div className="experts-route-fields"><label htmlFor="expert-context-budget">Context budget<input id="expert-context-budget" type="number" min={2000} max={64000} step={1000} value={contextBudget} onChange={(event) => setContextBudget(Number(event.currentTarget.value))} /></label><label htmlFor="expert-max-steps">Maximum steps per run<input id="expert-max-steps" type="number" min={1} max={20} value={maxSteps} onChange={(event) => setMaxSteps(Number(event.currentTarget.value))} /></label></div>
      <p className="experts-muted">A Team membership may further restrict these capabilities. It cannot add permissions.</p>
      <div className="experts-actions"><button type="button" className="global-panel-btn" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="global-panel-btn primary" disabled={busy || !name.trim() || !specialization.trim() || !instructions.trim()}>{busy ? "Saving…" : copying ? "Copy Expert" : initial ? "Save Expert" : "Create Expert"}</button></div>
    </form>
  </section>;
}
