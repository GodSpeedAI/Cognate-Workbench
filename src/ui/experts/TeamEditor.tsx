// Small inline Team editor for creating, renaming and copying governed collaboration spaces.
// Serves J-TEAM-CREATE while activation and membership remain explicit later steps.
import { useState } from "react";
import { EXPERT_TOOLS, type ExpertTool, type Team } from "../../experts/types.ts";

export interface TeamDraft {
  readonly name: string;
  readonly tools: ExpertTool[];
  readonly limits: Team["limits"];
}

export function TeamEditor({ initial, busy, onCancel, onSave }: {
  readonly initial: Team | undefined;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (draft: TeamDraft) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [tools, setTools] = useState<ExpertTool[]>(initial?.tools ?? [...EXPERT_TOOLS]);
  const [limits, setLimits] = useState<Team["limits"]>(initial?.limits ?? { maxDepth: 2, maxAssignments: 12, maxUnread: 20, maxRounds: 8 });
  const toggleTool = (tool: ExpertTool, checked: boolean) => setTools((current) => checked ? [...new Set([...current, tool])] : current.filter((value) => value !== tool));
  return <section className="experts-editor" aria-labelledby="team-editor-heading"><header className="experts-section-head"><div><p className="experts-eyebrow">Team definition</p><h2 id="team-editor-heading">{initial ? "Configure Team" : "Create Team"}</h2><p>A draft Team needs exactly one Orchestrator before it can run.</p></div></header>
    <form className="experts-form" onSubmit={(event) => { event.preventDefault(); onSave({ name: name.trim(), tools, limits }); }}>
      <label htmlFor="team-name">Team name<input id="team-name" required maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)} /></label>
      <fieldset><legend>Team capability ceiling</legend><p className="experts-muted">A Team can narrow each Expert’s tools. It cannot grant a tool missing from an Expert’s own allowlist.</p><div className="experts-tool-list">{EXPERT_TOOLS.map((tool) => <label key={tool}><input type="checkbox" checked={tools.includes(tool)} onChange={(event) => toggleTool(tool, event.currentTarget.checked)} />{tool.replaceAll("_", " ")}</label>)}</div></fieldset>
      <fieldset><legend>Coordination limits</legend><div className="experts-route-fields">
        <label htmlFor="team-max-depth">Maximum handoff depth<input id="team-max-depth" type="number" min={1} max={5} value={limits.maxDepth} onChange={(event) => setLimits({ ...limits, maxDepth: Number(event.currentTarget.value) })} /></label>
        <label htmlFor="team-max-assignments">Maximum assignments<input id="team-max-assignments" type="number" min={1} max={30} value={limits.maxAssignments} onChange={(event) => setLimits({ ...limits, maxAssignments: Number(event.currentTarget.value) })} /></label>
        <label htmlFor="team-max-unread">Maximum unread work<input id="team-max-unread" type="number" min={1} max={100} value={limits.maxUnread} onChange={(event) => setLimits({ ...limits, maxUnread: Number(event.currentTarget.value) })} /></label>
        <label htmlFor="team-max-rounds">Maximum speaking rounds<input id="team-max-rounds" type="number" min={1} max={30} value={limits.maxRounds} onChange={(event) => setLimits({ ...limits, maxRounds: Number(event.currentTarget.value) })} /></label>
      </div></fieldset>
      <p className="experts-muted">After saving, add Experts as Specialists, designate one Orchestrator, then activate the Team.</p>
      <div className="experts-actions"><button type="button" className="global-panel-btn" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="global-panel-btn primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : initial ? "Save Team" : "Create draft Team"}</button></div>
    </form>
  </section>;
}
