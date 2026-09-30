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

async function answer(
  intent: Intent,
  corpus: CompiledCorpus | null,
  send: Send,
  options: { dryRun: boolean }
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
    process.stderr.write(`${send.label} failed for one update: ${error}\n`);
  }
}

export function answerGuestMessage(
  ctx: GuestQueryContext,
  corpus: CompiledCorpus | null,
  options: { dryRun: boolean }
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
  options: { dryRun: boolean }
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
