// Task contract validation: which fields are satisfied, rendering chips for the UI.
import type { AuthorityScopes, Budget, ContractField, TaskContract } from "./types.ts";
import { CONTRACT_FIELDS } from "./types.ts";

export function contractMissing(c: Partial<TaskContract>): ContractField[] {
  const missing: ContractField[] = [];

  // context: needs workspaceId non-empty string
  if (!c.context?.workspaceId?.trim()) {
    missing.push("context");
  }

  // goal: needs non-blank goal.outcome
  if (!c.goal?.outcome?.trim()) {
    missing.push("goal");
  }

  // skills: needs >=1
  if (!c.skills || c.skills.length === 0) {
    missing.push("skills");
  }

  // authority: needs defined
  if (c.authority === undefined) {
    missing.push("authority");
  }

  // executors: needs >=1
  if (!c.executors || c.executors.length === 0) {
    missing.push("executors");
  }

  // budget: needs defined
  if (c.budget === undefined) {
    missing.push("budget");
  }

  // invariants: needs >=1
  if (!c.invariants || c.invariants.length === 0) {
    missing.push("invariants");
  }

  // acceptance: needs >=1 criterion with required===true
  if (!c.acceptance || !c.acceptance.some(crit => crit.required)) {
    missing.push("acceptance");
  }

  return missing;
}

export function isContractComplete(c: Partial<TaskContract>): boolean {
  return contractMissing(c).length === 0;
}

export function defaultAuthority(): AuthorityScopes {
  return {
    filesystem: { read: "yes", write: "no", outsideWorkspace: "no" },
    shell: { run: "no", destructive: "no" },
    network: { outbound: "no" },
    packages: { install: "no" },
    extensions: { install: "no", enable: "no" },
    protectedPaths: [],
  };
}

export interface ContractChip {
  readonly field: ContractField;
  readonly label: string;
  readonly value: string;
  readonly state: "set" | "missing";
}

export function contractChips(c: Partial<TaskContract>): ContractChip[] {
  const chips: ContractChip[] = [];

  // context: workspaceId
  if (c.context?.workspaceId?.trim()) {
    chips.push({
      field: "context",
      label: "Workspace",
      value: c.context.workspaceId,
      state: "set",
    });
  } else {
    chips.push({
      field: "context",
      label: "Workspace",
      value: "—",
      state: "missing",
    });
  }

  // goal: outcome truncated to 48 chars with "…"
  if (c.goal?.outcome?.trim()) {
    const outcome = c.goal.outcome.trim();
    const value = outcome.length > 48 ? outcome.substring(0, 48) + "…" : outcome;
    chips.push({
      field: "goal",
      label: "Goal",
      value,
      state: "set",
    });
  } else {
    chips.push({
      field: "goal",
      label: "Goal",
      value: "—",
      state: "missing",
    });
  }

  // skills: `${n} skills`
  const skillCount = c.skills?.length ?? 0;
  chips.push({
    field: "skills",
    label: "Skills",
    value: skillCount > 0 ? `${skillCount} skills` : "—",
    state: skillCount > 0 ? "set" : "missing",
  });

  // authority: read/read+write/read+write+shell/read-only based on grants
  if (c.authority) {
    const auth = c.authority;
    const grants: string[] = [];

    // Check filesystem.read
    if (auth.filesystem.read !== "no") {
      grants.push("read");
    }

    // Check filesystem.write
    if (auth.filesystem.write !== "no") {
      grants.push("write");
    }

    // Check shell.run
    if (auth.shell.run !== "no") {
      grants.push("shell");
    }

    const value =
      grants.length === 0
        ? "read-only"
        : grants.join("+");

    chips.push({
      field: "authority",
      label: "Authority",
      value,
      state: "set",
    });
  } else {
    chips.push({
      field: "authority",
      label: "Authority",
      value: "—",
      state: "missing",
    });
  }

  // executors: `${n} executors`
  const executorCount = c.executors?.length ?? 0;
  chips.push({
    field: "executors",
    label: "Executors",
    value: executorCount > 0 ? `${executorCount} executors` : "—",
    state: executorCount > 0 ? "set" : "missing",
  });

  // budget: listing only defined fields
  if (c.budget) {
    const budgetParts: string[] = [];
    if (c.budget.maxTokens !== undefined) {
      const tokens = c.budget.maxTokens;
      budgetParts.push(tokens >= 1000 ? `${Math.round(tokens / 1000)}k tok` : `${tokens} tok`);
    }
    if (c.budget.maxCostUsd !== undefined) {
      budgetParts.push(`$${c.budget.maxCostUsd.toFixed(2)}`);
    }
    if (c.budget.maxConcurrency !== undefined) {
      budgetParts.push(`${c.budget.maxConcurrency}×`);
    }
    if (c.budget.maxMs !== undefined) {
      const seconds = Math.round(c.budget.maxMs / 1000);
      budgetParts.push(`${seconds}s`);
    }

    const value = budgetParts.length > 0 ? budgetParts.join(" · ") : "—";
    chips.push({
      field: "budget",
      label: "Budget",
      value,
      state: budgetParts.length > 0 ? "set" : "missing",
    });
  } else {
    chips.push({
      field: "budget",
      label: "Budget",
      value: "—",
      state: "missing",
    });
  }

  // invariants: `${n} invariants`
  const invariantCount = c.invariants?.length ?? 0;
  chips.push({
    field: "invariants",
    label: "Invariants",
    value: invariantCount > 0 ? `${invariantCount} invariants` : "—",
    state: invariantCount > 0 ? "set" : "missing",
  });

  // acceptance: `${n} criteria`
  const criteriaCount = c.acceptance?.length ?? 0;
  chips.push({
    field: "acceptance",
    label: "Acceptance",
    value: criteriaCount > 0 ? `${criteriaCount} criteria` : "—",
    state: criteriaCount > 0 ? "set" : "missing",
  });

  return chips;
}
