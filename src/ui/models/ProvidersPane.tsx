// Settings -> Providers (PandaCode-style): one card per stored provider, each expandable with
// Test connection / Make active / Edit / Delete, and an "Add provider" wizard. Everything goes through
// capabilities (`provider.list|test|activate|delete`, `model.configure`); this file holds no key.
import { useCallback, useEffect, useState } from "react";
import { useCognate } from "@godspeedai/cognate-react";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, EditIcon, PlusIcon, ShieldIcon, TrashIcon } from "../icons.tsx";
import { useToast } from "../shell/Toast.tsx";
import { ProviderWizard, type ProviderTestOutcome, type ProviderWizardInitial } from "./ProviderWizard.tsx";
import { capabilityErrorMessage, wireToProtocol } from "./providerCatalog.ts";
import { keyStoreLabel, storageNote, useProviderList, useSecretsBackend, type StoredProvider } from "./useProviders.ts";

export interface ProvidersWizardRequest {
  /** Edit the active provider instead of adding a new one. */
  readonly edit?: boolean;
  /** Prefill this model when editing. */
  readonly model?: string;
  /** Edit this stored provider (wins over `edit`). */
  readonly providerId?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function initialFor(p: StoredProvider, model?: string): ProviderWizardInitial {
  return {
    providerId: p.providerId,
    displayName: p.displayName,
    hasKey: p.hasKey,
    keyless: p.keyless,
    ...(p.auth ? { auth: p.auth } : {}),
    ...(p.apiVersion ? { apiVersion: p.apiVersion } : {}),
    baseURL: p.baseURL,
    protocol: p.protocol,
    model: model ?? p.model,
  };
}

export function ProvidersPane({ startWizard }: { readonly startWizard?: ProvidersWizardRequest | undefined }) {
  const client = useCognate();
  const toast = useToast();
  const { providers, refresh } = useProviderList();
  const backend = useSecretsBackend();
  const [wizard, setWizard] = useState<{ readonly edit?: StoredProvider; readonly model?: string } | undefined>(startWizard && !startWizard.edit && !startWizard.providerId ? {} : undefined);
  const [pendingEdit, setPendingEdit] = useState<ProvidersWizardRequest | undefined>(startWizard?.edit || startWizard?.providerId ? startWizard : undefined);
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [tests, setTests] = useState<Readonly<Record<string, ProviderTestOutcome | "testing">>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [error, setError] = useState<{ readonly id: string; readonly text: string } | undefined>(undefined);

  // A request to edit the active (or a named) provider resolves once the list has loaded.
  useEffect(() => {
    if (!pendingEdit || !providers) return;
    const target = pendingEdit.providerId ? providers.find((p) => p.providerId === pendingEdit.providerId) : providers.find((p) => p.isCurrent);
    setPendingEdit(undefined);
    setWizard(target ? { edit: target, ...(pendingEdit.model ? { model: pendingEdit.model } : {}) } : {});
  }, [pendingEdit, providers]);

  const test = useCallback(
    async (p: StoredProvider) => {
      setTests((t) => ({ ...t, [p.providerId]: "testing" }));
      try {
        const r = (await client.invoke("provider.test", { providerId: p.providerId } as never)) as unknown as ProviderTestOutcome;
        setTests((t) => ({ ...t, [p.providerId]: r }));
      } catch (err) {
        setTests((t) => ({ ...t, [p.providerId]: { ok: false, latencyMs: 0, message: capabilityErrorMessage(err) } }));
      }
    },
    [client],
  );

  const activate = useCallback(
    async (p: StoredProvider) => {
      setBusy(p.providerId);
      setError(undefined);
      try {
        await client.invoke("provider.activate", { providerId: p.providerId } as never);
        toast.show(`${p.displayName} is now active`);
        refresh();
      } catch (err) {
        setError({ id: p.providerId, text: capabilityErrorMessage(err) });
      } finally {
        setBusy(undefined);
      }
    },
    [client, toast, refresh],
  );

  const remove = useCallback(
    async (p: StoredProvider) => {
      setBusy(p.providerId);
      setError(undefined);
      try {
        await client.invoke("provider.delete", { providerId: p.providerId } as never);
        setConfirmDelete(undefined);
        setOpen(undefined);
        toast.show(`${p.displayName} deleted`);
        refresh();
      } catch (err) {
        setError({ id: p.providerId, text: capabilityErrorMessage(err) });
        setConfirmDelete(undefined);
      } finally {
        setBusy(undefined);
      }
    },
    [client, toast, refresh],
  );

  if (wizard) {
    const editing = wizard.edit;
    return (
      <>
        <h3>{editing ? `Edit ${editing.displayName}` : "Add model provider"}</h3>
        <ProviderWizard
          {...(editing ? { initial: initialFor(editing, wizard.model) } : {})}
          submitLabel={editing ? (editing.isCurrent ? "Save changes" : "Save and make active") : "Create provider"}
          onCancel={() => setWizard(undefined)}
          onSaved={() => {
            setWizard(undefined);
            refresh();
          }}
        />
      </>
    );
  }

  return (
    <>
      <p className="prov-storage" data-storage-backend={backend?.backend ?? "unknown"}>
        <ShieldIcon aria-hidden="true" />
        <span>{storageNote(backend)}</span>
      </p>
      {providers === undefined ? (
        <p className="empty-state small" role="status">Loading providers…</p>
      ) : providers.length === 0 ? (
        <p className="empty-state small">No model provider configured yet.</p>
      ) : (
        <ul className="prov-list" aria-label="Providers">
          {providers.map((p) => {
            const isOpen = open === p.providerId;
            const t = tests[p.providerId];
            const keyText = p.keyless ? "No key needed" : p.hasKey ? `Key stored in ${keyStoreLabel(backend)}` : "No key stored";
            return (
              <li key={p.providerId} className={`prov-card${p.isCurrent ? " is-active" : ""}`} data-provider={p.providerId}>
                <button
                  type="button"
                  className="prov-head"
                  aria-expanded={isOpen}
                  aria-controls={`prov-body-${p.providerId}`}
                  onClick={() => setOpen(isOpen ? undefined : p.providerId)}
                >
                  {isOpen ? <ChevronDownIcon aria-hidden="true" /> : <ChevronRightIcon aria-hidden="true" />}
                  <span className="prov-name">{p.displayName}</span>
                  {p.isCurrent && <span className="prov-badge">Active</span>}
                  <span className="prov-model">{p.model}</span>
                  <span className={`prov-key${!p.keyless && !p.hasKey ? " is-missing" : ""}`}>
                    {(p.keyless || p.hasKey) && <CheckIcon aria-hidden="true" />}
                    {keyText}
                  </span>
                </button>
                {isOpen && (
                  <div className="prov-body" id={`prov-body-${p.providerId}`}>
                    <dl className="prov-facts">
                      <dt>Protocol</dt>
                      <dd>{wireToProtocol(p.protocol)}</dd>
                      <dt>Base URL</dt>
                      <dd>
                        <code title={p.baseURL}>{p.baseURL}</code>
                      </dd>
                      {p.apiVersion && (
                        <>
                          <dt>API version</dt>
                          <dd>{p.apiVersion}</dd>
                        </>
                      )}
                      <dt>Model</dt>
                      <dd>
                        <code>{p.model}</code>
                      </dd>
                      <dt>Host</dt>
                      <dd>{hostOf(p.baseURL)}</dd>
                    </dl>
                    {t && t !== "testing" && (
                      <p role={t.ok ? "status" : "alert"} className={t.ok ? "pw-test pw-test-ok" : "pw-test pw-test-fail"} data-test-result={t.ok ? "ok" : "failed"}>
                        {t.ok ? <CheckIcon aria-hidden="true" /> : null}
                        <span>{t.message}</span>
                      </p>
                    )}
                    {error?.id === p.providerId && (
                      <p role="alert" className="form-error">
                        {error.text}
                      </p>
                    )}
                    <div className="prov-actions">
                      <button type="button" aria-label={`Test connection for ${p.displayName}`} disabled={t === "testing"} onClick={() => void test(p)}>
                        {t === "testing" ? "Testing…" : "Test connection"}
                      </button>
                      {!p.isCurrent && (
                        <button type="button" aria-label={`Make ${p.displayName} active`} disabled={busy === p.providerId} onClick={() => void activate(p)}>
                          Make active
                        </button>
                      )}
                      <button type="button" aria-label={`Edit ${p.displayName}`} onClick={() => setWizard({ edit: p })}>
                        <EditIcon aria-hidden="true" /> Edit
                      </button>
                      <span className="prov-actions-spacer" />
                      {confirmDelete === p.providerId ? (
                        <span className="provider-delete-confirm">
                          <span role="status" className="provider-delete-confirm-text">
                            Delete {p.displayName} and its stored key? This cannot be undone.
                          </span>
                          <button type="button" className="danger-btn" disabled={busy === p.providerId} onClick={() => void remove(p)}>
                            Yes, delete
                          </button>
                          <button type="button" onClick={() => setConfirmDelete(undefined)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button type="button" aria-label={`Delete ${p.displayName}`} onClick={() => setConfirmDelete(p.providerId)}>
                          <TrashIcon aria-hidden="true" /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="add-provider-btn" onClick={() => setWizard({})}>
        <PlusIcon /> Add provider
      </button>
    </>
  );
}
