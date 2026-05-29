import { describe, expect, it } from "vitest";
import { recognizeSms, regexesBySms, smsesByRegex } from "./recognition";

describe("recognizeSms", () => {
  it("matches a regex against an SMS", () => {
    expect(recognizeSms("^PAY (\\d+)$", "PAY 100")).toEqual({
      matched: true,
      error: null,
    });
  });

  it("reports no match without an error", () => {
    expect(recognizeSms("^PAY (\\d+)$", "REFUND 100")).toEqual({
      matched: false,
      error: null,
    });
  });

  it("surfaces a compile error for an invalid regex", () => {
    const result = recognizeSms("[broken", "PAY 100");
    expect(result.matched).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("treats an empty or whitespace regex as no match, no error", () => {
    expect(recognizeSms("", "PAY 100")).toEqual({
      matched: false,
      error: null,
    });
    expect(recognizeSms("   ", "PAY 100")).toEqual({
      matched: false,
      error: null,
    });
  });

  it("recognizes over normalized text, matching multiline SMS like the device", () => {
    expect(
      recognizeSms("^PAY (\\d+) at (.+)$", "PAY 100\nat Shop").matched
    ).toBe(true);
  });
});

describe("regexesBySms", () => {
  it("returns a result per regex aligned by index", () => {
    const results = regexesBySms(
      ["^PAY (\\d+)$", "^REFUND (\\d+)$", "[broken"],
      "PAY 100"
    );
    expect(results).toEqual([
      { matched: true, error: null },
      { matched: false, error: null },
      { matched: false, error: expect.any(String) },
    ]);
  });

  it("normalizes the SMS once and matches multiline input", () => {
    const results = regexesBySms(["^A (\\d+) B$"], "A 1\n\nB");
    expect(results[0]?.matched).toBe(true);
  });

  it("treats an empty regex element as no match, no error", () => {
    expect(regexesBySms([""], "PAY 100")).toEqual([
      { matched: false, error: null },
    ]);
  });

  it("returns an empty array for no regexes", () => {
    expect(regexesBySms([], "PAY 100")).toEqual([]);
  });
});

describe("smsesByRegex", () => {
  it("returns a single error and aligned matches for many SMS", () => {
    expect(
      smsesByRegex(["PAY 100", "REFUND 50", "PAY 7"], "^PAY (\\d+)$")
    ).toEqual({
      error: null,
      matched: [true, false, true],
    });
  });

  it("reports a single error and no matches for an invalid regex", () => {
    const result = smsesByRegex(["PAY 100", "PAY 200"], "[broken");
    expect(result.error).toBeTruthy();
    expect(result.matched).toEqual([]);
  });

  it("normalizes each SMS, matching multiline input like the device", () => {
    expect(smsesByRegex(["PAY 100\nat Shop"], "^PAY (\\d+) at (.+)$")).toEqual({
      error: null,
      matched: [true],
    });
  });

  it("treats an empty regex as no matches across all SMS", () => {
    expect(smsesByRegex(["PAY 100", "PAY 200"], "")).toEqual({
      error: null,
      matched: [false, false],
    });
  });
});
