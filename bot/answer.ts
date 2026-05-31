/**
 * Recognition Bot reply pipeline (ADR-0006). One orchestrator delivers every
 * reply. Guest/direct difference lives in two extractors + two `Send` adapters
 * behind seam. `answer` mode-agnostic: resolve text via `respond`, deliver it,
 * knows nothing about source chat.
 */

import type { InlineQueryResult } from "grammy/types";
import {
  extractDirectSms,
  extractSms,
  type Intent,
  type MessageEntityLike,
} from "./extract-sms";
import type { CompiledCorpus } from "./recognize";
import { respond } from "./respond";

/**
 * Slice of grammY `guest_message` context handler needs. Minimal -> unit-testable
 * without real Bot. Full `Context` structurally assignable.
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
 * Slice of grammY message context direct handler needs. Private-chat filter
 * lives in server wiring -> message already DM here.
 */
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

/**
 * How resolved reply reaches Telegram. Adapter knows *how* to deliver + carries
 * op `label` -> one swallow in `answer` names failed path, no per-adapter
 * try/catch dup.
 */
interface Send {
  label: string;
  deliver(body: string): Promise<unknown>;
}

/**
 * Resolve reply text, deliver it. Whole "never return 500" invariant lives here
 * once. Guest query expires in seconds, `reply` can hit rate limit. Throw ->
 * `webhookCallback` returns HTTP 500 -> Telegram keeps offset, re-sends same dead
 * update forever -> head-of-line poisoning blocks every newer message behind it.
 * One lost reply = OK degradation; stuck queue = not. So log + return normal ->
 * webhook acks 200. Deliberate silence (`respond → null`, guest no `/sms`) same
 * out: no send, still 200. Never log raw SMS. Dry-run -> print, not send.
 */
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
    process.stderr.write(`${send.label} failed for one update: ${error}\n`);
  }
}

/**
 * Answer one guest query, recognize SMS against corpus. Guest recognition needs
 * leading `/sms`; without it intent silent, no answer sent (ADR-0006). `null`
 * corpus = snapshot not ready (cold start) -> `respond` returns init stub.
 */
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

/**
 * Answer one direct (private-chat) message, recognize whole text as SMS against
 * corpus. Direct never silent — bare text always SMS; empty `/sms` or service
 * command gets usage hint (ADR-0006). `null` corpus -> cold-start stub via
 * `respond`.
 */
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
