import type { DirectIntent, Intent } from "./extract-sms";
import { type CompiledCorpus, recognize } from "./recognize";
import { INITIALIZING_MESSAGE, renderResponse } from "./render";

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
