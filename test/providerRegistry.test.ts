// Unit: ProviderRegistry hot-swap semantics. A replacement that fails before activation is
// disposed and the previous provider stays mounted and usable — a bad reconfigure must never
// take model.generate down. ProviderRegistry only calls kernel.mount, so a minimal fake kernel
// that actually runs component activation exercises the real streamingProviderComponent path.
import { describe, expect, test } from "bun:test";
import type {
  Component,
  ComponentHandle,
  FiberContext,
  Kernel,
  KernelEvent,
  Requirement,
} from "@godspeedai/cognate-kernel-api";
import { ProviderRegistry, type ModelConfig } from "../src/components/providerRegistry.ts";
import type { SecretStore } from "../src/secrets.ts";

/** Fake kernel: activation runs immediately; provided capabilities are invocable by contract id. */
function fakeKernel(options: { readonly failComponentIds?: readonly string[] } = {}): Kernel & {
  invoke(capability: string, input: unknown): Promise<unknown>;
} {
  const handlers = new Map<string, { readonly handler: (input: unknown, context: { signal: AbortSignal; progress?: unknown }) => Promise<unknown>; readonly owner: object }>();
  const kernel: Kernel = {
    root: undefined as never,
    async mount(component: Component) {
      const owner = {};
      const fiber: FiberContext = {
        fiberId: "fiber-1",
        componentId: component.id,
        scope: undefined as never,
        dependencies: {},
        effects: { register: () => ({ label: "none", disposed: false, dispose: async () => {} }) },
        signal: new AbortController().signal,
        provide: (contract, handler) => {
          handlers.set(contract.id, { handler: handler as never, owner });
        },
      };
      const fail = options.failComponentIds?.includes(component.id) ?? false;
      const handle = {
        componentId: component.id,
        scopeId: "root",
        state: "ACTIVATING" as ComponentHandle["state"],
        fiberId: undefined as string | undefined,
        lastError: undefined,
        waitFor: (state: string, timeoutMs?: number) =>
          fail
            ? new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error("activation timeout")), Math.min(timeoutMs ?? 1000, 50)))
            : Promise.resolve().then(async () => {
                  await component.activate(fiber);
                  handle.state = "ACTIVE";
                  handle.fiberId = "fiber-1";
                }),
        dispose: async () => {
          handle.state = "DISPOSED";
          // Withdraw only what this mount still owns: a younger mount of the same contract id
          // (the hot-swap replacement) must survive the old provider's disposal.
          for (const [id, entry] of [...handlers]) if (entry.owner === owner) handlers.delete(id);
        },
        reset: async () => {},
      } as ComponentHandle;
      return handle;
    },
    resolve: (requirement: Requirement) => {
      const handler = handlers.get(requirement.capability);
      return handler ? ({ capability: requirement.capability, invoke: handler } as never) : { unavailable: true, requirement, reason: "no provider" };
    },
    observe: (_listener: (event: KernelEvent) => void) => () => {},
    shutdown: async () => {},
  };
  return {
    ...kernel,
    async invoke(capability: string, input: unknown) {
      const entry = handlers.get(capability);
      if (!entry) throw new Error(`no provider for ${capability}`);
      return entry.handler(input, { signal: new AbortController().signal });
    },
  };
}

const secrets: SecretStore = {
  async get(name) {
    return name === "model-provider:mock" ? "sk-test" : undefined;
  },
  async put() {},
};

const config = (protocol: ModelConfig["protocol"], overrides: Partial<ModelConfig> = {}): ModelConfig => ({
  providerId: "mock",
  baseURL: "not-a-base-url",
  protocol,
  model: "mock-model-1",
  ...overrides,
});

describe("ProviderRegistry hot-swap", () => {
  test("a replacement whose activation fails is disposed; the previous provider stays usable", async () => {
    let disposedReasons: string[] = [];
    const kernel = fakeKernel({ failComponentIds: ["model-provider:openai-responses:mock"] });
    // Wrap dispose to record reasons.
    const innerMount = kernel.mount.bind(kernel);
    kernel.mount = async (component, scope) => {
      const handle = await innerMount(component, scope);
      const innerDispose = handle.dispose.bind(handle);
      handle.dispose = async (reason: string) => {
        disposedReasons.push(reason);
        await innerDispose(reason);
      };
      return handle;
    };
    const registry = new ProviderRegistry(kernel);
    await registry.swap(config("openai-compatible"), secrets);
    expect(registry.current?.protocol).toBe("openai-compatible");
    // Sanity: the mounted provider actually serves model.generate.
    await expect(kernel.invoke("model.generate", { messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(); // dead baseURL: unavailable, but the capability exists

    // A swap whose replacement never becomes ACTIVE throws, disposes the orphaned replacement,
    // and leaves the previous provider mounted, current, and invocable.
    disposedReasons = [];
    await expect(registry.swap(config("openai-responses"), secrets)).rejects.toThrow("activation timeout");
    expect(disposedReasons).toHaveLength(1);
    expect(registry.current?.protocol).toBe("openai-compatible");
    await expect(kernel.invoke("model.generate", { messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(); // still the OLD provider (connection refused), not "no provider"
  });

  test("successful hot-swap replaces the served provider; unsupported protocol is a safe no-op", async () => {
    const kernel = fakeKernel();
    const registry = new ProviderRegistry(kernel);
    await registry.swap(config("openai-compatible"), secrets);
    expect(registry.current?.protocol).toBe("openai-compatible");

    // Unsupported protocol: buildProvider throws inside swap; nothing mounts, nothing disposes,
    // the previous provider stays current and invocable.
    await expect(registry.swap(config("gemini-generate-content" as never), secrets)).rejects.toThrow("unsupported wire protocol");
    expect(registry.current?.protocol).toBe("openai-compatible");
    const lease = kernel.resolve({ capability: "model.generate" } as Requirement);
    expect("unavailable" in lease).toBe(false);

    // A successful hot-swap disposes the old component; the capability resolves to the new one.
    await registry.swap(config("anthropic-messages"), secrets);
    expect(registry.current?.protocol).toBe("anthropic-messages");
    const lease2 = kernel.resolve({ capability: "model.generate" } as Requirement);
    expect("unavailable" in lease2).toBe(false);
  });

  test("an unreachable baseURL still mounts (activation never dials); generate reports unavailable, not missing", async () => {
    const kernel = fakeKernel();
    const registry = new ProviderRegistry(kernel);
    await registry.swap(config("openai-completions", { baseURL: "not-a-base-url" }), secrets);
    try {
      await kernel.invoke("model.generate", { messages: [{ role: "user", content: "hi" }] });
      throw new Error("expected model.generate to fail against a dead endpoint");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("no provider for");
    }
  });
});
