// Fake OpenAI/Anthropic-style endpoint for provider-parity journeys. Unlike the aimock journal
// (which redacts Authorization), it records the real header values, so a test can prove which
// stored key reached the wire. Test-only: the keys here are fixtures, never real credentials.
export interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization?: string;
  readonly xApiKey?: string;
  readonly apiKey?: string;
  readonly model?: string;
}

export interface FakeProvider {
  readonly port: number;
  readonly baseURL: string;
  readonly seen: SeenRequest[];
  stop(): Promise<void>;
}

/** `acceptKey`: the one credential value this server accepts (Bearer, x-api-key or api-key); when
 *  undefined the server accepts only requests carrying no credential at all (a keyless server). */
export function fakeProvider(options: { readonly acceptKey?: string; readonly models?: readonly string[] } = {}): FakeProvider {
  const seen: SeenRequest[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const authorization = req.headers.get("authorization") ?? undefined;
      const xApiKey = req.headers.get("x-api-key") ?? undefined;
      const apiKey = req.headers.get("api-key") ?? undefined;
      let body: { model?: string; stream?: boolean } = {};
      if (req.method === "POST") body = (await req.json().catch(() => ({}))) as typeof body;
      seen.push({
        method: req.method,
        path: url.pathname + url.search,
        ...(authorization !== undefined ? { authorization } : {}),
        ...(xApiKey !== undefined ? { xApiKey } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(body.model ? { model: body.model } : {}),
      });
      const presented = authorization?.replace(/^Bearer\s*/i, "") || xApiKey || apiKey || "";
      const authorised = options.acceptKey === undefined ? presented === "" : presented === options.acceptKey;
      if (!authorised) return new Response(JSON.stringify({ error: { message: "unauthorised" } }), { status: 401, statusText: "Unauthorized", headers: { "content-type": "application/json" } });
      if (req.method === "GET" && url.pathname.endsWith("/models")) {
        return Response.json({ data: (options.models ?? ["model-a", "model-b"]).map((id) => ({ id })) });
      }
      if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
        const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        if (body.stream) {
          return new Response(chunk({ role: "assistant", content: "fake-ok" }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
        }
        return Response.json({ id: "c1", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "fake-ok" }, finish_reason: "stop" }] });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    port: server.port ?? 0,
    baseURL: `http://127.0.0.1:${server.port}/v1`,
    seen,
    stop: async () => { await server.stop(true); },
  };
}
