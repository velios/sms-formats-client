import { regexesBySms } from "@/domain/format";
import type { CorpusFormat, Source } from "./corpus";

export interface RecognizedFormat {
  source: Source;
  bank: string;
  formatId: string;
  /** Permalink to the recognized format's file, carried from the corpus. */
  fileUrl: string;
}

/**
 * Which corpus formats recognize this SMS. Matching runs through the shared
 * recognition core (`@/domain/format`), so it stays byte-for-byte identical to
 * the editor and the device. Invalid regexes resolve to `matched: false` and
 * are silently skipped — no special handling here.
 */
export function recognize(
  sms: string,
  corpus: CorpusFormat[]
): RecognizedFormat[] {
  const results = regexesBySms(
    corpus.map((format) => format.regex),
    sms
  );
  const recognized: RecognizedFormat[] = [];
  corpus.forEach((format, index) => {
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
