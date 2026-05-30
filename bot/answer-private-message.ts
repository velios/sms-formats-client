import { INITIALIZING_MESSAGE } from "./answer-guest-message";
import type { CorpusFormat } from "./corpus";
import { extractDirectSms } from "./extract-sms";
import { respond } from "./respond";

/**
 * The slice of a grammY message context this handler depends on. Kept minimal
 * so the handler is unit-testable without constructing a real Bot — the full
 * `Context` is structurally assignable to it. The private-chat filter lives in
 * the server wiring, so by the time we get here the message is already a DM.
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
 * Answer one direct (private-chat) message, recognizing the whole text as the
 * SMS against the corpus. A `null` corpus means the snapshot isn't ready yet
 * (cold start) — we answer the initializing stub instead of recognizing. In
 * dry-run the reply is printed instead of sent.
 *
 * The `reply` is wrapped for the same reason `answerGuestQuery` is in
 * answer-guest-message.ts: a throw makes `webhookCallback` return HTTP 500, on
 * which Telegram keeps the offset and re-sends the same update forever —
 * head-of-line poisoning that blocks every newer message behind it. One lost
 * reply is acceptable degradation; a stuck queue is not. So we log and return
 * normally, letting the webhook ack 200. We never log the raw SMS.
 */
export async function answerPrivateMessage(
  ctx: PrivateMessageContext,
  corpus: CorpusFormat[] | null,
  options: { dryRun: boolean }
): Promise<void> {
  const intent = extractDirectSms(ctx.message?.text);
  // Direct never goes silent, so `respond` always returns a string here; cold
  // start only blocks recognition, not a hint.
  const body =
    corpus === null && intent.kind === "sms"
      ? INITIALIZING_MESSAGE
      : respond(intent, corpus ?? []);

  if (options.dryRun) {
    process.stdout.write(`${body}\n`);
    return;
  }

  try {
    await ctx.reply(body, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    process.stderr.write(`reply failed for one update: ${error}\n`);
  }
}
