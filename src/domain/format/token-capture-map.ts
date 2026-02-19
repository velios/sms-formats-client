import type { RegexMatchResult, RegexPatternToken } from "./regex";

/**
 * Build a mapping from each pattern token index to the innermost
 * capture group index it belongs to (1-based), or null if the token
 * is outside any capturing group.
 *
 * Uses a stack-based approach: opening `(` tokens push a group,
 * closing `)` tokens pop. Non-capturing group openers (`(?:`, `(?=`,
 * `(?!`, `(?<=`, `(?<!`, `(?<name>`) are tracked but excluded from
 * the capture index sequence.
 */
export function buildTokenToCaptureGroupMap(
  tokens: RegexPatternToken[]
): Array<number | null> {
  const result: Array<number | null> = [];
  const groupStack: Array<number | null> = [];
  let captureIndex = 0;

  for (const token of tokens) {
    if (token.type === "group" && token.raw.startsWith("(")) {
      const isCapturing = token.raw === "(" || token.raw.startsWith("(?<");
      const isNamedCapturing =
        token.raw.startsWith("(?<") && !token.raw.startsWith("(?<=");
      if (isCapturing || isNamedCapturing) {
        captureIndex++;
        groupStack.push(captureIndex);
        result.push(captureIndex);
      } else {
        groupStack.push(null);
        result.push(innermostCapture(groupStack));
      }
    } else if (token.type === "group" && token.raw === ")") {
      // Pop the group from the stack before resolving this token's group
      const popped = groupStack.pop() ?? null;
      // The closing paren belongs to the group it closes
      result.push(popped);
    } else {
      result.push(innermostCapture(groupStack));
    }
  }

  return result;
}

function innermostCapture(stack: Array<number | null>): number | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const value = stack[i];
    if (value != null) {
      return value;
    }
  }
  return null;
}

/**
 * Resolve a clicked token index to the capture group it belongs to.
 * Returns the 1-based group index, or null if the token is not inside
 * any capturing group.
 */
export function resolveTokenCaptureGroup(
  tokens: RegexPatternToken[],
  tokenIndex: number
): number | null {
  if (tokenIndex < 0 || tokenIndex >= tokens.length) {
    return null;
  }
  const map = buildTokenToCaptureGroupMap(tokens);
  return map[tokenIndex] ?? null;
}

/**
 * Resolve the match-text range that a token maps to.
 *
 * - If the token is inside a capturing group → return that group's captured range.
 * - If the token is outside all capturing groups (a "gap") → return the text
 *   range between the nearest surrounding groups (or match boundary).
 * - Returns null if no match, or the resolved range is empty.
 */
export function resolveTokenMatchRange(
  tokenIndex: number,
  captureGroupMap: Array<number | null>,
  matchResult: RegexMatchResult
): { start: number; end: number } | null {
  if (tokenIndex < 0 || tokenIndex >= captureGroupMap.length) {
    return null;
  }
  if (
    !matchResult.matched ||
    matchResult.matchStart == null ||
    matchResult.matchEnd == null
  ) {
    return null;
  }

  const groupIndex = captureGroupMap[tokenIndex];

  // Token is inside a capture group → return that group's match range
  if (groupIndex != null) {
    const group = matchResult.groups.find((g) => g.index === groupIndex);
    if (group && group.start < group.end) {
      return { start: group.start, end: group.end };
    }
    // Group didn't capture anything (e.g. optional group)
    return null;
  }

  // Token is outside any capture group → compute gap range
  return resolveGapRange(tokenIndex, captureGroupMap, matchResult);
}

function resolveGapRange(
  tokenIndex: number,
  captureGroupMap: Array<number | null>,
  matchResult: RegexMatchResult
): { start: number; end: number } | null {
  const matchStart = matchResult.matchStart ?? 0;
  const matchEnd = matchResult.matchEnd ?? 0;

  // Scan backwards to find the nearest preceding capture group
  let prevGroupIndex: number | null = null;
  for (let i = tokenIndex - 1; i >= 0; i--) {
    const g = captureGroupMap[i];
    if (g != null) {
      prevGroupIndex = g;
      break;
    }
  }

  // Scan forwards to find the nearest following capture group
  let nextGroupIndex: number | null = null;
  for (let i = tokenIndex + 1; i < captureGroupMap.length; i++) {
    const g = captureGroupMap[i];
    if (g != null) {
      nextGroupIndex = g;
      break;
    }
  }

  const gapStart =
    prevGroupIndex != null
      ? (matchResult.groups.find((g) => g.index === prevGroupIndex)?.end ??
        matchStart)
      : matchStart;

  const gapEnd =
    nextGroupIndex != null
      ? (matchResult.groups.find((g) => g.index === nextGroupIndex)?.start ??
        matchEnd)
      : matchEnd;

  if (gapStart < gapEnd) {
    return { start: gapStart, end: gapEnd };
  }
  return null;
}
