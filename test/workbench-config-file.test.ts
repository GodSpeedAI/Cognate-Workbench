// T11 (J-CFG-config-path): pure configuration-export logic — which environment variables this app
// recognises, which may carry a secret, how a settings row becomes an editable file, and the rule
// that a sensitive value never appears in that file.
import { describe, expect, test } from "bun:test";
import {
  RECOGNIZED_ENV_VARS,
  buildConfigExport,
  describeEnvironment,
  isSensitiveEnvVar,
  renderConfigExport,
  resolveConfigFilePath,
} from "../src/configFile.ts";

describe("environment recognition", () => {
  test("every variable src/ reads is listed", () => {
    for (const name of ["COGNATE_WORKBENCH_HOME", "COGNATE_HARNESS_HOME", "COGNATE_POSTGRES_URL", "COGNATE_PG", "MODEL_RETRY_BACKOFF_MS", "PORT", "SXR_BIN"]) {
      expect(RECOGNIZED_ENV_VARS).toContain(name);
    }
  });

  test("only the postgres URL is treated as sensitive", () => {
    expect(isSensitiveEnvVar("COGNATE_POSTGRES_URL")).toBe(true);
    expect(isSensitiveEnvVar("SXR_BIN")).toBe(false);
    expect(isSensitiveEnvVar("PORT")).toBe(false);
  });
});

describe("describeEnvironment", () => {
  test("an unset variable reports value null and set false", () => {
    const entries = describeEnvironment({});
    const port = entries.find((e) => e.name === "PORT");
    expect(port).toEqual({ name: "PORT", value: null, sensitive: false, set: false });
  });

  test("a set non-sensitive variable shows its value", () => {
    const entries = describeEnvironment({ SXR_BIN: "/usr/local/bin/sxr" });
    expect(entries.find((e) => e.name === "SXR_BIN")?.value).toBe("/usr/local/bin/sxr");
  });

  test("a sensitive variable's value never leaves — even one embedding a password", () => {
    const secret = "postgres://user:super-secret-password@db:5432/app";
    const entries = describeEnvironment({ COGNATE_POSTGRES_URL: secret });
    const row = entries.find((e) => e.name === "COGNATE_POSTGRES_URL");
    expect(row?.sensitive).toBe(true);
    expect(row?.set).toBe(true);
    expect(row?.value).not.toContain("super-secret-password");
    expect(row?.value).not.toContain("postgres://");
    expect(row?.value).toBe("<set, hidden>");
  });

  test("unrecognised variables are ignored entirely", () => {
    const entries = describeEnvironment({ AWS_SECRET_ACCESS_KEY: "never-listed", SXR_BIN: "/x" });
    expect(entries.map((e) => e.name)).not.toContain("AWS_SECRET_ACCESS_KEY");
  });

  test("the result is ordered and complete regardless of the input's key order", () => {
    const entries = describeEnvironment({ PORT: "3000", SXR_BIN: "/x" });
    expect(entries.map((e) => e.name)).toEqual([...RECOGNIZED_ENV_VARS]);
  });
});

describe("resolveConfigFilePath", () => {
  test("is inside the app home", () => {
    expect(resolveConfigFilePath("/home/op/.data")).toBe("/home/op/.data/cognate.config.json");
  });
  test("a trailing slash does not produce a double slash", () => {
    expect(resolveConfigFilePath("/home/op/.data/")).toBe("/home/op/.data/cognate.config.json");
  });
});

describe("buildConfigExport / renderConfigExport", () => {
  const env = describeEnvironment({ PORT: "3000", COGNATE_POSTGRES_URL: "postgres://u:p@h/db", SXR_BIN: "/x" });

  test("keeps only the settings keys this app reads", () => {
    const exported = buildConfigExport({
      home: "/home/op/.data",
      settings: { permission: "full-access", fontSize: 16, futureField: "must-not-leak" },
      env,
    });
    expect(exported.settings["permission"]).toBe("full-access");
    expect(exported.settings["fontSize"]).toBe(16);
    expect(Object.hasOwn(exported.settings, "futureField")).toBe(false);
  });

  test("a sensitive env value is redacted in the export too", () => {
    const text = renderConfigExport(buildConfigExport({ home: "/h", settings: {}, env }));
    expect(text).not.toContain("postgres://u:p@h/db");
    expect(text).toContain("COGNATE_POSTGRES_URL");
    expect(text).toContain("<set, hidden>");
  });

  test("the export is valid, pretty-printed JSON ending in a newline", () => {
    const text = renderConfigExport(buildConfigExport({ home: "/h", settings: { permission: "read-only" }, env }));
    expect(text.endsWith("\n")).toBe(true);
    expect(text.split("\n").length).toBeGreaterThan(3);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  test("the export states plainly that it is non-secret", () => {
    const exported = buildConfigExport({ home: "/h", settings: {}, env });
    expect(exported.note.toLowerCase()).toContain("secret");
  });
});
