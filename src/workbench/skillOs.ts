import type {
  CapabilityContractDef,
  ImplementationBinding,
  CapabilityState,
  AuthorityLevel,
  EvidenceKind,
} from "./types.ts";
import { CAPABILITY_LIFECYCLE } from "./types.ts";

// ---- Lifecycle management ----

/** Get the immediate next state in the lifecycle, or undefined if at the end. */
export function nextLifecycle(state: CapabilityState): CapabilityState | undefined {
  const idx = CAPABILITY_LIFECYCLE.indexOf(state);
  if (idx === -1 || idx === CAPABILITY_LIFECYCLE.length - 1) return undefined;
  return CAPABILITY_LIFECYCLE[idx + 1];
}

export type LifecycleResult =
  | { readonly ok: true; readonly state: CapabilityState }
  | { readonly ok: false; readonly error: string };

/** Validate and advance from one state to the next. Only the immediate next state is allowed. */
export function advanceLifecycle(from: CapabilityState, to: CapabilityState): LifecycleResult {
  const fromIdx = CAPABILITY_LIFECYCLE.indexOf(from);
  const toIdx = CAPABILITY_LIFECYCLE.indexOf(to);

  if (fromIdx === -1) {
    return { ok: false, error: `unknown from state: ${from}` };
  }
  if (toIdx === -1) {
    return { ok: false, error: `unknown to state: ${to}` };
  }

  // Check: only immediate next allowed
  if (toIdx !== fromIdx + 1) {
    const expectedNext = fromIdx < CAPABILITY_LIFECYCLE.length - 1
      ? CAPABILITY_LIFECYCLE[fromIdx + 1]
      : "end of lifecycle";
    return {
      ok: false,
      error: `cannot go from ${from} to ${to}: ${expectedNext} must come first`
    };
  }

  return { ok: true, state: to };
}

/** Check if a capability state allows invocation. */
export function canInvoke(state: CapabilityState): boolean {
  return state === "ENABLED" || state === "EXERCISED" || state === "VERIFIED" || state === "AVAILABLE";
}

/** Check if a capability state is trusted. */
export function isTrusted(state: CapabilityState): boolean {
  return state === "VERIFIED" || state === "AVAILABLE";
}

// ---- Capability catalog ----

/** Seed the capability catalog with at least 14 contracts. */
export function seedCatalog(): CapabilityContractDef[] {
  return [
    {
      id: "capability.product-briefing",
      category: "Understand",
      purpose: "Gather and structure domain requirements",
      consumes: ["user-input", "domain-context"],
      produces: ["brief", "invariants"],
      authority: ["inspect", "advise"],
      conflicts: [],
      complements: ["capability.domain-rule-extraction"],
      acceptance: ["test", "audit"],
      owns: ["brief"],
    },
    {
      id: "capability.domain-rule-extraction",
      category: "Understand",
      purpose: "Extract governing rules and constraints",
      consumes: ["brief", "domain-context"],
      produces: ["rules", "constraints"],
      authority: ["inspect", "advise"],
      conflicts: [],
      complements: ["capability.product-briefing"],
      acceptance: ["test", "audit"],
      owns: ["domain-rules"],
    },
    {
      id: "capability.reference-distillation",
      category: "Represent",
      purpose: "Distill visual references into design patterns",
      consumes: ["reference-materials"],
      produces: ["design-patterns"],
      authority: ["inspect", "advise"],
      conflicts: [],
      complements: ["capability.structural-sketch"],
      acceptance: ["audit", "human"],
      owns: ["reference-patterns"],
    },
    {
      id: "capability.structural-sketch",
      category: "Represent",
      purpose: "Create structural diagrams and architectural sketches",
      consumes: ["brief", "rules"],
      produces: ["sketch", "architecture"],
      authority: ["inspect", "advise", "modify"],
      conflicts: [],
      complements: ["capability.design-initialization"],
      acceptance: ["audit", "human"],
      owns: ["structural-design"],
    },
    {
      id: "capability.design-initialization",
      category: "Represent",
      purpose: "Initialize design system foundations",
      consumes: ["sketch", "design-patterns"],
      produces: ["design-system", "tokens"],
      authority: ["inspect", "advise", "modify"],
      conflicts: [],
      complements: ["capability.reference-distillation"],
      acceptance: ["test", "audit"],
      owns: ["design-system"],
    },
    {
      id: "capability.frontend-actualization",
      category: "Actualize",
      purpose: "Implement frontend components and layouts",
      consumes: ["design-system", "brief"],
      produces: ["components", "artifacts"],
      authority: ["inspect", "advise", "modify", "execute"],
      conflicts: [],
      complements: [],
      acceptance: ["test", "journey", "human"],
      owns: ["visual-implementation", "product-behavior"],
    },
    {
      id: "capability.code-repair",
      category: "Actualize",
      purpose: "Fix and improve code quality",
      consumes: ["source-code", "feedback"],
      produces: ["fixed-code"],
      authority: ["inspect", "advise", "modify", "execute"],
      conflicts: [],
      complements: [],
      acceptance: ["test", "independent-check"],
      owns: ["source-code"],
    },
    {
      id: "capability.artifact-generation",
      category: "Actualize",
      purpose: "Generate artifacts and deliverables",
      consumes: ["components", "content"],
      produces: ["artifacts", "builds"],
      authority: ["inspect", "advise", "modify", "execute"],
      conflicts: [],
      complements: [],
      acceptance: ["test", "journey"],
      owns: ["artifact-outputs"],
    },
    {
      id: "capability.runtime-preview",
      category: "Inspect",
      purpose: "Run and preview applications",
      consumes: ["artifacts", "builds"],
      produces: ["runtime-state", "observations"],
      authority: ["inspect", "execute"],
      conflicts: [],
      complements: ["capability.grounded-feedback"],
      acceptance: ["test", "journey"],
      owns: ["runtime-execution"],
    },
    {
      id: "capability.grounded-feedback",
      category: "Inspect",
      purpose: "Gather feedback from runtime observation",
      consumes: ["runtime-state", "observations"],
      produces: ["feedback", "issues"],
      authority: ["inspect"],
      conflicts: [],
      complements: ["capability.runtime-preview"],
      acceptance: ["test", "audit", "human"],
      owns: [],
    },
    {
      id: "capability.independent-verification",
      category: "Verify",
      purpose: "Independently verify implementations",
      consumes: ["artifacts", "acceptance-criteria"],
      produces: ["verification-report"],
      authority: ["inspect", "verify"],
      conflicts: [],
      complements: [],
      acceptance: ["test", "audit"],
      owns: [],
    },
    {
      id: "capability.accessibility-audit",
      category: "Verify",
      purpose: "Audit accessibility and compliance",
      consumes: ["artifacts", "components"],
      produces: ["audit-report"],
      authority: ["inspect", "verify"],
      conflicts: [],
      complements: [],
      acceptance: ["audit", "test"],
      owns: [],
    },
    {
      id: "capability.visual-polish",
      category: "Refine",
      purpose: "Polish visual presentation and appearance",
      consumes: ["artifacts", "feedback"],
      produces: ["polished-artifacts"],
      authority: ["inspect", "advise", "modify"],
      conflicts: [],
      complements: [],
      acceptance: ["audit", "human"],
      owns: ["visual-implementation"],
    },
    {
      id: "capability.browser-journey-verification",
      category: "Verify",
      purpose: "Verify end-to-end browser journeys",
      consumes: ["artifacts", "journey-specs"],
      produces: ["journey-report"],
      authority: ["inspect", "verify", "execute"],
      conflicts: [],
      complements: [],
      acceptance: ["test", "journey"],
      owns: [],
    },
    {
      id: "capability.change-review",
      category: "Verify",
      purpose: "Review and assess changes",
      consumes: ["artifacts", "feedback"],
      produces: ["review-report"],
      authority: ["inspect", "advise", "verify"],
      conflicts: [],
      complements: [],
      acceptance: ["test", "audit", "human"],
      owns: [],
    },
    {
      id: "capability.capability-creation",
      category: "Extend",
      purpose: "Create and register new capabilities",
      consumes: ["specification"],
      produces: ["capability-contract"],
      authority: ["inspect", "advise", "modify", "verify", "approve"],
      conflicts: [],
      complements: [],
      acceptance: ["test", "audit"],
      owns: [],
    },
    {
      id: "capability.automation-scheduling",
      category: "Operationalize",
      purpose: "Schedule and automate recurring tasks",
      consumes: ["workflow", "triggers"],
      produces: ["automation-schedule"],
      authority: ["inspect", "advise", "modify", "execute", "install"],
      conflicts: [],
      complements: [],
      acceptance: ["test", "audit"],
      owns: [],
    },
  ];
}

// ---- Implementation bindings ----

/** Seed implementation bindings. */
export function seedBindings(): ImplementationBinding[] {
  return [
    {
      capabilityId: "capability.visual-polish",
      implementationId: "impl.impeccable-polish",
      provider: "impeccable",
      executorKind: "deterministic",
      setup: {},
    },
    {
      capabilityId: "capability.browser-journey-verification",
      implementationId: "impl.playwright",
      provider: "playwright",
      executorKind: "deterministic",
      setup: { runner: "playwright" },
    },
    {
      capabilityId: "capability.structural-sketch",
      implementationId: "impl.native-sketch",
      provider: "native",
      executorKind: "deterministic",
      setup: {},
    },
    {
      capabilityId: "capability.reference-distillation",
      implementationId: "impl.native-moodboard",
      provider: "native",
      executorKind: "deterministic",
      setup: {},
    },
    {
      capabilityId: "capability.capability-creation",
      implementationId: "impl.creator-mode",
      provider: "native",
      executorKind: "llm",
      setup: {},
    },
    {
      capabilityId: "capability.automation-scheduling",
      implementationId: "impl.automation-tasks",
      provider: "native",
      executorKind: "deterministic",
      setup: {},
    },
  ];
}

// ---- Binding substitution ----

export interface Substitution {
  readonly compatible: boolean;
  readonly unchanged: readonly string[];
  readonly changed: readonly string[];
  readonly problems: readonly string[];
}

/** Validate binding substitution (V-002). */
export function checkSubstitution(
  contract: CapabilityContractDef,
  oldBinding: ImplementationBinding,
  newBinding: ImplementationBinding,
): Substitution {
  const problems: string[] = [];

  // Problem: different capability
  if (oldBinding.capabilityId !== contract.id) {
    problems.push(`old binding has capabilityId ${oldBinding.capabilityId}, contract is ${contract.id}`);
  }
  if (newBinding.capabilityId !== contract.id) {
    problems.push(`new binding has capabilityId ${newBinding.capabilityId}, contract is ${contract.id}`);
  }

  // Problem: same implementation
  if (oldBinding.implementationId === newBinding.implementationId) {
    problems.push(`same implementationId: ${oldBinding.implementationId}`);
  }

  // Problem: verifier silently becomes LLM
  if (
    contract.authority.includes("verify") &&
    oldBinding.executorKind === "deterministic" &&
    newBinding.executorKind === "llm"
  ) {
    problems.push(`verifier (contract has verify authority) cannot change from deterministic to llm`);
  }

  const compatible = problems.length === 0;

  const unchanged = compatible
    ? ["journey-contract", "acceptance-criteria"]
    : [];

  const changed = compatible
    ? [
        "implementation",
        ...(oldBinding.setup !== newBinding.setup ? ["setup"] : []),
        ...(oldBinding.provider !== newBinding.provider ? ["provider"] : []),
      ]
    : [];

  return { compatible, unchanged, changed, problems: problems as readonly string[] };
}

// ---- Filtering ----

/** Get bindings for a specific capability id. */
export function bindingsFor(
  bindings: readonly ImplementationBinding[],
  capabilityId: string,
): ImplementationBinding[] {
  return bindings.filter((b) => b.capabilityId === capabilityId);
}

// ---- Conflict detection ----

export interface Conflict {
  readonly surface: string;
  readonly capabilities: readonly string[];
}

/** Detect conflicts among active capabilities. */
export function detectConflicts(
  catalog: readonly CapabilityContractDef[],
  active: readonly string[],
): Conflict[] {
  const conflicts: Conflict[] = [];

  // Build a map of capability id -> contract
  const contractMap = new Map<string, CapabilityContractDef>();
  for (const contract of catalog) {
    contractMap.set(contract.id, contract);
  }

  // Track which surfaces are owned by which active capabilities
  const surfaceOwners = new Map<string, string[]>();
  for (const capId of active) {
    const contract = contractMap.get(capId);
    if (!contract) continue;

    for (const surface of contract.owns) {
      if (!surfaceOwners.has(surface)) {
        surfaceOwners.set(surface, []);
      }
      surfaceOwners.get(surface)!.push(capId);
    }
  }

  // Find surfaces with multiple owners
  for (const [surface, owners] of surfaceOwners.entries()) {
    if (owners.length > 1) {
      conflicts.push({
        surface,
        capabilities: owners.sort(),
      });
    }
  }

  // Find explicit conflicts that are both active
  for (const capId of active) {
    const contract = contractMap.get(capId);
    if (!contract) continue;

    for (const conflictId of contract.conflicts) {
      if (active.includes(conflictId)) {
        // Add only once, sorted by id
        const sorted = [capId, conflictId].sort();
        const id1 = sorted[0]!;
        const id2 = sorted[1]!;
        const surfaceLabel = `explicit:${id1}|${id2}`;

        // Check if we already added this
        if (!conflicts.some((c) => c.surface === surfaceLabel)) {
          conflicts.push({
            surface: surfaceLabel,
            capabilities: [id1, id2],
          });
        }
      }
    }
  }

  // Sort by surface name
  return conflicts.sort((a, b) => a.surface.localeCompare(b.surface));
}

// ---- Provider capabilities ----

/** Get capability ids that a provider realizes. */
export function packageProvides(
  provider: string,
  bindings: readonly ImplementationBinding[],
): string[] {
  const capabilities = new Set<string>();
  for (const binding of bindings) {
    if (binding.provider === provider) {
      capabilities.add(binding.capabilityId);
    }
  }
  return Array.from(capabilities).sort();
}

// ---- Creation steps ----

/** Get the 13 create-capability contract steps in order. */
export function creationSteps(): readonly string[] {
  return [
    "describe",
    "define-surface",
    "define-io",
    "define-authority",
    "define-verification",
    "build",
    "inspect-provenance",
    "install",
    "grant",
    "enable",
    "exercise",
    "verify",
    "register",
  ] as const;
}
