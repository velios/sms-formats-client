import { type CompiledRegex, recognizeWithCompiled } from "@/domain/format";
import type { CorpusFormat, Source } from "./corpus";

export interface RecognizedFormat {
  source: Source;
  bank: string;
  formatId: string;
  fileUrl: string;
}

export interface CompiledCorpus {
  formats: CorpusFormat[];
  compiled: CompiledRegex[];
}

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
