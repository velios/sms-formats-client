import type { RegexPatternToken } from "./pattern-analysis";
import type { RegexMatchResult } from "./regex";

function isGroupOpener(token: RegexPatternToken): boolean {
  return token.type === "group" && token.raw.startsWith("(");
}

function isCapturingGroupOpener(raw: string): boolean {
  if (raw === "(") {
    return true;
  }
  return raw.startsWith("(?<") && raw[3] !== "=" && raw[3] !== "!";
}

export function buildTokenToCaptureGroupMap(
  tokens: RegexPatternToken[]
): Array<number | null> {
  const result: Array<number | null> = [];
  const groupStack: Array<number | null> = [];
  let captureIndex = 0;

  for (const token of tokens) {
    if (isGroupOpener(token)) {
      if (isCapturingGroupOpener(token.raw)) {
        captureIndex++;
        groupStack.push(captureIndex);
        result.push(captureIndex);
      } else {
        groupStack.push(null);
        result.push(innermostCapture(groupStack));
      }
    } else if (token.type === "group" && token.raw === ")") {
      const popped = groupStack.pop() ?? null;
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

export function isCapturingGroupOpenerToken(token: RegexPatternToken): boolean {
  return isGroupOpener(token) && isCapturingGroupOpener(token.raw);
}

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

export function resolveCaptureGroupRange(
  tokens: RegexPatternToken[],
  groupIndex: number
): { start: number; end: number } | null {
  if (groupIndex < 1) {
    return null;
  }

  let captureIndex = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!(isGroupOpener(token) && isCapturingGroupOpener(token.raw))) {
      continue;
    }
    captureIndex++;
    if (captureIndex !== groupIndex) {
      continue;
    }
    const end = findMatchingCloseEnd(tokens, i);
    return end == null ? null : { start: token.start, end };
  }

  return null;
}

function findMatchingCloseEnd(
  tokens: RegexPatternToken[],
  openIndex: number
): number | null {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (isGroupOpener(token)) {
      depth++;
    } else if (token.type === "group" && token.raw === ")") {
      depth--;
      if (depth === 0) {
        return token.end;
      }
    }
  }
  return null;
}

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

  if (groupIndex != null) {
    const group = matchResult.groups.find((g) => g.index === groupIndex);
    if (group && group.start < group.end) {
      return { start: group.start, end: group.end };
    }
    return null;
  }

  return resolveGapRange(tokenIndex, captureGroupMap, matchResult);
}

function resolveGapRange(
  tokenIndex: number,
  captureGroupMap: Array<number | null>,
  matchResult: RegexMatchResult
): { start: number; end: number } | null {
  const matchStart = matchResult.matchStart ?? 0;
  const matchEnd = matchResult.matchEnd ?? 0;

  let prevGroupIndex: number | null = null;
  for (let i = tokenIndex - 1; i >= 0; i--) {
    const g = captureGroupMap[i];
    if (g != null) {
      prevGroupIndex = g;
      break;
    }
  }

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
