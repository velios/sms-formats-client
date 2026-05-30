import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerGuestMessage,
  type GuestQueryContext,
} from "./answer-guest-message";
import type { CorpusFormat } from "./corpus";

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

// A reply-to-SMS @mention — the shape Telegram delivers for a recognized query.
const guestMessage = {
  text: "@zenmoneysms_bot",
  entities: [{ type: "mention", offset: 0, length: 16 }],
  reply_to_message: { text: DEMO_SMS },
};

// The exact rejection Telegram raises once a guest query has expired. The
// handler swallows *any* throw, so the precise type doesn't matter — but
// mirroring the real error keeps the regression honest about what it guards.
class ExpiredQueryError extends Error {
  readonly error_code = 400;
  constructor() {
    super(
      "Call to 'answerGuestQuery' failed! (400: Bad Request: query is too old and response timeout expired or query ID is invalid)"
    );
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("answerGuestMessage", () => {
  it("does not rethrow when answerGuestQuery rejects, so the webhook can still ack 200", async () => {
    const answerGuestQuery = vi.fn().mockRejectedValue(new ExpiredQueryError());
    const errWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const ctx: GuestQueryContext = { guestMessage, answerGuestQuery };

    await expect(
      answerGuestMessage(ctx, corpus, { dryRun: false })
    ).resolves.toBeUndefined();

    expect(answerGuestQuery).toHaveBeenCalledOnce();
    expect(errWrite).toHaveBeenCalledWith(
      expect.stringContaining("answerGuestQuery failed")
    );
  });

  it("answers the recognized format via answerGuestQuery on the happy path", async () => {
    const answerGuestQuery = vi.fn().mockResolvedValue({});
    const ctx: GuestQueryContext = { guestMessage, answerGuestQuery };

    await answerGuestMessage(ctx, corpus, { dryRun: false });

    expect(answerGuestQuery).toHaveBeenCalledOnce();
    const result = answerGuestQuery.mock.calls[0]?.[0] as {
      input_message_content: { message_text: string };
    };
    expect(result.input_message_content.message_text).toBe(
      `main:\n- <a href="${SBER_URL}">sberbank/12</a>`
    );
  });

  it("ignores a context with no guest message", async () => {
    const answerGuestQuery = vi.fn().mockResolvedValue({});
    const ctx: GuestQueryContext = { answerGuestQuery };

    await answerGuestMessage(ctx, corpus, { dryRun: false });

    expect(answerGuestQuery).not.toHaveBeenCalled();
  });

  it("prints the reply instead of sending it in dry-run", async () => {
    const answerGuestQuery = vi.fn().mockResolvedValue({});
    const outWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const ctx: GuestQueryContext = { guestMessage, answerGuestQuery };

    await answerGuestMessage(ctx, corpus, { dryRun: true });

    expect(answerGuestQuery).not.toHaveBeenCalled();
    expect(outWrite).toHaveBeenCalledWith(
      `main:\n- <a href="${SBER_URL}">sberbank/12</a>\n`
    );
  });
});
