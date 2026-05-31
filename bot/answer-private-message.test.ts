import { afterEach, describe, expect, it, vi } from "vitest";
import { compileRegexes } from "@/domain/format";
import { INITIALIZING_MESSAGE } from "./answer-guest-message";
import {
  answerPrivateMessage,
  type PrivateMessageContext,
} from "./answer-private-message";
import type { CorpusFormat } from "./corpus";
import type { CompiledCorpus } from "./recognize";
import { DIRECT_USAGE_HINT } from "./render";

const DEMO_SMS = "Pokupka 1000 RUB. Karta *1234. Dostupno 5000 RUB";
const SBER_URL =
  "https://github.com/zenmoney/sms-formats/blob/abc/src/sberbank/formats/12.txt";

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

class TooManyRequestsError extends Error {
  readonly error_code = 429;
  constructor() {
    super("Call to 'sendMessage' failed! (429: Too Many Requests)");
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("answerPrivateMessage", () => {
  it("recognizes the whole message text and replies with the formats", async () => {
    const reply = vi.fn().mockResolvedValue({});
    const ctx: PrivateMessageContext = { message: { text: DEMO_SMS }, reply };

    await answerPrivateMessage(ctx, corpus, { dryRun: false });

    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]?.[0]).toBe(
      `main:\n- <a href="${SBER_URL}">sberbank/12</a>`
    );
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

    expect(reply.mock.calls[0]?.[0]).toBe(
      `main:\n- <a href="${SBER_URL}">sberbank/12</a>`
    );
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
    expect(outWrite).toHaveBeenCalledWith(
      `main:\n- <a href="${SBER_URL}">sberbank/12</a>\n`
    );
  });
});
