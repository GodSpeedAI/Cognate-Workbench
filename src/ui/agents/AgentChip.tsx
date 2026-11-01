// Composer context-bar chip: which agent runs this session. "Cognate (native)" or any installed
// harness CLI, with its permission mode and (where the CLI takes one) a model. Controlled: the owner
// decides whether a change binds a session now (`session.harness.bind`) or is held for the first send.
import { useEffect, useRef, useState } from "react";
import { BotIcon, CheckIcon, ChevronDownIcon, TerminalIcon } from "../icons.tsx";
import { defaultModeFor, postureNotice, type HarnessChoice, type HarnessInfo } from "./useHarness.ts";

export function agentLabel(harnesses: readonly HarnessInfo[] | undefined, harnessId: string | null | undefined): string {
  if (!harnessId) return "Cognate (native)";
  return harnesses?.find((h) => h.id === harnessId)?.label ?? harnessId;
}

export function AgentNotice({ harnesses, choice }: { readonly harnesses: readonly HarnessInfo[] | undefined; readonly choice: HarnessChoice }) {
  if (!choice.harnessId) return null;
  const info = harnesses?.find((h) => h.id === choice.harnessId);
  const n = postureNotice(info, agentLabel(harnesses, choice.harnessId), choice.permissionMode);
  return (
    <p className={`agent-notice${n.warn ? " is-warn" : ""}`} role="note" data-agent-notice={n.warn ? "full" : "bridged"}>
      <TerminalIcon aria-hidden="true" />
      <span>{n.text}</span>
    </p>
  );
}

export function AgentChip({
  harnesses,
  choice,
  locked,
  error,
  onChange,
  onOpenSettings,
}: {
  readonly harnesses: readonly HarnessInfo[] | undefined;
  readonly choice: HarnessChoice;
  readonly locked: boolean;
  readonly error?: string | undefined;
  readonly onChange: (next: HarnessChoice) => void;
  readonly onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [modelDraft, setModelDraft] = useState(choice.model ?? "");
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setModelDraft(choice.model ?? ""), [choice.model, choice.harnessId]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    wrapRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const info = choice.harnessId ? harnesses?.find((h) => h.id === choice.harnessId) : undefined;
  const label = agentLabel(harnesses, choice.harnessId);
  const modeLabel = info?.permissionModes.find((m) => m.id === choice.permissionMode)?.label;
  const installed = harnesses?.filter((h) => h.installed) ?? [];
  const missing = harnesses?.filter((h) => !h.installed) ?? [];
  const onMenuKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const items = [...(wrapRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  };
  const pickAgent = (h: HarnessInfo | null) => {
    if (!h) onChange({ harnessId: null });
    else if (choice.harnessId !== h.id) onChange({ harnessId: h.id, ...(defaultModeFor(h) ? { permissionMode: defaultModeFor(h)! } : {}) });
  };
  const commitModel = () => {
    const m = modelDraft.trim();
    if (!choice.harnessId || m === (choice.model ?? "")) return;
    onChange({ harnessId: choice.harnessId, ...(choice.permissionMode ? { permissionMode: choice.permissionMode } : {}), ...(m ? { model: m } : {}) });
  };
  return (
    <span className="ctx-menu-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        id="agent-chip"
        className={`ctx-chip ctx-chip-button${choice.harnessId ? " is-set" : ""}${choice.permissionMode === "full" ? " is-warn" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Agent: ${label}${modeLabel ? `, ${modeLabel}` : ""}`}
        disabled={locked}
        title={locked ? "The agent can't change while a run is active." : choice.harnessId ? `This session runs ${label}.` : "Choose which agent runs this session."}
        onClick={() => setOpen((v) => !v)}
      >
        {choice.harnessId ? <TerminalIcon aria-hidden="true" /> : <BotIcon aria-hidden="true" />}
        <span className="ctx-chip-text">{label}</span>
        {modeLabel && <span className="ctx-chip-note">{modeLabel}</span>}
        <ChevronDownIcon aria-hidden="true" />
      </button>
      {error && (
        <span className="wb-error" role="alert">
          {error}
        </span>
      )}
      {open && (
        <div role="menu" aria-label="Agent" className="ctx-menu agent-menu" onKeyDown={onMenuKey}>
          <button type="button" role="menuitemradio" aria-checked={!choice.harnessId} onClick={() => pickAgent(null)}>
            <span className="ctx-menu-check">{!choice.harnessId && <CheckIcon />}</span>
            <span>
              Cognate (native) <span className="ctx-menu-sub">your model provider, contained</span>
            </span>
          </button>
          {installed.map((h) => (
            <button key={h.id} type="button" role="menuitemradio" aria-checked={choice.harnessId === h.id} onClick={() => pickAgent(h)}>
              <span className="ctx-menu-check">{choice.harnessId === h.id && <CheckIcon />}</span>
              <span>
                {h.label} <span className="ctx-menu-sub">{h.version ?? "installed"}</span>
              </span>
            </button>
          ))}
          {harnesses === undefined && <p className="ctx-menu-empty">Looking for agent CLIs…</p>}
          {harnesses !== undefined && installed.length === 0 && <p className="ctx-menu-empty">No agent CLIs found on this computer.</p>}
          {info && info.permissionModes.length > 0 && (
            <>
              <div className="ctx-menu-sep" role="separator" />
              <div className="ctx-menu-group" id="agent-mode-label">
                Permission mode
              </div>
              {info.permissionModes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice.permissionMode === m.id}
                  title={m.description}
                  onClick={() => onChange({ harnessId: info.id, permissionMode: m.id, ...(choice.model ? { model: choice.model } : {}) })}
                >
                  <span className="ctx-menu-check">{choice.permissionMode === m.id && <CheckIcon />}</span>
                  <span className={m.id === "full" ? "agent-mode-full" : undefined}>
                    {m.label} <span className="ctx-menu-sub">{m.description}</span>
                  </span>
                </button>
              ))}
              {info.modelMechanism !== "none" && (
                <label className="agent-model">
                  <span className="ctx-menu-group">Model (optional)</span>
                  <input
                    value={modelDraft}
                    placeholder="CLI default"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Agent model"
                    onChange={(e) => setModelDraft(e.currentTarget.value)}
                    onBlur={commitModel}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitModel();
                      }
                    }}
                  />
                </label>
              )}
            </>
          )}
          {missing.length > 0 && (
            <>
              <div className="ctx-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
              >
                <span className="ctx-menu-check" />
                <span>
                  Set up more agents… <span className="ctx-menu-sub">{missing.length} not installed</span>
                </span>
              </button>
            </>
          )}
          {info && (
            <div className="agent-menu-notice">
              <AgentNotice harnesses={harnesses} choice={choice} />
            </div>
          )}
        </div>
      )}
    </span>
  );
}
