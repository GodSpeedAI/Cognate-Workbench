# Mobile remote control

Control a running Workbench from a phone: see sessions, send a turn or steer a running one, stop a run, and
answer the decisions waiting on you (tool approvals, plan reviews, SEA-Forge governance approvals). The desktop
turns it on. The phone proves it is you with a passkey.

## How it works

1. On the desktop, open **Remote** in the sidebar and choose **Turn on remote control**. A pairing link and QR
   code appear. The link works once and expires after five minutes.
2. Open the link on the phone (or scan the QR code). The phone reads the secret from the URL fragment and
   removes it from the address bar before anything else runs.
3. The phone registers a passkey with user verification. From then on, opening the remote needs that passkey.
4. The phone sees sessions and decisions and sends commands. The desktop dialog shows the phone as connected.

Closing the dialog does not stop remote control. The sidebar shows **Waiting for phone** or **Phone connected**
while it is on. **Stop** ends it.

## Trust model

- **Access.** Access starts from the QR code or the copied link. The link only lets one passkey be registered.
  It never grants control by itself.
- **Passkey.** Registration and every sign-in require user verification. A sign-in whose signature counter does
  not rise is refused, which catches a cloned passkey.
- **Pairing secret.** 32 random bytes, carried in the fragment (`#p=`), so it never reaches a server log, a
  tunnel log or a Referer header. Only its SHA-256 verifier is compared. It is single use and expires in five
  minutes. It lives in memory only.
- **One controller.** Pairing a new phone replaces the previous one: its passkey is dropped and its sessions are
  revoked. **Refresh QR** and **Stop** revoke every link, device and session at once.
- **Sessions.** A successful sign-in issues a durable Workbench session (12 hours) bound to the operator. The
  cookie is `__Host-wb_remote`, `Secure`, `HttpOnly`, `SameSite=Strict`, path `/`. Revocation takes effect on the
  next request.
- **Listener.** The phone listener binds `127.0.0.1` only. Default port `3181` (`COGNATE_REMOTE_PORT`). Requests
  must carry the expected `Host`. POST requests must carry the expected `Origin` and a JSON body.
- **Decisions.** Nothing is approved automatically. A decision is answered through the same continuation and
  governance calls the desktop uses, under the paired operator's identity. A reconciliation of an interrupted
  effect is desktop-only.
- **Canonical state.** The phone shows and changes the same Workbench state as the desktop. Remote keeps no
  second store of sessions, runs or approvals. Device records (credential, public key, sign count, label, session
  id) live in the shared state thread `auth:remote:v1`.
- **Updates.** The phone re-reads what it shows when the desktop changes anything. The stream carries no payloads.

## Not end-to-end encrypted

Remote control is HTTP. Transport encryption is provided only by the HTTPS endpoint you put in front of it, such
as a tunnel. The tunnel operator can read traffic between the phone and your machine. The passkey proves who is
signing in. It does not encrypt the session.

## Expose it through a tunnel

Local-only use works without a tunnel: `http://localhost:3181` is a secure context, so passkeys work on that
machine for testing.

To reach the phone from another network, run a tunnel you control and point the remote at its public HTTPS origin:

```bash
export COGNATE_REMOTE_PUBLIC_URL=https://remote.example.com   # an origin only: no path, query or fragment
bun run start
```

With `cloudflared`, a named tunnel forwards a hostname you control to the remote port. Set it up once:

```bash
cloudflared tunnel login                                        # authorize cloudflared for your Cloudflare zone
cloudflared tunnel create workbench-remote                      # writes a credentials file under ~/.cloudflared
cloudflared tunnel route dns workbench-remote remote.example.com
```

Then describe the ingress in `~/.cloudflared/config.yml`. The hostname goes to the phone listener, and a final
catch-all answers everything else with 404:

```yaml
tunnel: workbench-remote
credentials-file: /home/you/.cloudflared/<tunnel-id>.json   # the file `tunnel create` wrote
ingress:
  - hostname: remote.example.com
    service: http://127.0.0.1:3181
  - service: http_status:404
```

Run the tunnel while the remote is on:

```bash
cloudflared tunnel run workbench-remote
```

A quick tunnel (`cloudflared tunnel --url http://127.0.0.1:3181`) gets a random hostname each time it starts. The
passkey is bound to the host, so every quick-tunnel start means pairing the phone again. Use a named tunnel for an
address that stays put.

The public URL must match what the tunnel serves: the passkey is bound to its host. Use a hostname you control.
Do not expose the cockpit port (default `3180`) through the same tunnel. Only the phone listener is meant for
remote access.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `COGNATE_REMOTE_PORT` | `3181` | Loopback port for the phone listener. |
| `COGNATE_REMOTE_PUBLIC_URL` | unset | Public HTTPS origin for a tunnel. Unset means this machine only. |

## Known limits

- The phone cannot answer reconciliation of an interrupted effect; decide it on the desktop.
- The change signal is one event per committed event, so a busy workspace refetches often (debounced to 250 ms).
- Pairing secrets and sessions do not survive a restart. Turning remote on after a restart revokes every phone that
  was paired before it, so pair the phone again from the desktop's new link. The phone shows "Restoring connection".
