import { describe, expect, it } from "vitest";
import type { CorpusFormat } from "./corpus";
import { recognize } from "./recognize";

const corpus: CorpusFormat[] = [
  {
    source: { kind: "main" },
    bank: "sberbank",
    formatId: "12",
    regex: "^Pokupka \\d+ RUB",
    fileUrl: "https://github.com/o/r/blob/sha/src/sberbank/formats/12.txt",
  },
  {
    source: { kind: "pr", number: 45, title: "Add Tinkoff format" },
    bank: "tinkoff",
    formatId: "24",
    regex: "Pokupka (\\d+) RUB",
    fileUrl: "https://github.com/o/r/blob/sha/src/tinkoff/formats/24.txt",
  },
  {
    source: { kind: "main" },
    bank: "vtb",
    formatId: "9",
    regex: "[broken(",
    fileUrl: "https://github.com/o/r/blob/sha/src/vtb/formats/9.txt",
  },
];

describe("recognize", () => {
  it("returns every format whose regex recognizes the SMS, by source", () => {
    expect(recognize("Pokupka 1000 RUB", corpus)).toEqual([
      {
        source: { kind: "main" },
        bank: "sberbank",
        formatId: "12",
        fileUrl: "https://github.com/o/r/blob/sha/src/sberbank/formats/12.txt",
      },
      {
        source: { kind: "pr", number: 45, title: "Add Tinkoff format" },
        bank: "tinkoff",
        formatId: "24",
        fileUrl: "https://github.com/o/r/blob/sha/src/tinkoff/formats/24.txt",
      },
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
      {
        source: { kind: "main" },
        bank: "sberbank",
        formatId: "12",
        fileUrl: "https://github.com/o/r/blob/sha/src/sberbank/formats/12.txt",
      },
      {
        source: { kind: "pr", number: 45, title: "Add Tinkoff format" },
        bank: "tinkoff",
        formatId: "24",
        fileUrl: "https://github.com/o/r/blob/sha/src/tinkoff/formats/24.txt",
      },
    ]);
  });
});
