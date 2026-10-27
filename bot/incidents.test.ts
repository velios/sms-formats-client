import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Api, GrammyError, InputFile } from "grammy";
import type { Chat, Message } from "grammy/types";
import type { DeliveryFailure } from "./answer";
import { notifyAdmin } from "./incidents";

const chat: Chat.PrivateChat = {
  id: 42,
  type: "private",
  first_name: "Tester",
};
const message: Message.TextMessage = {
  message_id: 10,
  date: 1_700_000_000,
  chat,
  text: "@zenmoneysms_bot /sms",
  reply_to_message: {
    message_id: 9,
    date: 1_699_999_999,
    chat,
    text: "SMS",
    reply_to_message: undefined,
  },
};
const context = {
  update: { update_id: 101 },
  chat,
  msg: message,
  from: { id: 7, is_bot: false, first_name: "Tester" },
};
const failure: DeliveryFailure = {
  id: "incident-1",
  occurredAt: "2026-10-27T08:51:01.000Z",
  method: "answerGuestQuery",
  intent: "sms",
  sms: " \r\n尾号5787卡 <b>&\r\n ",
  error: new GrammyError(
    "Telegram rejected response",
    {
      ok: false,
      error_code: 400,
      description: "Bad Request: ENTITIES_TOO_LONG",
    },
    "answerGuestQuery",
    { sensitivePayload: "must not be included" }
  ),
  retry: "sent",
  responseBytes: 13_263,
  shortenedResponseBytes: 6219,
  corpusSize: 6297,
};

afterEach(() => mock.restore());

describe("notifyAdmin", () => {
  it("sends a plain-text report to the configured chat with exact SMS and actionable metadata", async () => {
    const api = new Api("123456:local-test");
    const sendMessage = spyOn(api, "sendMessage").mockResolvedValue(message);
    const sendDocument = spyOn(api, "sendDocument");

    await notifyAdmin(api, "-10042", context, failure, "corpus-sha");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [destination, text, options] = sendMessage.mock.calls[0]!;
    expect(destination).toBe("-10042");
    expect(options?.parse_mode).toBeUndefined();
    expect(JSON.parse(text.slice("Ошибка SMS-бота\n".length))).toMatchObject({
      id: "incident-1",
      occurredAt: failure.occurredAt,
      sms: failure.sms,
      error: {
        errorCode: 400,
        description: "Bad Request: ENTITIES_TOO_LONG",
        method: "answerGuestQuery",
      },
      retry: "sent",
      responseBytes: 13_263,
      shortenedResponseBytes: 6219,
      corpusSize: 6297,
      mainSha: "corpus-sha",
      updateId: 101,
      chatId: 42,
      chatType: "private",
      messageId: 10,
      messageDate: 1_700_000_000,
      repliedToMessageId: 9,
      userId: 7,
    });
    expect(text).not.toContain("sensitivePayload");
    expect(sendDocument).not.toHaveBeenCalled();
  });

  it("includes the second failure and Telegram retry parameters", async () => {
    const api = new Api("123456:local-test");
    const sendMessage = spyOn(api, "sendMessage").mockResolvedValue(message);
    const retryError = new GrammyError(
      "Rate limited",
      {
        ok: false,
        error_code: 429,
        description: "Too Many Requests",
        parameters: { retry_after: 20 },
      },
      "answerGuestQuery",
      {}
    );

    await notifyAdmin(
      api,
      "-10042",
      context,
      { ...failure, retry: "failed", retryError },
      undefined
    );

    expect(sendMessage.mock.calls[0]?.[1]).toContain('"retry_after": 20');
    expect(sendMessage.mock.calls[0]?.[1]).toContain('"retry": "failed"');
    expect(sendMessage.mock.calls[0]?.[1]).toContain('"errorCode": 429');
  });

  it("sends a full JSON attachment when the SMS makes the report too long", async () => {
    let upload: FormData | undefined;
    const api = new Api("123456:local-test", {
      fetch: (async (input, init) => {
        const request = new Request(input, init);
        expect(new URL(request.url).pathname).toEndWith("/sendDocument");
        upload = await request.formData();
        return Response.json({
          ok: true,
          result: {
            ...message,
            document: { file_id: "report", file_unique_id: "report" },
          },
        });
      }) as typeof fetch,
    });
    const sendMessage = spyOn(api, "sendMessage");
    const sendDocument = spyOn(api, "sendDocument");
    const sms = "尾号😀\r\n".repeat(1000);

    await notifyAdmin(
      api,
      "-10042",
      context,
      { ...failure, sms },
      "corpus-sha"
    );

    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendDocument).toHaveBeenCalledTimes(1);
    const [destination, document, options] = sendDocument.mock.calls[0]!;
    expect(destination).toBe("-10042");
    expect(document).toBeInstanceOf(InputFile);
    expect(options?.caption).toContain("incident-1");
    expect(upload?.get("chat_id")).toBe("-10042");
    const files: File[] = [];
    upload!.forEach((part) => {
      if (part instanceof File) {
        files.push(part);
      }
    });
    const file = files[0]!;
    expect(file.name).toBe("sms-bot-incident-incident-1.json");
    expect(JSON.parse(await file.text())).toMatchObject({
      sms,
      id: "incident-1",
    });
  });
});
