// Settings → Governance & evidence: which authority decides approvals (SEA-Forge or Workbench), whether
// settlement runs, and the proof that judges the selected workspace's agent runs. Every block degrades to a
// plain message: the capabilities are read-only or operator-only, and the UI works without governance.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useCognate } from "@godspeedai/cognate-react";
import { copyToClipboard } from "./download.ts";

interface GovernanceStatus {
  readonly mode: "off" | "sea-forge";
  readonly worldRef?: string;
  readonly operator?: string;
  readonly service?: string;
}

interface ProofSource {
  readonly kind: "swe_seed_eval_spec";
  readonly specPath: string;
  readonly specSha256: string;
  readonly specId: string;
  readonly specVersion: string;
  readonly checkId: string;
}

interface DeclaredProof {
  readonly workspaceId: string;
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly timeoutS?: number;
  readonly declaredBy?: string;
  readonly source?: ProofSource;
}

interface ProofCurrent {
  readonly settlementActive: boolean;
  readonly proofSource: "any" | "swe_seed";
  readonly sweSeedConfigured: boolean;
  readonly declared: DeclaredProof | null;
}

/** The capability's own message, unprefixed-stripped and unchanged: the operator sees what was refused. */
function verbatimError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const json = /failed: (\{.*\})\s*$/s.exec(raw)?.[1];
  if (json) {
    try {
      const message = (JSON.parse(json) as { message?: string }).message;
      if (message) return message;
    } catch {
      /* fall through to the raw text */
    }
  }
  return raw;
}

const SOURCE_LABEL: Record<ProofCurrent["proofSource"], string> = {
  any: "any: a typed command or a SWE_SEED contract",
  swe_seed: "swe_seed: only SWE_SEED contracts",
};

/** Short digest for display; the full value stays in the title attribute. */
function shortSha(value: string): string {
  const hex = value.replace(/^sha256:/, "");
  return `sha256:${hex.slice(0, 12)}…`;
}

function GovernanceAuthority() {
  const client = useCognate();
  const [status, setStatus] = useState<GovernanceStatus | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    client
      .invoke("governance.status", {} as never)
      .then((result) => {
        if (live) setStatus(result as unknown as GovernanceStatus);
      })
      .catch((e: unknown) => {
        if (live) setError(verbatimError(e));
      });
    return () => {
      live = false;
    };
  }, [client]);

  const copyWorldRef = async (worldRef: string) => {
    setCopied(await copyToClipboard(worldRef));
  };

  return (
    <section aria-labelledby="governance-authority-heading" className="provider-card governance-card">
      <h4 id="governance-authority-heading">Authority</h4>
      {error !== undefined ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : status === undefined ? (
        <p className="settings-subtitle">Checking the approval authority…</p>
      ) : status.mode === "sea-forge" ? (
        <>
          <p className="settings-description">SEA-Forge decides every capability and action. Agent edits, shell commands and code runs wait for your approval.</p>
          <div className="plugin-row-text">
            <span className="plugin-description">World ref</span>
            <span className="governance-world-ref">
              <code title={status.worldRef}>{status.worldRef}</code>
              <button type="button" className="governance-copy" aria-label="Copy world ref" onClick={() => void copyWorldRef(status.worldRef ?? "")}>
                Copy
              </button>
              {copied && (
                <span role="status" className="settings-subtitle">
                  {" "}
                  Copied
                </span>
              )}
            </span>
          </div>
          <div className="plugin-row-text">
            <span className="plugin-description">Operator actor</span>
            <code>{status.operator}</code>
          </div>
          <div className="plugin-row-text">
            <span className="plugin-description">Service actor</span>
            <code>{status.service}</code>
          </div>
        </>
      ) : (
        <p className="settings-description">
          Workbench decides its own approvals. To make SEA-Forge the authority, start Workbench with COGNATE_GOVERNANCE=sea-forge (docs/sea-forge-authority.md).
        </p>
      )}
    </section>
  );
}

function GovernanceSettlement({ current, currentError }: { readonly current: ProofCurrent | undefined; readonly currentError: string | undefined }) {
  // workspace.proof.current answers with the settlement configuration even when no workspace is selected.
  const error = currentError;
  const on = current?.settlementActive;
  const proofSource = current?.proofSource;

  return (
    <section aria-labelledby="governance-settlement-heading" className="provider-card governance-card">
      <h4 id="governance-settlement-heading">Settlement</h4>
      {error !== undefined ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : on === undefined ? (
        <p className="settings-subtitle">Checking settlement…</p>
      ) : on ? (
        <>
          <p className="settings-description">Settlement is on. SEA-Forge settles each agent run on the evidence RealityTrace recorded.</p>
          {proofSource !== undefined && (
            <div className="plugin-row-text">
              <span className="plugin-description">Proof source</span>
              <span>{SOURCE_LABEL[proofSource]}</span>
            </div>
          )}
        </>
      ) : (
        <p className="settings-description">
          Settlement is off. Start Workbench with COGNATE_GOVERNANCE=sea-forge and set COGNATE_REALITYTRACE_BIN, COGNATE_REALITYTRACE_DATA_HOME and COGNATE_REALITYTRACE_STATE_HOME
          to turn it on (docs/sea-forge-authority.md, "Settlement").
        </p>
      )}
    </section>
  );
}

type ProofTab = "contract" | "command";

function ProofDeclaration({ workspaceId, current, onDeclared }: { readonly workspaceId: string; readonly current: ProofCurrent; readonly onDeclared: () => void }) {
  const client = useCognate();
  const commandAllowed = current.proofSource !== "swe_seed";
  const [tab, setTab] = useState<ProofTab>(commandAllowed ? "command" : "contract");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);
  // SWE_SEED contract fields
  const [specPath, setSpecPath] = useState("");
  const [specSha256, setSpecSha256] = useState("");
  const [checkId, setCheckId] = useState("");
  const [contractTimeout, setContractTimeout] = useState("");
  // Command fields
  const [argvText, setArgvText] = useState("");
  const [cwd, setCwd] = useState("");
  const [commandTimeout, setCommandTimeout] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setConfirmation(undefined);
    try {
      if (tab === "contract") {
        const timeout = contractTimeout.trim() === "" ? {} : { timeoutS: Number(contractTimeout) };
        await client.invoke("workspace.proof.declare_contract", { workspaceId, specPath: specPath.trim(), specSha256: specSha256.trim(), checkId: checkId.trim(), ...timeout } as never);
        setConfirmation("SWE_SEED contract declared. It applies to runs that start from now on.");
      } else {
        const argv = argvText.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
        const dir = cwd.trim() === "" ? {} : { cwd: cwd.trim() };
        const timeout = commandTimeout.trim() === "" ? {} : { timeoutS: Number(commandTimeout) };
        await client.invoke("workspace.proof.declare", { workspaceId, argv, ...dir, ...timeout } as never);
        setConfirmation("Command proof declared. It applies to runs that start from now on.");
      }
      onDeclared();
    } catch (e) {
      setError(verbatimError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Declare proof" className="provider-card">
      {commandAllowed ? (
        <div role="tablist" aria-label="Proof kind" className="add-provider-tabs">
          <button type="button" role="tab" id="proof-tab-command" aria-selected={tab === "command"} aria-controls="proof-panel" className={tab === "command" ? "tab active" : "tab"} onClick={() => setTab("command")}>
            Command
          </button>
          <button type="button" role="tab" id="proof-tab-contract" aria-selected={tab === "contract"} aria-controls="proof-panel" className={tab === "contract" ? "tab active" : "tab"} onClick={() => setTab("contract")}>
            SWE_SEED contract
          </button>
        </div>
      ) : (
        <p className="settings-subtitle">Command proofs are hidden: COGNATE_PROOF_SOURCE=swe_seed accepts only SWE_SEED contracts.</p>
      )}
      <div role="tabpanel" id="proof-panel" aria-labelledby={commandAllowed ? `proof-tab-${tab}` : undefined}>
        {tab === "contract" ? (
          <>
            {!current.sweSeedConfigured && <p className="settings-subtitle">SWE_SEED is not configured (COGNATE_SWE_SEED_BIN), so a contract cannot be declared yet.</p>}
            <label>
              Spec path (relative to the workspace)
              <input value={specPath} onChange={(e) => setSpecPath(e.currentTarget.value)} placeholder="eval/spec.toml" required />
            </label>
            <label>
              SHA-256
              <input value={specSha256} onChange={(e) => setSpecSha256(e.currentTarget.value)} placeholder="sha256:…" required />
            </label>
            <label>
              Check id
              <input value={checkId} onChange={(e) => setCheckId(e.currentTarget.value)} placeholder="tests-pass" required />
            </label>
            <label>
              Timeout seconds (optional)
              <input type="number" min={1} max={3600} step={1} value={contractTimeout} onChange={(e) => setContractTimeout(e.currentTarget.value)} />
            </label>
          </>
        ) : (
          <>
            <label>
              Command (one argument per line)
              <textarea aria-label="Command (one argument per line)" value={argvText} onChange={(e) => setArgvText(e.currentTarget.value)} rows={3} placeholder={"bun\ntest"} required />
            </label>
            <label>
              Working directory (optional)
              <input value={cwd} onChange={(e) => setCwd(e.currentTarget.value)} placeholder="." />
            </label>
            <label>
              Timeout seconds (optional)
              <input type="number" min={1} max={3600} step={1} value={commandTimeout} onChange={(e) => setCommandTimeout(e.currentTarget.value)} />
            </label>
          </>
        )}
      </div>
      {error !== undefined && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {confirmation !== undefined && (
        <p role="status" className="settings-subtitle">
          {confirmation}
        </p>
      )}
      <div className="modal-actions">
        <button type="submit" disabled={busy}>
          {busy ? "Declaring…" : "Declare proof"}
        </button>
      </div>
    </form>
  );
}

function GovernanceProof({
  workspaceId,
  current,
  error,
  onDeclared,
}: {
  readonly workspaceId: string | undefined;
  readonly current: ProofCurrent | undefined;
  readonly error: string | undefined;
  readonly onDeclared: () => void;
}) {
  if (workspaceId === undefined) {
    return (
      <section aria-labelledby="governance-proof-heading" className="provider-card governance-card">
        <h4 id="governance-proof-heading">Proof for the selected workspace</h4>
        <p className="settings-description">Select a workspace to declare the proof that judges its agent runs.</p>
      </section>
    );
  }
  const declared = current?.declared ?? null;
  const source = declared?.source;
  return (
    <section aria-labelledby="governance-proof-heading" className="provider-card governance-card">
      <h4 id="governance-proof-heading">Proof for the selected workspace</h4>
      {error !== undefined ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : current === undefined ? (
        <p className="settings-subtitle">Loading the proof…</p>
      ) : declared === null ? (
        <p className="settings-description">No proof declared. Agent runs in this workspace are not settled.</p>
      ) : (
        <>
          {source !== undefined ? (
            <dl className="governance-proof-facts">
              <dt>Spec path</dt>
              <dd>
                <code>{source.specPath}</code>
              </dd>
              <dt>Check id</dt>
              <dd>
                <code>{source.checkId}</code>
              </dd>
              <dt>Spec</dt>
              <dd>
                <code>
                  {source.specId} {source.specVersion}
                </code>
              </dd>
              <dt>SHA-256</dt>
              <dd>
                <code title={source.specSha256}>{shortSha(source.specSha256)}</code>
              </dd>
              <dt>Declared by</dt>
              <dd>
                <code>{declared.declaredBy ?? "unknown"}</code>
              </dd>
            </dl>
          ) : (
            <dl className="governance-proof-facts">
              <dt>Command</dt>
              <dd>
                <code>{(declared.argv ?? []).join(" ")}</code>
              </dd>
              <dt>Declared by</dt>
              <dd>
                <code>{declared.declaredBy ?? "unknown"}</code>
              </dd>
            </dl>
          )}
          <p className="settings-subtitle">Applies to runs that start after it was declared.</p>
        </>
      )}
      {current !== undefined && (
        <ProofDeclaration key={workspaceId} workspaceId={workspaceId} current={current} onDeclared={onDeclared} />
      )}
    </section>
  );
}

/** Settings → Governance & evidence. Owns the selected workspace's proof so the settlement and proof blocks
 *  agree, and refreshes it after a declaration. */
export function GovernancePane({ workspaceId }: { readonly workspaceId: string | undefined }) {
  const client = useCognate();
  const [current, setCurrent] = useState<ProofCurrent | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setCurrent(undefined);
    setError(undefined);
  }, [workspaceId]);

  useEffect(() => {
    let live = true;
    client
      .invoke("workspace.proof.current", (workspaceId === undefined ? {} : { workspaceId }) as never)
      .then((result) => {
        if (live) setCurrent(result as unknown as ProofCurrent);
      })
      .catch((e: unknown) => {
        if (live) setError(verbatimError(e));
      });
    return () => {
      live = false;
    };
  }, [client, workspaceId, revision]);

  const onDeclared = useCallback(() => setRevision((r) => r + 1), []);

  return (
    <>
      <h3>Governance &amp; evidence</h3>
      <p className="settings-description">Who decides approvals, whether agent runs are settled, and the proof they are judged by.</p>
      <GovernanceAuthority />
      <GovernanceSettlement current={current} currentError={error} />
      <GovernanceProof workspaceId={workspaceId} current={current} error={error} onDeclared={onDeclared} />
    </>
  );
}
