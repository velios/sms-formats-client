import { describe, expect, it } from "vitest";
import type { RegexMatchResult } from "./regex";
import { explainRegex, testRegex } from "./regex";
import {
  buildTokenToCaptureGroupMap,
  isCapturingGroupOpenerToken,
  resolveCaptureGroupRange,
  resolveTokenCaptureGroup,
  resolveTokenMatchRange,
} from "./token-capture-map";

function tokensFor(pattern: string) {
  return explainRegex(pattern, "en").patternTokens;
}

/** Helper to build captureGroupMap + matchResult for a pattern/test pair */
function setup(pattern: string, testStr: string) {
  const tokens = tokensFor(pattern);
  const captureGroupMap = buildTokenToCaptureGroupMap(tokens);
  const matchResult = testRegex(pattern, testStr);
  return { tokens, captureGroupMap, matchResult };
}

describe("buildTokenToCaptureGroupMap", () => {
  it("maps tokens inside a simple capturing group", () => {
    // ^(\d+)$
    const tokens = tokensFor("^(\\d+)$");
    const map = buildTokenToCaptureGroupMap(tokens);
    // ^ → null, ( → 1, \d → 1, + → 1, ) → 1, $ → null
    expect(map[0]).toBeNull(); // ^
    expect(map[1]).toBe(1); // (
    expect(map[2]).toBe(1); // \d
    expect(map[3]).toBe(1); // +
    expect(map[4]).toBe(1); // )
    expect(map[5]).toBeNull(); // $
  });

  it("maps tokens in multiple capturing groups", () => {
    // ^(\d+) (\w+)$
    const tokens = tokensFor("^(\\d+) (\\w+)$");
    const map = buildTokenToCaptureGroupMap(tokens);
    // Find the opening parens
    const openParens = tokens
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.raw === "(");
    expect(openParens).toHaveLength(2);
    expect(map[openParens[0]!.i]).toBe(1);
    expect(map[openParens[1]!.i]).toBe(2);
  });

  it("excludes non-capturing groups from capture index", () => {
    // ^(?:hello) (\w+)$
    const tokens = tokensFor("^(?:hello) (\\w+)$");
    const map = buildTokenToCaptureGroupMap(tokens);
    // The (?:...) content should NOT have a capture group
    const ncGroupOpen = tokens.findIndex((t) => t.raw === "(?:");
    expect(map[ncGroupOpen]).toBeNull();
    // The capturing group should be group 1
    const capGroupOpen = tokens.findIndex((t) => t.raw === "(");
    expect(map[capGroupOpen]).toBe(1);
  });

  it("handles nested groups correctly", () => {
    // ^((\d+)-(\w+))$
    const tokens = tokensFor("^((\\d+)-(\\w+))$");
    const map = buildTokenToCaptureGroupMap(tokens);
    // Outer ( → group 1, inner first ( → group 2, inner second ( → group 3
    const openParens = tokens
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.raw === "(");
    expect(openParens).toHaveLength(3);
    expect(map[openParens[0]!.i]).toBe(1); // outer
    expect(map[openParens[1]!.i]).toBe(2); // first inner
    expect(map[openParens[2]!.i]).toBe(3); // second inner
    // The literal "-" between inner groups should belong to outer group 1
    const dash = tokens.findIndex((t) => t.raw === "-");
    expect(map[dash]).toBe(1);
  });

  it("handles optional/unmatched captures", () => {
    // ^(\d+)?(.*)$
    const tokens = tokensFor("^(\\d+)?(.*)$");
    const map = buildTokenToCaptureGroupMap(tokens);
    const openParens = tokens
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.raw === "(");
    expect(openParens).toHaveLength(2);
    expect(map[openParens[0]!.i]).toBe(1);
    expect(map[openParens[1]!.i]).toBe(2);
  });

  it("handles escaped parentheses (not groups)", () => {
    // ^\((\d+)\)$
    const tokens = tokensFor("^\\((\\d+)\\)$");
    const map = buildTokenToCaptureGroupMap(tokens);
    // \( is escape, not a group opener
    const escOpen = tokens.findIndex((t) => t.raw === "\\(");
    expect(map[escOpen]).toBeNull();
    // ( is the real group
    const realOpen = tokens.findIndex((t) => t.raw === "(");
    expect(map[realOpen]).toBe(1);
  });

  it("excludes lookbehind groups from capture index", () => {
    // ^(?<=x)(\d+)$ — lookbehind is non-capturing, so the only group is 1
    const tokens = tokensFor("^(?<=x)(\\d+)$");
    const map = buildTokenToCaptureGroupMap(tokens);
    const lookbehind = tokens.findIndex((t) => t.raw === "(?<=");
    expect(map[lookbehind]).toBeNull();
    const capOpen = tokens.findIndex((t) => t.raw === "(");
    expect(map[capOpen]).toBe(1);
  });

  it("returns empty array for empty tokens", () => {
    expect(buildTokenToCaptureGroupMap([])).toEqual([]);
  });
});

describe("resolveCaptureGroupRange", () => {
  /** Slice the pattern at the resolved range to assert the exact bracket span. */
  function spanFor(pattern: string, groupIndex: number): string | null {
    const range = resolveCaptureGroupRange(tokensFor(pattern), groupIndex);
    return range ? pattern.slice(range.start, range.end) : null;
  }

  it("spans the parentheses of a simple group", () => {
    expect(spanFor("^(\\d+)$", 1)).toBe("(\\d+)");
  });

  it("excludes a trailing quantifier after the group", () => {
    // ([A-Z]{3})? → range covers the parens, not the outer `?`
    expect(spanFor("([A-Z]{3})?", 1)).toBe("([A-Z]{3})");
    expect(spanFor("(\\d+)*", 1)).toBe("(\\d+)");
    expect(spanFor("(\\d+){2,4}", 1)).toBe("(\\d+)");
  });

  it("keeps an inner curly quantifier that is inside the group", () => {
    expect(spanFor("(\\d{4})", 1)).toBe("(\\d{4})");
  });

  it("spans the full outer group for a nested capture", () => {
    expect(spanFor("(\\d{2}-(\\d{4}))", 1)).toBe("(\\d{2}-(\\d{4}))");
    expect(spanFor("(\\d{2}-(\\d{4}))", 2)).toBe("(\\d{4})");
  });

  it("skips non-capturing and lookaround groups when numbering", () => {
    expect(spanFor("(?:ab)(\\d+)", 1)).toBe("(\\d+)");
    expect(spanFor("(?=\\d)(\\d+)", 1)).toBe("(\\d+)");
    // Lookbehind is NOT a capturing group → group 1 is the real one
    expect(spanFor("(?<=x)(\\d+)", 1)).toBe("(\\d+)");
  });

  it("resolves named capturing groups", () => {
    expect(spanFor("(?<year>\\d{4})", 1)).toBe("(?<year>\\d{4})");
  });

  it("returns null for an out-of-range group index", () => {
    expect(resolveCaptureGroupRange(tokensFor("(\\d+)"), 0)).toBeNull();
    expect(resolveCaptureGroupRange(tokensFor("(\\d+)"), 2)).toBeNull();
    expect(resolveCaptureGroupRange([], 1)).toBeNull();
  });
});

describe("resolveTokenCaptureGroup", () => {
  it("returns the capture group for a token inside a group", () => {
    const tokens = tokensFor("^(\\d+)$");
    // \d token (index 2) should be in group 1
    expect(resolveTokenCaptureGroup(tokens, 2)).toBe(1);
  });

  it("returns null for a token outside any group", () => {
    const tokens = tokensFor("^(\\d+)$");
    // ^ token (index 0) is outside
    expect(resolveTokenCaptureGroup(tokens, 0)).toBeNull();
  });

  it("returns null for out-of-bounds index", () => {
    const tokens = tokensFor("^(\\d+)$");
    expect(resolveTokenCaptureGroup(tokens, -1)).toBeNull();
    expect(resolveTokenCaptureGroup(tokens, 999)).toBeNull();
  });

  it("returns innermost group for nested capture", () => {
    const tokens = tokensFor("^((\\d+))$");
    // \d inside the inner group should resolve to group 2
    const digitToken = tokens.findIndex((t) => t.raw === "\\d");
    expect(resolveTokenCaptureGroup(tokens, digitToken)).toBe(2);
  });

  it("handles lookahead groups correctly", () => {
    // ^(?=\d)(\d+)$
    const tokens = tokensFor("^(?=\\d)(\\d+)$");
    const map = buildTokenToCaptureGroupMap(tokens);
    // (?= is not capturing, so tokens inside it have no capture group
    const lookahead = tokens.findIndex((t) => t.raw === "(?=");
    expect(map[lookahead]).toBeNull();
    // The capturing group should be group 1
    const capOpen = tokens.findIndex((t) => t.raw === "(");
    expect(map[capOpen]).toBe(1);
  });
});

describe("isCapturingGroupOpenerToken", () => {
  it("is true for a plain capturing opener", () => {
    const tokens = tokensFor("^(\\d+)$");
    const open = tokens.find((t) => t.raw === "(")!;
    expect(isCapturingGroupOpenerToken(open)).toBe(true);
  });

  it("is true for a named capturing opener", () => {
    const tokens = tokensFor("(?<y>\\d+)");
    const open = tokens.find((t) => t.raw.startsWith("(?<y"))!;
    expect(isCapturingGroupOpenerToken(open)).toBe(true);
  });

  it("is false for non-capturing and lookaround openers", () => {
    for (const pattern of ["(?:\\d)", "(?=\\d)", "(?!\\d)", "(?<=\\d)x"]) {
      const tokens = tokensFor(pattern);
      const open = tokens.find((t) => t.raw.startsWith("(?"))!;
      expect(isCapturingGroupOpenerToken(open)).toBe(false);
    }
  });

  it("is false for a closing paren and for content tokens", () => {
    const tokens = tokensFor("(\\d+)");
    const close = tokens.find((t) => t.raw === ")")!;
    const digit = tokens.find((t) => t.raw === "\\d")!;
    expect(isCapturingGroupOpenerToken(close)).toBe(false);
    expect(isCapturingGroupOpenerToken(digit)).toBe(false);
  });
});

describe("resolveTokenMatchRange", () => {
  it("returns the capture group match range for a token inside a group", () => {
    // Pattern: ^(\d+) руб\.$   Test: "1000 руб."
    const { tokens, captureGroupMap, matchResult } = setup(
      "^(\\d+) руб\\.$",
      "1000 руб."
    );
    // Find \d token (inside group 1)
    const digitIdx = tokens.findIndex((t) => t.raw === "\\d");
    const range = resolveTokenMatchRange(
      digitIdx,
      captureGroupMap,
      matchResult
    );
    // Group 1 captures "1000" at positions 0..4
    expect(range).toEqual({ start: 0, end: 4 });
  });

  it("returns the gap range before the first group", () => {
    // Pattern: hello (\d+)$   Test: "hello 42"
    const { tokens, captureGroupMap, matchResult } = setup(
      "hello (\\d+)$",
      "hello 42"
    );
    // Tokenizer combines "hello " into a single literal token at index 0
    const literalIdx = tokens.findIndex((t) => t.raw === "hello ");
    expect(literalIdx).toBe(0);
    const range = resolveTokenMatchRange(
      literalIdx,
      captureGroupMap,
      matchResult
    );
    // Gap before group 1: "hello " → [0, 6)
    expect(range).toEqual({ start: 0, end: 6 });
  });

  it("returns the gap range after the last group", () => {
    // Pattern: ^(\d+) руб\.   Test: "1000 руб."
    const { tokens, captureGroupMap, matchResult } = setup(
      "^(\\d+) руб\\.",
      "1000 руб."
    );
    // Tokenizer combines " руб" into a single literal token
    const rubIdx = tokens.findIndex((t) => t.raw === " руб");
    expect(rubIdx).toBeGreaterThan(0);
    const range = resolveTokenMatchRange(rubIdx, captureGroupMap, matchResult);
    // Gap after group 1: " руб." → [4, 9)
    expect(range).toEqual({ start: 4, end: 9 });
  });

  it("returns the gap range between two groups", () => {
    // Pattern: ^(\d+) - (\w+)$   Test: "100 - abc"
    const { tokens, captureGroupMap, matchResult } = setup(
      "^(\\d+) - (\\w+)$",
      "100 - abc"
    );
    // Tokenizer combines " - " into a single literal token between groups
    const gapIdx = tokens.findIndex((t) => t.raw === " - ");
    expect(gapIdx).toBeGreaterThan(0);
    const range = resolveTokenMatchRange(gapIdx, captureGroupMap, matchResult);
    // Gap between groups: " - " → [3, 6)
    expect(range).toEqual({ start: 3, end: 6 });
  });

  it("returns null when there is no match", () => {
    const tokens = tokensFor("^(\\d+)$");
    const captureGroupMap = buildTokenToCaptureGroupMap(tokens);
    const noMatch: RegexMatchResult = {
      matched: false,
      fullMatch: null,
      matchStart: null,
      matchEnd: null,
      groups: [],
      error: null,
    };
    const range = resolveTokenMatchRange(2, captureGroupMap, noMatch);
    expect(range).toBeNull();
  });

  it("returns null for out-of-bounds token index", () => {
    const { captureGroupMap, matchResult } = setup("^(\\d+)$", "42");
    expect(resolveTokenMatchRange(-1, captureGroupMap, matchResult)).toBeNull();
    expect(
      resolveTokenMatchRange(999, captureGroupMap, matchResult)
    ).toBeNull();
  });

  it("returns null for an optional group that did not capture", () => {
    // Pattern: ^(\d+)?(\w+)$   Test: "abc"
    // Group 1 is optional and won't match; group 2 captures "abc"
    const { tokens, captureGroupMap, matchResult } = setup(
      "^(\\d+)?(\\w+)$",
      "abc"
    );
    // Token inside group 1 (e.g. \d)
    const digitIdx = tokens.findIndex((t) => t.raw === "\\d");
    const range = resolveTokenMatchRange(
      digitIdx,
      captureGroupMap,
      matchResult
    );
    expect(range).toBeNull();
  });

  it("handles nested groups — returns innermost group's range", () => {
    // Pattern: ^((\d+)-(\w+))$   Test: "123-abc"
    const { tokens, captureGroupMap, matchResult } = setup(
      "^((\\d+)-(\\w+))$",
      "123-abc"
    );
    // \d token is inside group 2 (innermost)
    const digitIdx = tokens.findIndex((t) => t.raw === "\\d");
    const range = resolveTokenMatchRange(
      digitIdx,
      captureGroupMap,
      matchResult
    );
    // Group 2 captures "123" → [0, 3)
    expect(range).toEqual({ start: 0, end: 3 });
  });

  it("handles nested groups — literal between inner groups maps to outer group", () => {
    // Pattern: ^((\d+)-(\w+))$   Test: "123-abc"
    const { tokens, captureGroupMap, matchResult } = setup(
      "^((\\d+)-(\\w+))$",
      "123-abc"
    );
    // "-" literal belongs to outer group 1
    const dashIdx = tokens.findIndex((t) => t.raw === "-");
    expect(captureGroupMap[dashIdx]).toBe(1);
    const range = resolveTokenMatchRange(dashIdx, captureGroupMap, matchResult);
    // Group 1 captures "123-abc" → [0, 7)
    expect(range).toEqual({ start: 0, end: 7 });
  });

  it("returns gap when all tokens are outside groups (no groups)", () => {
    // Pattern: hello   Test: "hello"
    const { captureGroupMap, matchResult } = setup("hello", "hello");
    const range = resolveTokenMatchRange(0, captureGroupMap, matchResult);
    // Entire match is a "gap" → [0, 5)
    expect(range).toEqual({ start: 0, end: 5 });
  });
});
