import { smsesByRegex } from "./recognition";

export interface FormatIntersectionInput {
  filePath: string;
  regex: string;
  examples: string[];
}

export interface FormatIntersectionStat {
  filePath: string;
  totalExamples: number;
  ownMatchedExamples: number;
  intersectingOtherFormats: number;
  intersectingFormatPaths: string[];
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
      otherMatched.matched.forEach((isMatch, i) => {
        if (isMatch) {
          intersectingFormatIndexes.add(otherExamples[i]!.otherIndex);
        }
      });
      const intersectingFormatPaths = Array.from(intersectingFormatIndexes)
        .sort((a, b) => a - b)
        .map((index) => formats[index]!.filePath);

      return [
        format.filePath,
        {
          filePath: format.filePath,
          totalExamples: format.examples.length,
          ownMatchedExamples: ownMatched.matched.filter(Boolean).length,
          intersectingOtherFormats: intersectingFormatIndexes.size,
          intersectingFormatPaths,
        },
      ];
    })
  );
}
