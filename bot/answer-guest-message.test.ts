import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerGuestMessage,
  type GuestQueryContext,
  INITIALIZING_MESSAGE,
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

// A reply to an SMS plus "@zenmoneysms_bot /sms" — the canonical guest call
// that triggers recognition (ADR-0006: recognition requires the /sms token).
const guestMessage = {
  text: "@zenmoneysms_bot /sms",
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

  it("answers the initializing stub when the corpus is not ready yet", async () => {
    const answerGuestQuery = vi.fn().mockResolvedValue({});
    const ctx: GuestQueryContext = { guestMessage, answerGuestQuery };

    await answerGuestMessage(ctx, null, { dryRun: false });

    const result = answerGuestQuery.mock.calls[0]?.[0] as {
      input_message_content: { message_text: string };
    };
    expect(result.input_message_content.message_text).toBe(
      INITIALIZING_MESSAGE
    );
  });

  it("stays silent (no answerGuestQuery) when the call carries no /sms", async () => {
    const answerGuestQuery = vi.fn().mockResolvedValue({});
    const ctx: GuestQueryContext = {
      // A mention + reply but no /sms token: someone talking about the bot, not
      // summoning it. The handler must return without answering so the webhook
      // still acks 200 (no head-of-line poisoning).
      guestMessage: {
        text: "@zenmoneysms_bot",
        entities: [{ type: "mention", offset: 0, length: 16 }],
        reply_to_message: { text: DEMO_SMS },
      },
      answerGuestQuery,
    };

    await answerGuestMessage(ctx, corpus, { dryRun: false });

    expect(answerGuestQuery).not.toHaveBeenCalled();
  });

  it("prefers the quoted fragment of the replied-to message", async () => {
    const answerGuestQuery = vi.fn().mockResolvedValue({});
    const ctx: GuestQueryContext = {
      guestMessage: {
        text: "@zenmoneysms_bot /sms",
        entities: [{ type: "mention", offset: 0, length: 16 }],
        reply_to_message: { text: `шум перед: ${DEMO_SMS}` },
        quote: { text: DEMO_SMS },
      },
      answerGuestQuery,
    };

    await answerGuestMessage(ctx, corpus, { dryRun: false });

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
