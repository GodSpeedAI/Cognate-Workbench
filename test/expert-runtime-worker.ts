import { writeFile } from "node:fs/promises";
import { collaborationResponder } from "./expert-helpers.ts";
import { startServer } from "../src/server.ts";
import type { ModelConfig } from "../src/components/providerRegistry.ts";

const home = process.env.EXPERT_WORKER_HOME;
const portFile = process.env.EXPERT_WORKER_PORT_FILE;
const startedFile = process.env.EXPERT_WORKER_STARTED_FILE;
const releaseFile = process.env.EXPERT_WORKER_RELEASE_FILE;
if (!home || !portFile || !startedFile || !releaseFile) throw new Error("Expert runtime worker environment is incomplete");

const server = await startServer({
  port: 0,
  home,
  expertProviderFactory(route: ModelConfig) {
    return {
      id: route.providerId,
      model: route.model,
      features: { generate: true, stream: false, tool_use: true, structured_output: false, multimodal_input: false, context_limit: 32_000 },
      async generate(request) {
        if (route.model === "builder-model" && !request.messages.some((message) => message.role === "tool")) {
          if (!(await Bun.file(releaseFile).exists())) {
            await writeFile(startedFile, "builder provider entered", "utf8");
            while (!(await Bun.file(releaseFile).exists())) await Bun.sleep(15);
          }
          return { message: { role: "assistant", content: "Recovered Builder result after process restart." }, toolCalls: [], finishReason: "stop", model: route.model };
        }
        return collaborationResponder(route, request);
      },
      async *stream() {},
    };
  },
});
await writeFile(portFile, new URL(server.url).port, "utf8");
// The parent test terminates this process to model abrupt Workbench interruption.
await new Promise<void>(() => {});
