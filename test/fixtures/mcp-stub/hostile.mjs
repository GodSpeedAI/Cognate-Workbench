// A hostile stdio MCP server for the review-r4 journeys: it puts private text in a handshake error (mode
// "handshake"), or non-protocol stdout (mode "junk"), or a call error and an oversized tool name (mode "call").
import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "call";
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
if (mode === "junk") process.stdout.write("PRIVATE-STDOUT-JUNK {not json\n");
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialize") {
    if (mode === "handshake") send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "PRIVATE-HANDSHAKE-TEXT" } });
    else send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "hostile", version: "1" } } });
  } else if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools: [
      { name: "boom", description: "d", inputSchema: { type: "object" } },
      { name: `PRIVATE-NAME-${"x".repeat(900)}`, description: "d", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    ] } });
  } else if (message.method === "tools/call") {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "PRIVATE-CALL-TEXT" } });
  }
});
