import { cleanText } from "./regex";

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
}

function compileRegex(pattern: string): RegExp | null {
  if (!pattern.trim()) {
    return null;
  }

  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

function countMatchedExamples(regex: RegExp, examples: string[]): number {
  let matchedExamples = 0;

  for (const example of examples) {
    if (regex.test(cleanText(example))) {
      matchedExamples += 1;
    }
  }

  return matchedExamples;
}

export function calculateFormatIntersectionStats(
  formats: FormatIntersectionInput[]
): Map<string, FormatIntersectionStat> {
  const compiledRegexByPath = new Map(
    formats.map((format) => [format.filePath, compileRegex(format.regex)])
  );

  return new Map(
    formats.map((format) => {
      const compiledRegex = compiledRegexByPath.get(format.filePath) ?? null;
      let ownMatchedExamples = 0;
      let intersectingOtherFormats = 0;

      if (compiledRegex) {
        ownMatchedExamples = countMatchedExamples(
          compiledRegex,
          format.examples
        );

        for (const otherFormat of formats) {
          if (otherFormat.filePath === format.filePath) {
            continue;
          }

          if (
            otherFormat.examples.some((example) =>
              compiledRegex.test(cleanText(example))
            )
          ) {
            intersectingOtherFormats += 1;
          }
        }
      }

      return [
        format.filePath,
        {
          filePath: format.filePath,
          totalExamples: format.examples.length,
          ownMatchedExamples,
          intersectingOtherFormats,
        },
      ];
    })
  );
}
