import { describe, expect, it } from "vitest";
import type { ParsedFormat } from "../types";
import { checkCrossFormatCollisions, validateFormat } from "./index";

function makeParsed(
  regex: string,
  columns: string[],
  examples: string[]
): ParsedFormat {
  return {
    regex,
    columns,
    examples,
    raw: "",
    parseIssues: [],
  };
}

describe("validateFormat", () => {
  it("passes for valid format", () => {
    const parsed = makeParsed("^(.*)$", ["comment"], ["Hello world"]);
    const issues = validateFormat(parsed, "test.txt");
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("reports invalid regex", () => {
    const parsed = makeParsed("[invalid", ["comment"], ["test"]);
    const issues = validateFormat(parsed, "test.txt");
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_REGEX" }),
      ])
    );
  });

  it("reports example not matching regex", () => {
    const parsed = makeParsed("^\\d+$", ["comment"], ["not a number"]);
    const issues = validateFormat(parsed, "test.txt");
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "EXAMPLE_NO_MATCH" }),
      ])
    );
  });

  it("reports group/column count mismatch", () => {
    const parsed = makeParsed("^(\\d+) (.+)$", ["outcome"], ["100 Shop"]);
    const issues = validateFormat(parsed, "test.txt");
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "GROUP_COUNT_MISMATCH" }),
      ])
    );
  });

  it("reports invalid column name", () => {
    const parsed = makeParsed("^(.*)$", ["nonexistent_column"], ["test"]);
    const issues = validateFormat(parsed, "test.txt");
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_COLUMN" }),
      ])
    );
  });

  it("accepts parameterized columns", () => {
    const parsed = makeParsed("^(\\d+)$", ["date#dd.MM.yyyy"], ["01.01.2024"]);
    // date is valid base name
    const issues = validateFormat(parsed, "test.txt");
    const colIssues = issues.filter((i) => i.code === "INVALID_COLUMN");
    expect(colIssues).toHaveLength(0);
  });

  it("accepts instrument and account balance columns used in sms-formats", () => {
    const parsed = makeParsed(
      "^(\\d+) (\\w+) (\\d+\\.\\d+) (\\w+)$",
      ["outcome", "instrument", "av_balance", "acc_instrument"],
      ["10 EUR 100.50 EUR"]
    );
    const issues = validateFormat(parsed, "test.txt");
    const colIssues = issues.filter((i) => i.code === "INVALID_COLUMN");
    expect(colIssues).toHaveLength(0);
  });
});

describe("checkCrossFormatCollisions", () => {
  it("detects collision when example matches another format regex", () => {
    const format1 = {
      filePath: "f1.txt",
      parsed: makeParsed("^(.*)$", ["comment"], ["Any text"]),
    };
    const format2 = {
      filePath: "f2.txt",
      parsed: makeParsed("^(\\d+) руб$", ["outcome"], ["100 руб"]),
    };

    // format2's example "100 руб" also matches format1's regex ^(.*)$
    const issues = checkCrossFormatCollisions([format1, format2]);
    expect(issues.some((i) => i.code === "EXAMPLE_COLLISION")).toBe(true);
  });

  it("returns no collisions for non-overlapping formats", () => {
    const format1 = {
      filePath: "f1.txt",
      parsed: makeParsed("^ABC (\\d+)$", ["outcome"], ["ABC 100"]),
    };
    const format2 = {
      filePath: "f2.txt",
      parsed: makeParsed("^XYZ (\\d+)$", ["outcome"], ["XYZ 200"]),
    };

    const issues = checkCrossFormatCollisions([format1, format2]);
    expect(issues).toHaveLength(0);
  });
});
