// Presentation tests for Expert and Team setup: labels, route choices, authority text and activation guidance.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExpertEditor } from "../src/ui/experts/ExpertEditor.tsx";
import { AssignmentEffectResolution, AssignmentSettlement, ExpertMemoryPanel } from "../src/ui/experts/ExpertsTeamsPanel.tsx";
import type { Assignment, Expert } from "../src/experts/types.ts";
import { TeamEditor } from "../src/ui/experts/TeamEditor.tsx";

describe("ExpertEditor", () => {
  test("names identity, model route, tools and context without collecting credentials", () => {
    const html = renderToStaticMarkup(<ExpertEditor
      initial={undefined}
      defaultRoute={{ providerId: "mock", baseURL: "http://127.0.0.1:5000/v1", protocol: "openai-compatible", model: "mock-model" }}
      routes={[
        { providerId: "mock", baseURL: "http://127.0.0.1:5000/v1", protocol: "openai-compatible", model: "mock-model" },
        { providerId: "local", baseURL: "http://127.0.0.1:8080/v1", protocol: "openai-completions", model: "local-coder" },
      ]}
      busy={false}
      onCancel={() => {}}
      onSave={() => {}}
      onOpenSettings={() => {}}
    />);
    expect(html).toContain("Create Expert");
    expect(html).toContain('for="expert-name"');
    expect(html).toContain("Model route");
    expect(html).toContain("mock · mock-model");
    expect(html).toContain("local · local-coder");
    expect(html).toContain("Allowed capabilities");
    expect(html).toContain("Read files");
    expect(html).toContain("Return result, abstain or decline");
    expect(html).toContain("Provider credentials stay in Settings");
    expect(html).toContain("Configure provider and credentials in Settings");
    expect(html).not.toContain('type="password"');
  });

  test("editing an Expert shows its route and actual allowed tools", () => {
    const html = renderToStaticMarkup(<ExpertEditor
      initial={{ id: "critic", name: "Critic", lifecycle: "active", definition: { id: "def-critic", specialization: "Independent review", instructions: "Find counterexamples.", route: { providerId: "local", baseURL: "http://127.0.0.1:8080/v1", protocol: "openai-completions", model: "local-coder" }, tools: ["read", "expert_return"], contextBudget: 8000, maxSteps: 4 } }}
      defaultRoute={undefined}
      routes={[]}
      busy={false}
      onCancel={() => {}}
      onSave={() => {}}
      onOpenSettings={() => {}}
    />);
    expect(html).toContain("Edit Expert");
    expect(html).toContain("local-coder");
    expect(html).toContain("value=\"8000\"");
    expect(html).toContain("value=\"4\"");
    expect(html).toContain("Read files");
    expect(html).toContain("Run shell commands");
  });

  test("copying an Expert starts with its configuration and a distinct identity", () => {
    const html = renderToStaticMarkup(<ExpertEditor
      initial={{ id: "solo-analyst", name: "Solo Analyst", lifecycle: "active", definition: { id: "def-solo", specialization: "Research", instructions: "Compare evidence.", route: { providerId: "mock", baseURL: "http://127.0.0.1:5000/v1", protocol: "openai-compatible", model: "aimock-model" }, tools: ["read", "expert_return"], contextBudget: 12000, maxSteps: 5 } }}
      copying
      defaultRoute={undefined}
      routes={[{ providerId: "mock", baseURL: "http://127.0.0.1:5000/v1", protocol: "openai-compatible", model: "aimock-model" }]}
      busy={false}
      onCancel={() => {}}
      onSave={() => {}}
      onOpenSettings={() => {}}
    />);
    expect(html).toContain("Copy Expert");
    expect(html).toContain('value="Solo Analyst copy"');
    expect(html).toContain("Compare evidence.");
    expect(html).toContain("aimock-model");
    expect(html).toContain('value="12000"');
  });
});

describe("TeamEditor", () => {
  test("teaches the one-Orchestrator activation requirement", () => {
    const html = renderToStaticMarkup(<TeamEditor initial={undefined} busy={false} onCancel={() => {}} onSave={() => {}} />);
    expect(html).toContain("Create Team");
    expect(html).toContain("A draft Team needs exactly one Orchestrator before it can run.");
    expect(html).toContain("After saving, add Experts as Specialists, designate one Orchestrator, then activate the Team.");
    expect(html).toContain("Team capability ceiling");
    expect(html).toContain("Maximum handoff depth");
    expect(html).toContain("Maximum speaking rounds");
    expect(html).toContain("Create draft Team");
    expect(html).toContain('for="team-name"');
  });
});

const assignment = (review: Assignment["review"]): Assignment => ({
    id: "assignment-1", expertId: "verifier", conversationId: "conversation-1", teamId: "cognate-team", parentId: null,
    purpose: "Check the result", acceptance: ["the evidence supports the claim"], depth: 0, attempt: 1,
    status: "completed", workspaceId: "workspace-1", mode: "safe", authorityTools: ["read"],
    execution: { expertId: "verifier", assignmentId: "assignment-1", conversationId: "conversation-1", instructions: "Verify", route: { providerId: "mock", baseURL: "http://localhost/v1", protocol: "openai-compatible", model: "mock" }, tools: ["read"], maxSteps: 3, context: [] },
    runId: "run-1", handoff: { assignmentId: "assignment-1", expertId: "verifier", runId: "run-1", disposition: "result", output: "Checked", artifacts: [], evidence: ["test passed"], uncertainties: [], failures: [], followUp: [] },
    reconciled: true, review, settlement: null,
});

const independent = (): Assignment => ({
    ...assignment(null), id: "assignment-independent", expertId: "builder", parentId: "assignment-1", runId: "run-independent",
    handoff: { assignmentId: "assignment-independent", expertId: "builder", runId: "run-independent", disposition: "result", output: "Checked by reading the artifact", artifacts: [], evidence: ["file matches"], uncertainties: [], failures: [], followUp: [] },
});

describe("AssignmentSettlement", () => {

  test("keeps human acceptance unavailable until an affirmative review exists", () => {
    const current = assignment(null);
    const html = renderToStaticMarkup(<AssignmentSettlement assignment={current} assignments={[current]} experts={{}} traces={{}} busy={false} onReview={() => {}} onSettle={() => {}} />);
    expect(html).toContain("A returned result is still an assertion");
    expect(html).toContain("Only the human operator");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Accept settlement<\/button>/);
  });

  test("exposes settlement only after the review record supports it", () => {
    const current = assignment({ verdict: "accept", rationale: "Independent test passed", evidence: ["assignment-independent"], by: "operator" });
    const other = independent();
    const experts = { builder: { id: "builder", name: "Builder", lifecycle: "active" as const, definition: { id: "def-builder", specialization: "Build", instructions: "", route: null, tools: [], contextBudget: 8000, maxSteps: 4 } } };
    const traces = { "run-independent": [{ toolCallId: "tc-1", tool: "read", args: {}, status: "success" as const }] };
    const html = renderToStaticMarkup(<AssignmentSettlement assignment={current} assignments={[current, other]} experts={experts} traces={traces} busy={false} onReview={() => {}} onSettle={() => {}} />);
    expect(html).toContain("Human review: accept");
    expect(html).toMatch(/<button[^>]*>Accept settlement<\/button>/);
  });
});

describe("Expert context and effect recovery", () => {
  test("shows provenance-bound memory controls and distinct private/shared Team scopes", () => {
    const expert: Expert = { id: "builder", name: "Builder", lifecycle: "active", definition: { id: "def-builder", specialization: "Build", instructions: "Build carefully", route: null, tools: ["read"], contextBudget: 8000, maxSteps: 4 } };
    const html = renderToStaticMarkup(<ExpertMemoryPanel expert={expert} teams={[{ id: "team-1", name: "Build Team", lifecycle: "active", members: [], tools: ["read"], limits: { maxDepth: 2, maxAssignments: 8, maxUnread: 10, maxRounds: 6 } }]} assignments={[]} onInvoke={async () => []} />);
    expect(html).toContain("Context stewardship");
    expect(html).toContain("Source Assignments");
    expect(html).toContain("Personal to this Expert");
    expect(html).toContain("private to this Expert in the Team");
    expect(html).toContain("Shared with this Team");
    expect(html).toContain("accepted");
  });

  test("makes ambiguous side effects a human reconciliation with explicit outcome and reason", () => {
    const current = { ...assignment(null), effects: { "tool-call-1": { commitmentId: "commitment-1", state: "UNKNOWN_RECONCILIATION_REQUIRED", tool: "bash" } } };
    const html = renderToStaticMarkup(<AssignmentEffectResolution assignment={current} busy={false} onResolve={() => {}} />);
    expect(html).toContain("Only the human operator");
    expect(html).toContain("Observed outcome");
    expect(html).toContain("What did you observe?");
    expect(html).toContain("Record operator reconciliation");
  });

  test("does not offer reconciliation while a side effect is still running", () => {
    const current = { ...assignment(null), status: "running" as const, effects: { "tool-call-1": { commitmentId: "commitment-1", state: "DISPATCHING", tool: "bash" } } };
    const html = renderToStaticMarkup(<AssignmentEffectResolution assignment={current} busy={false} onResolve={() => {}} />);
    expect(html).toContain("Side effect in progress");
    expect(html).toContain("cancellation signals it");
    expect(html).not.toContain("Record operator reconciliation");
  });
});
