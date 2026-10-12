// Glob matching for protected-path patterns. Logic ported to TypeScript from picomatch (MIT, (c) Jon Schlinkert) https://github.com/micromatch/picomatch @ 9fab7bf (lib/parse.js, lib/constants.js). Re-implemented, not vendored; picomatch is not a dependency.

/**
 * Converts a glob pattern to a RegExp that matches POSIX paths.
 * The regex is anchored with ^ and $.
 *
 * Supports:
 * - * : matches any characters except "/"
 * - ** : matches any characters including "/"
 *   - **\/ at start matches zero or more leading directories
 *   - trailing /** matches everything beneath
 * - ? : matches exactly one character except "/"
 * - [abc], [a-z], [!abc] : character classes (! is negation)
 * - {a,b,c} : brace alternation (no nesting required)
 * - \\ escapes : \* matches literal *, \? matches literal ?, etc.
 * - Regex metacharacters are escaped: +, (, ), {, }, |, $, ^, ., [ are escaped
 *
 * Note: Unlike picomatch's default, dotfiles are treated as matchable by *.
 * This is intentional for protected-path patterns where dotfiles must not
 * bypass glob matching via leading dots.
 *
 * @param pattern The glob pattern
 * @returns A RegExp anchored with ^ and $
 */
export function globToRegExp(pattern: string): RegExp {
  let regex = "";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    // Handle escaped characters
    if (ch === "\\" && i + 1 < pattern.length) {
      const next = pattern[i + 1]!;
      // Escape the next character literally in regex
      regex += escapeRegexChar(next);
      i += 2;
      continue;
    }

    // Handle **
    if (ch === "*" && pattern[i + 1] === "*") {
      // Check if this is **/something or something/**
      if (i + 2 < pattern.length && pattern[i + 2] === "/") {
        // **/ at the start or middle: matches zero or more directories
        regex += "(?:.*\\/)?";
        i += 3; // skip "**/"
        continue;
      } else if (i + 2 === pattern.length) {
        // Trailing **: matches everything beneath
        regex += ".*";
        i += 2;
        continue;
      } else if (
        i > 0 &&
        pattern[i - 1] === "/" &&
        i + 2 === pattern.length
      ) {
        // /** at the end: matches everything beneath
        regex += ".*";
        i += 2;
        continue;
      }
      // Otherwise treat ** as two separate * characters
      // Fall through to single * handling below
    }

    // Handle single *
    if (ch === "*") {
      // * matches any characters except /
      regex += "[^/]*";
      i++;
      continue;
    }

    // Handle ?
    if (ch === "?") {
      // ? matches exactly one character except /
      regex += "[^/]";
      i++;
      continue;
    }

    // Handle character classes [...]
    if (ch === "[") {
      const closeBracket = pattern.indexOf("]", i + 1);
      if (closeBracket === -1) {
        // No closing bracket, treat [ as literal
        regex += escapeRegexChar("[");
        i++;
        continue;
      }

      let classContent = pattern.slice(i + 1, closeBracket);

      // Handle negation [!...] -> [^...]
      if (classContent.startsWith("!")) {
        classContent = "^" + classContent.slice(1);
      }

      // Escape any regex special chars within the class
      // but preserve - for ranges and ^ for negation
      classContent = classContent
        .replace(/\\/g, "\\\\") // Escape backslashes first
        .replace(/\]/g, "\\]"); // Escape closing brackets

      regex += `[${classContent}]`;
      i = closeBracket + 1;
      continue;
    }

    // Handle brace expansion {a,b,c}
    if (ch === "{") {
      const closeBrace = findMatchingBrace(pattern, i);
      if (closeBrace === -1) {
        // No closing brace, treat { as literal
        regex += escapeRegexChar("{");
        i++;
        continue;
      }

      const braceContent = pattern.slice(i + 1, closeBrace);
      // Check if there's a comma at the top level - only then is it an expansion
      if (containsTopLevelComma(braceContent)) {
        // Split by comma at top level only
        const parts = splitTopLevelCommas(braceContent);

        if (parts.length > 1) {
          regex += "(";
          for (let j = 0; j < parts.length; j++) {
            if (j > 0) regex += "|";
            // Recursively process each alternative
            regex += globToRegExp(parts[j]!).source.slice(1, -1); // Remove ^ and $
          }
          regex += ")";
          i = closeBrace + 1;
          continue;
        }
      }

      // If no comma found or invalid, treat as literal
      regex += escapeRegexChar("{");
      i++;
      continue;
    }

    // Handle / - path separator
    if (ch === "/") {
      regex += "\\/";
      i++;
      continue;
    }

    // Handle other characters
    if (isRegexMetachar(ch!)) {
      regex += escapeRegexChar(ch!);
    } else {
      regex += ch!;
    }
    i++;
  }

  return new RegExp(`^${regex}$`);
}

/**
 * Checks if a path matches a glob pattern.
 * Normalizes the path: converts backslashes to forward slashes,
 * removes leading "./", and collapses multiple slashes.
 *
 * @param pattern The glob pattern
 * @param path The path to match
 * @returns true if path matches pattern
 */
export function globMatch(pattern: string, path: string): boolean {
  // Normalize path
  const normalizedPath = normalizePath(path);
  const regex = globToRegExp(pattern);
  return regex.test(normalizedPath);
}

/**
 * Checks if a pattern contains glob metacharacters.
 * Returns true if pattern contains *, ?, [, or {
 *
 * @param pattern The pattern to check
 * @returns true if pattern is a glob
 */
export function isGlob(pattern: string): boolean {
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];

    // Skip escaped characters
    if (ch === "\\") {
      i += 2;
      continue;
    }

    // Check for glob metacharacters
    if (ch === "*" || ch === "?" || ch === "[" || ch === "{") {
      return true;
    }

    i++;
  }

  return false;
}

// Helper functions

/**
 * Escapes a single character for use in a regex.
 */
function escapeRegexChar(ch: string): string {
  const metachars = "+*?^${}()|[]\\.";
  if (metachars.includes(ch)) {
    return `\\${ch}`;
  }
  return ch;
}

/**
 * Checks if a character is a regex metacharacter.
 */
function isRegexMetachar(ch: string): boolean {
  return "+*?^${}()|[]\\.".includes(ch);
}

/**
 * Finds the matching closing brace for an opening brace at position i.
 * Handles nested braces and respects escaping.
 */
function findMatchingBrace(pattern: string, openPos: number): number {
  let depth = 1;
  let i = openPos + 1;

  while (i < pattern.length && depth > 0) {
    const ch = pattern[i];

    if (ch === "\\") {
      i += 2; // Skip escaped character
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }

    i++;
  }

  return -1; // No matching brace found
}

/**
 * Checks if a string contains a comma at the top level only.
 * Respects nesting of braces, brackets, and parentheses.
 */
function containsTopLevelComma(input: string): boolean {
  let depth = 0;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === "\\") {
      i += 2; // Skip escaped character
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
    } else if (ch === "," && depth === 0) {
      return true;
    }

    i++;
  }

  return false;
}

/**
 * Splits a string by commas at the top level only.
 * Respects nesting of braces, brackets, and parentheses.
 * Preserves empty parts (e.g., {a,,b} -> ["a", "", "b"])
 */
function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === "\\") {
      current += ch;
      if (i + 1 < input.length) {
        current += input[i + 1];
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      current += ch;
    } else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }

    i++;
  }

  // Always push the last part (even if empty)
  parts.push(current);

  return parts;
}

/**
 * Normalizes a path for glob matching:
 * - Converts backslashes to forward slashes
 * - Removes leading "./"
 * - Collapses multiple slashes to single slash
 */
function normalizePath(path: string): string {
  // Convert backslashes to forward slashes (Windows -> POSIX)
  let normalized = path.replace(/\\/g, "/");

  // Remove leading "./"
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  // Collapse multiple slashes
  normalized = normalized.replace(/\/+/g, "/");

  return normalized;
}
