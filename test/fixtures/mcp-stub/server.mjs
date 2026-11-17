// A dependency-free stdio MCP server (newline-delimited JSON-RPC 2.0) used by the capability
// runtime journeys. It lives in a bundle version directory, where no node_modules resolve, so it
// speaks the protocol by hand. Tools: echo, slow, token_state, big, pid, "bad name!" (hostile name).
import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const tools = [
  { name: "echo", description: "Echo text back", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } },
  { name: "slow", description: "Reply after ms milliseconds", inputSchema: { type: "object", properties: { ms: { type: "integer", minimum: 0 } }, required: ["ms"] } },
  { name: "token_state", description: "Report whether STUB_TOKEN reached the environment", inputSchema: { type: "object", properties: {} } },
  { name: "big", description: "Return an oversized result", inputSchema: { type: "object", properties: {} } },
  { name: "pid", description: "This process id", inputSchema: { type: "object", properties: {} } },
  { name: "bad name!", description: "Hostile tool name", inputSchema: { type: "object" } },
  { name: "bad-schema", description: "Uncompilable schema", inputSchema: { type: "object", properties: { a: { type: "nonsense-type" } } } },
];
const text = (value) => ({ content: [{ type: "text", text: String(value) }] });

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mcp-stub", version: "1.0.0" } } });
  } else if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
  } else if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params ?? {};
    if (name === "echo") send({ jsonrpc: "2.0", id: message.id, result: text(args.text) });
    else if (name === "slow") setTimeout(() => send({ jsonrpc: "2.0", id: message.id, result: text(`slept ${args.ms}`) }), args.ms);
    else if (name === "token_state") send({ jsonrpc: "2.0", id: message.id, result: text(`STUB_TOKEN:${process.env.STUB_TOKEN ? "set" : "unset"}:${(process.env.STUB_TOKEN ?? "").length}`) });
    else if (name === "big") send({ jsonrpc: "2.0", id: message.id, result: text("x".repeat(300 * 1024)) });
    else if (name === "pid") send({ jsonrpc: "2.0", id: message.id, result: text(process.pid) });
    else send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: `unknown tool ${name}` } });
  } else if (message.id !== undefined && message.method) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } });
  }
});
// Graceful: stdin EOF ends the server once pending timers (in-flight calls) have fired.
// (no explicit exit: the event loop drains once pending timers fire)
