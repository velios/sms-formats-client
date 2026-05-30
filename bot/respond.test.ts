import { describe, expect, it } from "vitest";
import { respondToMessage } from "./respond";

const DEMO_SMS = "Pokupka 1000 RUB. Karta *1234. Dostupno 5000 RUB";

describe("respondToMessage (against the hardcoded corpus)", () => {
  it("answers a replied-to SMS with the grouped recognized formats", () => {
    const reply = respondToMessage({
      text: "@zenmoneysms_bot",
      entities: [{ type: "mention", offset: 0, length: 16 }],
      replyToText: DEMO_SMS,
    });
    expect(reply).toBe("main:\n- sberbank/12\nPR #45\n- tinkoff/24");
  });

  it("answers an inline SMS after the @mention the same way", () => {
    const reply = respondToMessage({
      text: `@zenmoneysms_bot ${DEMO_SMS}`,
      entities: [{ type: "mention", offset: 0, length: 16 }],
    });
    expect(reply).toBe("main:\n- sberbank/12\nPR #45\n- tinkoff/24");
  });

  it("returns the usage hint for an empty call", () => {
    const reply = respondToMessage({
      text: "@zenmoneysms_bot",
      entities: [{ type: "mention", offset: 0, length: 16 }],
    });
    expect(reply).toContain("Пришлите SMS");
  });

  it("returns the no-match message for an unrecognized SMS", () => {
    const reply = respondToMessage({ replyToText: "Random unmatched text" });
    expect(reply).toBe(
      "Ни один формат не распознаёт этот SMS — ни на main, ни в 2 открытых PR. Похоже, нужен новый формат."
    );
  });
});
