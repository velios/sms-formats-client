import { type Api, type Context, GrammyError, InputFile } from "grammy";
import type { DeliveryFailure } from "./answer";

function describeError(error: unknown): unknown {
  if (error instanceof GrammyError) {
    return {
      name: error.name,
      errorCode: error.error_code,
      description: error.description,
      method: error.method,
      parameters: error.parameters,
    };
  }
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
}

export async function notifyAdmin(
  api: Pick<Api, "sendMessage" | "sendDocument">,
  chatId: string,
  ctx: Pick<Context, "update" | "chat" | "msg" | "from">,
  failure: DeliveryFailure,
  mainSha: string | undefined
): Promise<void> {
  const report = JSON.stringify(
    {
      ...failure,
      error: describeError(failure.error),
      retryError:
        failure.retryError === undefined
          ? undefined
          : describeError(failure.retryError),
      updateId: ctx.update.update_id,
      chatId: ctx.chat?.id,
      chatType: ctx.chat?.type,
      messageId: ctx.msg?.message_id,
      messageDate: ctx.msg?.date,
      repliedToMessageId: ctx.msg?.reply_to_message?.message_id,
      userId: ctx.from?.id,
      mainSha,
      host: process.env.HOSTNAME,
    },
    null,
    2
  );
  const text = `Ошибка SMS-бота\n${report}`;
  if (text.length <= 4096) {
    await api.sendMessage(chatId, text, {
      link_preview_options: { is_disabled: true },
    });
  } else {
    await api.sendDocument(
      chatId,
      new InputFile(Buffer.from(report), `sms-bot-incident-${failure.id}.json`),
      {
        caption: `Ошибка SMS-бота. Инцидент ${failure.id}. Полный отчёт со SMS и ошибкой — в файле.`,
      }
    );
  }
}
