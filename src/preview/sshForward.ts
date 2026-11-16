// J-PREVIEW-register: an SSH world's loopback is not the Workbench host's loopback. A preview in
// an SSH world is reached by a local forward over the world's own SSH connection — direct-tcpip
// channels from a Workbench-host listener to the remote port — never by binding a public
// interface. The host key is re-verified against the world's recorded fingerprint (no
// trust-on-first-use), the same policy the SSH terminal applies.
import { createServer, type Server } from "node:net";
import { readFileSync } from "node:fs";
import { Client, type ConnectConfig } from "ssh2";
import { fingerprintOf } from "@godspeedai/cognate-execution-ssh";
import type { SshConnectionFacts } from "../terminal/ssh.ts";

export interface SshForward {
  /** The Workbench-host loopback URL the browser can actually open. */
  readonly viewUrl: string;
  readonly localPort: number;
  close(): Promise<void>;
}

export class SshForwardError extends Error {
  override readonly name = "SshForwardError";
}

/** Open one forward: local 127.0.0.1:<ephemeral> → remote 127.0.0.1:<remotePort>. */
export function openSshForward(facts: SshConnectionFacts, remotePort: number): Promise<SshForward> {
  return new Promise<SshForward>((resolve, reject) => {
    const config: ConnectConfig = {
      host: facts.host,
      port: facts.port,
      username: facts.username,
      readyTimeout: 12_000,
      // The handshake itself refuses a mismatched key — no trust-on-first-use, same as the terminal.
      hostVerifier: (key: Buffer) => fingerprintOf(key) === facts.hostKeyFingerprint,
    };
    if (facts.auth.kind === "password") config.password = facts.auth.password;
    else if (facts.auth.kind === "key") {
      // Same file-read contract as the terminal adapter: the secret store holds the path.
      config.privateKey = readFileSync(facts.auth.privateKeyPath);
      if (facts.auth.passphrase) config.passphrase = facts.auth.passphrase;
    } else {
      config.agent = process.env.SSH_AUTH_SOCK;
    }
    const client = new Client();
    let server: Server | undefined;
    let settled = false;
    const sockets = new Set<import("node:net").Socket>();
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch { /* never connected */ }
      server?.close();
      reject(new SshForwardError(`ssh forward: ${error.message}`));
    };
    client.on("error", fail);
    client.on("close", () => {
      // A mid-life disconnect ends the listener; callers observe it via a dead viewUrl.
      if (settled && server) server.close();
    });
    client.on("ready", () => {
      // hostVerifier already pinned the key before "ready" fires; open the Workbench-host listener.
      server = createServer((socket) => {
        // Kept-alive sockets must never pin the forward shut: track and destroy on close.
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        client.forwardOut("127.0.0.1", 0, "127.0.0.1", remotePort, (error, channel) => {
          if (error || !channel) {
            socket.destroy();
            return;
          }
          socket.pipe(channel).pipe(socket);
          socket.on("error", () => channel.end());
          channel.on("error", () => socket.end());
        });
      });
      server.on("error", fail);
      // Port 0: the OS picks a free loopback port; the preview's viewUrl names it.
      server.listen(0, "127.0.0.1", () => {
        const localPort = (server!.address() as { port: number }).port;
        settled = true;
        resolve({
          viewUrl: `http://127.0.0.1:${localPort}`,
          localPort,
          close: async () => {
            for (const socket of sockets) socket.destroy();
            sockets.clear();
            await new Promise<void>((done) => server?.close(() => done()));
            try { client.end(); } catch { /* already gone */ }
          },
        });
      });
    });
    client.connect(config);
  });
}
