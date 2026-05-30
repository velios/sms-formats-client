import { describe, expect, it } from "vitest";
import type { CorpusFormat } from "./corpus";
import { recognize } from "./recognize";

const corpus: CorpusFormat[] = [
  {
    source: { kind: "main" },
    bank: "sberbank",
    formatId: "12",
    regex: "^Pokupka \\d+ RUB",
  },
  {
    source: { kind: "pr", number: 45 },
    bank: "tinkoff",
    formatId: "24",
    regex: "Pokupka (\\d+) RUB",
  },
  {
    source: { kind: "main" },
    bank: "vtb",
    formatId: "9",
    regex: "[broken(",
  },
];

describe("recognize", () => {
  it("returns every format whose regex recognizes the SMS, by source", () => {
    expect(recognize("Pokupka 1000 RUB", corpus)).toEqual([
      { source: { kind: "main" }, bank: "sberbank", formatId: "12" },
      { source: { kind: "pr", number: 45 }, bank: "tinkoff", formatId: "24" },
    ]);
  });

  it("silently skips invalid regexes instead of crashing", () => {
    const result = recognize("Pokupka 1000 RUB", corpus);
    expect(result.some((r) => r.bank === "vtb")).toBe(false);
  });

  it("returns nothing when no regex recognizes the SMS", () => {
    expect(recognize("ничего не подходит", corpus)).toEqual([]);
  });

  it("recognizes over normalized text, matching multiline SMS like the device", () => {
    expect(recognize("Pokupka 1000\nRUB", corpus)).toEqual([
      { source: { kind: "main" }, bank: "sberbank", formatId: "12" },
      { source: { kind: "pr", number: 45 }, bank: "tinkoff", formatId: "24" },
    ]);
  });
});
