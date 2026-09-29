import type { RegexPatternToken } from "./pattern-analysis";
import type { RecognitionProgress, RegexMatchResult } from "./regex";

export type HighlightMode = "parts" | "groups";

export interface PatternHighlightPlan {
  lit: boolean[];
  colorGroups: number[];
}

export function buildPatternHighlightPlan(
  tokens: RegexPatternToken[],
  tokenCaptureGroupMap: Array<number | null>,
  matchResult: RegexMatchResult,
  progress: RecognitionProgress | null
): PatternHighlightPlan {
  const litPatternEnd = matchResult.matched
    ? Number.POSITIVE_INFINITY
    : (progress?.prefixPatternEnd ?? 0);

  const sourceGroups = matchResult.matched
    ? matchResult.groups
    : (progress?.groups ?? []);
  const capturedGroupIndices = new Set(
    sourceGroups.filter((group) => group.end > group.start).map((g) => g.index)
  );

  const lit: boolean[] = [];
  const colorGroups: number[] = [];

  tokens.forEach((token, index) => {
    lit.push(token.end > token.start && token.end <= litPatternEnd);
    const groupIndex = tokenCaptureGroupMap[index] ?? null;
    colorGroups.push(
      groupIndex != null && capturedGroupIndices.has(groupIndex)
        ? groupIndex
        : 0
    );
  });

  return { lit, colorGroups };
}
