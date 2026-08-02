import { smsesByRegex } from "./recognition";

export interface FormatIntersectionInput {
  filePath: string;
  regex: string;
  examples: string[];
}

export interface IntersectingExample {
  filePath: string;
  example: string;
}

export interface FormatIntersectionStat {
  filePath: string;
  totalExamples: number;
  ownMatchedExamples: number;
  intersectingOtherFormats: number;
  intersectingFormatPaths: string[];
  // The texts behind the counters: which foreign example this regex recognized
  // and which own example it failed to. The counters answer "how many", these
  // answer "which one" — needed wherever the intersection has to be quoted
  // rather than tallied (the prompt package).
  intersectingExamples: IntersectingExample[];
  ownUnmatchedExamples: string[];
}

export function calculateFormatIntersectionStats(
  formats: FormatIntersectionInput[]
): Map<string, FormatIntersectionStat> {
  return new Map(
    formats.map((format) => {
      const ownMatched = smsesByRegex(format.examples, format.regex);

      const otherExamples = formats.flatMap((other, otherIndex) =>
        other.filePath === format.filePath
          ? []
          : other.examples.map((example) => ({ example, otherIndex }))
      );
      const otherMatched = smsesByRegex(
        otherExamples.map((entry) => entry.example),
        format.regex
      );
      const intersectingFormatIndexes = new Set<number>();
      const intersectingExamples: IntersectingExample[] = [];
      otherMatched.matched.forEach((isMatch, i) => {
        if (isMatch) {
          const entry = otherExamples[i]!;
          intersectingFormatIndexes.add(entry.otherIndex);
          intersectingExamples.push({
            filePath: formats[entry.otherIndex]!.filePath,
            example: entry.example,
          });
        }
      });
      const intersectingFormatPaths = Array.from(intersectingFormatIndexes)
        .sort((a, b) => a - b)
        .map((index) => formats[index]!.filePath);
      // An invalid or empty regex yields an empty `matched` array, so every own
      // example counts as unrecognized — same reading as the zero counter.
      const ownUnmatchedExamples = format.examples.filter(
        (_, i) => ownMatched.matched[i] !== true
      );

      return [
        format.filePath,
        {
          filePath: format.filePath,
          totalExamples: format.examples.length,
          ownMatchedExamples: ownMatched.matched.filter(Boolean).length,
          intersectingOtherFormats: intersectingFormatIndexes.size,
          intersectingFormatPaths,
          intersectingExamples,
          ownUnmatchedExamples,
        },
      ];
    })
  );
}
