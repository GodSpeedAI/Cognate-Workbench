// Settings -> Agents: the native Cognate agent plus the external agent CLIs found on the server host.
// Detection runs on the machine that runs Workbench (never in the browser). Sign-in belongs to each CLI.
import { useState } from "react";
import { BotIcon, CheckIcon, CopyIcon, ExternalLinkIcon, TerminalIcon } from "../icons.tsx";
import { useToast } from "../shell/Toast.tsx";
import { useHarnessList, type HarnessInfo } from "./useHarness.ts";

function CopyCommand({ command }: { readonly command: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  return (
    <span className="agent-cmd">
      <code>{command}</code>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Copy install command ${command}`}
        title="Copy command"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(
            () => {
              setDone(true);
              toast.show("Command copied");
              setTimeout(() => setDone(false), 1500);
            },
            () => toast.show("Could not copy"),
          );
        }}
      >
        {done ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      </button>
    </span>
  );
}

function protocolLabel(p: string): string {
  return p === "claude-stream-json" ? "Claude stream-json" : p === "codex-app-server" ? "Codex app-server" : p === "acp" ? "ACP" : p;
}

function HarnessRow({ h }: { readonly h: HarnessInfo }) {
  return (
    <li className={`agent-card${h.installed ? " is-installed" : ""}`} data-harness={h.id}>
      <div className="agent-head">
        <TerminalIcon aria-hidden="true" />
        <span className="agent-name">{h.label}</span>
        <span className={`agent-pill ${h.installed ? "is-ok" : "is-off"}`}>{h.installed ? "Installed" : "Not installed"}</span>
        <span className={`agent-pill ${h.verification === "verified" ? "is-verified" : "is-unverified"}`} title={h.verification === "verified" ? "Workbench's integration with this CLI has been exercised." : "Workbench's integration with this CLI follows its documented interface but has not been verified against a real install."}>
          {h.verification === "verified" ? "Verified" : "Unverified"}
        </span>
        {h.version && <span className="agent-version">{h.version}</span>}
      </div>
      {h.installed ? (
        <dl className="agent-facts">
          {h.path && (
            <>
              <dt>Location</dt>
              <dd>
                <code title={h.path}>{h.path}</code>
              </dd>
            </>
          )}
          <dt>Protocol</dt>
          <dd>{protocolLabel(h.protocol)}</dd>
          <dt>Approvals</dt>
          <dd>{h.supportsApprovals ? "Tool calls ask you in Workbench" : "Uses the CLI's own permission rules"}</dd>
          <dt>Sign-in</dt>
          <dd>{h.signInHint}</dd>
        </dl>
      ) : (
        <div className="agent-install">
          <p className="agent-reason">{h.reasonUnavailable ?? "Not found on this computer."}</p>
          <p>
            <a href={h.installHint.url} target="_blank" rel="noreferrer">
              Install {h.label} <ExternalLinkIcon aria-hidden="true" />
            </a>
          </p>
          {h.installHint.command && <CopyCommand command={h.installHint.command} />}
        </div>
      )}
    </li>
  );
}

export function AgentsPane() {
  const { harnesses, host, refreshing, error, refresh } = useHarnessList();
  const installed = harnesses?.filter((h) => h.installed) ?? [];
  const rest = harnesses?.filter((h) => !h.installed) ?? [];
  return (
    <>
      <div className="agent-toolbar">
        <p className="settings-subtitle">
          Choose an agent per session from the composer. {host ? `Detected on this computer (${host.platform}/${host.arch}).` : ""}
        </p>
        <button type="button" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? "Checking…" : "Refresh"}
        </button>
      </div>
      <ul className="agent-list" aria-label="Agents">
        <li className="agent-card is-native" data-harness="native">
          <div className="agent-head">
            <BotIcon aria-hidden="true" />
            <span className="agent-name">Cognate agent</span>
            <span className="agent-pill is-ok">Built in</span>
            <span className="agent-pill is-verified">Default</span>
          </div>
          <dl className="agent-facts">
            <dt>Runs</dt>
            <dd>Through your active model provider, inside the workspace's containment, with approvals and evidence checks.</dd>
          </dl>
        </li>
        {harnesses === undefined && !error && <li className="empty-state small" role="status">Looking for agent CLIs…</li>}
        {error && (
          <li role="alert" className="form-error">
            Could not detect agent CLIs: {error}
          </li>
        )}
        {installed.map((h) => (
          <HarnessRow key={h.id} h={h} />
        ))}
        {rest.map((h) => (
          <HarnessRow key={h.id} h={h} />
        ))}
      </ul>
    </>
  );
}
