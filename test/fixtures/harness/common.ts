// Shared helpers for the fake harness CLIs. These speak each protocol deterministically so the
// journey tests never run a real CLI or model. Behaviour is chosen by keywords in the prompt:
//   ask       request permission for an edit before doing it (allow -> edit runs, deny -> tool fails)
//   edit      do a file edit (with a diff) without asking
//   hang      stream some text then wait forever (spawns a `sleep` child; pids -> hang.pids in cwd)
//   stubborn  with hang: ignore the protocol interrupt
//   authfail  fail like a signed-out CLI      limit  fail like a usage limit      crash  exit 3
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

export function out(frame: unknown): void {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

export function lines(onLine: (frame: Record<string, any>) => void): void {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (l) => {
    if (!l.trim()) return;
    try { onLine(JSON.parse(l)); } catch { /* ignore */ }
  });
}

export function logArgv(): void {
  writeFileSync("fake.pid", `${process.pid}\n`);
  const file = process.env.FAKE_HARNESS_LOG;
  if (file) appendFileSync(file, `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env) })}\n`);
}

export function version(name: string): boolean {
  if (process.argv.includes("--version")) { console.log(`${name} 1.2.3 (fake)`); return true; }
  if (process.argv.includes("--help")) { console.log(`Usage: ${name} [options]\n  --experimental-acp   Start in ACP mode`); return true; }
  return false;
}

export function hang(): void {
  const child = Bun.spawn(["sleep", "300"], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  writeFileSync("hang.pids", `${process.pid} ${child.pid}\n`);
  setInterval(() => {}, 1 << 30);
}
