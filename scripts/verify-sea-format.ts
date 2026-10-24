#!/usr/bin/env bun

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CommentToken = { text: string; trailing: boolean };

/** Extract actual // comments while ignoring delimiters inside SEA strings. */
export function extractCommentTokens(source: string): CommentToken[] {
  const comments: CommentToken[] = [];
  let i = 0;
  let lineStart = 0;
  let state: "normal" | "string" | "multiline" = "normal";

  while (i < source.length) {
    const c = source[i]!;
    if (state === "normal") {
      if (source.startsWith('"""', i)) {
        state = "multiline";
        i += 3;
      } else if (c === '"') {
        state = "string";
        i++;
      } else if (source.startsWith("//", i)) {
        const end = source.indexOf("\n", i);
        const stop = end < 0 ? source.length : end;
        comments.push({
          text: source.slice(i + 2, stop).trim(),
          trailing: source.slice(lineStart, i).trim().length > 0,
        });
        i = stop;
      } else if (c === "\n") {
        lineStart = ++i;
      } else {
        i++;
      }
    } else if (state === "string") {
      if (c === "\\") i += Math.min(2, source.length - i);
      else if (c === '"') {
        state = "normal";
        i++;
      } else if (c === "\n") {
        lineStart = ++i;
      } else i++;
    } else if (source.startsWith('"""', i)) {
      state = "normal";
      i += 3;
    } else if (c === "\n") {
      lineStart = ++i;
    } else i++;
  }

  return comments;
}

function withoutLocations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLocations);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "line" && key !== "column")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, withoutLocations(child)]),
    );
  }
  return value;
}

function run(args: string[]): string {
  const result = Bun.spawnSync(args, { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  if (result.exitCode !== 0) {
    throw new Error(`${args.join(" ")} failed (${result.exitCode})\n${stderr || stdout}`);
  }
  return stdout;
}

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const modelPath = join(repoRoot, ".sea/interaction/interaction-model.sea");

export function verifySeaFormat(path = modelPath): void {
  const original = readFileSync(path, "utf8");
  const formatted = run(["domainforge", "fmt", path]);
  const scratch = mkdtempSync(join(tmpdir(), "cognate-sea-format-"));
  const formattedPath = join(scratch, "interaction-model.sea");

  try {
    writeFileSync(formattedPath, formatted);
    run(["domainforge", "validate", "--format", "human", path]);
    run(["domainforge", "validate", "--format", "human", formattedPath]);

    const originalAst = JSON.parse(run(["domainforge", "parse", "--ast", "--format", "json", path]));
    const formattedAst = JSON.parse(run(["domainforge", "parse", "--ast", "--format", "json", formattedPath]));
    if (JSON.stringify(withoutLocations(originalAst)) !== JSON.stringify(withoutLocations(formattedAst))) {
      throw new Error("DomainForge fmt changed the normalized AST (excluding line and column locations)");
    }

    const originalComments = extractCommentTokens(original);
    const formattedComments = extractCommentTokens(formatted);
    if (JSON.stringify(originalComments) !== JSON.stringify(formattedComments)) {
      throw new Error(
        `DomainForge fmt changed comment content or placement\noriginal: ${JSON.stringify(originalComments)}\nformatted: ${JSON.stringify(formattedComments)}`,
      );
    }

    const secondPass = run(["domainforge", "fmt", formattedPath]);
    if (secondPass !== formatted) throw new Error("DomainForge fmt is not idempotent");

    const check = Bun.spawnSync(["domainforge", "fmt", "--check", path], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (check.exitCode !== 0) {
      const output = new TextDecoder().decode(check.stderr) || new TextDecoder().decode(check.stdout);
      throw new Error(`DomainForge fmt --check failed (${check.exitCode})\n${output}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    verifySeaFormat(process.argv[2] ? resolve(process.argv[2]) : modelPath);
    console.log(`SEA formatter fidelity verified: ${modelPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
