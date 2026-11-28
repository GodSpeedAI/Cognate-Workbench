// A unix-socket stand-in SEA-Forge that answers the CEP `authority_request` NDJSON exchange with an `authority_decision`
// envelope, so Cognate's real `SeaForgeAuthority` client (and its decision parsing) is part of what a test exercises.
import { createServer, type Server } from "node:net";

/** A SEA ledger entry (`entry_ulid`). */
export const ULID = "01HZX3Q7M9K2N4P6R8T0VWXYZ1";
export const WORLD = `world:test@sha256:${"a".repeat(64)}`;

/** What the stand-in SEA-Forge answers for one request. */
export type Answer =
  | { kind: "boundary"; digests: string[]; extraConstraints?: { constraint_type: string; description: string }[]; noLedger?: boolean; decisionIdOnly?: boolean }
  | { kind: "plain"; decision: "allow" | "deny" | "escalate" | "constrained_allow" }
  | { kind: "malformed" } | { kind: "error" } | { kind: "silent" };

/** A unix-socket SEA-Forge: the CEP authority_decision for the request it received, or a defect. */
export async function seaForge(path: string, answerFor: (digest: string | undefined, resource: string) => Answer, seen: { claims: unknown[]; resources: string[] }): Promise<Server> {
  const server = createServer((socket) => {
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += String(chunk);
      if (!buffered.includes("\n")) return;
      const request = JSON.parse(buffered.slice(0, buffered.indexOf("\n")));
      const ext = request.envelope.extensions["godspeed.authority_request"];
      seen.claims.push(ext.claims);
      seen.resources.push(ext.resource_id);
      const answer = answerFor(ext.claims?.execution_profile_digest, ext.resource_id);
      if (answer.kind === "silent") return; // never answers: the client times out
      if (answer.kind === "malformed") { socket.end("this is not json\n"); return; }
      if (answer.kind === "error") { socket.end(JSON.stringify({ ok: false, error_class: "policy_unavailable", error: "no bundle" }) + "\n"); return; }
      const decision = answer.kind === "boundary" ? "boundary" : answer.decision;
      const constraints = answer.kind === "boundary"
        ? [...answer.digests.map((d) => ({ constraint_type: "execution_profile", description: d })), ...(answer.extraConstraints ?? [])]
        : [];
      socket.end(JSON.stringify({
        ok: true, final: true,
        envelope: {
          envelope_kind: "authority_decision", envelope_id: `dec-${request.request_id}`, lineage_refs: [request.envelope.envelope_id],
          scope: { world_ref: WORLD }, constraints,
          extensions: {
            "cep.profile": { profile_id: "godspeed.authority_decision", profile_version: "1.0.0" },
            "godspeed.authority_decision": { request_ref: request.envelope.envelope_id, operation_id: request.request_id, decision, ...(answer.kind === "boundary" && answer.noLedger ? {} : answer.kind === "boundary" && answer.decisionIdOnly ? { decision_id: "auth_01" } : { decision_id: `D-${request.request_id}`, ledger_entry: ULID }), ...(decision === "boundary" ? { policy_basis: ["rule:profile"] } : {}) },
          },
        },
      }) + "\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return server;
}

