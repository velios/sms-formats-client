import { GrammyError } from "grammy";
import type { InlineQueryResult } from "grammy/types";
import {
  extractDirectSms,
  extractSms,
  type Intent,
  type MessageEntityLike,
} from "./extract-sms";
import type { CompiledCorpus } from "./recognize";
import { respond } from "./respond";

export interface GuestQueryContext {
  guestMessage?: {
    text?: string;
    entities?: MessageEntityLike[];
    reply_to_message?: { text?: string };
    quote?: { text?: string };
  };
  answerGuestQuery(result: InlineQueryResult): Promise<unknown>;
}

export interface PrivateMessageContext {
  message?: { text?: string };
  reply(
    text: string,
    other?: {
      parse_mode?: "HTML";
      link_preview_options?: { is_disabled?: boolean };
    }
  ): Promise<unknown>;
}

interface Send {
  label: string;
  deliver(body: string): Promise<unknown>;
}

export interface DeliveryFailure {
  id: string;
  occurredAt: string;
  method: string;
  intent: Intent["kind"];
  sms?: string;
  error: unknown;
  retry: "not-attempted" | "sent" | "failed";
  retryError?: unknown;
  responseBytes: number;
  shortenedResponseBytes?: number;
  corpusSize: number;
}

interface AnswerOptions {
  dryRun: boolean;
  onDeliveryError?: (failure: DeliveryFailure) => Promise<unknown>;
}

async function answer(
  intent: Intent,
  corpus: CompiledCorpus | null,
  send: Send,
  options: AnswerOptions
): Promise<void> {
  const body = respond(intent, corpus);
  if (body === null) {
    return;
  }
  if (options.dryRun) {
    process.stdout.write(`${body}\n`);
    return;
  }
  try {
    await send.deliver(body);
  } catch (error) {
    // Acknowledge the webhook to avoid duplicate replies.
    const failure: DeliveryFailure = {
      id: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      method: send.label,
      intent: intent.kind,
      sms: intent.kind === "sms" ? intent.sms : undefined,
      error,
      retry: "not-attempted",
      responseBytes: Buffer.byteLength(body),
      corpusSize: corpus?.formats.length ?? 0,
    };
    process.stderr.write(
      `${send.label} failed for one update [${failure.id}]: ${error}\n`
    );
    const shortened = body.replaceAll(/ \(<a href="[^"]*">zensms<\/a>\)/g, "");
    if (
      error instanceof GrammyError &&
      error.error_code === 400 &&
      error.description === "Bad Request: ENTITIES_TOO_LONG" &&
      shortened !== body
    ) {
      failure.shortenedResponseBytes = Buffer.byteLength(shortened);
      try {
        await send.deliver(shortened);
        failure.retry = "sent";
      } catch (retryError) {
        failure.retry = "failed";
        failure.retryError = retryError;
        process.stderr.write(
          `${send.label} shortened reply failed for one update [${failure.id}]: ${retryError}\n`
        );
      }
    }
    try {
      await options.onDeliveryError?.(failure);
    } catch (notificationError) {
      process.stderr.write(
        `Admin notification failed [${failure.id}]: ${notificationError}\n`
      );
    }
  }
}

export function answerGuestMessage(
  ctx: GuestQueryContext,
  corpus: CompiledCorpus | null,
  options: AnswerOptions
): Promise<void> {
  const message = ctx.guestMessage;
  if (!message) {
    return Promise.resolve();
  }
  const intent = extractSms({
    text: message.text,
    entities: message.entities,
    replyToText: message.reply_to_message?.text,
    quoteText: message.quote?.text,
  });
  return answer(
    intent,
    corpus,
    {
      label: "answerGuestQuery",
      deliver: (body) =>
        ctx.answerGuestQuery({
          type: "article",
          id: "recognition",
          title: "Распознанные форматы",
          input_message_content: {
            message_text: body,
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
          },
        }),
    },
    options
  );
}

export function answerPrivateMessage(
  ctx: PrivateMessageContext,
  corpus: CompiledCorpus | null,
  options: AnswerOptions
): Promise<void> {
  const intent = extractDirectSms(ctx.message?.text);
  return answer(
    intent,
    corpus,
    {
      label: "reply",
      deliver: (body) =>
        ctx.reply(body, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        }),
    },
    options
  );
}
