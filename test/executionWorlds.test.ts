import { describe, expect, test } from "bun:test";
import { parseConnect, parseWslList } from "../src/capabilities/executionWorlds.ts";
import { friendlyConnectionError } from "../src/ui/RemoteWorkspaceForm.tsx";

const FP = "SHA256:" + "A".repeat(43);
const ssh = (over: Record<string, unknown> = {}, auth: Record<string, unknown> = { kind: "agent" }) => ({ kind: "ssh" as const, ssh: { host: "build.example.com", username: "dev", auth, hostKeyFingerprint: FP, ...over } }) as never;

describe("execution.world.connect input validation", () => {
  test("requires the confirmed host-key fingerprint, a sane host/user/port, and a secret for password auth", () => {
    expect(() => parseConnect(ssh({ hostKeyFingerprint: "" }))).toThrow(/fingerprint/);
    expect(() => parseConnect(ssh({ hostKeyFingerprint: "SHA256:short" }))).toThrow(/fingerprint/);
    expect(() => parseConnect(ssh({ host: "bad host; rm -rf /" }))).toThrow(/host/);
    expect(() => parseConnect(ssh({ username: "a b" }))).toThrow(/username/);
    expect(() => parseConnect(ssh({ port: 70000 }))).toThrow(/port/);
    expect(() => parseConnect(ssh({}, { kind: "password", password: "" }))).toThrow(/password/);
    expect(() => parseConnect(ssh({}, { kind: "telepathy" }))).toThrow(/auth kind/);
    expect(() => parseConnect({ kind: "ftp" } as never)).toThrow(/kind/);
  });
  test("splits secrets from the durable descriptor: only the auth KIND (and a key PATH) are kept", () => {
    const pw = parseConnect(ssh({ port: 2222 }, { kind: "password", password: "hunter2" }));
    expect(pw.secrets).toEqual({ password: "hunter2" });
    expect(JSON.stringify(pw.connection)).not.toContain("hunter2");
    expect(pw.connection).toMatchObject({ kind: "ssh", port: 2222, auth: { kind: "password" }, hostKeyFingerprint: FP });
    expect(pw.label).toBe("dev@build.example.com:2222");
    const key = parseConnect(ssh({}, { kind: "key", privateKeyPath: "~/.ssh/id", passphrase: "pp" }));
    expect(key.secrets).toEqual({ passphrase: "pp" });
    expect(JSON.stringify(key.connection)).not.toContain("pp\"");
    expect(key.connection).toMatchObject({ auth: { kind: "key", privateKeyPath: "~/.ssh/id", passphrase: true } });
  });
  test("WSL: needs a safe distribution name; the user is optional but validated", () => {
    expect(parseConnect({ kind: "wsl", wsl: { distro: "Ubuntu-24.04" } } as never)).toMatchObject({ connection: { kind: "wsl", distro: "Ubuntu-24.04" }, label: "WSL: Ubuntu-24.04" });
    expect(() => parseConnect({ kind: "wsl", wsl: { distro: "x; reboot" } } as never)).toThrow(/distribution/);
    expect(() => parseConnect({ kind: "wsl", wsl: { distro: "Ubuntu", user: "ROOT$" } } as never)).toThrow(/user/);
  });
});

describe("wsl.exe list parsing", () => {
  const utf16 = (text: string) => { const b = Buffer.alloc(text.length * 2); for (let i = 0; i < text.length; i++) b.writeUInt16LE(text.charCodeAt(i), i * 2); return b; };
  test("decodes UTF-16LE output and plain UTF-8, dropping blanks and annotations", () => {
    expect(parseWslList(utf16("Ubuntu-24.04\r\nDebian\r\n\r\n"))).toEqual([{ name: "Ubuntu-24.04", isDefault: false }, { name: "Debian", isDefault: false }]);
    expect(parseWslList(Buffer.from("Ubuntu (Default)\nAlpine\n"))).toEqual([{ name: "Ubuntu", isDefault: true }, { name: "Alpine", isDefault: false }]);
    expect(parseWslList(Buffer.alloc(0))).toEqual([]);
  });
});

describe("friendly connection errors", () => {
  test("say what to do, not an error code", () => {
    const ctx = { host: "h", port: 2200 };
    expect(friendlyConnectionError("connect ECONNREFUSED 1.2.3.4:2200", ctx)).toMatch(/Nothing is listening on h:2200/);
    expect(friendlyConnectionError("All configured authentication methods failed", ctx)).toMatch(/rejected these credentials/);
    expect(friendlyConnectionError("host key for h (SHA256:x) does not match", ctx)).toMatch(/Do not continue/);
    expect(friendlyConnectionError("getaddrinfo ENOTFOUND h", ctx)).toMatch(/Could not find h/);
    expect(friendlyConnectionError("something unexpected")).toBe("something unexpected");
  });
});
