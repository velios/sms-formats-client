import { describe, expect, it } from "vitest";
import { calculateFormatIntersectionStats } from "./intersections";

describe("calculateFormatIntersectionStats", () => {
  it("counts own examples and intersections with other formats", () => {
    const stats = calculateFormatIntersectionStats([
      {
        filePath: "src/Bank/formats/a.txt",
        regex: "^PAY (\\d+)$",
        examples: ["PAY 100", "PAY 200", "OTHER"],
      },
      {
        filePath: "src/Bank/formats/b.txt",
        regex: "^REFUND (\\d+)$",
        examples: ["PAY 300", "REFUND 50"],
      },
      {
        filePath: "src/Bank/formats/c.txt",
        regex: "^CARD (\\d+)$",
        examples: ["CARD 1"],
      },
    ]);

    expect(stats.get("src/Bank/formats/a.txt")).toEqual({
      filePath: "src/Bank/formats/a.txt",
      totalExamples: 3,
      ownMatchedExamples: 2,
      intersectingOtherFormats: 1,
    });
    expect(stats.get("src/Bank/formats/b.txt")).toEqual({
      filePath: "src/Bank/formats/b.txt",
      totalExamples: 2,
      ownMatchedExamples: 1,
      intersectingOtherFormats: 0,
    });
    expect(stats.get("src/Bank/formats/c.txt")).toEqual({
      filePath: "src/Bank/formats/c.txt",
      totalExamples: 1,
      ownMatchedExamples: 1,
      intersectingOtherFormats: 0,
    });
  });

  it("returns zeros for missing or invalid regex", () => {
    const stats = calculateFormatIntersectionStats([
      {
        filePath: "src/Bank/formats/empty.txt",
        regex: "",
        examples: ["PAY 100"],
      },
      {
        filePath: "src/Bank/formats/invalid.txt",
        regex: "[broken",
        examples: ["PAY 200"],
      },
    ]);

    expect(stats.get("src/Bank/formats/empty.txt")).toEqual({
      filePath: "src/Bank/formats/empty.txt",
      totalExamples: 1,
      ownMatchedExamples: 0,
      intersectingOtherFormats: 0,
    });
    expect(stats.get("src/Bank/formats/invalid.txt")).toEqual({
      filePath: "src/Bank/formats/invalid.txt",
      totalExamples: 1,
      ownMatchedExamples: 0,
      intersectingOtherFormats: 0,
    });
  });
});
