import { describe, expect, it } from "vitest";
import type { CorpusFormat } from "./corpus";
import { respond } from "./respond";

const DEMO_SMS = "Pokupka 1000 RUB. Karta *1234. Dostupno 5000 RUB";
const SBER_URL =
  "https://github.com/zenmoney/sms-formats/blob/abc/src/sberbank/formats/12.txt";

const corpus: CorpusFormat[] = [
  {
    source: { kind: "main" },
    bank: "sberbank",
    formatId: "12",
    regex: "^Pokupka \\d+ RUB\\. Karta \\*\\d+\\. Dostupno \\d+ RUB$",
    fileUrl: SBER_URL,
  },
];

describe("respond", () => {
  it("returns null for a silent intent", () => {
    expect(respond({ kind: "silent" }, corpus)).toBeNull();
  });

  it("returns the hint text verbatim for a hint intent", () => {
    expect(respond({ kind: "hint", text: "do this" }, corpus)).toBe("do this");
  });

  it("recognizes an sms intent and renders the formats linked to their files", () => {
    expect(respond({ kind: "sms", sms: DEMO_SMS }, corpus)).toBe(
      `main:\n- <a href="${SBER_URL}">sberbank/12</a>`
    );
  });

  it("renders the no-match message for an unrecognized sms", () => {
    expect(respond({ kind: "sms", sms: "Random unmatched text" }, corpus)).toBe(
      "Ни один формат не распознаёт этот SMS — ни на main, ни в 0 открытых PR. Похоже, нужен новый формат."
    );
  });
});
