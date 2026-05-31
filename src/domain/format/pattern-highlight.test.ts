import { describe, expect, it } from "vitest";
import { buildPatternHighlightPlan } from "./pattern-highlight";
import { explainRegex, recognitionProgress, testRegex } from "./regex";
import { buildTokenToCaptureGroupMap } from "./token-capture-map";

function plan(pattern: string, sms: string) {
  const tokens = explainRegex(pattern, "en").patternTokens;
  const map = buildTokenToCaptureGroupMap(tokens);
  const matchResult = testRegex(pattern, sms);
  const progress = matchResult.matched
    ? null
    : recognitionProgress(pattern, sms);
  return {
    tokens,
    ...buildPatternHighlightPlan(tokens, map, matchResult, progress),
  };
}

describe("buildPatternHighlightPlan", () => {
  it("lights every token on a full match", () => {
    const { lit } = plan("(\\d+) rub", "100 rub");
    expect(lit.every(Boolean)).toBe(true);
  });

  it("colors tokens of a captured group with that group, gaps with blue", () => {
    const { tokens, colorGroups } = plan("(\\d+) rub", "100 rub");
    // tokens: "(", "\d", "+", ")", " rub"
    expect(tokens.map((t) => t.raw)).toEqual(["(", "\\d", "+", ")", " rub"]);
    expect(colorGroups).toEqual([1, 1, 1, 1, 0]);
  });

  it("distinguishes multiple captured groups", () => {
    const { colorGroups } = plan("(\\d+)-(\\d+)", "12-34");
    // group 1 tokens then a blue gap "-" then group 2 tokens
    expect(colorGroups).toEqual([1, 1, 1, 1, 0, 2, 2, 2, 2]);
  });

  it("paints a group that did not capture as blue (not its own color)", () => {
    // Optional group never captures; its tokens stay blue inside the match.
    const { colorGroups, lit } = plan("(a)?b", "b");
    expect(lit.every(Boolean)).toBe(true);
    expect(colorGroups.every((c) => c === 0)).toBe(true);
  });

  it("lights nothing when neither full match nor prefix latches", () => {
    const { lit } = plan("USD", "hello world");
    expect(lit.every((value) => value === false)).toBe(true);
  });

  it("lights only the recognized prefix on a partial match", () => {
    const pattern = "Karta.*?Balans";
    const sms = "Karta 1234 net";
    const { tokens, lit } = plan(pattern, sms);
    const progress = recognitionProgress(pattern, sms);
    expect(progress).not.toBeNull();
    const cut = progress!.prefixPatternEnd;
    expect(cut).toBeLessThan(pattern.length);
    tokens.forEach((token, index) => {
      expect(lit[index]).toBe(token.end <= cut);
    });
    // The trailing "Balans" literal is beyond the cut → neutral.
    expect(lit.at(-1)).toBe(false);
  });

  it("colors prefix capture groups on a partial match", () => {
    const pattern = "^Pokupka (\\d+) rub (Shop)";
    const sms = "Pokupka\n1000 rub\nMagazin XXX";
    const { tokens, colorGroups, lit } = plan(pattern, sms);
    // group 1 captured "1000" inside the recognized prefix.
    const litGroupOnes = tokens
      .map((_, index) => (lit[index] ? colorGroups[index] : null))
      .filter((group) => group === 1);
    expect(litGroupOnes.length).toBeGreaterThan(0);
  });
});
