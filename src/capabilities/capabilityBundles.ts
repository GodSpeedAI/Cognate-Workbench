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
import type { ExecutionWorldRegistry } from "@godspeedai/cognate-execution";
import { join } from "node:path";
import { materializeVersion, pruneVersions, scanBundle, versionDir, BUNDLE_LIMITS, BundleLimitError, versionHashFor } from "./bundleStore.ts";
import { buildDescriptor, type BundleManifestData } from "./skillLoader.ts";
import { HarnessPatchError, hasHarness, validateHarness } from "../workbench/harnessPatches.ts";
import { ingestDirectorySource, type IngestedSource } from "../workbench/bundleSources.ts";

const registerSchema = {
  type: "object",
  properties: {
    capabilityId: { type: "string", pattern: "^capability\\.bundle\\.[a-z0-9][a-z0-9.-]{0,63}$" },
    sourceDir: { type: "string" },
    /** CUJ 8: read `sourceDir` through this execution world's filesystem port (local/SSH/WSL). */
    executionWorldId: { type: "string" },
    manifest: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        purpose: { type: "string", maxLength: 200 },
        skills: { type: "array", maxItems: 8, items: { type: "object", properties: { name: { type: "string" }, entry: { type: "string" }, isEntryDocument: { type: "boolean" }, trigger: { type: "string", maxLength: 160 } }, required: ["name", "entry"], additionalProperties: false } },
        tools: { type: "array", maxItems: 8, items: { type: "object", properties: { id: { type: "string" }, description: { type: "string" }, inputSchema: { type: "object" } }, required: ["id", "description", "inputSchema"], additionalProperties: false } },
        requirements: { type: "array", maxItems: 16, items: { type: "string" } },
        conflicts: { type: "array", items: { type: "string" } },
        complements: { type: "array", items: { type: "string" } },
        owns: { type: "array", items: { type: "string" } },
        harness: { type: "object" },
      },
      required: ["name", "purpose", "skills"],
      additionalProperties: false,
    },
  },
  required: ["capabilityId", "sourceDir", "manifest"],
  additionalProperties: false,
} as const;

const SYSTEM = { actor: { id: "system", kind: "system" as const }, tenant: "local" };

const KNOWN_REQUIREMENT_KINDS: ReadonlySet<string> = new Set(["capability.invoke", "skill.load", "harness.modify", "bundle.create", "bundle.activate"]);

export interface CapabilityBundlesOptions {
  readonly getService: () => RuntimeService;
  readonly lifecycleRecorder: import("../workbench/lifecycleRecorder.ts").LifecycleRecorder;
  readonly authorityIndex: import("../workbench/authorityIndex.ts").AuthorityIndex;
  readonly home: string;
  readonly tenant: string;
  /** Live-referenced versions per capability (the GC reference rule, owner condition 4):
   *  active versions + versions any activation row, in-flight counter, or spawn-ledger process
   *  names. Wired from the authority index + spawn ledger at T2; empty in T1 (no activations
   *  exist yet — register/validate only). */
  readonly referencedVersions?: (capabilityId: string) => ReadonlySet<string>;
  /** CUJ 8: the execution-world registry; present => `executionWorldId` sources are readable. */
  readonly getRegistry?: () => ExecutionWorldRegistry;
  readonly semanticRefs?: Readonly<Record<string, SemanticRef | undefined>>;
}

export function capabilityBundlesComponent(options: CapabilityBundlesOptions): Component {
  const ajv = new Ajv({ strict: false });
  const validateRegister = ajv.compile(registerSchema);
  const contracts: CapabilityContract[] = [
    { id: "capability.bundle.register", version: "1.0.0", semanticRef: options.semanticRefs?.["capability.bundle.register"] },
    { id: "capability.bundle.uninstall", version: "1.0.0", semanticRef: options.semanticRefs?.["capability.bundle.uninstall"] },
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
      const index = options.authorityIndex;


      fiber.provide(contracts[0] as CapabilityContract, async (raw: unknown, ctx: HandlerContext) => {
        const input = raw as { capabilityId?: string; sourceDir?: string; executionWorldId?: string; manifest?: Record<string, unknown> };
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
        const manifest = input.manifest as unknown as BundleManifestData & { requirements?: readonly string[] };
        // §4.3: every validation refusal is explicit AND recorded (`capability.validation_failed`).
        const refuse = async (reason: string): Promise<never> => {
          await record([{ type: "capability.validation_failed", payload: { capabilityId, reason, recordedAt: new Date().toISOString() } }]).catch(() => {});
          throw new Error(`capability.bundle.register: ${reason}`);
        };
        for (const requirement of manifest.requirements ?? []) {
          if (!KNOWN_REQUIREMENT_KINDS.has(requirement)) await refuse(`unknown requirement kind ${requirement} — unsatisfiable declarations fail install (§1.2)`);
        }
        let harness: ReturnType<typeof validateHarness>;
        try {
          harness = validateHarness(manifest.harness);
        } catch (error) {
          if (error instanceof HarnessPatchError) return refuse(`harness declaration refused (${error.code}): ${error.message}`);
          throw error;
        }
        if (hasHarness(harness) && !(manifest.requirements ?? []).includes("harness.modify")) {
          return refuse("harness surfaces require the harness.modify requirement (modifying surfaces is authority-gated, §3.1)");
        }
        // CUJ 8: a provider-backed source is read through the world's filesystem port into a
        // staging directory; from there the pipeline is identical to a local install.
        let staged: IngestedSource | undefined;
        let sourceDir = input.sourceDir!;
        try {
          if (input.executionWorldId !== undefined) {
            const registry = options.getRegistry?.();
            if (!registry || !registry.has(input.executionWorldId)) await refuse(`execution world ${input.executionWorldId} is not connected`);
            try {
              staged = await ingestDirectorySource(registry!.get(input.executionWorldId), sourceDir, join(options.home, "bundle-staging"));
            } catch (error) {
              if (error instanceof BundleLimitError) return await refuse(error.message);
              throw error;
            }
            sourceDir = staged.dir;
          }
          // §4.2.2 payload ceilings (scan throws BundleLimitError with the named limit).
          let scanned: Awaited<ReturnType<typeof scanBundle>>;
          try {
            scanned = await scanBundle(sourceDir);
          } catch (error) {
            if (error instanceof BundleLimitError) return await refuse(error.message);
            throw error;
          }
          // Satisfiability: every declared skill entry must be a relative path to a scanned file.
          const present = new Set(scanned.manifest.map((line) => line.slice(0, line.lastIndexOf(":"))));
          for (const skill of manifest.skills) {
            if (skill.entry.startsWith("/") || skill.entry.split("/").includes("..") || !present.has(skill.entry)) await refuse(`skill ${skill.name} declares entry ${skill.entry}, which is not a file inside the bundle`);
          }
          const stored = JSON.parse(JSON.stringify({ name: manifest.name, purpose: manifest.purpose, skills: manifest.skills, tools: manifest.tools ?? [], requirements: manifest.requirements ?? [], conflicts: manifest.conflicts ?? [], complements: manifest.complements ?? [], owns: manifest.owns ?? [], harness })) as Record<string, unknown>;
          // The version identity covers payload AND the whole validated manifest (R1-2).
          const materialized = await materializeVersion(options.home, capabilityId, sourceDir, stored);
          const versionHash = versionHashFor(materialized.manifest, stored);
          // §5.1: descriptors truncate visibly at registration, and the truncation is recorded.
          const descriptor = buildDescriptor(capabilityId, versionHash, manifest);
          const pruned = await pruneVersions(options.home, capabilityId, versionHash, options.referencedVersions?.(capabilityId) ?? new Set());
          const recordedAt = new Date().toISOString();
          await record([
            { type: "capability.bundle.registered", payload: { capabilityId, name: manifest.name, purpose: manifest.purpose, version: versionHash, versionHash, dir: materialized.dir, files: materialized.files, totalBytes: materialized.totalBytes, origin: staged ? `world:${staged.worldKind}` : "directory", ...(staged ? { sourceWorldId: staged.worldId } : {}), createdBy: ctx.actor.id, skills: manifest.skills.length, tools: (manifest.tools ?? []).length, manifest: stored, descriptorTruncated: descriptor.truncated, recordedAt } },
            ...(pruned.length > 0 ? [{ type: "workbench.bundles.pruned", payload: { capabilityId, versions: pruned } }] : []),
          ]);
          return { capabilityId, version: versionHash, dir: materialized.dir, files: materialized.files, totalBytes: materialized.totalBytes, descriptorTruncated: descriptor.truncated };
        } finally {
          if (staged) await staged.cleanup().catch(() => {});
        }
      });

      fiber.provide(contracts[1] as CapabilityContract, async (raw: unknown, ctx: HandlerContext) => {
        const input = raw as { capabilityId?: string };
        const capabilityId = String(input.capabilityId ?? "");
        await requireOperator(ctx, "capability.bundle.uninstall");
        await index.ready;
        const live = [...index.activations.values()].some((row) => row.capabilityId === capabilityId && row.state === "active");
        if (live) throw new Error(`capability.bundle.uninstall: ${capabilityId} has live activations — deactivate first (zero-live rule, §1.5)`);
        await options.lifecycleRecorder.commitBatch(capabilityId, [{ type: "capability.uninstalled", payload: { capabilityId } }], `uninstall:${capabilityId}`);
        return { capabilityId, uninstalled: true };
      });
    },
  };
}

export { BUNDLE_LIMITS, versionHashFor };
void BUNDLE_LIMITS;
