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
  readonly group: "hosted" | "local" | "custom";
}

export const PROVIDER_CATALOG: readonly ProviderPreset[] = [
  { id: "openai", label: "OpenAI", description: "GPT models via the Responses API", protocol: "OpenAI Responses", baseURL: "https://api.openai.com/v1", auth: "apiKey", keyHint: "Starts with sk-", docsUrl: "https://platform.openai.com/api-keys", defaultModels: ["gpt-4.1"], group: "hosted" },
  { id: "anthropic", label: "Anthropic", description: "Claude models via the Messages API", protocol: "Anthropic Messages", baseURL: "https://api.anthropic.com/v1", auth: "apiKey", keyHint: "Starts with sk-ant-", docsUrl: "https://console.anthropic.com/settings/keys", defaultModels: ["claude-sonnet-4-5"], group: "hosted" },
  { id: "openrouter", label: "OpenRouter", description: "One key for many hosted models", protocol: "OpenAI Chat Completions", baseURL: "https://openrouter.ai/api/v1", auth: "apiKey", keyHint: "Starts with sk-or-", docsUrl: "https://openrouter.ai/keys", group: "hosted" },
  { id: "groq", label: "Groq", description: "Fast open-model inference", protocol: "OpenAI Chat Completions", baseURL: "https://api.groq.com/openai/v1", auth: "apiKey", keyHint: "Starts with gsk_", docsUrl: "https://console.groq.com/keys", group: "hosted" },
  { id: "mistral", label: "Mistral", description: "Mistral and Codestral models", protocol: "OpenAI Chat Completions", baseURL: "https://api.mistral.ai/v1", auth: "apiKey", docsUrl: "https://console.mistral.ai/api-keys", group: "hosted" },
  { id: "together", label: "Together AI", description: "Open models, hosted", protocol: "OpenAI Chat Completions", baseURL: "https://api.together.xyz/v1", auth: "apiKey", docsUrl: "https://api.together.xyz/settings/api-keys", group: "hosted" },
  { id: "fireworks", label: "Fireworks AI", description: "Open models, hosted", protocol: "OpenAI Chat Completions", baseURL: "https://api.fireworks.ai/inference/v1", auth: "apiKey", docsUrl: "https://fireworks.ai/account/api-keys", group: "hosted" },
  { id: "azure-openai", label: "Azure OpenAI", description: "Replace the resource and deployment in the URL", protocol: "OpenAI Chat Completions", baseURL: "https://your-resource.openai.azure.com/openai/deployments/your-deployment", auth: "apiKey", group: "hosted" },
  { id: "ollama", label: "Ollama", description: "Models running on this computer", protocol: "OpenAI Chat Completions", baseURL: "http://127.0.0.1:11434/v1", auth: "none", keyHint: "No key needed for a local server", group: "local" },
  { id: "lm-studio", label: "LM Studio", description: "Models running on this computer", protocol: "OpenAI Chat Completions", baseURL: "http://127.0.0.1:1234/v1", auth: "none", keyHint: "No key needed for a local server", group: "local" },
  { id: "custom", label: "Custom OpenAI-compatible", description: "Any gateway or server with a compatible API", protocol: "OpenAI Chat Completions", baseURL: "", auth: "apiKey", group: "custom" },
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
