// Write-only secret storage: `$COGNATE_HARNESS_HOME/secrets.json`, mode 0600.
// Read only by server-side code that needs to build a live provider (never by an agent's `run()`,
// never returned to a client, never logged, never placed in an event payload or a projection).
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface SecretStore {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  delete(key: string): Promise<void>;
}

export function secretStore(path: string): SecretStore {
  async function readAll(): Promise<Record<string, string>> {
    try {
      const text = await readFile(path, "utf8");
      return JSON.parse(text) as Record<string, string>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async function writeAll(secrets: Record<string, string>): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(path, 0o600);
  }

  return {
    async put(key, value) {
      const secrets = await readAll();
      secrets[key] = value;
      await writeAll(secrets);
    },
    async get(key) {
      const secrets = await readAll();
      return secrets[key];
    },
    async delete(key) {
      const secrets = await readAll();
      delete secrets[key];
      await writeAll(secrets);
    },
  };
}
