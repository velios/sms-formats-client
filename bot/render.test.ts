import { describe, expect, it } from "vitest";
import type { CorpusFormat } from "./corpus";
import type { RecognizedFormat } from "./recognize";
import { renderResponse } from "./render";

const corpus: CorpusFormat[] = [
  {
    source: { kind: "pr", number: 45 },
    bank: "tinkoff",
    formatId: "24",
    regex: "x",
  },
  {
    source: { kind: "pr", number: 50 },
    bank: "alfabank",
    formatId: "3",
    regex: "y",
  },
];

describe("renderResponse", () => {
  it("groups recognized formats by source, main first then PRs ascending", () => {
    const recognized: RecognizedFormat[] = [
      { source: { kind: "pr", number: 45 }, bank: "tinkoff", formatId: "24" },
      { source: { kind: "main" }, bank: "sberbank", formatId: "12" },
    ];
    expect(renderResponse(recognized, corpus)).toBe(
      "main:\n- sberbank/12\nPR #45\n- tinkoff/24"
    );
  });

  it("lists the same bank twice when main and a PR both recognize it", () => {
    const recognized: RecognizedFormat[] = [
      { source: { kind: "main" }, bank: "tinkoff", formatId: "24" },
      { source: { kind: "pr", number: 45 }, bank: "tinkoff", formatId: "24" },
    ];
    expect(renderResponse(recognized, corpus)).toBe(
      "main:\n- tinkoff/24\nPR #45\n- tinkoff/24"
    );
  });

  it("reports no matches with the count of open PRs", () => {
    expect(renderResponse([], corpus)).toBe(
      "Ни один формат не распознаёт этот SMS — ни на main, ни в 2 открытых PR. Похоже, нужен новый формат."
    );
  });
});
