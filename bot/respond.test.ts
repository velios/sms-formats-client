import { describe, expect, it } from "vitest";
import type { CorpusFormat } from "./corpus";
import { respondToMessage } from "./respond";

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

describe("respondToMessage", () => {
  it("answers a replied-to SMS with the recognized format linked to its file", () => {
    const reply = respondToMessage(
      {
        text: "@zenmoneysms_bot",
        entities: [{ type: "mention", offset: 0, length: 16 }],
        replyToText: DEMO_SMS,
      },
      corpus
    );
    expect(reply).toBe(`main:\n- <a href="${SBER_URL}">sberbank/12</a>`);
  });

  it("answers an inline SMS after the @mention the same way", () => {
    const reply = respondToMessage(
      {
        text: `@zenmoneysms_bot ${DEMO_SMS}`,
        entities: [{ type: "mention", offset: 0, length: 16 }],
      },
      corpus
    );
    expect(reply).toBe(`main:\n- <a href="${SBER_URL}">sberbank/12</a>`);
  });

  it("returns the usage hint for an empty call", () => {
    const reply = respondToMessage(
      {
        text: "@zenmoneysms_bot",
        entities: [{ type: "mention", offset: 0, length: 16 }],
      },
      corpus
    );
    expect(reply).toContain("Пришлите SMS");
  });

  it("returns the no-match message for an unrecognized SMS", () => {
    const reply = respondToMessage(
      { replyToText: "Random unmatched text" },
      corpus
    );
    expect(reply).toBe(
      "Ни один формат не распознаёт этот SMS — ни на main, ни в 0 открытых PR. Похоже, нужен новый формат."
    );
  });
});
