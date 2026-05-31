import type { DirectIntent, Intent } from "./extract-sms";
import { type CompiledCorpus, recognize } from "./recognize";
import { INITIALIZING_MESSAGE, renderResponse } from "./render";

/**
 * Resolve an extracted `Intent` plus the corpus state into the bot's reply text
 * — the single place that maps intent + corpus-readiness to text, so it stays
 * mode-agnostic: `silent → null`, `hint → text`, `sms` over a ready corpus →
 * rendered formats, `sms` before the first snapshot exists → the cold-start stub
 * (ADR-0004). A `null` corpus means no snapshot yet; only an `sms` intent needs
 * one, so a hint still answers during cold start.
 *
 * Only the guest adapter sees `null` (deliberate silence); direct extraction
 * never produces `silent`, so the overload lets the direct adapter treat the
 * result as a plain string.
 */
export function respond(
  intent: DirectIntent,
  corpus: CompiledCorpus | null
): string;
export function respond(
  intent: Intent,
  corpus: CompiledCorpus | null
): string | null;
export function respond(
  intent: Intent,
  corpus: CompiledCorpus | null
): string | null {
  if (intent.kind === "silent") {
    return null;
  }
  if (intent.kind === "hint") {
    return intent.text;
  }
  if (corpus === null) {
    return INITIALIZING_MESSAGE;
  }
  return renderResponse(recognize(intent.sms, corpus), corpus.formats);
}
