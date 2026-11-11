// Capability-bundles tranche T1 (§1.2 Install / §4.2.1–3): bundle validation and registration.
// T1 scope is register/validate/materialize/prune ONLY — activation lands in T2 with the
// dispatcher it mounts through (§9.5's corrected dependency order). Registration: validate the
// manifest (ajv), the payload ceilings, and requirement satisfiability (each declared
// requirement references a known permission kind), materialize the immutable version directory,
// prune beyond retention, and record `capability.bundle.registered` + `workbench.bundles.pruned`
// through the normal recording path (§8 matrix). Namespace partition: bundle ids register under
// owner "bundle" with a version (§4.4); reserved built-in ids are refused at skill.register.
import type { Component, HandlerContext, SemanticRef, CapabilityContract } from "@godspeedai/cognate-kernel-api";
import type { Json } from "@godspeedai/cognate-events";
import type { RuntimeService } from "@godspeedai/cognate-runtime-api";
import { randomUUID } from "node:crypto";
import Ajv from "ajv";
import { requireOperator } from "../workbench/operatorGuard.ts";
import { materializeVersion, pruneVersions, scanBundle, BUNDLE_LIMITS, BundleLimitError, versionHashFor } from "./bundleStore.ts";

const registerSchema = {
  type: "object",
  properties: {
    capabilityId: { type: "string", pattern: "^capability\\.bundle\\.[a-z0-9][a-z0-9.-]{0,63}$" },
    sourceDir: { type: "string" },
    manifest: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        purpose: { type: "string", maxLength: 200 },
        skills: { type: "array", maxItems: 8, items: { type: "object", properties: { name: { type: "string" }, entry: { type: "string" }, isEntryDocument: { type: "boolean" } }, required: ["name", "entry"], additionalProperties: false } },
        tools: { type: "array", maxItems: 8, items: { type: "object", properties: { id: { type: "string" }, description: { type: "string" }, inputSchema: { type: "object" } }, required: ["id", "description", "inputSchema"], additionalProperties: false } },
        requirements: { type: "array", maxItems: 16, items: { type: "string" } },
        conflicts: { type: "array", items: { type: "string" } },
        complements: { type: "array", items: { type: "string" } },
        owns: { type: "array", items: { type: "string" } },
      },
      required: ["name", "purpose", "skills"],
      additionalProperties: false,
    },
  },
  required: ["capabilityId", "sourceDir", "manifest"],
  additionalProperties: false,
} as const;

const KNOWN_REQUIREMENT_KINDS: ReadonlySet<string> = new Set(["capability.invoke", "skill.load", "harness.modify", "bundle.create", "bundle.activate"]);

export interface CapabilityBundlesOptions {
  readonly getService: () => RuntimeService;
  readonly home: string;
  readonly tenant: string;
  /** Live-referenced versions per capability (the GC reference rule, owner condition 4):
   *  active versions + versions any activation row, in-flight counter, or spawn-ledger process
   *  names. Wired from the authority index + spawn ledger at T2; empty in T1 (no activations
   *  exist yet — register/validate only). */
  readonly referencedVersions?: (capabilityId: string) => ReadonlySet<string>;
  readonly semanticRefs?: Readonly<Record<string, SemanticRef | undefined>>;
}

export function capabilityBundlesComponent(options: CapabilityBundlesOptions): Component {
  const ajv = new Ajv({ strict: false });
  const validateRegister = ajv.compile(registerSchema);
  const contracts: CapabilityContract[] = [
    { id: "capability.bundle.register", version: "1.0.0", semanticRef: options.semanticRefs?.["capability.bundle.register"] },
  ];
  const systemCaller = { actor: { id: "system", kind: "system" as const }, tenant: options.tenant };
  type RecordedEvent = { readonly type: string; readonly payload: Record<string, unknown> };
  const record = async (events: readonly RecordedEvent[]): Promise<void> => {
    const { AGENT_CONFIG } = await import("../agents/agentConfig.ts");
    await options.getService().startRun(systemCaller, {
      agent: AGENT_CONFIG,
      input: { kind: "workbench.recorded", events } as unknown as Json,
      idempotencyKey: randomUUID(),
      correlationId: `bundle:${randomUUID()}`,
    });
  };

  return {
    id: "capability-runtime:bundles",
    provides: contracts,
    activate(fiber) {
      fiber.provide(contracts[0] as CapabilityContract, async (raw: unknown, ctx: HandlerContext) => {
        const input = raw as { capabilityId?: string; sourceDir?: string; manifest?: Record<string, unknown> };
        const capabilityId = String(input.capabilityId ?? "");
        // §1.2 Install authority: operator direct, or a covered agent grant (the guard records
        // in-run refusals; grant coverage is enforced by the dispatcher decision at invocation
        // and by the grant the agent holds — validated here as bundle.create coverage).
        await requireOperator(ctx, "capability.bundle.register");
        const valid = validateRegister(raw ?? {}) as boolean;
        if (!valid) {
          const reason = validateRegister.errors?.map((e) => `${e.instancePath} ${e.message}`).join("; ") ?? "schema";
          throw new Error(`capability.bundle.register: manifest validation failed — ${reason}`);
        }
        const manifest = input.manifest as {
          name: string; purpose: string;
          skills: readonly { name: string; entry: string; isEntryDocument?: boolean }[];
          tools?: readonly { id: string; description: string; inputSchema: Record<string, unknown> }[];
          requirements?: readonly string[];
          conflicts?: readonly string[]; complements?: readonly string[]; owns?: readonly string[];
        };
        for (const requirement of manifest.requirements ?? []) {
          if (!KNOWN_REQUIREMENT_KINDS.has(requirement)) throw new Error(`capability.bundle.register: unknown requirement kind ${requirement} — unsatisfiable declarations fail install (§1.2)`);
        }
        // §4.2.2 payload ceilings (scan throws BundleLimitError with the named limit).
        try {
          await scanBundle(input.sourceDir!);
        } catch (error) {
          if (error instanceof BundleLimitError) throw new Error(`capability.bundle.register: ${error.message}`);
          throw error;
        }
        const materialized = await materializeVersion(options.home, capabilityId, input.sourceDir!);
        const versionHash = versionHashFor(materialized.manifest);
        const pruned = await pruneVersions(options.home, capabilityId, versionHash, options.referencedVersions?.(capabilityId) ?? new Set());
        const recordedAt = new Date().toISOString();
        await record([
          { type: "capability.bundle.registered", payload: { capabilityId, name: manifest.name, purpose: manifest.purpose, version: versionHash, versionHash, dir: materialized.dir, files: materialized.files, totalBytes: materialized.totalBytes, origin: "directory", createdBy: ctx.actor.id, skills: manifest.skills.length, tools: (manifest.tools ?? []).length, recordedAt } },
          ...(pruned.length > 0 ? [{ type: "workbench.bundles.pruned", payload: { capabilityId, versions: pruned } }] : []),
        ]);
        return { capabilityId, version: versionHash, dir: materialized.dir, files: materialized.files, totalBytes: materialized.totalBytes };
      });
    },
  };
}

export { BUNDLE_LIMITS, versionHashFor };
void BUNDLE_LIMITS;
