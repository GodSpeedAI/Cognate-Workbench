// Starts the bundled pg0 instance before the store's own driver runs. The SDK's pg0 driver waits for the
// `pg0 start` child's output pipes to close. On Windows the PostgreSQL process that pg0 leaves running
// inherits those pipes, so the close never arrives and startup hangs. Here the child gets no pipes and only
// its exit is awaited; once it is running, the driver's `pg0 info` finds it and connects.
import { spawn } from "node:child_process";

export function startPg0Detached(bin: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["start", "--name", name], { stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg0 start --name ${name} exited with ${code}`));
    });
  });
}
