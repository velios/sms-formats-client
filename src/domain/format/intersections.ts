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
