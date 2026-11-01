// Composer model chip + popover. `model.configure` always rewrites the stored key, so the active
// model cannot be switched without re-entering it: the list marks the current model and offers the
// provider's other models as shortcuts into Settings -> Models (edit, model prefilled).
import { useEffect, useMemo, useRef, useState } from "react";
import { useCognate } from "@godspeedai/cognate-react";
import type { ModelCatalogResult } from "../../modelCatalog.ts";
import { CheckIcon, ChevronDownIcon } from "../icons.tsx";

export interface ModelPickerConfig {
  readonly providerId: string;
  readonly baseURL: string;
  readonly protocol: string;
  readonly model: string;
}

export function ModelPicker({
  config,
  openRequest,
  onOpened,
  onManage,
  disabled,
}: {
  readonly config: ModelPickerConfig | undefined;
  /** Truthy request from outside (palette "Switch model"); `onOpened` acknowledges it. */
  readonly openRequest?: boolean;
  readonly onOpened?: () => void;
  /** Open Settings -> Models; `model` prefills the edit form with that model. */
  readonly onManage: (model?: string) => void;
  readonly disabled?: boolean;
}) {
  const client = useCognate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [others, setOthers] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (openRequest) {
      setOpen(true);
      onOpened?.();
    }
  }, [openRequest, onOpened]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    searchRef.current?.focus();
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
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !config) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const r = (await client.invoke("model.catalog", { protocol: config.protocol, baseURL: config.baseURL } as never)) as unknown as ModelCatalogResult;
        if (!cancelled) setOthers(r.ok ? r.models.filter((m) => m !== config.model) : []);
      } catch {
        if (!cancelled) setOthers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, client, config?.protocol, config?.baseURL, config?.model]);

  const q = query.trim().toLowerCase();
  const currentShown = config && (!q || config.model.toLowerCase().includes(q));
  const otherShown = useMemo(() => others.filter((m) => !q || m.toLowerCase().includes(q)).slice(0, 100), [others, q]);

  const moveFocus = (e: React.KeyboardEvent) => {
    const items = [...(wrapRef.current?.querySelectorAll<HTMLElement>('[role="option"], .model-picker-footer button') ?? [])];
    const all: HTMLElement[] = [searchRef.current!, ...items];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") all[(i + 1) % all.length]?.focus();
    else if (e.key === "ArrowUp") all[(i - 1 + all.length) % all.length]?.focus();
    else return;
    e.preventDefault();
  };

  const manage = (model?: string) => {
    setOpen(false);
    onManage(model);
  };

  return (
    <div className="model-picker" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="composer-info-label model-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={config ? `Model ${config.model}, change model` : "No model, connect a provider"}
        title="Switch model"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{config?.model ?? "No model"}</span>
        <ChevronDownIcon aria-hidden="true" />
      </button>
      {open && (
        <div className="model-picker-pop" role="dialog" aria-label="Switch model" onKeyDown={moveFocus}>
          <input
            ref={searchRef}
            type="search"
            className="model-picker-search"
            aria-label="Search models"
            placeholder="Search models"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <div role="listbox" aria-label="Models" className="model-picker-list">
            {!config && <p className="model-picker-empty">No model provider is connected yet.</p>}
            {config && <div className="model-picker-group">{config.providerId}</div>}
            {currentShown && config && (
              <button type="button" role="option" aria-selected="true" className="model-picker-opt current" onClick={() => setOpen(false)}>
                <span>{config.model}</span>
                <CheckIcon aria-hidden="true" />
              </button>
            )}
            {otherShown.map((m) => (
              <button key={m} type="button" role="option" aria-selected="false" className="model-picker-opt" title="Switching needs the provider key, so this opens the provider settings" onClick={() => manage(m)}>
                <span>{m}</span>
              </button>
            ))}
            {config && loading && <p className="model-picker-empty">Loading the provider's models…</p>}
            {config && !loading && !currentShown && otherShown.length === 0 && <p className="model-picker-empty">No models match “{query}”.</p>}
          </div>
          {config && <p className="model-picker-note">Choosing another model reopens the provider form, because the key must be re-entered.</p>}
          <div className="model-picker-footer">
            <button type="button" onClick={() => manage()}>
              Manage providers…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
