import { describe, expect, it } from "vitest";
import {
  cleanText,
  countCaptureGroups,
  explainRegex,
  recognitionProgress,
  testRegex,
} from "./regex";

describe("cleanText", () => {
  it("collapses a single newline run to one space", () => {
    expect(cleanText("a\nb")).toBe("a b");
  });

  it("collapses runs of mixed \\n and \\r to one space", () => {
    expect(cleanText("a\n\n\nb")).toBe("a b");
    expect(cleanText("a\r\nb")).toBe("a b");
    expect(cleanText("a\r\n\r\nb")).toBe("a b");
  });

  it("trims leading and trailing whitespace including converted newlines", () => {
    expect(cleanText("\n\n  hello  \r\n")).toBe("hello");
    expect(cleanText("  spaced  ")).toBe("spaced");
  });

  it("is idempotent", () => {
    const once = cleanText("\n a\n\nb \r");
    expect(cleanText(once)).toBe(once);
  });

  it("returns empty string for whitespace-only input", () => {
    expect(cleanText("\n\r\n  ")).toBe("");
  });
});

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

  it("matches across newlines and maps offsets back into the original", () => {
    const original = "Покупка\n1000 руб\nМагазин";
    const result = testRegex("^Покупка (\\d+) руб (.+)$", original);
    expect(result.matched).toBe(true);
    expect(result.matchStart).toBe(0);
    expect(result.matchEnd).toBe(original.length);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toMatchObject({ value: "1000" });
    expect(original.slice(result.groups[0]!.start, result.groups[0]!.end)).toBe(
      "1000"
    );
    expect(result.groups[1]).toMatchObject({ value: "Магазин" });
    expect(original.slice(result.groups[1]!.start, result.groups[1]!.end)).toBe(
      "Магазин"
    );
  });

  it("maps a collapsed newline run to the whole run in the original", () => {
    const original = "a\n\n\nb";
    const result = testRegex("^(a) (b)$", original);
    expect(result.matched).toBe(true);
    expect(result.groups[0]).toMatchObject({ value: "a", start: 0, end: 1 });
    // "b" sits after the 3-char run: original index 4
    expect(result.groups[1]).toMatchObject({ value: "b", start: 4, end: 5 });
  });

  it("accounts for trimmed leading whitespace when mapping offsets", () => {
    const original = "\n  10 USD";
    const result = testRegex("^(\\d+) (\\w+)$", original);
    expect(result.matched).toBe(true);
    expect(result.groups[0]).toMatchObject({ value: "10", start: 3, end: 5 });
    expect(result.groups[1]).toMatchObject({ value: "USD", start: 6, end: 9 });
    expect(original.slice(result.matchStart!, result.matchEnd!)).toBe("10 USD");
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

describe("recognitionProgress", () => {
  it("returns null for an empty pattern", () => {
    expect(recognitionProgress("", "anything")).toBeNull();
  });

  it("returns null when no prefix latches (empty B)", () => {
    // Pattern never starts: nothing of the SMS is covered.
    expect(recognitionProgress("USD", "hello world")).toBeNull();
  });

  it("recognizes the prefix and marks the unrecognized tail (region C)", () => {
    const pattern = "Soma/\\s*Summa\\s+(\\d[\\d\\s.,]*[.,]\\d{2})";
    const sms = "123123Soma/ Summa 49 500.00 XXXXX";
    const progress = recognitionProgress(pattern, sms);
    expect(progress).not.toBeNull();
    // A = "123123" stays before the prefix.
    expect(sms.slice(0, progress!.prefixStart)).toBe("123123");
    // B covers up to and including the captured amount.
    expect(sms.slice(progress!.prefixStart, progress!.prefixEnd)).toBe(
      "Soma/ Summa 49 500.00"
    );
    // C = " XXXXX" is the unrecognized tail, so text is not exhausted.
    expect(progress!.textExhausted).toBe(false);
    expect(progress!.groups[0]?.value).toBe("49 500.00");
    expect(
      sms.slice(progress!.groups[0]!.start, progress!.groups[0]!.end)
    ).toBe("49 500.00");
  });

  it("flags textExhausted when the prefix eats the whole SMS but the pattern needs more", () => {
    // "Summa" is consumed; the mandatory amount has no text left.
    const progress = recognitionProgress("Summa(\\d+)", "Summa");
    expect(progress).not.toBeNull();
    expect(progress!.prefixEnd).toBe("Summa".length);
    expect(progress!.textExhausted).toBe(true);
  });

  it("stops a lazy .*? early, leaving the rest as tail (region C)", () => {
    const sms = "Karta 1234 net";
    const progress = recognitionProgress("Karta.*?Balans", sms);
    expect(progress).not.toBeNull();
    // Lazy quantifier stays minimal: B = "Karta", the rest is the tail.
    expect(sms.slice(0, progress!.prefixStart)).toBe("");
    expect(sms.slice(progress!.prefixStart, progress!.prefixEnd)).toBe("Karta");
    expect(progress!.textExhausted).toBe(false);
  });

  it("greedy .* eats the tail and triggers textExhausted", () => {
    const progress = recognitionProgress("Karta.*Balans", "Karta 1234 net");
    expect(progress).not.toBeNull();
    expect(progress!.textExhausted).toBe(true);
  });

  it("does not regard an optional-only prefix as recognized", () => {
    // \s* matches empty at the start → empty B → null.
    expect(recognitionProgress("\\s*USD", "hello")).toBeNull();
  });

  it("maps prefix offsets back across collapsed newlines", () => {
    const original = "Pokupka\n1000 rub\nMagazin XXX";
    const progress = recognitionProgress(
      "^Pokupka (\\d+) rub (Shop)",
      original
    );
    expect(progress).not.toBeNull();
    expect(progress!.groups[0]).toMatchObject({ value: "1000" });
    expect(
      original.slice(progress!.groups[0]!.start, progress!.groups[0]!.end)
    ).toBe("1000");
  });

  it("respects anchored patterns (no latch when head precedes the anchor)", () => {
    // ^ forces the start; SMS has junk before it, so nothing latches.
    expect(recognitionProgress("^USD (\\d+)", "xxx USD 10")).toBeNull();
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
