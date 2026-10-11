// CognitiveFrame: the conditional right-hand region for the cognitive-navigation proof.
// Attention order (not equal cards): DESTINATION, PRESENT, DEVIATION, NEXT MOVE, SETTLEMENT, then
// conditionally AUTHORITY, SEARCH, METHOD RECOMMENDATION and the recorded REALITY. It renders only
// what the server derives from durable events (`case.derive`); focus is ephemeral and never truth.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCognate, useProjection } from "@godspeedai/cognate-react";
import { shortHash } from "../cognitive/canonical.ts";
import { parseRef, type FocusContext } from "../cognitive/focus.ts";
import { validateSurface, type Block, type Surface } from "../cognitive/surface.ts";
import { publishToWebMcp, toolsForFocus, type AttentionBackend } from "./webmcp.ts";

// -- Surface renderer: closed grammar only; anything invalid is rejected, never rendered. ------------
export function SurfaceView({ surface, onAction }: { readonly surface: unknown; readonly onAction?: (actionId: string) => void }) {
  let valid: Surface;
  try {
    valid = validateSurface(surface);
  } catch (e) {
    return <p className="cf-rejected" role="alert">Representation rejected: {e instanceof Error ? e.message : "invalid surface"}</p>;
  }
  return (
    <div className="cf-surface" data-surface-id={valid.id}>
      {valid.blocks.map((b, i) => <BlockView key={i} block={b} onAction={onAction} />)}
    </div>
  );
}

function BlockView({ block, onAction }: { readonly block: Block; readonly onAction?: (id: string) => void }) {
  switch (block.type) {
    case "callout":
      return <div className={`cf-callout cf-tone-${block.tone}`} role="status"><strong>{TONE[block.tone]}</strong> {block.title}{block.text ? <p>{block.text}</p> : null}</div>;
    case "entity":
      return <dl className="cf-entity" aria-label={block.label}>{block.fields.map((f) => <div key={f.key}><dt>{f.key}</dt><dd>{f.value}</dd></div>)}</dl>;
    case "table":
      return <table className="cf-table"><thead><tr>{block.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{block.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>;
    case "compare":
      return (
        <div className="cf-compare" role="group" aria-label="Compare">
          {[block.left, block.right].map((s, i) => (
            <div key={i}><h4>{s.label}{s.hash ? <code> {shortHash(s.hash)}</code> : null}</h4><dl>{s.items.map((it) => <div key={it.key}><dt>{it.key}</dt><dd>{it.value}</dd></div>)}</dl></div>
          ))}
          {block.left.items.length === 0 && <p className="cf-quiet">No consequential difference recorded.</p>}
        </div>
      );
    case "timeline":
      return <ol className="cf-timeline" aria-label="Timeline">{block.entries.map((e) => <li key={`${e.position}-${e.kind}`}><span className="cf-pos">#{e.position}</span> <span>{e.label}</span>{e.hash ? <code> {e.hash}</code> : null}</li>)}</ol>;
    case "preflight":
      return (
        <div className="cf-preflight" role="group" aria-label="Preflight">
          <h4>{block.title}</h4>
          <dl>
            <div><dt>Target</dt><dd>{block.target}</dd></div>
            {block.command ? <div><dt>Command</dt><dd><code>{block.command}</code></dd></div> : null}
            {block.impact.map((f) => <div key={f.key}><dt>{f.key}</dt><dd>{f.value}</dd></div>)}
            {block.recovery ? <div><dt>Recovery</dt><dd>{block.recovery}</dd></div> : null}
            <div><dt>Authority</dt><dd>{block.authority === "human-approval-required" ? "human approval required" : "none required"}</dd></div>
          </dl>
          {onAction ? <div className="cf-actions">{block.actions.map((a) => <button key={a.id} type="button" onClick={() => onAction(a.id)}>{a.label}</button>)}</div> : null}
        </div>
      );
    case "ask":
      return <div className="cf-ask" role="group" aria-label="Question"><p>{block.question}</p><div className="cf-actions">{block.options.map((o) => <button key={o.id} type="button" onClick={() => onAction?.(o.id)}>{o.label}</button>)}</div></div>;
  }
}
const TONE = { info: "NOTE", warn: "WARNING", fail: "FAILED", ok: "OK" } as const;

// -- derived Case as the server returns it -------------------------------------------------------
interface Derived {
  readonly case: {
    readonly caseId: string; readonly desiredOutcome: string; readonly baseWorldHash?: string; readonly candidateWorldHash?: string;
    readonly currentState: string; readonly criterionHash?: string; readonly materialDeviation?: string; readonly unknowns: readonly string[];
    readonly observation?: { readonly passed: number; readonly total: number; readonly unobserved: readonly string[] };
    readonly field: { readonly current: readonly { id: string; label: string; whyNow: string; successor?: string; authorityRequired: boolean }[]; readonly blocked: readonly { id: string; label: string; blockedBy: readonly string[]; reachableNow?: string }[]; readonly primary?: string };
    readonly settlementConditions: readonly { id: string; label: string; satisfied: boolean }[];
    readonly settlementReachable: boolean;
    readonly optionalRemaining: readonly { id: string; label: string; payment?: string }[];
  };
  readonly reality: readonly { position: number; eventType: string; summary: string }[];
  readonly evidence: readonly { position: number; checkId: string; passed: boolean }[];
  readonly search: { readonly rounds: readonly { roundId: string; candidateWorldHash: string; result: string; decision: string; score?: number }[]; readonly best: string | null; readonly criterionHash: string | null };
  readonly method: { readonly activeMethodHash: string; readonly recommendations: readonly { id: string; observedResidual: string; supporting: readonly string[]; contradicting: readonly string[]; scope: string; candidateChange: string; expectedEffect: string }[] };
  readonly settledHead: string | null;
}

function HashTag({ label, hash, kind }: { readonly label: string; readonly hash: string; readonly kind: "settled" | "candidate" }) {
  const [full, setFull] = useState(false);
  return (
    <button type="button" className={`cf-hash cf-hash-${kind}`} onClick={() => setFull((v) => !v)} aria-label={`${label} world ${hash}. Activate to ${full ? "shorten" : "show full identity"}`} title="Show/hide full identity">
      <span className="cf-hash-label">{label}</span> <code>{full ? hash : shortHash(hash)}</code>
    </button>
  );
}

export function CognitiveFrame({ awaitingDecision }: { readonly awaitingDecision: boolean }) {
  const client = useCognate();
  const rows = useProjection("cognitive");
  const caseId = rows?.find((r) => r.key === "activeCase")?.value as string | undefined;
  const latest = (rows?.find((r) => r.key === "latest")?.value as { position?: number } | undefined)?.position;
  const [derived, setDerived] = useState<Derived | undefined>();
  const [focus, setFocus] = useState<FocusContext | undefined>();
  const [view, setView] = useState<Surface | undefined>();
  const [confirm, setConfirm] = useState<{ actionId: string; focus: FocusContext } | undefined>();
  const [error, setError] = useState<string | undefined>();
  const focusRef = useRef<FocusContext | undefined>(undefined);
  focusRef.current = focus;

  const refresh = useCallback(async () => {
    if (!caseId) return;
    try {
      setDerived((await client.invoke("case.derive", { caseId })) as unknown as Derived);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, caseId]);
  useEffect(() => { void refresh(); }, [refresh, latest]);
  // `useProjection` can stay stale (DEBT-021), so the projection is only a hint; a slow refresh
  // guarantees the frame converges on the server-derived Case regardless.
  useEffect(() => {
    if (!caseId) return;
    const t = setInterval(() => { void refresh(); }, 1500);
    return () => clearInterval(t);
  }, [caseId, refresh]);

  const takePending = useCallback(async () => {
    const out = (await client.invoke("ui.pending", {})) as unknown as { surfaces: Surface[]; focus: FocusContext | null };
    if (out.surfaces.length > 0) setView(out.surfaces[out.surfaces.length - 1]);
    if (out.focus && out.focus.ref !== focusRef.current?.ref) setFocus(out.focus);
  }, [client]);
  useEffect(() => {
    if (!caseId) return;
    const t = setInterval(() => { void takePending().catch(() => undefined); }, 600);
    return () => clearInterval(t);
  }, [caseId, takePending]);

  const publish = useCallback(async (f: FocusContext | undefined) => {
    setFocus(f);
    await client.invoke("ui.focus.publish", { focus: (f ?? null) as never });
  }, [client]);
  const focusOn = (ref: string, extra: Partial<FocusContext> = {}) => { void publish({ ref: ref as FocusContext["ref"], ...(caseId ? { caseId } : {}), ...(derived?.case.candidateWorldHash ? { candidateWorldHash: derived.case.candidateWorldHash } : {}), ...extra }); };

  // One semantic operation for human click and agent request: ask the server, then take the Surface.
  const request = useCallback(async (op: Parameters<AttentionBackend["request"]>[0]) => {
    const out = await client.invoke("ui.request", op as never);
    await takePending();
    return out;
  }, [client, takePending]);

  const backend: AttentionBackend = useMemo(() => ({
    context: async () => client.invoke("ui.context", {}),
    request: (op) => request({ ...op, ...(op.op === "compare" && !op.left ? { left: derived?.settledHead ? `world:${derived.settledHead}` : undefined } : {}) }),
    proposeMutation: async (actionId, f) => { setConfirm({ actionId, focus: f }); return { status: "awaiting-human-confirmation", action: actionId }; },
  }), [client, request, derived?.settledHead]);

  useEffect(() => { publishToWebMcp(toolsForFocus(focus, backend)); }, [focus, backend]);

  const settle = async () => {
    if (!derived?.case.candidateWorldHash || !caseId) return;
    try { await client.invoke("world.settle", { caseId, candidateHash: derived.case.candidateWorldHash }); setError(undefined); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const confirmAction = async () => {
    if (!confirm) return;
    const { actionId, focus: f } = confirm;
    setConfirm(undefined);
    // Human-confirmed, then through the normal Cognate capability path (policy, mediation, run).
    if (actionId === "retry_verification" && f.candidateWorldHash) setError("Retry needs the check commands; start it from the conversation so it runs under normal governance.");
  };

  if (!caseId || !derived) return null;
  const c = derived.case;
  const settledHash = derived.settledHead ?? c.baseWorldHash;
  const primary = c.field.current.find((a) => a.id === c.field.primary);
  const alternatives = c.field.current.filter((a) => a.id !== c.field.primary);
  const successor = primary?.successor ? c.field.current.find((a) => a.id === primary.successor)?.label ?? c.field.blocked.find((a) => a.id === primary.successor)?.label ?? primary.successor : undefined;
  const failed = derived.evidence.filter((e) => !e.passed);

  return (
    <aside className="right-panel cognitive-frame" role="complementary" aria-label="Cognitive frame" data-testid="cognitive-frame">
      <div className="right-panel-body">
        <section aria-labelledby="cf-destination"><h2 id="cf-destination" className="cf-h">Destination</h2><p>{c.desiredOutcome}</p></section>

        <section aria-labelledby="cf-present">
          <h2 id="cf-present" className="cf-h">Present</h2>
          <div className="cf-worlds">
            {settledHash ? <HashTag label="Settled" hash={settledHash} kind="settled" /> : <p className="cf-quiet">No settled baseline recorded.</p>}
            {c.candidateWorldHash ? <HashTag label="Candidate" hash={c.candidateWorldHash} kind="candidate" /> : null}
          </div>
          {c.observation ? <p>Required checks: {c.observation.passed} / {c.observation.total} passed</p> : null}
          {c.criterionHash ? <p className="cf-quiet">Criterion <code>{shortHash(c.criterionHash)}</code> · frozen</p> : null}
          {derived.evidence.length > 0 && (
            <ul className="cf-evidence" aria-label="Recorded checks">
              {derived.evidence.map((e) => (
                <li key={e.position}>
                  <button type="button" aria-pressed={focus?.ref === `evidence:${e.position}`} className={e.passed ? "cf-row" : "cf-row cf-row-fail"} onClick={() => focusOn(`evidence:${e.position}`)}>
                    <span className="cf-recorded" aria-label="recorded observation">RECORDED</span> {e.checkId}: <strong>{e.passed ? "passed" : "FAILED"}</strong>
                    {focus?.ref === `evidence:${e.position}` ? <span className="cf-focused"> · focused</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="cf-deviation">
          <h2 id="cf-deviation" className="cf-h">Deviation</h2>
          {c.materialDeviation ? <p className="cf-deviation" role="status">{c.materialDeviation}</p> : <p className="cf-quiet">No material deviation recorded.</p>}
          {failed.length > 0 && <p className="cf-quiet">{failed.length} failing observation{failed.length > 1 ? "s" : ""}. Select one to give the agent something to refer to.</p>}
        </section>

        <section aria-labelledby="cf-next">
          <h2 id="cf-next" className="cf-h">Next move</h2>
          {primary ? (
            <div className="cf-primary">
              <p><strong>{primary.label}</strong></p>
              <p className="cf-quiet">Why: {primary.whyNow}</p>
              {successor ? <p className="cf-quiet">If satisfied: {successor} becomes reachable</p> : null}
              {primary.authorityRequired ? <p className="cf-quiet">Needs human authority</p> : null}
            </div>
          ) : <p className="cf-quiet">No move is currently reachable.</p>}
          {alternatives.length > 0 && <p className="cf-quiet">Alternatives: {alternatives.map((a) => a.label).join(" · ")}</p>}
          {c.field.blocked.length > 0 && (
            <ul className="cf-blocked" aria-label="Blocked">
              {c.field.blocked.map((b) => (
                <li key={b.id}>
                  <button type="button" className="cf-row" aria-pressed={focus?.ref === `affordance:${b.id}`} onClick={() => focusOn(`affordance:${b.id}`, { affordanceRef: `affordance:${b.id}` as never })}>
                    <strong>{b.label}</strong> — blocked · {b.blockedBy.join(", ")}{b.reachableNow ? ` · reachable now: ${c.field.current.find((a) => a.id === b.reachableNow)?.label ?? b.reachableNow}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="cf-settlement">
          <h2 id="cf-settlement" className="cf-h">Settlement</h2>
          <p role="status" className={c.settlementReachable ? "cf-reachable" : "cf-unreachable"}>
            {c.currentState === "settled" ? "Settled" : c.settlementReachable ? "Reachable — not yet settled" : "Not reachable"}
          </p>
          <ul className="cf-conditions" aria-label="Settlement conditions">
            {c.settlementConditions.map((s) => <li key={s.id}>{s.satisfied ? "Satisfied" : "Unsatisfied"} · {s.label}</li>)}
          </ul>
          {c.optionalRemaining.length > 0 && <p className="cf-quiet">Optional: {c.optionalRemaining.map((o) => `${o.label}${o.payment ? ` (payment ${o.payment})` : ""}`).join(" · ")}</p>}
          <button type="button" className="cf-btn" disabled={!c.settlementReachable || c.currentState === "settled"} onClick={() => void settle()}>Settle candidate</button>
          {error ? <p className="cf-rejected" role="alert">{error}</p> : null}
        </section>

        {awaitingDecision && <section aria-labelledby="cf-auth"><h2 id="cf-auth" className="cf-h">Authority</h2><p role="status">A consequential decision is waiting for you. Review it in the approval card.</p></section>}

        {derived.search.rounds.length > 0 && (
          <section aria-labelledby="cf-search">
            <h2 id="cf-search" className="cf-h">Search</h2>
            <p>Best world {derived.search.best ? <code>{shortHash(derived.search.best)}</code> : "none"} · rounds {derived.search.rounds.length}</p>
            {derived.search.criterionHash ? <p className="cf-quiet">Criterion <code>{shortHash(derived.search.criterionHash)}</code> · locked · Method <code>{shortHash(derived.method.activeMethodHash)}</code></p> : null}
            <ol className="cf-timeline" aria-label="Experiment rounds">{derived.search.rounds.map((r) => <li key={r.roundId}>{r.roundId} · {r.result} · {r.decision}{r.score !== undefined ? ` · ${r.score}` : ""}</li>)}</ol>
          </section>
        )}

        {derived.method.recommendations.map((m) => (
          <section key={m.id} aria-label="Method recommendation" className="cf-method">
            <h2 className="cf-h">Method recommendation</h2>
            <p><strong>candidate · not active</strong></p>
            <p>Observed residual: {m.observedResidual}</p>
            <p className="cf-quiet">Supporting: {m.supporting.join(", ")} · Contradicting: {m.contradicting.join(", ") || "none"}</p>
            <p className="cf-quiet">Suggested change: {m.candidateChange}</p>
            <p className="cf-quiet">Scope: {m.scope}</p>
            <p>Active method unchanged <code>{shortHash(derived.method.activeMethodHash)}</code></p>
            <button type="button" className="cf-btn" onClick={() => void client.invoke("method.accept", { recommendationId: m.id, method: { rule: m.candidateChange, from: m.id } } as never).catch((e) => setError(String(e instanceof Error ? e.message : e)))}>Accept into method</button>
          </section>
        ))}

        <section aria-labelledby="cf-views">
          <h2 id="cf-views" className="cf-h">Views</h2>
          <div className="cf-actions">
            <button type="button" className="cf-btn" onClick={() => void request({ op: "timeline", ref: `case:${caseId}` })}>Show timeline</button>
            {c.candidateWorldHash && settledHash ? <button type="button" className="cf-btn" onClick={() => void request({ op: "compare", left: `world:${settledHash}`, right: `candidate:${c.candidateWorldHash}` })}>Compare to settled</button> : null}
          </div>
          {confirm && (
            <SurfaceView surface={{ id: "ui:confirm", title: "Confirm", intent: "decide", purpose: "An agent proposed a consequential action.", lifetime: "session", provenance: { source: "ui.invoke" }, blocks: [{ type: "ask", question: `An agent asked to ${confirm.actionId.replace(/_/g, " ")} on ${confirm.focus.ref}. Only you can authorise this.`, options: [{ id: "confirm", label: "Confirm" }, { id: "cancel", label: "Cancel" }] }] }} onAction={(id) => { if (id === "confirm") void confirmAction(); else setConfirm(undefined); }} />
          )}
          {view && (
            <div className="cf-view" role="region" aria-label={view.title}>
              <div className="cf-view-head"><h3>{view.title}</h3><button type="button" aria-label="Close view" onClick={() => setView(undefined)}>Close</button></div>
              <SurfaceView surface={view} />
            </div>
          )}
        </section>

        <section aria-labelledby="cf-reality">
          <h2 id="cf-reality" className="cf-h">Reality <span className="cf-recorded">RECORDED · system-observed</span></h2>
          <ol className="cf-timeline" aria-label="Recorded facts">
            {derived.reality.slice(-12).map((f) => <li key={f.position}><span className="cf-pos">#{f.position}</span> {f.summary}</li>)}
          </ol>
        </section>
      </div>
    </aside>
  );
}
