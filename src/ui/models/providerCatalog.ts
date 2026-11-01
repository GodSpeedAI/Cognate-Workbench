// Data-driven provider catalog for the ProviderWizard. Extend by adding entries; no JSX changes needed.
// Only protocols the `model.configure` capability supports are valid here.

export const API_PROTOCOL_OPTIONS = ["OpenAI Chat Completions", "OpenAI Responses", "Anthropic Messages"] as const;
export type ApiProtocolLabel = (typeof API_PROTOCOL_OPTIONS)[number];
export type WireProtocolValue = "openai-compatible" | "openai-completions" | "openai-responses" | "anthropic-messages";

const PROTOCOL_WIRE_VALUES: Readonly<Record<ApiProtocolLabel, Exclude<WireProtocolValue, "openai-compatible">>> = {
  "OpenAI Chat Completions": "openai-completions",
  "OpenAI Responses": "openai-responses",
  "Anthropic Messages": "anthropic-messages",
};

export function protocolToWire(display: ApiProtocolLabel): Exclude<WireProtocolValue, "openai-compatible"> {
  return PROTOCOL_WIRE_VALUES[display];
}

/** "openai-compatible" is a legacy wire value; it edits as OpenAI Chat Completions. */
export function wireToProtocol(wire: string): ApiProtocolLabel {
  if (wire === "openai-responses") return "OpenAI Responses";
  if (wire === "anthropic-messages") return "Anthropic Messages";
  return "OpenAI Chat Completions";
}

export type ProviderAuthKind = "apiKey" | "none" | "oauth";

export type ProviderGroup = "popular" | "open" | "local" | "enterprise" | "custom";

export const PROVIDER_GROUPS: readonly { readonly key: ProviderGroup; readonly title: string }[] = [
  { key: "popular", title: "Popular" },
  { key: "open", title: "Open-model hosts" },
  { key: "local", title: "On this computer" },
  { key: "enterprise", title: "Enterprise" },
  { key: "custom", title: "Custom" },
];

export interface ProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly protocol: ApiProtocolLabel;
  /** Empty for "Custom": the operator supplies it. */
  readonly baseURL: string;
  readonly auth: ProviderAuthKind;
  /** Where to get a key / what the key looks like. */
  readonly keyHint?: string;
  readonly docsUrl?: string;
  readonly defaultModels?: readonly string[];
  readonly group: ProviderGroup;
  /** Azure OpenAI: `api-key` header, a deployment URL and an `api-version` query. Chat protocol only. */
  readonly azure?: true;
  /**
   * false: the base URL is the provider's published endpoint but Workbench has not exercised it.
   * The wizard says so; "Test connection" is the check. Presets with no URL here are guidance only.
   */
  readonly verified: boolean;
  /** Shown under the preset in the wizard (custom guidance for endpoints Workbench cannot prefill). */
  readonly guidance?: string;
}

export const DEFAULT_AZURE_API_VERSION = "2024-10-21";

export const PROVIDER_CATALOG: readonly ProviderPreset[] = [
  { id: "openai", label: "OpenAI", description: "GPT models via the Responses API", protocol: "OpenAI Responses", baseURL: "https://api.openai.com/v1", auth: "apiKey", keyHint: "Starts with sk-", docsUrl: "https://platform.openai.com/api-keys", defaultModels: ["gpt-4.1"], group: "popular", verified: true },
  { id: "openai-chat", label: "OpenAI (Chat Completions)", description: "The same models over the older Chat API", protocol: "OpenAI Chat Completions", baseURL: "https://api.openai.com/v1", auth: "apiKey", keyHint: "Starts with sk-", docsUrl: "https://platform.openai.com/api-keys", defaultModels: ["gpt-4.1"], group: "popular", verified: true },
  { id: "anthropic", label: "Anthropic", description: "Claude models via the Messages API", protocol: "Anthropic Messages", baseURL: "https://api.anthropic.com/v1", auth: "apiKey", keyHint: "Starts with sk-ant-", docsUrl: "https://console.anthropic.com/settings/keys", defaultModels: ["claude-sonnet-4-5"], group: "popular", verified: true },
  { id: "openrouter", label: "OpenRouter", description: "One key for many hosted models", protocol: "OpenAI Chat Completions", baseURL: "https://openrouter.ai/api/v1", auth: "apiKey", keyHint: "Starts with sk-or-", docsUrl: "https://openrouter.ai/keys", group: "popular", verified: true },
  { id: "google-gemini", label: "Google Gemini", description: "Gemini through its OpenAI-compatible endpoint", protocol: "OpenAI Chat Completions", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", auth: "apiKey", docsUrl: "https://aistudio.google.com/apikey", group: "popular", verified: false },
  { id: "xai", label: "xAI", description: "Grok models", protocol: "OpenAI Chat Completions", baseURL: "https://api.x.ai/v1", auth: "apiKey", keyHint: "Starts with xai-", docsUrl: "https://console.x.ai", group: "popular", verified: false },
  { id: "deepseek", label: "DeepSeek", description: "DeepSeek chat and reasoning models", protocol: "OpenAI Chat Completions", baseURL: "https://api.deepseek.com/v1", auth: "apiKey", docsUrl: "https://platform.deepseek.com/api_keys", group: "popular", verified: false },
  { id: "groq", label: "Groq", description: "Fast open-model inference", protocol: "OpenAI Chat Completions", baseURL: "https://api.groq.com/openai/v1", auth: "apiKey", keyHint: "Starts with gsk_", docsUrl: "https://console.groq.com/keys", group: "open", verified: true },
  { id: "mistral", label: "Mistral", description: "Mistral and Codestral models", protocol: "OpenAI Chat Completions", baseURL: "https://api.mistral.ai/v1", auth: "apiKey", docsUrl: "https://console.mistral.ai/api-keys", group: "open", verified: true },
  { id: "together", label: "Together AI", description: "Open models, hosted", protocol: "OpenAI Chat Completions", baseURL: "https://api.together.xyz/v1", auth: "apiKey", docsUrl: "https://api.together.xyz/settings/api-keys", group: "open", verified: true },
  { id: "fireworks", label: "Fireworks AI", description: "Open models, hosted", protocol: "OpenAI Chat Completions", baseURL: "https://api.fireworks.ai/inference/v1", auth: "apiKey", docsUrl: "https://fireworks.ai/account/api-keys", group: "open", verified: true },
  { id: "cerebras", label: "Cerebras", description: "Open models on wafer-scale hardware", protocol: "OpenAI Chat Completions", baseURL: "https://api.cerebras.ai/v1", auth: "apiKey", docsUrl: "https://cloud.cerebras.ai", group: "open", verified: false },
  { id: "moonshot", label: "Moonshot (Kimi)", description: "Kimi models via the Moonshot API", protocol: "OpenAI Chat Completions", baseURL: "https://api.moonshot.ai/v1", auth: "apiKey", docsUrl: "https://platform.moonshot.ai", group: "open", verified: false },
  { id: "qwen-dashscope", label: "Qwen (DashScope)", description: "Qwen models, international endpoint", protocol: "OpenAI Chat Completions", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", auth: "apiKey", docsUrl: "https://bailian.console.alibabacloud.com", group: "open", verified: false },
  { id: "perplexity", label: "Perplexity", description: "Search-grounded Sonar models", protocol: "OpenAI Chat Completions", baseURL: "https://api.perplexity.ai", auth: "apiKey", keyHint: "Starts with pplx-", docsUrl: "https://www.perplexity.ai/settings/api", group: "open", verified: false },
  { id: "zai-glm", label: "Z.ai GLM", description: "GLM models through the Anthropic-compatible endpoint", protocol: "Anthropic Messages", baseURL: "https://api.z.ai/api/anthropic", auth: "apiKey", docsUrl: "https://docs.z.ai", defaultModels: ["glm-5.3"], group: "open", verified: false, guidance: "Check whether this endpoint needs a /v1 suffix with Test connection." },
  { id: "xiaomi-mimo", label: "Xiaomi MiMo", description: "MiMo models. The endpoint depends on your plan and region", protocol: "Anthropic Messages", baseURL: "", auth: "apiKey", docsUrl: "https://platform.xiaomimimo.com", defaultModels: ["mimo-v2.6-pro"], group: "open", verified: false, guidance: "Paste the Anthropic-compatible endpoint shown for your MiMo plan; Workbench does not guess the region." },
  { id: "ollama", label: "Ollama", description: "Models running on this computer", protocol: "OpenAI Chat Completions", baseURL: "http://127.0.0.1:11434/v1", auth: "none", keyHint: "No key needed for a local server", group: "local", verified: true },
  { id: "lm-studio", label: "LM Studio", description: "Models running on this computer", protocol: "OpenAI Chat Completions", baseURL: "http://127.0.0.1:1234/v1", auth: "none", keyHint: "No key needed for a local server", group: "local", verified: true },
  { id: "azure-openai", label: "Azure OpenAI", description: "Your own deployment. Needs the deployment URL and an api-version", protocol: "OpenAI Chat Completions", baseURL: "https://your-resource.openai.azure.com/openai/deployments/your-deployment", auth: "apiKey", group: "enterprise", azure: true, verified: true },
  { id: "custom", label: "Custom OpenAI-compatible", description: "Any gateway or server with a compatible API", protocol: "OpenAI Chat Completions", baseURL: "", auth: "apiKey", group: "custom", verified: true },
];

export function slugifyProviderId(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(s) ? s : s ? `p-${s}` : "";
}

export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

/** `invocation of X failed: {json}` -> the JSON's `message`; otherwise the raw text. */
export function capabilityErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = /invocation of\s+\S+\s+failed:\s*(\{[\s\S]*\})\s*$/.exec(raw);
  if (m) {
    try {
      const parsed = JSON.parse(m[1]!) as { message?: unknown };
      if (typeof parsed.message === "string" && parsed.message) return parsed.message;
    } catch {
      /* fall through */
    }
  }
  return raw;
}
