// Add / edit a model provider. One component, used by Settings -> Models and by the first-run flow.
// Presets come from providerCatalog.ts; saving goes through `model.configure`, model discovery
// through `model.catalog` (read-only; nothing is configured until Save).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useCognate } from "@godspeedai/cognate-react";
import type { ModelCatalogResult } from "../../modelCatalog.ts";
import { CheckIcon } from "../icons.tsx";
import { useToast } from "../shell/Toast.tsx";
import {
  API_PROTOCOL_OPTIONS,
  PROVIDER_CATALOG,
  PROVIDER_ID_PATTERN,
  capabilityErrorMessage,
  protocolToWire,
  slugifyProviderId,
  wireToProtocol,
  type ApiProtocolLabel,
  type ProviderPreset,
} from "./providerCatalog.ts";

export interface ProviderWizardInitial {
  readonly providerId: string;
  readonly baseURL: string;
  /** Wire protocol value as stored. */
  readonly protocol: string;
  readonly model: string;
}

export interface ProviderWizardProps {
  /** Present when editing the configured provider (fields prefilled, key must be re-entered). */
  readonly initial?: ProviderWizardInitial;
  readonly submitLabel?: string;
  readonly cancelLabel?: string;
  /** Omit to hide the secondary button. */
  readonly onCancel?: () => void;
  readonly onSaved: () => void;
  readonly autoFocus?: boolean;
}

function validUrl(value: string): string | undefined {
  const v = value.trim();
  if (!v) return "Base URL is required.";
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "Use an http:// or https:// URL.";
  } catch {
    return "Enter a full URL, for example https://gateway.example/v1.";
  }
  return undefined;
}

export function ProviderWizard({ initial, submitLabel = "Save provider", cancelLabel = "Cancel", onCancel, onSaved, autoFocus }: ProviderWizardProps) {
  const client = useCognate();
  const toast = useToast();
  const uid = useId();
  const editing = initial !== undefined;
  const [presetId, setPresetId] = useState<string>(editing ? "" : "");
  const [displayName, setDisplayName] = useState(initial?.providerId ?? "");
  const [providerId, setProviderId] = useState(initial?.providerId ?? "");
  const [idTouched, setIdTouched] = useState(editing);
  const [baseURL, setBaseURL] = useState(initial?.baseURL ?? "");
  const [protocol, setProtocol] = useState<ApiProtocolLabel>(initial ? wireToProtocol(initial.protocol) : API_PROTOCOL_OPTIONS[0]);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(initial?.model ?? "");
  const [touched, setTouched] = useState<Readonly<Record<string, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [catalog, setCatalog] = useState<ModelCatalogResult | undefined>(undefined);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const modelWrapRef = useRef<HTMLDivElement>(null);

  const preset: ProviderPreset | undefined = PROVIDER_CATALOG.find((p) => p.id === presetId);
  const keyOptional = preset?.auth === "none";
  const touch = (k: string) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));

  const choosePreset = useCallback((p: ProviderPreset) => {
    setPresetId(p.id);
    setBaseURL(p.baseURL);
    setProtocol(p.protocol);
    setCatalog(undefined);
    setError(undefined);
    if (p.id !== "custom") {
      setDisplayName(p.label);
      setProviderId(p.id);
      setIdTouched(false);
      if (p.defaultModels?.[0]) setModel(p.defaultModels[0]);
    } else {
      setDisplayName("");
      setProviderId("");
      setIdTouched(false);
    }
    setTouched({});
    setSubmitted(false);
  }, []);

  const errors = {
    displayName: displayName.trim() ? undefined : "Name is required.",
    providerId: !providerId.trim() ? "Provider ID is required." : PROVIDER_ID_PATTERN.test(providerId) ? undefined : "Use lowercase letters, digits, - or _, starting with a letter.",
    baseURL: validUrl(baseURL),
    apiKey: keyOptional || apiKey.trim() ? undefined : "API key is required.",
    model: model.trim() ? undefined : "Choose or type a model ID.",
  };
  const valid = Object.values(errors).every((e) => e === undefined);
  const show = (k: keyof typeof errors) => (touched[k] || submitted ? errors[k] : undefined);

  const fetchModels = useCallback(async () => {
    setCatalogBusy(true);
    setCatalog(undefined);
    try {
      const result = (await client.invoke("model.catalog", {
        protocol: protocolToWire(protocol),
        baseURL,
        ...(apiKey.trim() ? { apiKey } : {}),
      } as never)) as unknown as ModelCatalogResult;
      setCatalog(result);
      if (result.ok && result.models.length > 0) {
        setListOpen(true);
        setActive(0);
      }
    } catch (err) {
      setCatalog({ ok: false, reason: capabilityErrorMessage(err), models: [] });
    } finally {
      setCatalogBusy(false);
    }
  }, [client, protocol, baseURL, apiKey]);

  const filtered = useMemo(() => {
    if (!catalog?.ok) return [] as readonly string[];
    const q = model.trim().toLowerCase();
    return catalog.models.filter((m) => !q || m.toLowerCase().includes(q)).slice(0, 200);
  }, [catalog, model]);

  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: MouseEvent) => {
      if (modelWrapRef.current && !modelWrapRef.current.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [listOpen]);

  const submit = useCallback(async () => {
    setSubmitted(true);
    if (!valid || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await client.invoke("model.configure", {
        providerId: providerId.trim(),
        baseURL: baseURL.trim(),
        protocol: protocolToWire(protocol),
        model: model.trim(),
        apiKey,
      });
      toast.show("Model provider saved");
      onSaved();
    } catch (err) {
      setError(capabilityErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [valid, busy, client, providerId, baseURL, protocol, model, apiKey, toast, onSaved]);

  const fid = (n: string) => `${uid}-${n}`;
  const groups: readonly { readonly title: string; readonly key: ProviderPreset["group"] }[] = [
    { title: "Hosted", key: "hosted" },
    { title: "On this computer", key: "local" },
    { title: "Other", key: "custom" },
  ];

  return (
    <form
      className="pw"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="pw-section">
        <div className="pw-label" id={fid("preset")}>
          Provider
        </div>
        <div role="radiogroup" aria-labelledby={fid("preset")} className="pw-presets">
          {groups.map((g) => (
            <div key={g.key} className="pw-preset-group">
              <span className="pw-group-title">{g.title}</span>
              <div className="pw-preset-grid">
                {PROVIDER_CATALOG.filter((p) => p.group === g.key).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={presetId === p.id}
                    className={presetId === p.id ? "pw-preset selected" : "pw-preset"}
                    onClick={() => choosePreset(p)}
                    data-autofocus={autoFocus && p === PROVIDER_CATALOG[0] ? "" : undefined}
                  >
                    <span className="pw-preset-name">
                      {p.label}
                      {presetId === p.id && <CheckIcon aria-hidden="true" />}
                    </span>
                    <span className="pw-preset-desc">{p.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {editing && !preset && <p className="pw-hint">Editing the configured provider. Pick a preset to start from different defaults.</p>}
      </div>

      <div className="pw-grid">
        <Field id={fid("name")} label="Display name" error={show("displayName")}>
          <input
            id={fid("name")}
            value={displayName}
            aria-invalid={show("displayName") ? true : undefined}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setDisplayName(v);
              if (!idTouched) setProviderId(slugifyProviderId(v));
            }}
            onBlur={() => touch("displayName")}
            placeholder="Acme gateway"
          />
        </Field>
        <Field id={fid("pid")} label="Provider ID" hint="Lowercase name for requests and the stored credential." error={show("providerId")}>
          <input
            id={fid("pid")}
            value={providerId}
            aria-invalid={show("providerId") ? true : undefined}
            onChange={(e) => {
              setIdTouched(true);
              setProviderId(e.currentTarget.value);
            }}
            onBlur={() => touch("providerId")}
            placeholder="acme-gateway"
          />
        </Field>
      </div>

      <Field id={fid("url")} label="Base URL" hint={preset?.id === "azure-openai" ? "Replace your-resource and your-deployment with your own." : "Where requests are sent, usually ending in /v1."} error={show("baseURL")}>
        <input
          id={fid("url")}
          type="url"
          value={baseURL}
          aria-invalid={show("baseURL") ? true : undefined}
          onChange={(e) => {
            setBaseURL(e.currentTarget.value);
            setCatalog(undefined);
          }}
          onBlur={() => touch("baseURL")}
          placeholder="https://gateway.example/v1"
        />
      </Field>

      <div className="pw-grid">
        <Field id={fid("proto")} label="API protocol" hint="The wire format this provider speaks.">
          <select
            id={fid("proto")}
            value={protocol}
            onChange={(e) => {
              setProtocol(e.currentTarget.value as ApiProtocolLabel);
              setCatalog(undefined);
            }}
          >
            {API_PROTOCOL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id={fid("key")}
          label="API key"
          hint={
            keyOptional
              ? "Optional. Local servers usually need no key."
              : editing
                ? "Re-enter the key to save changes; it is stored on this computer, never in the event log."
                : (preset?.keyHint ?? "Stored on this computer, never in the event log.")
          }
          error={show("apiKey")}
          action={
            <button type="button" className="pw-link" aria-pressed={showKey} onClick={() => setShowKey((v) => !v)}>
              {showKey ? "Hide key" : "Show key"}
            </button>
          }
        >
          <input
            id={fid("key")}
            type={showKey ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            aria-invalid={show("apiKey") ? true : undefined}
            onChange={(e) => setApiKey(e.currentTarget.value)}
            onBlur={() => touch("apiKey")}
          />
        </Field>
      </div>
      {preset?.docsUrl && (
        <p className="pw-hint">
          Need a key?{" "}
          <a href={preset.docsUrl} target="_blank" rel="noreferrer">
            Get one from {preset.label}
          </a>
        </p>
      )}

      <Field id={fid("model")} label="Model" hint="Fetch the provider's list, or type any model ID." error={show("model")}>
        <div className="pw-model" ref={modelWrapRef}>
          <div className="pw-model-row">
            <input
              id={fid("model")}
              role="combobox"
              aria-expanded={listOpen && filtered.length > 0}
              aria-controls={fid("models")}
              aria-autocomplete="list"
              aria-invalid={show("model") ? true : undefined}
              value={model}
              autoComplete="off"
              spellCheck={false}
              placeholder="model-id"
              onChange={(e) => {
                setModel(e.currentTarget.value);
                setListOpen(true);
                setActive(0);
              }}
              onFocus={() => catalog?.ok && setListOpen(true)}
              onBlur={() => touch("model")}
              onKeyDown={(e) => {
                if (!listOpen || filtered.length === 0) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => (a + 1) % filtered.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => (a - 1 + filtered.length) % filtered.length);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  setModel(filtered[active] ?? model);
                  setListOpen(false);
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setListOpen(false);
                }
              }}
            />
            <button type="button" disabled={catalogBusy || validUrl(baseURL) !== undefined} onClick={() => void fetchModels()}>
              {catalogBusy ? "Fetching…" : "Fetch models"}
            </button>
          </div>
          {listOpen && filtered.length > 0 && (
            <ul id={fid("models")} role="listbox" aria-label="Available models" className="pw-models">
              {filtered.map((m, i) => (
                <li key={m} role="option" aria-selected={m === model} className={i === active ? "pw-option active" : "pw-option"} onMouseDown={(e) => e.preventDefault()} onClick={() => { setModel(m); setListOpen(false); }}>
                  {m}
                  {m === model && <CheckIcon aria-hidden="true" />}
                </li>
              ))}
            </ul>
          )}
        </div>
        {catalog && !catalog.ok && (
          <p role="alert" className="form-error">
            Could not fetch models: {catalog.reason} You can still type a model ID.
          </p>
        )}
        {catalog?.ok && (
          <p role="status" className="pw-hint">
            Found {catalog.models.length} model{catalog.models.length === 1 ? "" : "s"}. Type to filter.
          </p>
        )}
      </Field>

      {error && (
        <p role="alert" className="form-error pw-submit-error">
          {error}
        </p>
      )}
      <div className="pw-actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
        <button type="submit" className="pw-primary" disabled={busy || !valid}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  action,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string | undefined;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="pw-field">
      <div className="pw-label-row">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      {children}
      {error ? (
        <p className="pw-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="pw-hint">{hint}</p>
      ) : null}
    </div>
  );
}
