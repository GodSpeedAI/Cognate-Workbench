// Experts and Teams roster, configuration and scoped conversations.
// Serves the proposed J-EXPERT-* and J-TEAM-* journeys through real Workbench capabilities.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useCognate, useContinuations, useProjection } from "@godspeedai/cognate-react";
import type { ModelConfig } from "../../components/providerRegistry.ts";
import { SurfaceView } from "../CognitiveFrame.tsx";
import { EXPERT_TOOLS, type Assignment, type Conversation, type Expert, type ExpertMemory, type ExpertState, type ExpertTool, type Team } from "../../experts/types.ts";
import { ExpertEditor } from "./ExpertEditor.tsx";
import { TeamEditor, type TeamDraft } from "./TeamEditor.tsx";

function currentValue<T>(rows: readonly { readonly key: string; readonly value: unknown }[] | undefined): T | undefined {
  const row = rows?.find((candidate) => candidate.key === "current" || candidate.key.endsWith("/current"));
  return row?.value as T | undefined;
}

function assignmentLabel(status: Assignment["status"]): string {
  switch (status) {
    case "queued": return "Queued";
    case "running": return "Running";
    case "waiting": return "Waiting";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    case "reconciliation-required": return "Needs reconciliation";
  }
}

export function ExpertsTeamsPanel({ workspaceId, onClose, onOpenNavigation, onOpenSettings }: { readonly workspaceId: string | undefined; readonly onClose: () => void; readonly onOpenNavigation: () => void; readonly onOpenSettings: () => void }) {
  const client = useCognate();
  const rows = useProjection("experts");
  const configRows = useProjection("model-config");
  const routeRows = useProjection("provider-routes");
  const state = currentValue<ExpertState>(rows);
  const configuredRoute = currentValue<ModelConfig>(configRows);
  const configuredRoutes = useMemo(() => (routeRows ?? []).map((row) => row.value as unknown as ModelConfig), [routeRows]);
  const seeded = useRef(false);
  const [selectedTeamId, setSelectedTeamId] = useState("cognate-team");
  const [selectedExpertId, setSelectedExpertId] = useState("product-manager");
  const [detailMode, setDetailMode] = useState<"team" | "expert">("team");
  const [pendingTeamSelection, setPendingTeamSelection] = useState<string>();
  const [pendingExpertSelection, setPendingExpertSelection] = useState<string>();
  const [editingTeamId, setEditingTeamId] = useState<string | undefined>();
  const [editingExpertId, setEditingExpertId] = useState<string | undefined>();
  const [editor, setEditor] = useState<"expert" | "team" | undefined>();
  const [copying, setCopying] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversationScope, setConversationScope] = useState<"solo" | "team" | "private-team">();
  const [conversationHistory, setConversationHistory] = useState<Conversation[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [privateRead, setPrivateRead] = useState<{ conversation: Conversation; messages: NonNullable<ExpertState["messages"][string]>[]; assignments: Assignment[] }>();
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<{ readonly kind: "status" | "error"; readonly text: string }>();
  const [busy, setBusy] = useState(false);

  const experts = useMemo(() => Object.values(state?.experts ?? {}).sort((a, b) => a.name.localeCompare(b.name)), [state]);
  const teams = useMemo(() => Object.values(state?.teams ?? {}).sort((a, b) => a.name.localeCompare(b.name)), [state]);
  const team = state?.teams[selectedTeamId];
  const expert = state?.experts[selectedExpertId];
  const projectedConversation = conversationId ? state?.conversations[conversationId] : undefined;
  const privateConversation = conversationScope === "private-team" && privateRead?.conversation.id === conversationId ? privateRead : undefined;
  const conversation = privateConversation?.conversation ?? projectedConversation;
  const messages = privateConversation
    ? privateConversation.messages
    : conversation ? conversation.messageIds.map((id) => state?.messages[id]).filter((row): row is NonNullable<typeof row> => Boolean(row)) : [];
  const projectedAssignments = useMemo(() => Object.values(state?.assignments ?? {})
    .filter((item) => conversation ? item.conversationId === conversation.id : false)
    .sort((a, b) => a.id.localeCompare(b.id)), [state, conversation]);
  const assignments = privateConversation ? privateConversation.assignments : projectedAssignments;

  const invoke = useCallback(async <T,>(capability: string, input: Record<string, unknown>): Promise<T> => {
    return await client.invoke(capability, { requestId: crypto.randomUUID(), ...input } as never) as T;
  }, [client]);

  const refreshHistory = useCallback(async (scope = conversationScope, expertId = expert?.id, teamId = team?.id) => {
    if (!scope || (scope === "team" && !teamId) || (scope !== "team" && !expertId)) {
      setConversationHistory([]);
      return;
    }
    setHistoryBusy(true);
    try {
      const result = await invoke<{ conversations: Conversation[] }>("expert.context", {
        list: true, scope,
        ...(scope === "team" ? { teamId } : { expertId }),
        ...(scope === "private-team" ? { teamId } : {}),
      });
      setConversationHistory(result.conversations);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setHistoryBusy(false);
    }
  }, [conversationScope, expert?.id, invoke, team?.id]);

  useEffect(() => {
    let stopped = false;
    if (!conversationScope) {
      setConversationHistory([]);
      setHistoryBusy(false);
      return;
    }
    const input = {
      list: true,
      scope: conversationScope,
      ...(conversationScope === "team" ? { teamId: team?.id } : { expertId: expert?.id }),
      ...(conversationScope === "private-team" ? { teamId: team?.id } : {}),
    };
    if ((conversationScope === "team" && !team?.id) || (conversationScope !== "team" && !expert?.id)) {
      setConversationHistory([]);
      setHistoryBusy(false);
      return;
    }
    setHistoryBusy(true);
    void invoke<{ conversations: Conversation[] }>("expert.context", input)
      .then((result) => { if (!stopped) setConversationHistory(result.conversations); })
      .catch((error: unknown) => { if (!stopped) setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) }); })
      .finally(() => { if (!stopped) setHistoryBusy(false); });
    return () => { stopped = true; };
  }, [conversationScope, expert?.id, invoke, team?.id]);

  useEffect(() => {
    if (rows === undefined || seeded.current || state) return;
    seeded.current = true;
    void invoke("experts.seed", {}).catch((error: unknown) => setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) }));
  }, [rows, state, invoke]);

  useEffect(() => {
    if (!state) return;
    if (pendingTeamSelection && state.teams[pendingTeamSelection]) {
      setSelectedTeamId(pendingTeamSelection);
      setDetailMode("team");
      setPendingTeamSelection(undefined);
    } else if (!pendingTeamSelection && !state.teams[selectedTeamId]) setSelectedTeamId(state.teams["cognate-team"] ? "cognate-team" : teams[0]?.id ?? "");
    if (pendingExpertSelection && state.experts[pendingExpertSelection]) {
      setSelectedExpertId(pendingExpertSelection);
      setDetailMode("expert");
      setPendingExpertSelection(undefined);
    } else if (!pendingExpertSelection && !state.experts[selectedExpertId]) setSelectedExpertId(state.experts["product-manager"] ? "product-manager" : experts[0]?.id ?? "");
  }, [state, teams, experts, selectedTeamId, selectedExpertId, pendingTeamSelection, pendingExpertSelection]);

  useEffect(() => {
    let stopped = false;
    if (!conversationScope) {
      setConversationHistory([]);
      return;
    }
    const input = {
      list: true,
      scope: conversationScope,
      ...(conversationScope === "team" ? { teamId: team?.id } : { expertId: expert?.id }),
      ...(conversationScope === "private-team" ? { teamId: team?.id } : {}),
    };
    if ((conversationScope === "team" && !team?.id) || (conversationScope !== "team" && !expert?.id)) {
      setConversationHistory([]);
      return;
    }
    setHistoryBusy(true);
    void invoke<{ conversations: Conversation[] }>("expert.context", input)
      .then((result) => { if (!stopped) setConversationHistory(result.conversations); })
      .catch((error: unknown) => { if (!stopped) setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) }); })
      .finally(() => { if (!stopped) setHistoryBusy(false); });
    return () => { stopped = true; };
  }, [conversationScope, expert?.id, invoke, team?.id]);

  useEffect(() => {
    if (conversationScope !== "private-team" || !conversationId) return;
    let stopped = false;
    const refresh = () => void invoke<{ conversation: Conversation; messages: NonNullable<ExpertState["messages"][string]>[]; assignments: Assignment[] }>("expert.context", { conversationId })
      .then((result) => { if (!stopped) setPrivateRead(result); })
      .catch((error: unknown) => { if (!stopped) setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) }); });
    refresh();
    const interval = setInterval(refresh, 1200);
    return () => { stopped = true; clearInterval(interval); };
  }, [conversationScope, conversationId, invoke]);

  const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      setNotice({ kind: "status", text: success });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }, []);

  const startConversation = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    const targetWorkspaceId = conversation?.workspaceId ?? workspaceId;
    if (!targetWorkspaceId || !text || busy) return;
    await run(async () => {
      if (conversationScope === "team" && team) {
        const result = await invoke<{ conversationId: string }>("team.converse", { teamId: team.id, ...(conversationId ? { conversationId } : {}), workspaceId: targetWorkspaceId, message: text });
        setConversationId(result.conversationId);
        setPrivateRead(undefined);
        await refreshHistory("team", undefined, team.id);
      } else if (expert && (conversationScope === "solo" || conversationScope === "private-team")) {
        const result = await invoke<{ conversationId: string }>("expert.converse", { expertId: expert.id, ...(conversationScope === "private-team" && team ? { teamId: team.id } : {}), ...(conversationId ? { conversationId } : {}), workspaceId: targetWorkspaceId, message: text });
        setConversationId(result.conversationId);
        if (conversationScope !== "private-team") setPrivateRead(undefined);
        await refreshHistory(conversationScope, expert.id, conversationScope === "private-team" ? team?.id : undefined);
      }
      setMessage("");
    }, "Message sent. Run and handoff state will appear as the projection updates.");
  };

  const createExpert = async (draft: { name: string; specialization: string; instructions: string; route: ModelConfig | null; tools: ExpertTool[]; contextBudget: number; maxSteps: number }) => {
    await run(async () => {
      let expertId = editingExpertId;
      if (copying && editingExpertId) expertId = (await invoke<{ expertId: string }>("expert.copy", { expertId: editingExpertId, name: draft.name })).expertId;
      const saved = await invoke<{ expertId: string }>("expert.save", { ...draft, ...(expertId ? { expertId } : {}) });
      setPendingExpertSelection(saved.expertId);
      setEditor(undefined);
      setCopying(false);
      setEditingExpertId(undefined);
    }, copying ? "Expert copied." : editingExpertId ? "Expert saved." : "Expert created.");
  };

  const saveTeam = async (draft: TeamDraft) => {
    await run(async () => {
      let teamId = editingTeamId;
      if (copying && editingTeamId) teamId = (await invoke<{ teamId: string }>("team.copy", { teamId: editingTeamId, name: draft.name })).teamId;
      const saved = await invoke<{ teamId: string }>("team.save", { ...(teamId ? { teamId } : {}), ...draft });
      setPendingTeamSelection(saved.teamId);
      setEditor(undefined);
      setCopying(false);
      setEditingTeamId(undefined);
    }, copying ? "Team copied." : editingTeamId ? "Team saved." : "Team created as a draft.");
  };

  const toggleMember = async (expertId: string, remove: boolean) => {
    if (!team) return;
    await run(() => invoke("team.member", { teamId: team.id, expertId, ...(remove ? { remove: true } : {}) }), remove ? "Member removed." : "Specialist added.");
  };

  const visibleTeam = team;
  const selectedConversation: Conversation | undefined = conversation;
  return (
    <section className="experts-panel" aria-label="Experts and Teams">
      <header className="experts-panel-head">
        <button type="button" className="global-panel-btn experts-nav-toggle" onClick={onOpenNavigation}>Navigation</button>
        <div>
          <p className="experts-eyebrow">Cognate Workbench</p>
          <h1>Experts &amp; Teams</h1>
          <p>Persistent Expert identities. Governed Team work. Each run remains inspectable.</p>
        </div>
        <button type="button" className="global-panel-btn" onClick={onClose}>Back to conversation</button>
      </header>

      {notice && <p className={notice.kind === "error" ? "experts-notice error" : "experts-notice"} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}

      {editor === "expert" ? (
        <ExpertEditor initial={editingExpertId ? state?.experts[editingExpertId] : undefined} copying={copying} defaultRoute={configuredRoute} routes={configuredRoutes} busy={busy} onCancel={() => { setEditor(undefined); setCopying(false); setEditingExpertId(undefined); }} onSave={(draft) => void createExpert(draft)} onOpenSettings={onOpenSettings} />
      ) : editor === "team" ? (
        <TeamEditor initial={editingTeamId ? { ...state?.teams[editingTeamId]!, ...(copying ? { name: `${state?.teams[editingTeamId]?.name ?? "Team"} copy` } : {}) } : undefined} busy={busy} onCancel={() => { setEditor(undefined); setCopying(false); setEditingTeamId(undefined); }} onSave={(draft) => void saveTeam(draft)} />
      ) : (
        <div className="experts-layout">
          <aside className="experts-roster" aria-label="Roster">
            <button type="button" className="global-panel-btn experts-jump-detail" onClick={() => document.getElementById("experts-selected-detail")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Jump to selected details</button>
            <div className="experts-roster-heading"><h2>Teams</h2><button type="button" className="global-panel-btn" onClick={() => { setEditingTeamId(undefined); setEditor("team"); setCopying(false); }}>New Team</button></div>
            {teams.length === 0 ? <p className="experts-empty">No Teams yet. Create a Team to define its members and sole Orchestrator.</p> : (
              <ul className="experts-list" aria-label="Teams">
                  {teams.map((item) => <li key={item.id}><button type="button" className={item.id === selectedTeamId && detailMode === "team" ? "experts-row selected" : "experts-row"} aria-pressed={item.id === selectedTeamId && detailMode === "team"} onClick={() => { setSelectedTeamId(item.id); setDetailMode("team"); setConversationId(undefined); setConversationScope(undefined); }}><span>{item.name}</span><small>{item.lifecycle === "active" ? "Active" : item.lifecycle === "draft" ? "Draft" : "Inactive"}</small></button></li>)}
              </ul>
            )}
            <div className="experts-roster-heading"><h2>Experts</h2><button type="button" className="global-panel-btn" onClick={() => { setEditingExpertId(undefined); setEditor("expert"); setCopying(false); }}>New Expert</button></div>
            {experts.length === 0 ? <p className="experts-empty">No Experts yet. Create an Expert identity to start a solo conversation or add it to a Team.</p> : (
              <ul className="experts-list" aria-label="Experts">
                {experts.map((item) => {
                  const membership = team?.members.find((member) => member.expertId === item.id);
                  return <li key={item.id}><button type="button" className={item.id === selectedExpertId && detailMode === "expert" ? "experts-row selected" : "experts-row"} aria-pressed={item.id === selectedExpertId && detailMode === "expert"} onClick={() => { setSelectedExpertId(item.id); setDetailMode("expert"); setConversationId(undefined); setConversationScope(undefined); }}><span>{item.name}</span><small>{membership?.role === "orchestrator" ? "Orchestrator" : membership?.role === "specialist" ? "Specialist" : item.lifecycle === "archived" ? "Archived" : "Expert"}</small></button></li>;
                })}
              </ul>
            )}
          </aside>

          <div className="experts-detail" id="experts-selected-detail">
            {visibleTeam && detailMode === "team" ? (
              <section aria-labelledby="experts-team-heading" className="experts-section">
                <div className="experts-section-head"><div><p className="experts-eyebrow">Team</p><h2 id="experts-team-heading">{visibleTeam.name}</h2><p>{visibleTeam.lifecycle === "active" ? "Accepts work through its Orchestrator." : "Draft Team. Select one Orchestrator before activation."}</p></div>
                  <div className="experts-actions"><button type="button" className="global-panel-btn primary" disabled={busy || !workspaceId || visibleTeam.lifecycle !== "active"} onClick={() => { setConversationScope("team"); setConversationId(undefined); }}>Open Team conversation</button><button type="button" className="global-panel-btn" onClick={() => { setEditingTeamId(visibleTeam.id); setEditor("team"); setCopying(true); }}>Copy Team</button><button type="button" className="global-panel-btn" onClick={() => { setEditingTeamId(visibleTeam.id); setEditor("team"); setCopying(false); }}>Edit Team</button></div>
                </div>
                <ul className="experts-members" aria-label="Team members">
                  {visibleTeam.members.map((member) => {
                    const person = state?.experts[member.expertId];
                    return <li key={member.expertId}><button type="button" className="experts-member-name" onClick={() => { setSelectedExpertId(member.expertId); setDetailMode("expert"); }}>{person?.name ?? member.expertId}</button><span>{member.role === "orchestrator" ? "Orchestrator" : "Specialist"}</span>
                      <button type="button" className="global-panel-btn" disabled={busy || !workspaceId || !person} onClick={() => { setSelectedExpertId(member.expertId); setConversationScope("private-team"); setConversationId(undefined); }}>Private conversation</button>
                      {member.role !== "orchestrator" && <button type="button" className="global-panel-btn" disabled={busy} onClick={() => void run(() => invoke("team.replaceOrchestrator", { teamId: visibleTeam.id, expertId: member.expertId }), `${person?.name ?? "Expert"} is now the Orchestrator.`)}>Make Orchestrator</button>}
                      {member.role === "specialist" && <button type="button" className="global-panel-btn" disabled={busy} onClick={() => void toggleMember(member.expertId, true)}>Remove</button>}
                    </li>;
                  })}
                </ul>
                {visibleTeam.members.length === 0 && <p className="experts-empty">This draft has no members. Add an Expert, then choose its Orchestrator.</p>}
                {visibleTeam.members.length < experts.length && <label className="experts-add-member">Add Specialist
                  <select aria-label="Add Specialist" value="" disabled={busy} onChange={(event) => { const id = event.currentTarget.value; if (id) void toggleMember(id, false); }}><option value="">Choose an Expert</option>{experts.filter((person) => !visibleTeam.members.some((member) => member.expertId === person.id)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
                </label>}
                {visibleTeam.lifecycle === "draft" && visibleTeam.members.filter((member) => member.role === "orchestrator").length !== 1 && <p className="experts-blocker" role="status">Choose exactly one Orchestrator before activating this Team.</p>}
                <div className="experts-actions"><button type="button" className="global-panel-btn" disabled={busy || visibleTeam.members.filter((member) => member.role === "orchestrator").length !== 1} onClick={() => void run(() => invoke("team.activate", { teamId: visibleTeam.id, active: visibleTeam.lifecycle !== "active" }), visibleTeam.lifecycle === "active" ? "Team deactivated." : "Team activated.")}>{visibleTeam.lifecycle === "active" ? "Deactivate Team" : "Activate Team"}</button></div>
                {!workspaceId && <p className="experts-muted">Choose a workspace before starting a conversation.</p>}
              </section>
            ) : expert && detailMode === "expert" ? (
              <section aria-labelledby="experts-person-heading" className="experts-section">
                <div className="experts-section-head"><div><p className="experts-eyebrow">Expert identity</p><h2 id="experts-person-heading">{expert.name}</h2><p>{expert.definition.specialization}</p></div><div className="experts-actions"><button type="button" className="global-panel-btn primary" disabled={busy || !workspaceId || expert.lifecycle !== "active"} onClick={() => { setConversationScope("solo"); setConversationId(undefined); }}>Open solo conversation</button><button type="button" className="global-panel-btn" onClick={() => { setEditingExpertId(expert.id); setEditor("expert"); setCopying(true); }}>Copy Expert</button><button type="button" className="global-panel-btn" onClick={() => { setEditingExpertId(expert.id); setEditor("expert"); setCopying(false); }}>Edit</button><button type="button" className="global-panel-btn" disabled={busy || expert.lifecycle === "archived"} onClick={() => void run(() => invoke("expert.archive", { expertId: expert.id }), "Expert archived. Existing history remains available.")}>Archive</button></div></div>
                <p className="experts-config-line"><strong>Tools</strong> {expert.definition.tools.length ? expert.definition.tools.join(", ") : "None"}</p>
                <p className="experts-config-line"><strong>Model</strong> {expert.definition.route ? `${expert.definition.route.providerId} · ${expert.definition.route.model}` : configuredRoute ? `${configuredRoute.providerId} · ${configuredRoute.model} (default)` : "No model route configured"}</p>
                <p className="experts-config-line"><strong>Context</strong> {expert.definition.contextBudget} tokens · up to {expert.definition.maxSteps} steps</p>
                <ExpertMemoryPanel expert={expert} teams={teams} assignments={Object.values(state?.assignments ?? {})} onInvoke={invoke} />
                {expert.lifecycle === "archived" && <p className="experts-muted">Archived Experts cannot start new runs.</p>}
              </section>
            ) : <p className="experts-empty">Choose a Team or Expert to inspect its membership and work.</p>}

            {conversationScope && (
              <ConversationPane scope={conversationScope} conversation={selectedConversation} history={conversationHistory} historyBusy={historyBusy} onSelectConversation={setConversationId} messages={messages} assignments={assignments} experts={state?.experts ?? {}} specialists={team?.members.filter((member) => member.role === "specialist") ?? []} value={message} busy={busy} workspaceAvailable={Boolean(selectedConversation?.workspaceId ?? workspaceId)} activeWorkspaceId={workspaceId} onChange={setMessage} onMention={(id) => { const person = state?.experts[id]; if (person) setMessage((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}@${person.name} `); }} onSubmit={startConversation} onCancel={(id) => void run(() => invoke("team.cancel", { assignmentId: id }), "Cancellation requested.")} onRetry={(id) => void run(() => invoke("team.retry", { assignmentId: id }), "Retry queued.")} onReview={(assignmentId, verdict, rationale, evidence) => void run(() => invoke("team.review", { assignmentId, verdict, rationale, evidence }), "Human review recorded.")} onSettle={(assignmentId, decision, rationale) => void run(() => invoke("team.settle", { assignmentId, decision, rationale }), decision === "accepted" ? "Human acceptance recorded." : "Revision requested.")} onResolveEffect={(assignmentId, toolCallId, outcome, reason) => void run(() => invoke("expert.effect.resolve", { assignmentId, toolCallId, outcome, reason }), "Effect reconciliation recorded by the operator.")} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ConversationPane({ scope, conversation, history, historyBusy, onSelectConversation, messages, assignments, experts, specialists, value, busy, workspaceAvailable, activeWorkspaceId, onChange, onMention, onSubmit, onCancel, onRetry, onReview, onSettle, onResolveEffect }: {
  readonly scope: "solo" | "team" | "private-team";
  readonly conversation: Conversation | undefined;
  readonly history: readonly Conversation[];
  readonly historyBusy: boolean;
  readonly onSelectConversation: (id: string | undefined) => void;
  readonly messages: readonly NonNullable<ExpertState["messages"][string]>[];
  readonly assignments: readonly Assignment[];
  readonly experts: Readonly<Record<string, Expert>>;
  readonly specialists: readonly { readonly expertId: string }[];
  readonly value: string;
  readonly busy: boolean;
  readonly workspaceAvailable: boolean;
  readonly activeWorkspaceId: string | undefined;
  readonly onChange: (value: string) => void;
  readonly onMention: (expertId: string) => void;
  readonly onSubmit: (event: FormEvent) => void;
  readonly onCancel: (id: string) => void;
  readonly onRetry: (id: string) => void;
  readonly onReview: (id: string, verdict: "revision" | "accept" | "escalate", rationale: string, evidence: string[]) => void;
  readonly onSettle: (id: string, decision: "accepted" | "revision", rationale: string) => void;
  readonly onResolveEffect: (assignmentId: string, toolCallId: string, outcome: "succeeded" | "failed", reason: string) => void;
}) {
  const traces = useExpertRunTraces(assignments);
  const assignmentsById = new Map(assignments.map((item) => [item.id, item]));
  const rootFor = (assignment: Assignment): Assignment | undefined => {
    let root = assignment;
    while (root.parentId && assignmentsById.has(root.parentId)) root = assignmentsById.get(root.parentId)!;
    return root.id === assignment.id ? undefined : root;
  };
  return <section className="experts-conversation" aria-labelledby="experts-conversation-heading">
    <div className="experts-section-head"><div><p className="experts-eyebrow">{scope === "solo" ? "Solo Expert" : scope === "private-team" ? "Private Expert-in-Team" : "Team conversation"}</p><h2 id="experts-conversation-heading">{conversation?.title ?? "New conversation"}</h2><p>{conversation ? `Conversation ${conversation.id}` : "Your first message starts a durable, scoped conversation."}</p></div></div>
    {conversation && activeWorkspaceId !== conversation.workspaceId && <p className="experts-muted">Continuing in the original workspace ({conversation.workspaceId}).</p>}
    <label className="experts-history">Conversation history <select aria-label="Conversation history" value={conversation?.id ?? ""} disabled={historyBusy} onChange={(event) => onSelectConversation(event.currentTarget.value || undefined)}><option value="">New conversation</option>{history.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.messageIds.length} messages</option>)}</select></label>
    <ol className="experts-transcript" aria-label="Conversation messages">
      {messages.map((item) => <li key={item.id}><strong>{item.sender.kind === "human" ? "You" : experts[item.sender.id]?.name ?? item.sender.id}</strong><p>{item.text}</p></li>)}
      {messages.length === 0 && <li className="experts-empty">No messages yet. Send a task to start this conversation.</li>}
    </ol>
    {assignments.length > 0 && <section className="experts-assignments" aria-labelledby="experts-assignments-heading"><h3 id="experts-assignments-heading">Assignments</h3><ol>{assignments.map((assignment) => <li key={assignment.id} id={`assignment-${assignment.id}`}><div><strong>{experts[assignment.expertId]?.name ?? assignment.expertId}</strong><span className="experts-status">{assignmentLabel(assignment.status)}</span><p>{assignment.purpose}</p></div>
      {assignment.handoff && <details><summary>Handoff and evidence</summary><p>{assignment.handoff.output || "No output returned."}</p>{assignment.handoff.evidence.length > 0 && <ul>{assignment.handoff.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}{assignment.handoff.uncertainties.length > 0 && <p>Uncertainty: {assignment.handoff.uncertainties.join("; ")}</p>}</details>}
      {assignment.handoff && <details><summary>Returned artifacts, failures and follow-up</summary><p><strong>Disposition</strong> {assignment.handoff.disposition}</p>{assignment.handoff.artifacts.length > 0 && <ul>{assignment.handoff.artifacts.map((artifact) => <li key={artifact}><ArtifactDownload artifactId={artifact} /></li>)}</ul>}{assignment.handoff.observedFailures?.length ? <p><strong>Observed tool failures</strong> {assignment.handoff.observedFailures.join("; ")} <span>These are observations; a later check may show recovery.</span></p> : null}{assignment.handoff.failures.length > 0 && <p role="alert"><strong>Unresolved failures</strong> {assignment.handoff.failures.join("; ")}</p>}{assignment.handoff.followUp.length > 0 && <p><strong>Follow-up</strong> {assignment.handoff.followUp.join("; ")}</p>}</details>}
      <AssignmentTrace runId={assignment.runId ?? undefined} entries={assignment.runId ? traces[assignment.runId] ?? [] : []} />
      <AssignmentEffectResolution assignment={assignment} busy={busy} onResolve={(toolCallId, outcome, reason) => onResolveEffect(assignment.id, toolCallId, outcome, reason)} />
      <AssignmentApproval assignment={assignment} busy={busy} />
      {assignment.handoff && <AssignmentSettlement assignment={assignment} assignments={assignments} experts={experts} traces={traces} busy={busy} onReview={(verdict, rationale, evidence) => onReview(assignment.id, verdict, rationale, evidence)} onSettle={(decision, rationale) => onSettle(assignment.id, decision, rationale)} />}
      {["failed", "cancelled"].includes(assignment.status) ? assignment.parentId ? <><p className="experts-muted">Retry is controlled by the root objective. Reconcile this Specialist result with the Orchestrator, then retry the root if it remains failed or cancelled.</p>{rootFor(assignment) && <button type="button" className="global-panel-btn" onClick={() => document.getElementById(`assignment-${rootFor(assignment)!.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>Review root objective</button>}</> : <button type="button" className="global-panel-btn" disabled={busy} onClick={() => onRetry(assignment.id)}>Retry assignment</button> : null}{["queued", "running", "waiting"].includes(assignment.status) && <button type="button" className="global-panel-btn" disabled={busy} onClick={() => onCancel(assignment.id)}>Cancel assignment</button>}
    </li>)}</ol></section>}
    <form className="experts-composer" onSubmit={onSubmit}><label htmlFor="experts-message">Message the {scope === "team" ? "Team" : "Expert"}</label><textarea id="experts-message" value={value} onChange={(event) => onChange(event.currentTarget.value)} rows={3} placeholder="Describe the work or ask a question" />
      {scope === "team" && specialists.length > 0 && <label htmlFor="experts-mention">Mention a Specialist <select id="experts-mention" value="" onChange={(event) => { if (event.currentTarget.value) onMention(event.currentTarget.value); }}><option value="">Add a name to your message</option>{specialists.map((member) => <option key={member.expertId} value={member.expertId}>{experts[member.expertId]?.name ?? member.expertId}</option>)}</select><small>Mentions guide the Orchestrator; it remains responsible for authorized delegation.</small></label>}
      {!workspaceAvailable && <p>Choose a workspace to start a conversation.</p>}
      <button type="submit" className="global-panel-btn primary" disabled={busy || !workspaceAvailable || value.trim().length === 0}>{busy ? "Sending…" : "Send message"}</button></form>
  </section>;
}

export function AssignmentSettlement({ assignment, assignments, experts, traces, busy, onReview, onSettle }: {
  readonly assignment: Assignment;
  readonly assignments: readonly Assignment[];
  readonly experts: Readonly<Record<string, Expert>>;
  readonly traces: Readonly<Record<string, readonly ExpertTraceEntry[]>>;
  readonly busy: boolean;
  readonly onReview: (verdict: "revision" | "accept" | "escalate", rationale: string, evidence: string[]) => void;
  readonly onSettle: (decision: "accepted" | "revision", rationale: string) => void;
}) {
  const [verdict, setVerdict] = useState<"revision" | "accept" | "escalate">("accept");
  const [rationale, setRationale] = useState("");
  const [decisionRationale, setDecisionRationale] = useState("");
  const handoff = assignment.handoff!;
  const descendants = new Set([assignment.id]);
  for (let depth = 0; depth < 6; depth++) for (const item of assignments) if (item.parentId && descendants.has(item.parentId)) descendants.add(item.id);
  const independentEvidence = assignments.filter((item) => descendants.has(item.id) && item.id !== assignment.id && item.expertId !== assignment.expertId && item.handoff?.disposition === "result" && !item.handoff.failures.length && !item.handoff.uncertainties.length && Boolean(item.runId && traces[item.runId]?.some((entry) => entry.status === "success" && ["read", "bash", "run_code"].includes(entry.tool))));
  const citesIndependentEvidence = Boolean(assignment.review?.evidence.some((reference) => independentEvidence.some((item) => reference === item.id || reference === item.runId || reference === `run:${item.runId}`)));
  const mayAccept = assignment.review?.verdict === "accept" && citesIndependentEvidence && handoff.disposition === "result" && handoff.failures.length === 0 && handoff.uncertainties.length === 0;
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  return <section className="experts-review" aria-label="Human review and settlement">
    <p>Only the human operator records review and settlement. The Orchestrator cannot accept its own result.</p>
    {assignment.review ? <p role="status">Human review: {assignment.review.verdict} — {assignment.review.rationale} (by {assignment.review.by})</p> : <p>A returned result is still an assertion. Review its evidence before deciding settlement.</p>}
    <form onSubmit={(event) => { event.preventDefault(); onReview(verdict, rationale.trim(), [...new Set([assignment.id, ...selectedEvidence])]); }}>
      <label>Review verdict<select value={verdict} onChange={(event) => setVerdict(event.currentTarget.value as typeof verdict)}><option value="accept">Evidence supports the result</option><option value="revision">Request revision</option><option value="escalate">Escalate for attention</option></select></label>
      <label>Review rationale<textarea required value={rationale} onChange={(event) => setRationale(event.currentTarget.value)} rows={2} placeholder="What did you check, and what does the evidence establish?" /></label>
      <fieldset className="experts-review-evidence"><legend>Evidence for this review</legend><label><input type="checkbox" checked disabled /> This handoff · {assignment.id}</label>
        {independentEvidence.map((item) => <label key={item.id}><input type="checkbox" checked={selectedEvidence.includes(item.id)} onChange={(event) => setSelectedEvidence((current) => event.currentTarget.checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id))} />{experts[item.expertId]?.name ?? item.expertId} · independent {traces[item.runId ?? ""]?.filter((entry) => entry.status === "success" && ["read", "bash", "run_code"].includes(entry.tool)).map((entry) => entry.tool).join(", ")} · {item.id}</label>)}
        {independentEvidence.length === 0 && <p>No completed independent Specialist check is available yet. Acceptance stays blocked until a separate Expert run records a successful read, shell or code tool call.</p>}
      </fieldset>
      <button type="submit" className="global-panel-btn" disabled={busy || !rationale.trim() || (verdict === "accept" && selectedEvidence.length === 0)} title={verdict === "accept" && selectedEvidence.length === 0 ? "Select observable independent evidence before recording an accepting review." : undefined}>Record human review</button>
    </form>
    {assignment.settlement && <p role="status">Human settlement: {assignment.settlement.decision} — {assignment.settlement.rationale} (by {assignment.settlement.by})</p>}
    {!assignment.settlement && <div className="experts-actions"><label>Settlement rationale<input required value={decisionRationale} onChange={(event) => setDecisionRationale(event.currentTarget.value)} placeholder="Record the human decision and reason" /></label><button type="button" className="global-panel-btn" disabled={busy || !decisionRationale.trim()} onClick={() => onSettle("revision", decisionRationale.trim())}>Request revision</button><button type="button" className="global-panel-btn primary" disabled={busy || !decisionRationale.trim() || !mayAccept} title={mayAccept ? undefined : "Acceptance requires an affirmative review citing independent tool evidence, a result handoff and no unresolved failures or uncertainties."} onClick={() => onSettle("accepted", decisionRationale.trim())}>Accept settlement</button></div>}
    {!mayAccept && <p className="experts-blocker" role="status">Acceptance is blocked until the review cites a successful, independent Specialist check and the handoff has no unresolved uncertainty, failures or cancellation.</p>}
  </section>;
}

export function ExpertMemoryPanel({ expert, teams, assignments, onInvoke }: {
  readonly expert: Expert;
  readonly teams: readonly Team[];
  readonly assignments: readonly Assignment[];
  readonly onInvoke: (capability: string, input: Record<string, unknown>) => Promise<unknown>;
}) {
  const [teamId, setTeamId] = useState("");
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ExpertMemory["kind"]>("assertion");
  const [scope, setScope] = useState<ExpertMemory["scope"]>("personal");
  const [sources, setSources] = useState<string[]>([]);
  const [records, setRecords] = useState<readonly ExpertMemory[]>([]);
  const [notice, setNotice] = useState<{ readonly text: string; readonly error: boolean }>();
  const [busy, setBusy] = useState(false);
  const sourceOptions = assignments.filter((item) => item.expertId === expert.id && item.handoff && (!teamId ? item.teamId === null : item.teamId === teamId));
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true); setNotice(undefined);
    try { await action(); setNotice({ text: message, error: false }); }
    catch (failure) { setNotice({ text: failure instanceof Error ? failure.message : String(failure), error: true }); }
    finally { setBusy(false); }
  };
  const read = () => run(async () => {
    const result = await onInvoke("expert.memory.read", { expertId: expert.id, ...(teamId ? { teamId } : {}), ...(query.trim() ? { query: query.trim() } : {}) });
    setRecords(result as ExpertMemory[]);
  }, "Scoped memory loaded.");
  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await onInvoke("expert.memory.write", { expertId: expert.id, ...(teamId ? { teamId } : {}), scope: teamId ? scope : "personal", kind, text: text.trim(), sources });
      setText(""); setSources([]);
      const result = await onInvoke("expert.memory.read", { expertId: expert.id, ...(teamId ? { teamId } : {}) });
      setRecords(result as ExpertMemory[]);
    }, "Memory retained with provenance.");
  };
  return <section className="experts-memory" aria-labelledby="expert-memory-heading"><div className="experts-section-head"><div><p className="experts-eyebrow">Context stewardship</p><h3 id="expert-memory-heading">Scoped memory</h3><p>Memory is separate from the event log. Keep claims attributed and cite their source.</p></div></div>
    <label>Memory scope<TeamContextSelect teams={teams} value={teamId} onChange={(id) => { setTeamId(id); setRecords([]); setSources([]); setScope(id ? "private-team" : "personal"); }} /></label>
    <p className="experts-muted">Team notes can be private to this Expert in the Team, or Shared with this Team.</p>
    <form onSubmit={save}>
      <label>Knowledge kind<select value={kind} onChange={(event) => setKind(event.currentTarget.value as ExpertMemory["kind"])}><option value="observation">Observation</option><option value="assertion">Assertion</option><option value="inference">Inference</option><option value="accepted">Accepted knowledge (human promoted)</option></select></label>
      {teamId && <label>Team memory visibility<select value={scope === "team" ? "team" : "private-team"} onChange={(event) => setScope(event.currentTarget.value as "team" | "private-team")}><option value="private-team">Private to this Expert in the Team</option><option value="team">Shared with this Team</option></select></label>}
      <label>Retained note<textarea required maxLength={8000} rows={3} value={text} onChange={(event) => setText(event.currentTarget.value)} placeholder="Record a bounded, attributable fact or commitment" /></label>
      <fieldset><legend>Source Assignments</legend>{sourceOptions.length === 0 ? <p>No completed work by this Expert is available in the selected scope yet.</p> : sourceOptions.map((item) => <label key={item.id}><input type="checkbox" checked={sources.includes(item.id)} onChange={(event) => setSources((current) => event.currentTarget.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.purpose} · {item.id}</label>)}</fieldset>
      <p className="experts-muted">Retained knowledge keeps its provenance. An assertion is not a demonstrated capability; “accepted” is a human promotion.</p>
      <button type="submit" className="global-panel-btn" disabled={busy || !text.trim() || !sources.length}>Retain memory</button>
    </form>
    <form onSubmit={(event) => { event.preventDefault(); void read(); }}><label htmlFor={`expert-memory-query-${expert.id}`}>Find memory<input id={`expert-memory-query-${expert.id}`} value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search this scope" /></label><button type="submit" className="global-panel-btn" disabled={busy}>Load scoped memory</button></form>
    {notice && <p role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    {records.length > 0 ? <ul aria-label="Retained memory">{records.map((record) => <li key={record.id}><strong>{record.kind} · {record.scope}</strong><p>{record.text}</p><small>Sources: {record.sources.join(", ")} · retained by {record.by}</small></li>)}</ul> : <p className="experts-muted">No memory loaded for this scope. Load it to inspect retained notes.</p>}
  </section>;
}

function TeamContextSelect({ teams, value, onChange }: { readonly teams: readonly Team[]; readonly value: string; readonly onChange: (value: string) => void }) {
  return <select aria-label="Memory scope" value={value} onChange={(event) => onChange(event.currentTarget.value)}><option value="">Personal to this Expert</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name} context</option>)}</select>;
}

function AssignmentApproval({ assignment, busy }: { readonly assignment: Assignment; readonly busy: boolean }) {
  const { open, resolve } = useContinuations(assignment.runId ?? undefined);
  const [error, setError] = useState<string>();
  const [resolving, setResolving] = useState(false);
  const continuation = assignment.runId ? open.find((item) => item.type === "tool-approval" && item.runId === assignment.runId) : undefined;
  if (!continuation) return null;
  const payload = continuation.payload as { readonly tool?: unknown; readonly permission?: unknown; readonly justification?: unknown; readonly surface?: unknown };
  const tool = typeof payload.tool === "string" ? payload.tool : "operation";
  const permission = typeof payload.permission === "string" ? payload.permission : "additional";
  const justification = typeof payload.justification === "string" ? payload.justification : "No reason was provided.";
  const decide = (approved: boolean) => {
    setResolving(true);
    void resolve(continuation.id, "resume", { approved }).then(() => setError(undefined)).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))).finally(() => setResolving(false));
  };
  return <div className="approval-card surface-consequential" role="region" aria-label="Expert run approval">
    <p className="approval-waiting">Waiting for approval</p>
    <p>The Expert requested {permission} permission to use {tool}: {justification}</p>
    <p>Only the human operator can decide. The Orchestrator cannot approve this operation.</p>
    {payload.surface !== undefined && <SurfaceView surface={payload.surface} />}
    {error && <p role="alert">Approval could not be recorded: {error}</p>}
    <div className="approval-actions"><button type="button" className="approval-btn approval-reject" disabled={busy || resolving} onClick={() => decide(false)}>Reject</button><button type="button" className="approval-btn approval-allow" disabled={busy || resolving} onClick={() => decide(true)}>{resolving ? "Recording…" : "Allow once"}</button></div>
  </div>;
}

interface ExpertTraceEntry { readonly toolCallId: string; readonly tool: string; readonly args: unknown; readonly status: "running" | "success" | "failed"; readonly result?: unknown; readonly error?: string }

function useExpertRunTraces(assignments: readonly Assignment[]): Readonly<Record<string, readonly ExpertTraceEntry[]>> {
  const client = useCognate();
  const runIds = [...new Set(assignments.flatMap((assignment) => assignment.runId ? [assignment.runId] : []))].sort();
  const key = runIds.join("|");
  const [traces, setTraces] = useState<Readonly<Record<string, readonly ExpertTraceEntry[]>>>({});
  useEffect(() => {
    setTraces({});
    const byRun = new Map<string, Map<string, ExpertTraceEntry>>();
    const stops = runIds.map((runId) => {
      const entries = new Map<string, ExpertTraceEntry>();
      byRun.set(runId, entries);
      return client.subscribe({ runId }, (event) => {
        const payload = event.payload as { readonly toolCallId?: string; readonly tool?: string; readonly args?: unknown; readonly result?: unknown; readonly error?: string };
        if (!payload.toolCallId) return;
        const previous = entries.get(payload.toolCallId);
        if (event.eventType === "tool.call.started") entries.set(payload.toolCallId, { toolCallId: payload.toolCallId, tool: payload.tool ?? "tool", args: payload.args, status: "running" });
        else if (event.eventType === "tool.call.completed" && previous) entries.set(payload.toolCallId, { ...previous, status: "success", result: payload.result });
        else if (event.eventType === "tool.call.failed" && previous) entries.set(payload.toolCallId, { ...previous, status: "failed", error: payload.error ?? "Tool failed" });
        else return;
        setTraces(Object.fromEntries([...byRun].map(([id, rows]) => [id, [...rows.values()]])));
      });
    });
    return () => stops.forEach((stop) => stop());
  }, [client, key]);
  return traces;
}

function safeTrace(value: unknown): string {
  const redact = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(redact);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, /token|secret|password|api.?key|authorization/i.test(key) ? "[redacted]" : redact(child)]));
    return item;
  };
  try { return (JSON.stringify(redact(value), null, 2) ?? String(value)).slice(0, 5000); } catch { return String(value).slice(0, 5000); }
}

function AssignmentTrace({ runId, entries }: { readonly runId: string | undefined; readonly entries: readonly ExpertTraceEntry[] }) {
  if (!runId) return null;
  return <details className="experts-trace"><summary>Inspect run trace · {entries.length} tool calls</summary>
    {entries.length === 0 ? <p>No tool call events are recorded for this run.</p> : <ol>{entries.map((entry) => <li key={entry.toolCallId}><strong>{entry.tool}</strong> · {entry.status}{entry.error && <p role="alert">{entry.error}</p>}<details><summary>Call and result</summary><pre>{safeTrace(entry.args)}</pre>{entry.result !== undefined && <pre>{safeTrace(entry.result)}</pre>}</details></li>)}</ol>}
  </details>;
}

function ArtifactDownload({ artifactId }: { readonly artifactId: string }) {
  const client = useCognate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return <span>{artifactId} <button type="button" className="global-panel-btn" disabled={busy} onClick={() => {
    setBusy(true); setError(undefined);
    void client.artifact(artifactId).then((artifact) => {
      const url = URL.createObjectURL(new Blob([artifact.bytes as BlobPart], { type: artifact.mediaType }));
      const link = document.createElement("a"); link.href = url; link.download = artifact.name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))).finally(() => setBusy(false));
  }}>{busy ? "Preparing…" : "Download artifact"}</button>{error && <span role="alert"> {error}</span>}</span>;
}

export function AssignmentEffectResolution({ assignment, busy, onResolve }: { readonly assignment: Assignment; readonly busy: boolean; readonly onResolve: (toolCallId: string, outcome: "succeeded" | "failed", reason: string) => void }) {
  const ambiguous = Object.entries(assignment.effects ?? {}).filter(([, effect]) => ["DISPATCHING", "UNKNOWN_RECONCILIATION_REQUIRED"].includes(effect.state));
  if (!ambiguous.length) return null;
  if (["queued", "running", "waiting"].includes(assignment.status)) return <section className="experts-review" aria-label="Side effect in progress"><h4>Side effect in progress</h4><p>Execution remains active; cancellation signals it. Reconcile an uncertain outcome only after the run stops.</p></section>;
  return <section className="experts-review" aria-label="Human effect reconciliation"><h4>Side effect needs operator reconciliation</h4><p>The run cannot continue or retry until you inspect what happened and record an outcome. Only the human operator can record this reconciliation; the Expert cannot resolve its own effect.</p>
    {ambiguous.map(([toolCallId, effect]) => <EffectResolutionForm key={toolCallId} toolCallId={toolCallId} tool={effect.tool} busy={busy} onResolve={(outcome, reason) => onResolve(toolCallId, outcome, reason)} />)}
  </section>;
}

function EffectResolutionForm({ toolCallId, tool, busy, onResolve }: { readonly toolCallId: string; readonly tool: string; readonly busy: boolean; readonly onResolve: (outcome: "succeeded" | "failed", reason: string) => void }) {
  const [outcome, setOutcome] = useState<"succeeded" | "failed">("failed");
  const [reason, setReason] = useState("");
  return <form onSubmit={(event) => { event.preventDefault(); onResolve(outcome, reason.trim()); }}><p><strong>{tool}</strong> · {toolCallId}</p><label>Observed outcome<select value={outcome} onChange={(event) => setOutcome(event.currentTarget.value as typeof outcome)}><option value="failed">Side effect did not complete</option><option value="succeeded">Side effect completed</option></select></label><label>What did you observe?<textarea required rows={2} value={reason} onChange={(event) => setReason(event.currentTarget.value)} /></label><button type="submit" className="global-panel-btn" disabled={busy || !reason.trim()}>Record operator reconciliation</button></form>;
}
