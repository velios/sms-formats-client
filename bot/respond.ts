import type { CorpusFormat } from "./corpus";
import { extractSms, type IncomingMessage } from "./extract-sms";
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
