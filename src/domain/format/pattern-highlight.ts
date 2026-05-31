import type {
  RecognitionProgress,
  RegexMatchResult,
  RegexPatternToken,
} from "./regex";

export type HighlightMode = "parts" | "groups";

export interface PatternHighlightPlan {
  /** Per-token: is this token inside the lit (matched / recognized) region? */
  lit: boolean[];
  /**
   * Per-token color group for "groups" mode: `0` = full-match (blue), `N` =
   * the capture group N this token belongs to *and* that actually captured.
   * Only meaningful where `lit[i]` is true.
   */
  colorGroups: number[];
}

/**
 * Resolve, per pattern token, whether it sits in the lit region and which
 * capture-group color it carries — the shared model behind both pattern-field
 * highlight modes (see ADR-0007). Lit region: the full pattern on a full match,
 * the recognized prefix (`prefixPatternEnd`) on a partial match, nothing
 * otherwise. A token is group-N coloured only when its innermost capturing
 * group actually captured; matched-but-ungrouped tokens fall back to blue.
 */
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
