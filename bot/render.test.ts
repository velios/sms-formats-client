import { describe, expect, it } from "vitest";
import type { CorpusFormat } from "./corpus";
import type { RecognizedFormat } from "./recognize";
import {
  CONFLICT_HINT,
  DIRECT_USAGE_HINT,
  GUEST_USAGE_HINT,
  renderResponse,
} from "./render";

const SBER_URL =
  "https://github.com/zenmoney/sms-formats/blob/abc/src/sberbank/formats/12.txt";
const TINKOFF_URL =
  "https://github.com/zenmoney/sms-formats/blob/abc/src/tinkoff/formats/24.txt";

const corpus: CorpusFormat[] = [
  {
    source: { kind: "pr", number: 45, title: "Add Tinkoff format" },
    bank: "tinkoff",
    formatId: "24",
    regex: "x",
    fileUrl: TINKOFF_URL,
  },
  {
    source: { kind: "pr", number: 50, title: "Add Alfa format" },
    bank: "alfabank",
    formatId: "3",
    regex: "y",
    fileUrl:
      "https://github.com/zenmoney/sms-formats/blob/abc/src/alfabank/formats/3.txt",
  },
];

describe("usage hints", () => {
  it("guest hint names the /sms trigger", () => {
    expect(GUEST_USAGE_HINT).toContain("/sms");
  });

  it("direct hint offers bare text and the optional /sms", () => {
    expect(DIRECT_USAGE_HINT).toContain("/sms");
    expect(DIRECT_USAGE_HINT).toContain("просто сообщением");
  });

  it("conflict hint calls out the two-ways-at-once mistake", () => {
    expect(CONFLICT_HINT).toContain("двумя способами");
  });

  it("the three hints are distinct strings", () => {
    expect(
      new Set([GUEST_USAGE_HINT, DIRECT_USAGE_HINT, CONFLICT_HINT]).size
    ).toBe(3);
  });
});

describe("renderResponse", () => {
  it("groups recognized formats by source, main first then PRs ascending, with PR titles, as file links", () => {
    const recognized: RecognizedFormat[] = [
      {
        source: { kind: "pr", number: 45, title: "Add Tinkoff format" },
        bank: "tinkoff",
        formatId: "24",
        fileUrl: TINKOFF_URL,
      },
      {
        source: { kind: "main" },
        bank: "sberbank",
        formatId: "12",
        fileUrl: SBER_URL,
      },
    ];
    expect(renderResponse(recognized, corpus)).toBe(
      `main:\n- <a href="${SBER_URL}">sberbank/12</a>\nPR #45 «Add Tinkoff format»\n- <a href="${TINKOFF_URL}">tinkoff/24</a>`
    );
  });

  it("escapes HTML in the PR title", () => {
    const recognized: RecognizedFormat[] = [
      {
        source: { kind: "pr", number: 7, title: "Fix <b> & co" },
        bank: "tinkoff",
        formatId: "24",
        fileUrl: TINKOFF_URL,
      },
    ];
    expect(renderResponse(recognized, corpus)).toBe(
      `PR #7 «Fix &lt;b&gt; &amp; co»\n- <a href="${TINKOFF_URL}">tinkoff/24</a>`
    );
  });

  it("escapes HTML in the bank/formatId title", () => {
    const recognized: RecognizedFormat[] = [
      {
        source: { kind: "main" },
        bank: "a&b",
        formatId: "1",
        fileUrl: SBER_URL,
      },
    ];
    expect(renderResponse(recognized, corpus)).toBe(
      `main:\n- <a href="${SBER_URL}">a&amp;b/1</a>`
    );
  });

  it("reports no matches with the count of open PRs", () => {
    expect(renderResponse([], corpus)).toBe(
      "Ни один формат не распознаёт этот SMS — ни на main, ни в 2 открытых PR. Похоже, нужен новый формат."
    );
  });
});
