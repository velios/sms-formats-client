import { describe, expect, it } from "vitest";
import { REGEX_SNIPPETS } from "@/content/snippets.generated";
import {
  filterSnippets,
  groupSnippets,
  type RegexSnippet,
  snippetSchema,
} from "./schema";

const sample: RegexSnippet[] = [
  {
    id: "amount-0",
    group: "amount",
    pattern: "(\\d[\\d\\s.,]*)",
    desc: "Сумма операции",
    trigger: "Когда без копеек",
    kind: "default",
  },
  {
    id: "currency-0",
    group: "currency",
    pattern: "([A-Z]{3})",
    desc: "ISO-код валюты",
    kind: "default",
  },
];

describe("filterSnippets", () => {
  it("returns everything for an empty query", () => {
    expect(filterSnippets(sample, "   ")).toHaveLength(2);
  });

  it("matches on the pattern", () => {
    expect(filterSnippets(sample, "[A-Z]")).toEqual([sample[1]]);
  });

  it("matches on the group key and description, case-insensitively", () => {
    expect(filterSnippets(sample, "AMOUNT")).toEqual([sample[0]]);
    expect(filterSnippets(sample, "валюты")).toEqual([sample[1]]);
  });

  it("matches on the trigger", () => {
    expect(filterSnippets(sample, "копеек")).toEqual([sample[0]]);
  });
});

describe("groupSnippets", () => {
  it("preserves encounter order and buckets by group", () => {
    expect(groupSnippets(sample)).toEqual([
      { group: "amount", snippets: [sample[0]] },
      { group: "currency", snippets: [sample[1]] },
    ]);
  });
});

describe("snippetSchema", () => {
  it("accepts a valid entry and defaults kind to 'default'", () => {
    const parsed = snippetSchema.parse({
      group: "mcc",
      pattern: "(\\d+)",
      desc: "MCC",
    });
    expect(parsed.kind).toBe("default");
  });

  it("rejects a missing pattern", () => {
    expect(snippetSchema.safeParse({ group: "mcc", desc: "MCC" }).success).toBe(
      false
    );
  });

  it("rejects an unknown group", () => {
    expect(
      snippetSchema.safeParse({ group: "nope", pattern: "x", desc: "y" })
        .success
    ).toBe(false);
  });

  it("rejects an invalid kind", () => {
    expect(
      snippetSchema.safeParse({
        group: "mcc",
        pattern: "x",
        desc: "y",
        kind: "legacy",
      }).success
    ).toBe(false);
  });
});

describe("generated catalog", () => {
  it("is non-empty with unique ids", () => {
    expect(REGEX_SNIPPETS.length).toBeGreaterThan(0);
    const ids = new Set(REGEX_SNIPPETS.map((snippet) => snippet.id));
    expect(ids.size).toBe(REGEX_SNIPPETS.length);
  });

  it("only contains schema-valid, compilable snippets", () => {
    for (const snippet of REGEX_SNIPPETS) {
      expect(snippetSchema.safeParse(snippet).success).toBe(true);
      expect(() => new RegExp(snippet.pattern)).not.toThrow();
    }
  });
});
