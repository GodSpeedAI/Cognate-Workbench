// Composer model chip + popover. Lists every stored provider with its models (discovered lazily with
// `model.catalog` per provider, cached); choosing one switches instantly through `provider.activate`,
// which reuses the stored key, so nothing is re-entered.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCognate } from "@godspeedai/cognate-react";
import type { ModelCatalogResult } from "../../modelCatalog.ts";
import { CheckIcon, ChevronDownIcon } from "../icons.tsx";
import { useToast } from "../shell/Toast.tsx";
import { capabilityErrorMessage } from "./providerCatalog.ts";
import { useProviderList, type StoredProvider } from "./useProviders.ts";

type Models = { readonly state: "loading" } | { readonly state: "ready"; readonly models: readonly string[] } | { readonly state: "failed"; readonly reason: string };

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
  /** Open Settings -> Providers. */
  readonly onManage: () => void;
  readonly disabled?: boolean;
}) {
  const client = useCognate();
  const toast = useToast();
  const { providers } = useProviderList();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [catalogs, setCatalogs] = useState<Readonly<Record<string, Models>>>({});
  const [switching, setSwitching] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const fetched = useRef<Set<string>>(new Set());
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
    setError(undefined);
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

  // Discover each provider's models once per (provider, endpoint) while the popover is used.
  useEffect(() => {
    if (!open || !providers) return;
    for (const p of providers) {
      const key = `${p.providerId}|${p.baseURL}|${p.protocol}`;
      if (fetched.current.has(key)) continue;
      fetched.current.add(key);
      setCatalogs((c) => ({ ...c, [p.providerId]: { state: "loading" } }));
      void (async () => {
        try {
          const r = (await client.invoke("model.catalog", {
            providerId: p.providerId,
            protocol: p.protocol,
            baseURL: p.baseURL,
            ...(p.auth ? { auth: p.auth } : {}),
            ...(p.apiVersion ? { apiVersion: p.apiVersion } : {}),
          } as never)) as unknown as ModelCatalogResult;
          setCatalogs((c) => ({ ...c, [p.providerId]: r.ok ? { state: "ready", models: r.models } : { state: "failed", reason: r.reason } }));
        } catch (err) {
          setCatalogs((c) => ({ ...c, [p.providerId]: { state: "failed", reason: capabilityErrorMessage(err) } }));
        }
      })();
    }
  }, [open, providers, client]);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const list: readonly StoredProvider[] = providers ?? [];
    return list.map((p) => {
      const cat = catalogs[p.providerId];
      const all = new Set<string>([p.model]);
      if (cat?.state === "ready") for (const m of cat.models) all.add(m);
      const models = [...all].filter((m) => !q || m.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q)).slice(0, 100);
      return { provider: p, models, cat };
    });
  }, [providers, catalogs, q]);

  const choose = useCallback(
    async (p: StoredProvider, model: string) => {
      if (p.isCurrent && config?.model === model) {
        setOpen(false);
        return;
      }
      setSwitching(`${p.providerId}|${model}`);
      setError(undefined);
      try {
        await client.invoke("provider.activate", { providerId: p.providerId, model } as never);
        setOpen(false);
        toast.show(`Now using ${model} on ${p.displayName}`);
        btnRef.current?.focus();
      } catch (err) {
        setError(capabilityErrorMessage(err));
      } finally {
        setSwitching(undefined);
      }
    },
    [client, config?.model, toast],
  );

  const moveFocus = (e: React.KeyboardEvent) => {
    const items = [...(wrapRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled), .model-picker-footer button') ?? [])];
    const all: HTMLElement[] = [searchRef.current!, ...items];
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") all[(i + 1) % all.length]?.focus();
    else if (e.key === "ArrowUp") all[(i - 1 + all.length) % all.length]?.focus();
    else return;
    e.preventDefault();
  };

  const manage = () => {
    setOpen(false);
    onManage();
  };
  const anyShown = groups.some((g) => g.models.length > 0);

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
            {providers !== undefined && providers.length === 0 && <p className="model-picker-empty">No model provider is connected yet.</p>}
            {providers === undefined && <p className="model-picker-empty">Loading providers…</p>}
            {groups.map(({ provider: p, models, cat }) => {
              const usable = p.keyless || p.hasKey;
              return (
                <div key={p.providerId} role="group" aria-label={p.displayName} className="model-picker-section" data-provider={p.providerId}>
                  <div className="model-picker-group">
                    {p.displayName}
                    {p.isCurrent && <span className="model-picker-active">Active</span>}
                  </div>
                  {models.map((m) => {
                    const current = p.isCurrent && config?.model === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        role="option"
                        aria-selected={current}
                        className={current ? "model-picker-opt current" : "model-picker-opt"}
                        disabled={!usable || switching !== undefined}
                        title={usable ? `Use ${m} on ${p.displayName}` : `${p.displayName} has no stored key. Add it in Providers.`}
                        onClick={() => void choose(p, m)}
                      >
                        <span>{m}</span>
                        {current && <CheckIcon aria-hidden="true" />}
                      </button>
                    );
                  })}
                  {cat?.state === "loading" && <p className="model-picker-empty">Loading models…</p>}
                  {cat?.state === "failed" && <p className="model-picker-empty" title={cat.reason}>Couldn't list models. {models.length ? "Showing the saved one." : ""}</p>}
                  {!usable && <p className="model-picker-empty">No key stored. Add it in Providers.</p>}
                </div>
              );
            })}
            {providers !== undefined && providers.length > 0 && !anyShown && <p className="model-picker-empty">No models match “{query}”.</p>}
          </div>
          {error && (
            <p role="alert" className="model-picker-note model-picker-error">
              {error}
            </p>
          )}
          <div className="model-picker-footer">
            <button type="button" onClick={manage}>
              Manage providers…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
