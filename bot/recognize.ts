import { type CompiledRegex, recognizeWithCompiled } from "@/domain/format";
import type { CorpusFormat, Source } from "./corpus";

export interface RecognizedFormat {
  source: Source;
  bank: string;
  formatId: string;
  /** Permalink to the recognized format's file, carried from the corpus. */
  fileUrl: string;
}

/**
 * A corpus paired with its regexes already compiled (aligned by index). The bot
 * compiles once per snapshot and matches every SMS against this, rather than
 * recompiling the whole corpus per message (ADR-0003).
 */
export interface CompiledCorpus {
  formats: CorpusFormat[];
  compiled: CompiledRegex[];
}

/** An unbuilt corpus stand-in, for paths that recognize before a snapshot exists. */
export const EMPTY_CORPUS: CompiledCorpus = { formats: [], compiled: [] };

/**
 * Which corpus formats recognize this SMS. Matching runs through the shared
 * recognition core (`@/domain/format`) over the precompiled regexes, so it
 * stays byte-for-byte identical to the editor and the device while reusing the
 * compiled `RegExp[]`. Invalid regexes resolve to `matched: false` and are
 * silently skipped — no special handling here.
 */
export function recognize(
  sms: string,
  corpus: CompiledCorpus
): RecognizedFormat[] {
  const results = recognizeWithCompiled(corpus.compiled, sms);
  const recognized: RecognizedFormat[] = [];
  corpus.formats.forEach((format, index) => {
    if (results[index]?.matched) {
      recognized.push({
        source: format.source,
        bank: format.bank,
        formatId: format.formatId,
        fileUrl: format.fileUrl,
      });
    }
  });
  return recognized;
}
