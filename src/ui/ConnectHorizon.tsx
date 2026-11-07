// Settings → Connect Horizon: asks the server to mint Horizon's session key and write it beside the setup.
// The browser only ever learns the expiry date; the key never crosses to it.
import { useCallback, useState } from "react";
import { useCognate } from "@godspeedai/cognate-react";

export type ConnectState =
  | { readonly kind: "idle" }
  | { readonly kind: "working" }
  | { readonly kind: "done"; readonly expiresAt: string }
  | { readonly kind: "failed"; readonly message: string };

export function ConnectHorizonView({ state, onConnect }: { readonly state: ConnectState; readonly onConnect: () => void }) {
  return (
    <section aria-labelledby="connect-horizon-h" className="settings-card">
      <h3 id="connect-horizon-h">Connect Horizon</h3>
      <p>Lets Horizon read the workshop with its own key. The key is written to a file next to this setup and is never shown here. It lasts 90 days.</p>
      <button type="button" onClick={onConnect} disabled={state.kind === "working"}>{state.kind === "done" ? "Connect Horizon again" : "Connect Horizon"}</button>
      {state.kind === "done" ? <p role="status">Connected. The key expires on {state.expiresAt.slice(0, 10)}.</p> : null}
      {state.kind === "failed" ? <p role="alert">Could not connect: {state.message}</p> : null}
    </section>
  );
}

export function ConnectHorizon() {
  const client = useCognate();
  const [state, setState] = useState<ConnectState>({ kind: "idle" });
  const onConnect = useCallback(async () => {
    setState({ kind: "working" });
    try {
      const result = (await client.invoke("identity.connectHorizon", {} as never)) as { expiresAt: string };
      setState({ kind: "done", expiresAt: result.expiresAt });
    } catch (error) {
      setState({ kind: "failed", message: error instanceof Error ? error.message : "unknown error" });
    }
  }, [client]);
  return <ConnectHorizonView state={state} onConnect={() => void onConnect()} />;
}
