import type { DirectIntent, Intent } from "./extract-sms";
import { type CompiledCorpus, recognize } from "./recognize";
import { renderResponse } from "./render";

/**
 * Resolve an extracted `Intent` plus the corpus into the bot's reply text. The
 * union fully encodes the outcome, so this is mode-agnostic: `silent → null`,
 * `hint → text`, `sms → renderResponse(recognize(...))`. Only the guest adapter
 * sees `null`; direct extraction never produces `silent`, so the overload lets
 * the direct adapter treat the result as a plain string.
 */
export function respond(intent: DirectIntent, corpus: CompiledCorpus): string;
export function respond(intent: Intent, corpus: CompiledCorpus): string | null;
export function respond(intent: Intent, corpus: CompiledCorpus): string | null {
  if (intent.kind === "silent") {
    return null;
  }
  if (intent.kind === "hint") {
    return intent.text;
  }
  return renderResponse(recognize(intent.sms, corpus), corpus.formats);
}
