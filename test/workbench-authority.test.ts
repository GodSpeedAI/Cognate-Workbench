import { describe, expect, test } from "bun:test";
import type { AuthorityScopes } from "../src/workbench/types.ts";
import {
  matchesProtected,
  decideWrite,
  decideShell,
  isDestructiveCommand,
  describeAuthority,
} from "../src/workbench/authority.ts";

describe("matchesProtected", () => {
  test("dir/ pattern matches anything under dir", () => {
    const patterns = ["source/", "tests/"];
    expect(matchesProtected(patterns, "source/file.ts")).toBe("source/");
    expect(matchesProtected(patterns, "source/subdir/file.ts")).toBe("source/");
    expect(matchesProtected(patterns, "tests/a.test.ts")).toBe("tests/");
  });

  test("exact file name match", () => {
    const patterns = ["file.csv", "config.json"];
    expect(matchesProtected(patterns, "file.csv")).toBe("file.csv");
    expect(matchesProtected(patterns, "config.json")).toBe("config.json");
  });

  test("glob pattern *.csv matches any path with that basename", () => {
    const patterns = ["*.csv"];
    expect(matchesProtected(patterns, "data.csv")).toBe("*.csv");
    expect(matchesProtected(patterns, "subdir/source.csv")).toBe("*.csv");
    expect(matchesProtected(patterns, "source.ts")).toBeUndefined();
  });

  test("tests/** pattern matches anything under tests", () => {
    const patterns = ["tests/**"];
    expect(matchesProtected(patterns, "tests/a.test.ts")).toBe("tests/**");
    expect(matchesProtected(patterns, "tests/subdir/b.test.ts")).toBe("tests/**");
  });

  test("a/*.ts single-segment glob", () => {
    const patterns = ["a/*.ts"];
    expect(matchesProtected(patterns, "a/file.ts")).toBe("a/*.ts");
    expect(matchesProtected(patterns, "a/subdir/file.ts")).toBeUndefined();
  });

  test("strips leading ./", () => {
    const patterns = ["source/"];
    expect(matchesProtected(patterns, "./source/file.ts")).toBe("source/");
  });

  test("collapses backslashes", () => {
    const patterns = ["source/"];
    expect(matchesProtected(patterns, "source\\file.ts")).toBe("source/");
  });

  test("returns undefined for no match", () => {
    const patterns = ["source/", "tests/"];
    expect(matchesProtected(patterns, "src/file.ts")).toBeUndefined();
  });

  test("rejects empty path", () => {
    const patterns = ["source/"];
    expect(matchesProtected(patterns, "")).toBeUndefined();
  });
});

describe("decideWrite", () => {
  const baseScopes: AuthorityScopes = {
    filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
    shell: { run: "no", destructive: "no" },
    network: { outbound: "no" },
    packages: { install: "no" },
    extensions: { install: "no", enable: "no" },
    protectedPaths: ["source.csv", "tests/"],
  };

  test("denies write to source.csv when protected", () => {
    const decision = decideWrite(baseScopes, "source.csv");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("protected-evidence");
  });

  test("denies write to tests/a.test.ts when protected", () => {
    const decision = decideWrite(baseScopes, "tests/a.test.ts");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("protected-evidence");
  });

  test("allows write to src/a.ts when write grant is yes", () => {
    const decision = decideWrite(baseScopes, "src/a.ts");
    expect(decision.outcome).toBe("allow");
    expect(decision.rule).toBe("fs.write");
  });

  test("elevatedPaths changes protected deny into approval", () => {
    const decision = decideWrite(baseScopes, "source.csv", {
      elevatedPaths: ["source.csv"],
    });
    expect(decision.outcome).toBe("approval");
    expect(decision.rule).toBe("protected-evidence");
  });

  test("denies write when filesystem.write is no", () => {
    const scopes: AuthorityScopes = {
      ...baseScopes,
      filesystem: { ...baseScopes.filesystem, write: "no" },
    };
    const decision = decideWrite(scopes, "src/file.ts");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("fs.write");
  });

  test("requires approval for write when filesystem.write is approval", () => {
    const scopes: AuthorityScopes = {
      ...baseScopes,
      filesystem: { ...baseScopes.filesystem, write: "approval" },
    };
    const decision = decideWrite(scopes, "src/file.ts");
    expect(decision.outcome).toBe("approval");
    expect(decision.rule).toBe("fs.write");
  });

  test("denies path that starts with /", () => {
    const decision = decideWrite(baseScopes, "/etc/passwd");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("fs.outside");
  });

  test("denies path with .. segment", () => {
    const decision = decideWrite(baseScopes, "src/../../../etc/passwd");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("fs.outside");
  });
});

describe("isDestructiveCommand", () => {
  test("rm -r is destructive", () => {
    expect(isDestructiveCommand("rm -r /path")).toBe(true);
  });

  test("rm -rf is destructive", () => {
    expect(isDestructiveCommand("rm -rf /path")).toBe(true);
  });

  test("rm -f is destructive", () => {
    expect(isDestructiveCommand("rm -f file.txt")).toBe(true);
  });

  test("git reset --hard is destructive", () => {
    expect(isDestructiveCommand("git reset --hard")).toBe(true);
  });

  test("git clean -f is destructive", () => {
    expect(isDestructiveCommand("git clean -f")).toBe(true);
  });

  test("git push --force is destructive", () => {
    expect(isDestructiveCommand("git push --force")).toBe(true);
  });

  test("git push -f is destructive", () => {
    expect(isDestructiveCommand("git push -f")).toBe(true);
  });

  test("mkfs is destructive", () => {
    expect(isDestructiveCommand("mkfs /dev/sda1")).toBe(true);
  });

  test("dd of= is destructive", () => {
    expect(isDestructiveCommand("dd if=file of=/dev/sda")).toBe(true);
  });

  test("chmod -R is destructive", () => {
    expect(isDestructiveCommand("chmod -R 755 /path")).toBe(true);
  });

  test("chown -R is destructive", () => {
    expect(isDestructiveCommand("chown -R user:group /path")).toBe(true);
  });

  test("> /dev/ is destructive", () => {
    expect(isDestructiveCommand("echo x > /dev/sda")).toBe(true);
  });

  test("drop table is destructive", () => {
    expect(isDestructiveCommand("DROP TABLE users")).toBe(true);
  });

  test("drop database is destructive", () => {
    expect(isDestructiveCommand("drop database mydb")).toBe(true);
  });

  test("truncate is destructive", () => {
    expect(isDestructiveCommand("TRUNCATE TABLE users")).toBe(true);
  });

  test("shred is destructive", () => {
    expect(isDestructiveCommand("shred -u file.txt")).toBe(true);
  });

  test("find ... -delete is destructive", () => {
    expect(isDestructiveCommand("find /path -name '*.tmp' -delete")).toBe(true);
  });

  test("cat is not destructive", () => {
    expect(isDestructiveCommand("cat file.txt")).toBe(false);
  });

  test("ls is not destructive", () => {
    expect(isDestructiveCommand("ls -la")).toBe(false);
  });
});

describe("decideShell", () => {
  const baseScopes: AuthorityScopes = {
    filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
    shell: { run: "yes", destructive: "no" },
    network: { outbound: "no" },
    packages: { install: "no" },
    extensions: { install: "no", enable: "no" },
    protectedPaths: ["source.csv", "tests/"],
  };

  test("denies sed -i s/a/b/ source.csv", () => {
    const decision = decideShell(baseScopes, "sed -i s/a/b/ source.csv");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("protected-evidence");
  });

  test("denies rm -rf tests/", () => {
    const decision = decideShell(baseScopes, "rm -rf tests/");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("protected-evidence");
  });

  test("denies echo x > source.csv", () => {
    const decision = decideShell(baseScopes, "echo x > source.csv");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("protected-evidence");
  });

  test("allows cat source.csv", () => {
    const decision = decideShell(baseScopes, "cat source.csv");
    expect(decision.outcome).toBe("allow");
    expect(decision.rule).toBe("shell.run");
  });

  test("denies destructive command when shell.destructive is no", () => {
    const scopes: AuthorityScopes = {
      ...baseScopes,
      shell: { run: "yes", destructive: "no" },
    };
    const decision = decideShell(scopes, "rm -rf /tmp");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("shell.destructive");
  });

  test("allows destructive command when shell.destructive is yes", () => {
    const scopes: AuthorityScopes = {
      ...baseScopes,
      shell: { run: "yes", destructive: "yes" },
    };
    const decision = decideShell(scopes, "rm -rf /tmp");
    expect(decision.outcome).toBe("allow");
    expect(decision.rule).toBe("shell.destructive");
  });

  test("requires approval for destructive command when shell.destructive is approval", () => {
    const scopes: AuthorityScopes = {
      ...baseScopes,
      shell: { run: "yes", destructive: "approval" },
    };
    const decision = decideShell(scopes, "rm -rf /tmp");
    expect(decision.outcome).toBe("approval");
    expect(decision.rule).toBe("shell.destructive");
  });

  test("denies shell.run when no", () => {
    const scopes: AuthorityScopes = {
      ...baseScopes,
      shell: { run: "no", destructive: "no" },
    };
    const decision = decideShell(scopes, "echo test");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("shell.run");
  });

  test("requires approval for shell.run when approval", () => {
    const scopes: AuthorityScopes = {
      ...baseScopes,
      shell: { run: "approval", destructive: "no" },
    };
    const decision = decideShell(scopes, "echo test");
    expect(decision.outcome).toBe("approval");
    expect(decision.rule).toBe("shell.run");
  });

  test("denies network command when network.outbound is no", () => {
    const scopes: AuthorityScopes = {
      ...baseScopes,
      network: { outbound: "no" },
    };
    const decision = decideShell(scopes, "curl https://example.com");
    expect(decision.outcome).toBe("deny");
    expect(decision.rule).toBe("network.outbound");
  });

  test("allows network command when both shell.run and network.outbound are yes", () => {
    const scopes: AuthorityScopes = {
      ...baseScopes,
      network: { outbound: "yes" },
    };
    const decision = decideShell(scopes, "curl https://example.com");
    expect(decision.outcome).toBe("allow");
    expect(decision.rule).toBe("network.outbound");
  });

  test("requires approval when network.outbound is approval even if shell.run is yes", () => {
    const scopes: AuthorityScopes = {
      ...baseScopes,
      network: { outbound: "approval" },
    };
    const decision = decideShell(scopes, "curl https://example.com");
    expect(decision.outcome).toBe("approval");
    expect(decision.rule).toBe("network.outbound");
  });

  test("elevatedPaths changes protected deny into approval", () => {
    const decision = decideShell(baseScopes, "sed -i s/a/b/ source.csv", {
      elevatedPaths: ["source.csv"],
    });
    expect(decision.outcome).toBe("approval");
    expect(decision.rule).toBe("protected-evidence");
  });
});

describe("describeAuthority", () => {
  test("includes all standard rows", () => {
    const scopes: AuthorityScopes = {
      filesystem: { read: "yes", write: "no", outsideWorkspace: "no" },
      shell: { run: "approval", destructive: "no" },
      network: { outbound: "no" },
      packages: { install: "no" },
      extensions: { install: "no", enable: "no" },
      protectedPaths: ["source.csv"],
    };
    const rows = describeAuthority(scopes);

    expect(rows.length).toBe(10); // 9 standard + 1 protected path
    expect(rows.some(r => r.group === "Filesystem" && r.label === "workspace read")).toBe(true);
    expect(rows.some(r => r.group === "Filesystem" && r.label === "workspace write")).toBe(true);
    expect(rows.some(r => r.group === "Filesystem" && r.label === "outside workspace")).toBe(true);
    expect(rows.some(r => r.group === "Shell" && r.label === "run commands")).toBe(true);
    expect(rows.some(r => r.group === "Shell" && r.label === "destructive commands")).toBe(true);
    expect(rows.some(r => r.group === "Network" && r.label === "outbound requests")).toBe(true);
    expect(rows.some(r => r.group === "Packages" && r.label === "install")).toBe(true);
    expect(rows.some(r => r.group === "Extensions" && r.label === "install plugin")).toBe(true);
    expect(rows.some(r => r.group === "Extensions" && r.label === "enable plugin")).toBe(true);
    expect(rows.some(r => r.group === "Protected evidence" && r.label === "source.csv")).toBe(true);
  });

  test("marks protected paths as immutable", () => {
    const scopes: AuthorityScopes = {
      filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
      shell: { run: "no", destructive: "no" },
      network: { outbound: "no" },
      packages: { install: "no" },
      extensions: { install: "no", enable: "no" },
      protectedPaths: ["source.csv", "tests/"],
    };
    const rows = describeAuthority(scopes);

    const protected1 = rows.find(r => r.label === "source.csv");
    expect(protected1?.grant).toBe("immutable");

    const protected2 = rows.find(r => r.label === "tests/");
    expect(protected2?.grant).toBe("immutable");
  });

  test("includes grant values from scopes", () => {
    const scopes: AuthorityScopes = {
      filesystem: { read: "yes", write: "approval", outsideWorkspace: "no" },
      shell: { run: "yes", destructive: "no" },
      network: { outbound: "approval" },
      packages: { install: "no" },
      extensions: { install: "approval", enable: "yes" },
      protectedPaths: [],
    };
    const rows = describeAuthority(scopes);

    expect(rows.find(r => r.label === "workspace read")?.grant).toBe("yes");
    expect(rows.find(r => r.label === "workspace write")?.grant).toBe("approval");
    expect(rows.find(r => r.label === "outside workspace")?.grant).toBe("no");
    expect(rows.find(r => r.label === "run commands")?.grant).toBe("yes");
    expect(rows.find(r => r.label === "destructive commands")?.grant).toBe("no");
    expect(rows.find(r => r.label === "outbound requests")?.grant).toBe("approval");
    expect(rows.find(r => r.label === "install")?.grant).toBe("no");
    expect(rows.find(r => r.label === "install plugin")?.grant).toBe("approval");
    expect(rows.find(r => r.label === "enable plugin")?.grant).toBe("yes");
  });
});

describe("V-003: Protected evidence rules", () => {
  test("decideWrite denies source.csv and tests/a.test.ts when protected", () => {
    const scopes: AuthorityScopes = {
      filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
      shell: { run: "no", destructive: "no" },
      network: { outbound: "no" },
      packages: { install: "no" },
      extensions: { install: "no", enable: "no" },
      protectedPaths: ["source.csv", "tests/"],
    };

    const d1 = decideWrite(scopes, "source.csv");
    expect(d1.outcome).toBe("deny");
    expect(d1.rule).toBe("protected-evidence");

    const d2 = decideWrite(scopes, "tests/a.test.ts");
    expect(d2.outcome).toBe("deny");
    expect(d2.rule).toBe("protected-evidence");
  });

  test("decideWrite allows src/a.ts when write grant is yes", () => {
    const scopes: AuthorityScopes = {
      filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
      shell: { run: "no", destructive: "no" },
      network: { outbound: "no" },
      packages: { install: "no" },
      extensions: { install: "no", enable: "no" },
      protectedPaths: ["source.csv", "tests/"],
    };

    const d = decideWrite(scopes, "src/a.ts");
    expect(d.outcome).toBe("allow");
    expect(d.rule).toBe("fs.write");
  });

  test("elevatedPaths changes protected deny into approval", () => {
    const scopes: AuthorityScopes = {
      filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
      shell: { run: "no", destructive: "no" },
      network: { outbound: "no" },
      packages: { install: "no" },
      extensions: { install: "no", enable: "no" },
      protectedPaths: ["source.csv", "tests/"],
    };

    const d1 = decideWrite(scopes, "source.csv", { elevatedPaths: ["source.csv"] });
    expect(d1.outcome).toBe("approval");

    const d2 = decideWrite(scopes, "tests/a.test.ts", {
      elevatedPaths: ["tests/"],
    });
    expect(d2.outcome).toBe("approval");
  });

  test("decideShell denies sed -i s/a/b/ source.csv and rm -rf tests/", () => {
    const scopes: AuthorityScopes = {
      filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
      shell: { run: "yes", destructive: "no" },
      network: { outbound: "no" },
      packages: { install: "no" },
      extensions: { install: "no", enable: "no" },
      protectedPaths: ["source.csv", "tests/"],
    };

    const d1 = decideShell(scopes, "sed -i s/a/b/ source.csv");
    expect(d1.outcome).toBe("deny");
    expect(d1.rule).toBe("protected-evidence");

    const d2 = decideShell(scopes, "rm -rf tests/");
    expect(d2.outcome).toBe("deny");
    expect(d2.rule).toBe("protected-evidence");
  });

  test("decideShell denies echo x > source.csv", () => {
    const scopes: AuthorityScopes = {
      filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
      shell: { run: "yes", destructive: "no" },
      network: { outbound: "no" },
      packages: { install: "no" },
      extensions: { install: "no", enable: "no" },
      protectedPaths: ["source.csv"],
    };

    const d = decideShell(scopes, "echo x > source.csv");
    expect(d.outcome).toBe("deny");
    expect(d.rule).toBe("protected-evidence");
  });

  test("decideShell allows cat source.csv", () => {
    const scopes: AuthorityScopes = {
      filesystem: { read: "yes", write: "yes", outsideWorkspace: "no" },
      shell: { run: "yes", destructive: "no" },
      network: { outbound: "no" },
      packages: { install: "no" },
      extensions: { install: "no", enable: "no" },
      protectedPaths: ["source.csv"],
    };

    const d = decideShell(scopes, "cat source.csv");
    expect(d.outcome).toBe("allow");
    expect(d.rule).toBe("shell.run");
  });
});
