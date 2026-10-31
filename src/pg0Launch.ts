// Starts the bundled pg0 instance before the store's own driver runs. The SDK's pg0 driver waits for the
// `pg0 start` child's output pipes to close. On Windows the PostgreSQL process that pg0 leaves running
// inherits those pipes, so the close never arrives and startup hangs. Here the child gets no pipes and only
// its exit is awaited; once it is running, the driver's `pg0 info` finds it and connects.
// pg0 outlives the server by design, so an instance that is already running is left alone.
import { spawn } from "node:child_process";

function isRunning(bin: string, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["info", "--name", name], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0 && /is running/.test(out)));
  });
}

/** Stop the named pg0 instance and resolve once `pg0 stop` has exited (pg0 waits for the postmaster). */
export function stopPg0(bin: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["stop", "--name", name], { stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg0 stop --name ${name} exited with ${code}`));
    });
  });
}

export async function startPg0Detached(bin: string, name: string): Promise<void> {
  if (await isRunning(bin, name)) return;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ["start", "--name", name], { stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg0 start --name ${name} exited with ${code}`));
    });
  });
}
