import { afterEach, describe, expect, it, vi } from "vitest";
import { compileRegexes } from "@/domain/format";
import {
  answerGuestMessage,
  answerPrivateMessage,
  type GuestQueryContext,
  type PrivateMessageContext,
} from "./answer";
import type { CorpusFormat } from "./corpus";
import type { CompiledCorpus } from "./recognize";
import { DIRECT_USAGE_HINT, INITIALIZING_MESSAGE } from "./render";

const DEMO_SMS = "Pokupka 1000 RUB. Karta *1234. Dostupno 5000 RUB";
const SBER_URL =
  "https://github.com/zenmoney/sms-formats/blob/abc/src/sberbank/formats/12.txt";
const RECOGNIZED = `main:\n- <a href="${SBER_URL}">sberbank/12</a>`;

const formats: CorpusFormat[] = [
  {
    source: { kind: "main" },
    bank: "sberbank",
    formatId: "12",
    regex: "^Pokupka \\d+ RUB\\. Karta \\*\\d+\\. Dostupno \\d+ RUB$",
    fileUrl: SBER_URL,
  },
];

const corpus: CompiledCorpus = {
  formats,
  compiled: compileRegexes(formats.map((format) => format.regex)),
};

afterEach(() => {
  vi.restoreAllMocks();
});

// A reply to an SMS plus "@zenmoneysms_bot /sms" — the canonical guest call that
// triggers recognition (ADR-0006: recognition requires the /sms token).
const guestMessage = {
  text: "@zenmoneysms_bot /sms",
  entities: [{ type: "mention", offset: 0, length: 16 }],
  reply_to_message: { text: DEMO_SMS },
};

// The exact rejection Telegram raises once a guest query has expired. The
// pipeline swallows *any* throw, so the precise type doesn't matter — but
// mirroring the real error keeps the regression honest about what it guards.
class ExpiredQueryError extends Error {
  readonly error_code = 400;
  constructor() {
    super(
      "Call to 'answerGuestQuery' failed! (400: Bad Request: query is too old and response timeout expired or query ID is invalid)"
    );
  }
}

class TooManyRequestsError extends Error {
  readonly error_code = 429;
  constructor() {
    super("Call to 'sendMessage' failed! (429: Too Many Requests)");
  }
}

function guestMessageText(answerGuestQuery: ReturnType<typeof vi.fn>): string {
  const result = answerGuestQuery.mock.calls[0]?.[0] as {
    input_message_content: { message_text: string };
  };
  return result.input_message_content.message_text;
}

describe("answerGuestMessage", () => {
  it("answers the recognized format via answerGuestQuery on the happy path", async () => {
    const answerGuestQuery = vi.fn().mockResolvedValue({});
    const ctx: GuestQueryContext = { guestMessage, answerGuestQuery };

    await answerGuestMessage(ctx, corpus, { dryRun: false });

    expect(answerGuestQuery).toHaveBeenCalledOnce();
    expect(guestMessageText(answerGuestQuery)).toBe(RECOGNIZED);
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

    expect(guestMessageText(answerGuestQuery)).toBe(RECOGNIZED);
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

  it("ignores a context with no guest message", async () => {
    const answerGuestQuery = vi.fn().mockResolvedValue({});
    const ctx: GuestQueryContext = { answerGuestQuery };

    await answerGuestMessage(ctx, corpus, { dryRun: false });

    expect(answerGuestQuery).not.toHaveBeenCalled();
  });

  it("answers the initializing stub when the corpus is not ready yet", async () => {
    const answerGuestQuery = vi.fn().mockResolvedValue({});
    const ctx: GuestQueryContext = { guestMessage, answerGuestQuery };

    await answerGuestMessage(ctx, null, { dryRun: false });

    expect(guestMessageText(answerGuestQuery)).toBe(INITIALIZING_MESSAGE);
  });

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

  it("prints the reply instead of sending it in dry-run", async () => {
    const answerGuestQuery = vi.fn().mockResolvedValue({});
    const outWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const ctx: GuestQueryContext = { guestMessage, answerGuestQuery };

    await answerGuestMessage(ctx, corpus, { dryRun: true });

    expect(answerGuestQuery).not.toHaveBeenCalled();
    expect(outWrite).toHaveBeenCalledWith(`${RECOGNIZED}\n`);
  });
});

describe("answerPrivateMessage", () => {
  it("recognizes the whole message text and replies with the formats", async () => {
    const reply = vi.fn().mockResolvedValue({});
    const ctx: PrivateMessageContext = { message: { text: DEMO_SMS }, reply };

    await answerPrivateMessage(ctx, corpus, { dryRun: false });

    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]?.[0]).toBe(RECOGNIZED);
    expect(reply.mock.calls[0]?.[1]).toEqual({
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  it("strips a leading /sms and recognizes the payload", async () => {
    const reply = vi.fn().mockResolvedValue({});
    const ctx: PrivateMessageContext = {
      message: { text: `/sms ${DEMO_SMS}` },
      reply,
    };

    await answerPrivateMessage(ctx, corpus, { dryRun: false });

    expect(reply.mock.calls[0]?.[0]).toBe(RECOGNIZED);
  });

  it("answers the direct usage hint for /start", async () => {
    const reply = vi.fn().mockResolvedValue({});
    const ctx: PrivateMessageContext = { message: { text: "/start" }, reply };

    await answerPrivateMessage(ctx, corpus, { dryRun: false });

    expect(reply.mock.calls[0]?.[0]).toBe(DIRECT_USAGE_HINT);
  });

  it("answers the direct usage hint for an empty /sms", async () => {
    const reply = vi.fn().mockResolvedValue({});
    const ctx: PrivateMessageContext = { message: { text: "/sms" }, reply };

    await answerPrivateMessage(ctx, corpus, { dryRun: false });

    expect(reply.mock.calls[0]?.[0]).toBe(DIRECT_USAGE_HINT);
  });

  it("answers the direct usage hint for a textless message", async () => {
    const reply = vi.fn().mockResolvedValue({});
    const ctx: PrivateMessageContext = { message: {}, reply };

    await answerPrivateMessage(ctx, corpus, { dryRun: false });

    expect(reply.mock.calls[0]?.[0]).toBe(DIRECT_USAGE_HINT);
  });

  it("answers the initializing stub when the corpus is not ready yet", async () => {
    const reply = vi.fn().mockResolvedValue({});
    const ctx: PrivateMessageContext = { message: { text: DEMO_SMS }, reply };

    await answerPrivateMessage(ctx, null, { dryRun: false });

    expect(reply.mock.calls[0]?.[0]).toBe(INITIALIZING_MESSAGE);
  });

  it("does not rethrow when reply rejects, so the webhook can still ack 200", async () => {
    const reply = vi.fn().mockRejectedValue(new TooManyRequestsError());
    const errWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const ctx: PrivateMessageContext = { message: { text: DEMO_SMS }, reply };

    await expect(
      answerPrivateMessage(ctx, corpus, { dryRun: false })
    ).resolves.toBeUndefined();

    expect(reply).toHaveBeenCalledOnce();
    expect(errWrite).toHaveBeenCalledWith(
      expect.stringContaining("reply failed")
    );
  });

  it("prints the reply instead of sending it in dry-run", async () => {
    const reply = vi.fn().mockResolvedValue({});
    const outWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const ctx: PrivateMessageContext = { message: { text: DEMO_SMS }, reply };

    await answerPrivateMessage(ctx, corpus, { dryRun: true });

    expect(reply).not.toHaveBeenCalled();
    expect(outWrite).toHaveBeenCalledWith(`${RECOGNIZED}\n`);
  });
});
