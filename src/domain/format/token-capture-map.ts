import type { RegexMatchResult, RegexPatternToken } from "./regex";

/** True for a `(` token that opens a *capturing* group (plain or named). */
function isGroupOpener(token: RegexPatternToken): boolean {
  return token.type === "group" && token.raw.startsWith("(");
}

/**
 * Whether a group-opener token starts a capturing group, matching the native
 * engine's numbering: plain `(` and named `(?<name>`, but NOT `(?:`, lookahead
 * `(?=`/`(?!`, or lookbehind `(?<=`/`(?<!`.
 */
function isCapturingGroupOpener(raw: string): boolean {
  if (raw === "(") {
    return true;
  }
  // Named capturing group `(?<name>` — but exclude lookbehind `(?<=` / `(?<!`.
  return raw.startsWith("(?<") && raw[3] !== "=" && raw[3] !== "!";
}

/**
 * Build a mapping from each pattern token index to the innermost
 * capture group index it belongs to (1-based), or null if the token
 * is outside any capturing group.
 *
 * Uses a stack-based approach: opening `(` tokens push a group,
 * closing `)` tokens pop. Non-capturing group openers (`(?:`, `(?=`,
 * `(?!`, `(?<=`, `(?<!`) are tracked but excluded from the capture
 * index sequence.
 */
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
 * Resolve the character range of capturing group N's parentheses in the pattern
 * string: from its opening `(` to the matching `)`, **including** the brackets
 * but **excluding** any trailing quantifier (`?`/`+`/`*`/`{n,m}`), which is a
 * separate token outside the parens. Returns null if group N does not exist.
 *
 * Used to drive a real CodeMirror selection over the group so a snippet insert
 * replaces the whole group (see ADR-0010).
 */
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

/**
 * Given the index of a group-opener token, find the `end` offset of its
 * matching `)` by walking forward and tracking bracket depth. Returns null if
 * the group is unclosed.
 */
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
