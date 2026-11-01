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
  DEFAULT_AZURE_API_VERSION,
  PROVIDER_CATALOG,
  PROVIDER_GROUPS,
  PROVIDER_ID_PATTERN,
  capabilityErrorMessage,
  protocolToWire,
  slugifyProviderId,
  wireToProtocol,
  type ApiProtocolLabel,
  type ProviderPreset,
} from "./providerCatalog.ts";

/** The shape `provider.test` answers with (see src/capabilities/providerSwitch.ts). */
export interface ProviderTestOutcome {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly modelCount?: number;
  readonly message: string;
}

export interface ProviderWizardInitial {
  readonly providerId: string;
  readonly displayName?: string;
  /** A key is already stored: leaving the key field blank keeps it. */
  readonly hasKey?: boolean;
  readonly keyless?: boolean;
  readonly auth?: "bearer" | "none" | "api-key";
  readonly apiVersion?: string;
  readonly baseURL: string;
  /** Wire protocol value as stored. */
  readonly protocol: string;
  readonly model: string;
}

function wireProtocolOf(wire: string): string {
  return protocolToWire(wireToProtocol(wire));
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
  const [displayName, setDisplayName] = useState(initial?.displayName ?? initial?.providerId ?? "");
  const [providerId, setProviderId] = useState(initial?.providerId ?? "");
  const [idTouched, setIdTouched] = useState(editing);
  const [baseURL, setBaseURL] = useState(initial?.baseURL ?? "");
  const [protocol, setProtocol] = useState<ApiProtocolLabel>(initial ? wireToProtocol(initial.protocol) : API_PROTOCOL_OPTIONS[0]);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(initial?.model ?? "");
  const [apiVersion, setApiVersion] = useState(initial?.apiVersion ?? "");
  const [azureFlag, setAzureFlag] = useState(initial?.auth === "api-key");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestOutcome | undefined>(undefined);
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
  const azure = azureFlag || preset?.azure === true;
  const keyStored = editing && initial?.hasKey === true;
  const keyOptional = preset?.auth === "none" || (editing && !preset && initial?.keyless === true);
  const touch = (k: string) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));

  const choosePreset = useCallback((p: ProviderPreset) => {
    setPresetId(p.id);
    setAzureFlag(p.azure === true);
    setApiVersion(p.azure ? DEFAULT_AZURE_API_VERSION : "");
    setTestResult(undefined);
    setBaseURL(p.baseURL);
    setProtocol(p.azure ? "OpenAI Chat Completions" : p.protocol);
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
    apiKey: keyOptional || keyStored || apiKey.trim() ? undefined : "API key is required.",
    apiVersion: azure && !apiVersion.trim() ? "Azure needs an api-version, for example 2024-10-21." : undefined,
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
        ...(apiKey.trim() ? { apiKey } : keyStored ? { providerId: initial!.providerId } : {}),
        ...(azure ? { auth: "api-key", apiVersion: apiVersion.trim() } : keyOptional ? { auth: "none" } : {}),
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
  }, [client, protocol, baseURL, apiKey, azure, apiVersion, keyOptional, keyStored, initial]);

  const testConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(undefined);
    try {
      const unchanged = keyStored && !apiKey.trim() && baseURL.trim() === initial!.baseURL && protocolToWire(protocol) === wireProtocolOf(initial!.protocol);
      const input = unchanged
        ? { providerId: initial!.providerId }
        : {
            baseURL: baseURL.trim(),
            protocol: protocolToWire(protocol),
            ...(apiKey.trim() ? { apiKey } : keyStored ? { providerId: initial!.providerId } : {}),
            ...(azure ? { auth: "api-key", apiVersion: apiVersion.trim() } : keyOptional ? { auth: "none" } : {}),
          };
      setTestResult((await client.invoke("provider.test", input as never)) as unknown as ProviderTestOutcome);
    } catch (err) {
      setTestResult({ ok: false, latencyMs: 0, message: capabilityErrorMessage(err) });
    } finally {
      setTesting(false);
    }
  }, [client, keyStored, apiKey, baseURL, protocol, initial, azure, apiVersion, keyOptional]);

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
        ...(apiKey.trim() ? { apiKey } : {}),
        ...(azure ? { auth: "api-key", apiVersion: apiVersion.trim() } : keyOptional ? { auth: "none" } : {}),
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      } as never);
      toast.show("Model provider saved");
      onSaved();
    } catch (err) {
      setError(capabilityErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [valid, busy, client, providerId, baseURL, protocol, model, apiKey, azure, apiVersion, keyOptional, displayName, toast, onSaved]);

  const fid = (n: string) => `${uid}-${n}`;
  const groups = PROVIDER_GROUPS;

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
                    data-preset={p.id}
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
        {preset && !preset.verified && (
          <p className="pw-hint pw-unverified" role="note">
            {preset.baseURL ? "This address comes from the provider's published docs and has not been checked by Workbench. Use Test connection before saving." : (preset.guidance ?? "Enter the endpoint from your provider's docs.")}
            {preset.baseURL && preset.guidance ? ` ${preset.guidance}` : ""}
          </p>
        )}
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

      <Field id={fid("url")} label="Base URL" hint={azure ? "The deployment URL, ending in /deployments/your-deployment-name. Replace your-resource and your-deployment." : "Where requests are sent, usually ending in /v1."} error={show("baseURL")}>
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

      {azure && (
        <Field id={fid("apiver")} label="API version" hint="Azure requires an api-version query. Azure OpenAI works with the Chat Completions protocol only." error={show("apiVersion")}>
          <input id={fid("apiver")} value={apiVersion} aria-invalid={show("apiVersion") ? true : undefined} onChange={(e) => { setApiVersion(e.currentTarget.value); setTestResult(undefined); }} onBlur={() => touch("apiVersion")} placeholder={DEFAULT_AZURE_API_VERSION} />
        </Field>
      )}

      <div className="pw-grid">
        <Field id={fid("proto")} label="API protocol" hint={azure ? "Azure uses Chat Completions." : "The wire format this provider speaks."}>
          <select
            id={fid("proto")}
            disabled={azure}
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
              : keyStored
                ? "A key is stored for this provider. Leave blank to keep it, or paste a new one to replace it."
                : editing
                ? "Stored in your system's secret store, never in the event log."
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
            placeholder={keyStored ? "Stored — leave blank to keep" : undefined}
            onChange={(e) => {
              setApiKey(e.currentTarget.value);
              setTestResult(undefined);
            }}
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

      {testResult && (
        <p role={testResult.ok ? "status" : "alert"} className={testResult.ok ? "pw-test pw-test-ok" : "pw-test pw-test-fail"} data-test-result={testResult.ok ? "ok" : "failed"}>
          {testResult.ok ? <CheckIcon aria-hidden="true" /> : null}
          <span>
            {testResult.message}
          </span>
        </p>
      )}
      {error && (
        <p role="alert" className="form-error pw-submit-error">
          {error}
        </p>
      )}
      <div className="pw-actions">
        <button type="button" className="pw-test-btn" disabled={testing || validUrl(baseURL) !== undefined || (azure && !apiVersion.trim())} onClick={() => void testConnection()}>
          {testing ? "Testing…" : "Test connection"}
        </button>
        <span className="pw-actions-spacer" />
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
