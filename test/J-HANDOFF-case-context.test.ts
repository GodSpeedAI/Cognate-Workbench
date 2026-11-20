// J-HANDOFF-case-context (cognitiveos convergence 9, ticket #119; D-minimal-contracts `caseContext`,
// D0 `worldCorroboration`/`assertedBy` rows, E-acceptance-journeys J8).
//
// The Workbench `expert.converse` accepts an optional CEP `CaseContext` + asserted provenance,
// validates it with the published `caseContextIssues`, freezes it into the Assignment's execution
// snapshot, and forwards it through the bridge into `startRun`. `assertedBy` is a recorded claim,
// never a refusal; `worldCorroboration` is `verified` only when a registry check ran (Workbench runs
// none, so it records `asserted`). With no `caseContext` the path is unchanged.
import { describe, expect, test } from "bun:test";
import type { StoredEvent } from "@godspeedai/cognate-events";
import { LOCAL_OPERATOR } from "../src/server.ts";
import { configureDefaultRoutes, invoke, waitForAssignment, withExpertApp, type ExpertTestApp } from "./expert-helpers.ts";

const HEX = "a".repeat(64);
const worldRef = `world:horizon@sha256:${HEX}`;
const semanticRef = "horizon.interaction::CaseRecord";
const exploratory = { worldRef, semanticRef, caseId: "case_1", planItemId: "step_1", role: "executor", kind: "exploratory" } as const;

const responder = async (route: { model: string }) => ({
  message: { role: "assistant" as const, content: "Explored the case." },
  toolCalls: [], finishReason: "stop" as const, model: route.model,
});

const contextOf = async (app: ExpertTestApp, runId: string): Promise<unknown> => {
  const events: StoredEvent[] = [];
  for await (const event of app.app.runtime.service.events(LOCAL_OPERATOR, { runId })) events.push(event);
  const started = events.find((event) => event.eventType === "run.started");
  return (started?.metadata as { caseContext?: unknown } | undefined)?.caseContext;
};

describe("J-HANDOFF-case-context", () => {
  test("an exploratory context is validated, frozen into the execution snapshot, and carried on the run", async () => {
    await withExpertApp(responder, async (app) => {
      await configureDefaultRoutes(app);
      const result = (await invoke(app, "expert.converse", {
        expertId: "builder", workspaceId: app.workspaceId, message: "Explore the case.", requestId: "handoff-accepted",
        caseContext: exploratory, assertedBy: "horizon:operator:win-1",
      })) as { assignmentId: string };
      const assignment = await waitForAssignment(app, result.assignmentId, (a) => !!a.runId);
      // Frozen into the execution snapshot: stable for the run's life.
      expect(assignment.execution.caseContext).toEqual(exploratory);
      expect(assignment.execution.assertedBy).toBe("horizon:operator:win-1");
      expect(assignment.execution.worldCorroboration).toBe("asserted");
      // Carried onto the run itself (Cognate adds the run principal).
      expect(await contextOf(app, assignment.runId!)).toMatchObject({ ...exploratory, principal: `wb-agent:builder` });
    });
  });

  test("an evaluated context without episodeRef is refused with the published rule", async () => {
    await withExpertApp(responder, async (app) => {
      await configureDefaultRoutes(app);
      await expect(invoke(app, "expert.converse", {
        expertId: "builder", workspaceId: app.workspaceId, message: "Evaluated work.", requestId: "handoff-evaluated",
        caseContext: { ...exploratory, kind: "evaluated" }, assertedBy: "horizon:operator",
      })).rejects.toThrow(/episodeRef/);
    });
  });

  test("a malformed worldRef (a local execution digest presented as a CEP world) is refused", async () => {
    await withExpertApp(responder, async (app) => {
      await configureDefaultRoutes(app);
      await expect(invoke(app, "expert.converse", {
        expertId: "builder", workspaceId: app.workspaceId, message: "Malformed world.", requestId: "handoff-malformed",
        caseContext: { ...exploratory, worldRef: `sha256:${HEX}` }, assertedBy: "horizon:operator",
      })).rejects.toThrow(/worldRef/);
    });
  });

  test("assertedBy is recorded verbatim and is never itself a refusal", async () => {
    await withExpertApp(responder, async (app) => {
      await configureDefaultRoutes(app);
      const result = (await invoke(app, "expert.converse", {
        expertId: "builder", workspaceId: app.workspaceId, message: "Odd attribution.", requestId: "handoff-asserted-by",
        caseContext: exploratory, assertedBy: "  whoever claims this  ",
      })) as { assignmentId: string };
      const assignment = await waitForAssignment(app, result.assignmentId, (a) => !!a.runId);
      expect(assignment.execution.assertedBy).toBe("  whoever claims this  ");
    });
  });

  test("with no caseContext the run carries none and the path is unchanged", async () => {
    await withExpertApp(responder, async (app) => {
      await configureDefaultRoutes(app);
      const result = (await invoke(app, "expert.converse", {
        expertId: "builder", workspaceId: app.workspaceId, message: "No case.", requestId: "handoff-none",
      })) as { assignmentId: string };
      const assignment = await waitForAssignment(app, result.assignmentId, (a) => !!a.runId);
      expect("caseContext" in assignment.execution).toBe(false);
      expect("assertedBy" in assignment.execution).toBe(false);
      expect("worldCorroboration" in assignment.execution).toBe(false);
      expect(await contextOf(app, assignment.runId!)).toBeUndefined();
    });
  }, 60_000);
});
