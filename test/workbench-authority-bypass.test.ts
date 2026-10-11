// Regression tests for protected-evidence bypasses found while reviewing the worker-written
// authority module: path traversal that normalises back into the workspace, and shell mutations
// that reach a protected file through a chain, a wrapper or a redirect.
import { describe, expect, test } from "bun:test";
import { decideShell, decideWrite, matchesProtected } from "../src/workbench/authority.ts";
import { defaultAuthority } from "../src/workbench/contract.ts";
import type { AuthorityScopes } from "../src/workbench/types.ts";

const open: AuthorityScopes = {
  filesystem: { read: "yes", write: "yes", outsideWorkspace: "yes" },
  shell: { run: "yes", destructive: "yes" },
  network: { outbound: "yes" },
  packages: { install: "yes" },
  extensions: { install: "yes", enable: "yes" },
  protectedPaths: ["source.csv", "tests/", "data/*.json"],
};

describe("V-003 protected evidence cannot be reached by path tricks", () => {
  test("traversal that normalises into the workspace is still protected", () => {
    expect(decideWrite(open, "src/../source.csv").outcome).toBe("deny");
    expect(decideWrite(open, "./tests/../tests/a.test.ts").outcome).toBe("deny");
    expect(decideWrite(open, "src/./../data/x.json").rule).toBe("protected-evidence");
  });
  test("a path that really escapes is judged by the outside-workspace grant, not protection", () => {
    expect(decideWrite(open, "../elsewhere.txt").rule).toBe("fs.write");
    const closed = { ...open, filesystem: { ...open.filesystem, outsideWorkspace: "no" as const } };
    expect(decideWrite(closed, "../elsewhere.txt").rule).toBe("fs.outside");
  });
  test("decision carries the matched pattern and normalised path", () => {
    const d = decideWrite(open, "src/../source.csv");
    expect(d.pattern).toBe("source.csv");
    expect(d.path).toBe("source.csv");
  });
  test("nested files match basename patterns at any depth", () => {
    expect(matchesProtected(["source.csv"], "a/b/source.csv")).toBe("source.csv");
    expect(matchesProtected(["*.csv"], "a/b/c.csv")).toBe("*.csv");
    expect(matchesProtected(["tests/"], "src/tests/a.ts")).toBeUndefined();
  });
});

describe("V-003 shell mutations of protected evidence", () => {
  test.each([
    "rm source.csv",
    "ls && rm -rf tests/",
    "sudo sed -i s/a/b/ source.csv",
    'bash -c "echo hi > source.csv"',
    "cp /tmp/x data/y.json",
    "tee tests/new.test.ts < /dev/null",
    "echo x >> source.csv",
  ])("blocks %s", (cmd) => {
    const d = decideShell(open, cmd);
    expect(d.outcome).toBe("deny");
    expect(d.rule).toBe("protected-evidence");
  });
  test.each(["cat source.csv", "grep a tests/x.ts", "ls tests/", "wc -l data/a.json"])("allows reads: %s", (cmd) => {
    expect(decideShell(open, cmd).outcome).toBe("allow");
  });
  test("elevating the exact path downgrades deny to approval, never to allow", () => {
    const d = decideShell(open, "rm source.csv", { elevatedPaths: ["source.csv"] });
    expect(d.outcome).toBe("approval");
  });
  test("default authority grants no shell", () => {
    expect(decideShell(defaultAuthority(), "ls").outcome).toBe("deny");
  });
  test("package installs and network use are separate grants", () => {
    const scopes = { ...open, packages: { install: "approval" as const }, network: { outbound: "no" as const } };
    expect(decideShell(scopes, "npm install left-pad").outcome).toBe("deny"); // npm install also reaches the network
    expect(decideShell({ ...open, packages: { install: "approval" } }, "pip install requests").outcome).toBe("approval");
  });
});
