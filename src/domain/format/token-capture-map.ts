import type { RegexPatternToken } from "./regex";

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
