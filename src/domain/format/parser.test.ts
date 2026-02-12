import { describe, expect, it } from "vitest";
import { FORMAT_TEMPLATE, parseFormatFile, serializeFormat } from "./parser";

describe("parseFormatFile", () => {
  it("parses a well-formed format file", () => {
    const raw = [
      "^(\\d+) руб. (.+)$",
      "",
      "-----COLUMNS-----",
      "outcome;payee",
      "",
      "-----EXAMPLE-----",
      "1000 руб. Магазин",
    ].join("\n");

    const result = parseFormatFile(raw, "test.txt");
    expect(result.regex).toBe("^(\\d+) руб. (.+)$");
    expect(result.columns).toEqual(["outcome", "payee"]);
    expect(result.examples).toEqual(["1000 руб. Магазин"]);
    expect(result.parseIssues).toEqual([]);
  });

  it("parses multiple examples", () => {
    const raw = [
      "^(.*)$",
      "",
      "-----COLUMNS-----",
      "comment",
      "",
      "-----EXAMPLE-----",
      "First example",
      "",
      "-----EXAMPLE-----",
      "Second example",
    ].join("\n");

    const result = parseFormatFile(raw, "test.txt");
    expect(result.examples).toEqual(["First example", "Second example"]);
  });

  it("reports missing COLUMNS marker", () => {
    const raw = "^(.*)$\n\n-----EXAMPLE-----\ntest";
    const result = parseFormatFile(raw, "test.txt");
    expect(result.parseIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_COLUMNS" }),
      ])
    );
  });

  it("reports missing EXAMPLE marker", () => {
    const raw = "^(.*)$\n\n-----COLUMNS-----\ncomment";
    const result = parseFormatFile(raw, "test.txt");
    expect(result.parseIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_EXAMPLE" }),
      ])
    );
  });

  it("reports missing regex", () => {
    const raw = "\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\ntest";
    const result = parseFormatFile(raw, "test.txt");
    expect(result.parseIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_REGEX" }),
      ])
    );
  });

  it("handles multiline examples", () => {
    const raw = [
      "^(.*)$",
      "",
      "-----COLUMNS-----",
      "comment",
      "",
      "-----EXAMPLE-----",
      "Line 1",
      "Line 2",
    ].join("\n");

    const result = parseFormatFile(raw, "test.txt");
    expect(result.examples).toEqual(["Line 1\nLine 2"]);
  });
});

describe("serializeFormat", () => {
  it("produces canonical format output", () => {
    const result = serializeFormat("^(.*)$", ["comment"], ["Sample SMS text"]);
    expect(result).toBe(
      "^(.*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nSample SMS text\n"
    );
  });

  it("serializes multiple examples", () => {
    const result = serializeFormat("^(.*)$", ["comment"], ["Ex1", "Ex2"]);
    expect(result).toContain(
      "-----EXAMPLE-----\nEx1\n\n-----EXAMPLE-----\nEx2\n"
    );
  });

  it("serializes multiple columns with semicolons", () => {
    const result = serializeFormat(
      "^(\\d+)(.+)$",
      ["outcome", "payee"],
      ["100 Shop"]
    );
    expect(result).toContain("outcome;payee");
  });
});

describe("FORMAT_TEMPLATE", () => {
  it("is parseable without errors", () => {
    const result = parseFormatFile(FORMAT_TEMPLATE, "template.txt");
    expect(result.parseIssues).toEqual([]);
    expect(result.regex).toBe("^(.*)$");
    expect(result.columns).toEqual(["comment"]);
    expect(result.examples).toEqual(["Sample SMS text"]);
  });
});

describe("round-trip", () => {
  it("parse then serialize produces equivalent content", () => {
    const original = serializeFormat(
      "^(\\d+) руб\\. (.+)$",
      ["outcome", "payee"],
      ["1000 руб. Магазин", "500 руб. Аптека"]
    );
    const parsed = parseFormatFile(original, "test.txt");
    const reserialized = serializeFormat(
      parsed.regex,
      parsed.columns,
      parsed.examples
    );
    expect(reserialized).toBe(original);
  });
});
