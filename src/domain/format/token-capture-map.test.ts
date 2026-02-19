import { describe, expect, it } from "vitest";
import { explainRegex } from "./regex";
import {
  buildTokenToCaptureGroupMap,
  resolveTokenCaptureGroup,
} from "./token-capture-map";

function tokensFor(pattern: string) {
  return explainRegex(pattern, "en").patternTokens;
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

  it("returns empty array for empty tokens", () => {
    expect(buildTokenToCaptureGroupMap([])).toEqual([]);
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
