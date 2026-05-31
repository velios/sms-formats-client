import type { InlineQueryResult } from "grammy/types";
import { extractSms, type MessageEntityLike } from "./extract-sms";
import { type CompiledCorpus, EMPTY_CORPUS } from "./recognize";
import { respond } from "./respond";

/**
 * The slice of a grammY `guest_message` context this handler depends on. Kept
 * minimal so the handler is unit-testable without constructing a real Bot — the
 * full `Context` is structurally assignable to it.
 */
export interface GuestQueryContext {
  guestMessage?: {
    text?: string;
    entities?: MessageEntityLike[];
    reply_to_message?: { text?: string };
    quote?: { text?: string };
  };
  answerGuestQuery(result: InlineQueryResult): Promise<unknown>;
}

/**
 * Cold start: no snapshot exists yet (the first clone/build hasn't finished, see
 * ADR-0004). We answer with this rather than stay silent or error, so the user
 * knows to retry in a moment instead of assuming the bot is dead.
 */
export const INITIALIZING_MESSAGE =
  "Бот запускается и собирает корпус форматов — попробуйте через несколько секунд.";

/**
 * Answer one guest query, recognizing the SMS against the corpus. A `null`
 * corpus means the snapshot isn't ready yet (cold start) — we answer the
 * initializing stub instead of recognizing. In dry-run the reply is printed
 * instead of sent.
 *
 * `answerGuestQuery` is wrapped because a guest query expires within seconds:
 * once it's too old (or its id is invalid) Telegram rejects the answer with a
 * 400 and will never accept it on retry. Letting that throw makes
 * `webhookCallback` return HTTP 500, on which Telegram keeps the offset and
 * re-sends the same dead update forever — head-of-line poisoning that blocks
 * every newer, answerable message behind it. One lost answer is acceptable
 * degradation; a stuck queue is not. So we log and let the handler return
 * normally, letting the webhook ack with 200. (Same isolate-one-failure
 * principle as the per-PR corpus guard in d5e621a.)
 */
export async function answerGuestMessage(
  ctx: GuestQueryContext,
  corpus: CompiledCorpus | null,
  options: { dryRun: boolean }
): Promise<void> {
  const message = ctx.guestMessage;
  if (!message) {
    return;
  }

  const intent = extractSms({
    text: message.text,
    entities: message.entities,
    replyToText: message.reply_to_message?.text,
    quoteText: message.quote?.text,
  });

  // Cold start only blocks recognition — a hint needs no corpus, and silence is
  // resolved below regardless of readiness.
  const body =
    corpus === null && intent.kind === "sms"
      ? INITIALIZING_MESSAGE
      : respond(intent, corpus ?? EMPTY_CORPUS);

  if (body === null) {
    // Deliberate silence (ADR-0006): no /sms, so we skip answerGuestQuery and
    // let the handler return. Unlike a *failed* send, an intentional non-answer
    // still acks the webhook 200, so the queue can't head-of-line-poison.
    return;
  }

  if (options.dryRun) {
    process.stdout.write(`${body}\n`);
    return;
  }

  try {
    await ctx.answerGuestQuery({
      type: "article",
      id: "recognition",
      title: "Распознанные форматы",
      input_message_content: {
        message_text: body,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      },
    });
  } catch (error) {
    process.stderr.write(`answerGuestQuery failed for one update: ${error}\n`);
  }
}
