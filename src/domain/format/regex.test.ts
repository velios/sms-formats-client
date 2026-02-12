import { describe, expect, it } from "vitest";
import { countCaptureGroups, explainRegex, testRegex } from "./regex";

describe("testRegex", () => {
  it("returns matched result for matching pattern", () => {
    const result = testRegex("^(\\d+) руб\\. (.+)$", "1000 руб. Магазин");
    expect(result.matched).toBe(true);
    expect(result.fullMatch).toBe("1000 руб. Магазин");
    expect(result.matchStart).toBe(0);
    expect(result.matchEnd).toBe("1000 руб. Магазин".length);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.value).toBe("1000");
    expect(result.groups[1]?.value).toBe("Магазин");
    expect(result.error).toBeNull();
  });

  it("returns no match for non-matching string", () => {
    const result = testRegex("^\\d+ USD$", "hello world");
    expect(result.matched).toBe(false);
    expect(result.fullMatch).toBeNull();
    expect(result.matchStart).toBeNull();
    expect(result.matchEnd).toBeNull();
    expect(result.groups).toEqual([]);
    expect(result.error).toBeNull();
  });

  it("returns error for invalid regex", () => {
    const result = testRegex("[invalid", "test");
    expect(result.matched).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("handles empty pattern", () => {
    const result = testRegex("", "test");
    expect(result.matched).toBe(false);
    expect(result.error).toBeNull();
  });

  it("handles non-capturing groups", () => {
    const result = testRegex("^(?:hello) (\\w+)$", "hello world");
    expect(result.matched).toBe(true);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.value).toBe("world");
  });

  it("keeps correct offsets for repeated captured values", () => {
    const result = testRegex(
      "^([A-Z]{3})\\s+([0-9.]+)\\s+([A-Z]{3})$",
      "EUR 10.00 EUR"
    );
    expect(result.matched).toBe(true);
    expect(result.groups).toHaveLength(3);
    expect(result.groups[0]).toMatchObject({ value: "EUR", start: 0, end: 3 });
    expect(result.groups[1]).toMatchObject({
      value: "10.00",
      start: 4,
      end: 9,
    });
    expect(result.groups[2]).toMatchObject({
      value: "EUR",
      start: 10,
      end: 13,
    });
  });
});

describe("countCaptureGroups", () => {
  it("counts groups in simple pattern", () => {
    expect(countCaptureGroups("^(\\d+) (.+)$")).toBe(2);
  });

  it("counts single group", () => {
    expect(countCaptureGroups("^(.*)$")).toBe(1);
  });

  it("returns null for invalid regex", () => {
    expect(countCaptureGroups("[invalid")).toBeNull();
  });

  it("ignores non-capturing groups", () => {
    expect(countCaptureGroups("^(?:a)(b)$")).toBe(1);
  });
});

describe("explainRegex", () => {
  it("returns human-readable explanation lines", () => {
    const explanation = explainRegex("^\\d{5}$");
    expect(explanation.lines.length).toBeGreaterThan(0);
    expect(explanation.lines.join(" ").toLowerCase()).toContain("digit");
    expect(explanation.canHighlightPattern).toBe(true);
    expect(explanation.patternTokens.map((token) => token.raw).join("")).toBe(
      "^\\d{5}$"
    );
  });

  it("builds token offsets for regex pattern parts", () => {
    const explanation = explainRegex("(abc)");
    expect(explanation.canHighlightPattern).toBe(true);
    expect(explanation.patternTokens[0]).toEqual(
      expect.objectContaining({
        raw: "(",
        start: 0,
        end: 1,
      })
    );
  });

  it("returns empty explanation for empty regex", () => {
    const explanation = explainRegex("");
    expect(explanation.heading).toBeNull();
    expect(explanation.lines).toEqual([]);
    expect(explanation.patternTokens).toEqual([]);
  });

  it("returns empty explanation for invalid regex", () => {
    const explanation = explainRegex("[invalid");
    expect(explanation.lines).toEqual([]);
    expect(explanation.canHighlightPattern).toBe(false);
    expect(explanation.patternTokens).toEqual([]);
  });

  it("supports russian locale output", () => {
    const explanation = explainRegex("^\\d{5}$", "ru");
    expect(explanation.lines.join(" ").toLowerCase()).toContain("циф");
    expect(explanation.patternTokens[1]?.description.toLowerCase()).toContain(
      "циф"
    );
  });
});
