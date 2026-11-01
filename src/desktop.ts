// Entry point of the windowed desktop executable (Windows GUI subsystem: no console, so console output goes to a log file).
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { main } from "./cli.ts";
import { defaultHome } from "./resources.ts";

const home = process.env.COGNATE_WORKBENCH_HOME ?? process.env.COGNATE_HARNESS_HOME ?? defaultHome();
const logFile = join(home, "launch.log");
try { mkdirSync(home, { recursive: true }); } catch { /* logging stays best-effort */ }
const sink = (...parts: unknown[]) => {
  try { appendFileSync(logFile, `${new Date().toISOString()} ${parts.map(String).join(" ")}\n`); } catch { /* no console to fall back to */ }
};
console.log = console.warn = console.error = sink;

main(["launch"]).then(
  (code) => { if (code !== 0) process.exitCode = code; },
  (error: Error) => { sink(`[cognate-workbench] ${error.message}`); process.exit(1); },
);
