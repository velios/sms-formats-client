import type { CorpusFormat } from "./corpus";
import {
  extractDirectSms,
  extractSms,
  type IncomingMessage,
} from "./extract-sms";
import { recognize } from "./recognize";
import { renderResponse, USAGE_HINT } from "./render";

/**
 * Full input→output pipeline as a pure function: a Telegram message plus the
 * corpus in, the bot's reply text out. Transport-agnostic so the whole contract
 * is testable without Telegram/grammY.
 */
export function respondToMessage(
  message: IncomingMessage,
  corpus: CorpusFormat[]
): string {
  const extracted = extractSms(message);
  if (extracted.kind === "empty") {
    return USAGE_HINT;
  }
  const recognized = recognize(extracted.sms, corpus);
  return renderResponse(recognized, corpus);
}

/**
 * Direct-invocation counterpart: the private-chat message text in, the bot's
 * reply out. Same recognition core and output contract as `respondToMessage`,
 * differing only in how the SMS is extracted (whole text verbatim).
 */
export function respondToDirectMessage(
  text: string | undefined,
  corpus: CorpusFormat[]
): string {
  const extracted = extractDirectSms(text);
  if (extracted.kind === "empty") {
    return USAGE_HINT;
  }
  const recognized = recognize(extracted.sms, corpus);
  return renderResponse(recognized, corpus);
}
