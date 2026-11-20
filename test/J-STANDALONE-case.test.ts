import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createClient } from "@godspeedai/cognate-client";
import { createRemoteRuntimeService } from "@godspeedai/cognate-protocol-connect";
import { connectTransport, devToken } from "@godspeedai/cognate-protocol-connect-bun";
import { LOCAL_OPERATOR, startServer } from "../src/server.ts";
import { withTempHome } from "./helpers.ts";

test("ordinary case work remains available without Gauntlet escalation", async () => {
  await withTempHome(async (home) => {
    const app = await startServer({ port: 0, home, devAuth: true, executionPosture: "uncontained-local" });
    const client = createClient({ service: createRemoteRuntimeService(connectTransport(app.url), () => devToken(LOCAL_OPERATOR)), caller: LOCAL_OPERATOR });
    try {
      await client.invoke("case.open", { caseId: "STANDALONE-1", desiredOutcome: "Verify ordinary case work" });
      const result = await client.invoke("criterion.freeze", {
        caseId: "STANDALONE-1",
        spec: { version: 1, requiredChecks: ["unit"], observed: ["the result"], unobserved: [], guardrails: ["read-only"], protectedInvariants: ["integrity"] },
      }) as { criterionHash: string };
      expect(result.criterionHash).toMatch(/^[0-9a-f]{64}$/);
      await client.invoke("affordance.field", { caseId: "STANDALONE-1" });
      await expect(client.invoke("case.escalate", {})).rejects.toThrow(/no eligible provider for case\.escalate/i);
      expect(existsSync(join(home, "escalations"))).toBe(false);
    } finally {
      await app.stop();
    }
  });
}, 120_000);
