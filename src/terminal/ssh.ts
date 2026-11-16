// SSH terminal port: one interactive shell channel per session over ssh2, reusing the same
// durable facts the execution-world SSH provider relies on — the confirmed host-key
// fingerprint (verified again at every terminal spawn; there is no trust-on-first-use) and
// the credentials the operator stored in the secret store. The SDK's own SSH provider keeps
// its connection private, so the terminal opens its own; the fingerprint policy is identical.
import { readFileSync } from "node:fs";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import { fingerprintOf, type HostKeyPolicy } from "@godspeedai/cognate-execution-ssh";
import type { TerminalExitInfo, TerminalHandle, TerminalPort, TerminalSpawnCallbacks, TerminalSpawnSpec } from "./types.ts";
import { TerminalSpawnError } from "./types.ts";

/** The durable facts `execution.world.connect` recorded for one SSH world. */
export interface SshConnectionFacts {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly hostKeyFingerprint: string;
  readonly auth:
    | { readonly kind: "password"; readonly password?: string }
    | { readonly kind: "key"; readonly privateKeyPath: string; readonly passphrase?: string }
    | { readonly kind: "agent" };
}

const READY_TIMEOUT_MS = 15_000;
const TERMINATE_GRACE_MS = 1_500;

/** Open one interactive shell channel. The host key must match the recorded fingerprint. */
export function sshTerminalPort(): TerminalPort {
  return {
    kind: "ssh",
    spawn(spec: TerminalSpawnSpec, on: TerminalSpawnCallbacks): Promise<TerminalHandle> {
      const facts = spec.worldFacts as SshConnectionFacts | undefined;
      if (!facts || typeof facts.host !== "string" || typeof facts.hostKeyFingerprint !== "string") {
        return Promise.reject(new TerminalSpawnError("ssh terminal: connection facts are required"));
      }
      return new Promise<TerminalHandle>((resolve, reject) => {
        const config: ConnectConfig = {
          host: facts.host,
          port: facts.port,
          username: facts.username,
          readyTimeout: READY_TIMEOUT_MS,
          hostVerifier: (key: Buffer) => fingerprintOf(key) === facts.hostKeyFingerprint,
        };
        switch (facts.auth.kind) {
          case "password":
            if (!facts.auth.password) return reject(new TerminalSpawnError("ssh terminal: the stored password is missing"));
            config.password = facts.auth.password;
            break;
          case "key":
            try {
              config.privateKey = readFileSync(facts.auth.privateKeyPath, "utf8");
            } catch (error) {
              return reject(new TerminalSpawnError(`ssh terminal: cannot read the private key at ${facts.auth.privateKeyPath}: ${(error as Error).message}`));
            }
            if (facts.auth.passphrase) config.passphrase = facts.auth.passphrase;
            break;
          case "agent":
            config.agent = process.env.SSH_AUTH_SOCK;
            break;
        }

        const connection = new Client();
        let channel: ClientChannel | undefined;
        let settled = false;
        let ended = false;
        let exitInfo: TerminalExitInfo | undefined;
        const fail = (message: string) => {
          if (settled) return;
          settled = true;
          connection.end();
          reject(new TerminalSpawnError(message));
        };

        connection
          .on("ready", () => {
            connection.shell({ cols: spec.cols, rows: spec.rows, term: "xterm-256color" }, (error, shell) => {
              if (error) return fail(`ssh terminal: shell channel failed: ${error.message}`);
              channel = shell;
              settled = true;
              shell.on("data", (chunk: Buffer) => on.data(new Uint8Array(chunk)));
              shell.on("close", () => {
                if (ended) return;
                ended = true;
                connection.end();
                on.exit(exitInfo ?? { exitCode: null, reason: "exited" });
              });
              shell.stderr?.on("data", () => {
                /* stderr is multiplexed into 'data' for shell channels; kept for symmetry */
              });
              resolve({
                write: (data) => {
                  if (!ended) shell.write(data);
                },
                resize: (cols, rows) => {
                  if (!ended) shell.setWindow(rows, cols, 0, 0);
                },
                terminate: async () => {
                  if (ended) return (exitInfo ?? { exitCode: null, reason: "terminated" });
                  ended = true;
                  // No process group is reachable over SSH: close the channel (sends EOF),
                  // then drop the connection after a grace period if the server lingers.
                  exitInfo = { exitCode: null, reason: "terminated" };
                  shell.end();
                  await Bun.sleep(TERMINATE_GRACE_MS);
                  connection.end();
                  return exitInfo;
                },
              });
            });
          })
          .on("error", (error: Error) => {
            if (!settled) fail(`ssh terminal: connection failed: ${error.message}`);
            else if (!ended) {
              ended = true;
              on.exit({ exitCode: null, reason: "error", message: error.message });
            }
          })
          .on("end", () => {
            if (!ended && settled) {
              ended = true;
              on.exit(exitInfo ?? { exitCode: null, reason: "exited" });
            }
          })
          .connect(config);
      });
    },
  };
}

export type { HostKeyPolicy };
