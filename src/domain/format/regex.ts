import type { RegexPatternToken } from "./pattern-analysis";
import { tokenizeRegexPattern } from "./pattern-analysis";
import { tryCompile } from "./regex-compiler";

export interface RegexMatchResult {
  matched: boolean;
  fullMatch: string | null;
  matchStart: number | null;
  matchEnd: number | null;
  groups: { index: number; value: string; start: number; end: number }[];
  error: string | null;
}

type ExecMatchWithIndices = RegExpExecArray & {
  indices?: Array<[number, number] | undefined>;
};

export function normalizeSmsText(text: string): string {
  return text.replace(/[\n\r]+/g, " ").trim();
}

interface NormalizedTextMapping {
  normalized: string;
  toOriginal: (offset: number) => number;
}

// Keep normalized offsets mapped to the original SMS.
function buildNormalizedTextMapping(text: string): NormalizedTextMapping {
  let collapsed = "";
  const collapsedToOriginal: number[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\n" || ch === "\r") {
      const runStart = i;
      while (i < text.length && (text[i] === "\n" || text[i] === "\r")) {
        i++;
      }
      collapsedToOriginal[collapsed.length] = runStart;
      collapsed += " ";
    } else {
      collapsedToOriginal[collapsed.length] = i;
      collapsed += ch;
      i++;
    }
  }
  collapsedToOriginal[collapsed.length] = text.length;

  const leadingMatch = collapsed.match(/^\s+/);
  const trimStart = leadingMatch ? leadingMatch[0].length : 0;
  const trailingMatch = collapsed.match(/\s+$/);
  const trimEnd = Math.max(
    trimStart,
    collapsed.length - (trailingMatch ? trailingMatch[0].length : 0)
  );
  const normalized = collapsed.slice(trimStart, trimEnd);

  return {
    normalized,
    toOriginal: (offset: number) => {
      const clamped = Math.max(0, Math.min(offset, normalized.length));
      return collapsedToOriginal[trimStart + clamped]!;
    },
  };
}

function emptyMatchResult(error: string | null = null): RegexMatchResult {
  return {
    matched: false,
    fullMatch: null,
    matchStart: null,
    matchEnd: null,
    groups: [],
    error,
  };
}

function findGroupBounds(
  testStr: string,
  value: string,
  fallbackCursor: number,
  matchStart: number,
  matchEnd: number
): { start: number; end: number } {
  if (!value) {
    return { start: fallbackCursor, end: fallbackCursor };
  }

  let groupStart = testStr.indexOf(value, fallbackCursor);
  if (groupStart < matchStart || groupStart > matchEnd) {
    groupStart = testStr.indexOf(value, matchStart);
  }
  if (groupStart < 0) {
    groupStart = matchStart;
  }

  return {
    start: groupStart,
    end: Math.min(matchEnd, groupStart + value.length),
  };
}

function extractMatchGroups(
  match: ExecMatchWithIndices,
  supportsIndices: boolean,
  testStr: string,
  matchStart: number,
  matchEnd: number
): RegexMatchResult["groups"] {
  const groups: RegexMatchResult["groups"] = [];
  let fallbackCursor = matchStart;

  for (let i = 1; i < match.length; i++) {
    const value = match[i] ?? "";
    const indexedBounds = supportsIndices ? match.indices?.[i] : undefined;
    const bounds = indexedBounds
      ? { start: indexedBounds[0], end: indexedBounds[1] }
      : findGroupBounds(testStr, value, fallbackCursor, matchStart, matchEnd);

    groups.push({
      index: i,
      value,
      start: bounds.start,
      end: bounds.end,
    });
    fallbackCursor = Math.max(fallbackCursor, bounds.end);
  }

  return groups;
}

export function testRegex(pattern: string, testStr: string): RegexMatchResult {
  if (!pattern) {
    return emptyMatchResult();
  }

  const compiled = tryCompile(pattern);
  if (!compiled.regex) {
    return emptyMatchResult(compiled.error);
  }

  const mapping = buildNormalizedTextMapping(testStr);
  const normalized = mapping.normalized;
  const match = compiled.regex.exec(normalized) as ExecMatchWithIndices | null;
  if (!match) {
    return emptyMatchResult();
  }

  const fullMatch = match[0] ?? null;
  const normMatchStart = match.index ?? 0;
  const normMatchEnd =
    fullMatch == null ? normMatchStart : normMatchStart + fullMatch.length;

  const normGroups = extractMatchGroups(
    match,
    compiled.supportsIndices,
    normalized,
    normMatchStart,
    normMatchEnd
  );

  return {
    matched: true,
    fullMatch,
    matchStart: mapping.toOriginal(normMatchStart),
    matchEnd: mapping.toOriginal(normMatchEnd),
    groups: normGroups.map((group) => ({
      index: group.index,
      value: group.value,
      start: mapping.toOriginal(group.start),
      end: mapping.toOriginal(group.end),
    })),
    error: null,
  };
}

export interface RecognitionProgress {
  prefixStart: number;
  prefixEnd: number;
  prefixPatternEnd: number;
  groups: RegexMatchResult["groups"];
  textExhausted: boolean;
}

function depthZeroBoundaryTokenIndices(tokens: RegexPatternToken[]): number[] {
  const indices: number[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const raw = token.raw;
    if (token.type === "group" && raw.startsWith("(")) {
      depth++;
    } else if (raw === ")") {
      depth = Math.max(0, depth - 1);
    }
    if (depth === 0) {
      indices.push(i);
    }
  }
  return indices;
}

export function recognitionProgress(
  pattern: string,
  sms: string
): RecognitionProgress | null {
  if (!pattern) {
    return null;
  }

  const tokens = tokenizeRegexPattern(pattern, "en");
  if (tokens.length === 0) {
    return null;
  }

  const mapping = buildNormalizedTextMapping(sms);
  const normalized = mapping.normalized;

  let best: {
    match: ExecMatchWithIndices;
    supportsIndices: boolean;
    start: number;
    end: number;
    patternEnd: number;
  } | null = null;

  for (const tokenIndex of depthZeroBoundaryTokenIndices(tokens)) {
    const patternEnd = tokens[tokenIndex]!.end;
    const subPattern = pattern.slice(0, patternEnd);
    const compiled = tryCompile(subPattern);
    if (!compiled.regex) {
      continue;
    }
    const match = compiled.regex.exec(
      normalized
    ) as ExecMatchWithIndices | null;
    if (!match || match[0] == null) {
      continue;
    }
    const start = match.index ?? 0;
    const end = start + match[0].length;
    best = {
      match,
      supportsIndices: compiled.supportsIndices,
      start,
      end,
      patternEnd,
    };
  }

  if (!best || best.end <= best.start) {
    return null;
  }

  const normGroups = extractMatchGroups(
    best.match,
    best.supportsIndices,
    normalized,
    best.start,
    best.end
  );

  return {
    prefixStart: mapping.toOriginal(best.start),
    prefixEnd: mapping.toOriginal(best.end),
    prefixPatternEnd: best.patternEnd,
    groups: normGroups.map((group) => ({
      index: group.index,
      value: group.value,
      start: mapping.toOriginal(group.start),
      end: mapping.toOriginal(group.end),
    })),
    textExhausted: best.end === normalized.length,
  };
}

export function countCaptureGroups(pattern: string): number | null {
  const compiled = tryCompile(pattern);
  if (!compiled.regex) {
    return null;
  }
  const result = tryCompile(`${pattern}|`).regex?.exec("");
  return result ? result.length - 1 : null;
}
