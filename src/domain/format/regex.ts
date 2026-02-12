import { explain as explainWithSimplifier } from "@the-node-forge/regex-simplifier";

export type RegexExplanationLocale = "en" | "ru";

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

function compileRegexForTest(pattern: string): {
  regex: RegExp | null;
  supportsIndices: boolean;
  error: string | null;
} {
  try {
    return {
      regex: new RegExp(pattern, "d"),
      supportsIndices: true,
      error: null,
    };
  } catch {
    try {
      return {
        regex: new RegExp(pattern),
        supportsIndices: false,
        error: null,
      };
    } catch (error) {
      return {
        regex: null,
        supportsIndices: false,
        error: error instanceof Error ? error.message : "Invalid regex",
      };
    }
  }
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

/**
 * Test a regex string against a test string. Returns match info.
 */
export function testRegex(pattern: string, testStr: string): RegexMatchResult {
  if (!pattern) {
    return emptyMatchResult();
  }

  const compiled = compileRegexForTest(pattern);
  if (!compiled.regex) {
    return emptyMatchResult(compiled.error);
  }

  const match = compiled.regex.exec(testStr) as ExecMatchWithIndices | null;
  if (!match) {
    return emptyMatchResult();
  }

  const fullMatch = match[0] ?? null;
  const matchStart = match.index ?? 0;
  const matchEnd =
    fullMatch == null ? matchStart : matchStart + fullMatch.length;

  return {
    matched: true,
    fullMatch,
    matchStart,
    matchEnd,
    groups: extractMatchGroups(
      match,
      compiled.supportsIndices,
      testStr,
      matchStart,
      matchEnd
    ),
    error: null,
  };
}

/**
 * Count the number of capturing groups in a regex pattern.
 */
export function countCaptureGroups(pattern: string): number | null {
  try {
    // Match-empty cannot be used for many patterns, so we append an empty
    // alternative and inspect the captures count from the exec result shape.
    const result = new RegExp(`${pattern}|`).exec("");
    return result ? result.length - 1 : 0;
  } catch {
    return null;
  }
}

export interface RegexExplanation {
  heading: string | null;
  lines: string[];
  canHighlightPattern: boolean;
  patternTokens: RegexPatternToken[];
}

export interface RegexPatternToken {
  type: string;
  description: string;
  raw: string;
  start: number;
  end: number;
}

function isRussianLocale(locale: RegexExplanationLocale): boolean {
  return locale === "ru";
}

function normalizeExplanation(
  explanation: string,
  locale: RegexExplanationLocale
): Pick<RegexExplanation, "heading" | "lines"> {
  const rawLines = explanation
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return { heading: null, lines: [] };
  }

  const hasHeading = rawLines[0]?.endsWith(":");
  const rawHeading = hasHeading ? rawLines[0]?.slice(0, -1).trim() : null;
  const lines = rawLines
    .slice(hasHeading ? 1 : 0)
    .map((line) => (line.startsWith("- ") ? line.slice(2).trim() : line))
    .map((line) =>
      isRussianLocale(locale) ? translateSimplifierLineToRussian(line) : line
    )
    .filter(Boolean);
  const heading =
    rawHeading == null
      ? null
      : isRussianLocale(locale)
        ? translateSimplifierHeadingToRussian(rawHeading)
        : rawHeading;

  return { heading, lines };
}

function translateSimplifierHeadingToRussian(heading: string): string {
  if (heading.toLowerCase() === "this pattern") {
    return "Это выражение";
  }
  return heading;
}

function translateSimplifierLineToRussian(line: string): string {
  const quantifierMap: Record<string, string> = {
    digits: "цифр",
    "word characters": "символов слова",
    whitespace: "пробельных символов",
    "any character except newline": "любых символов, кроме перевода строки",
  };
  const exactDigitsMatch = line.match(/^exactly (\d+|five) digits$/i);
  if (exactDigitsMatch) {
    const count = exactDigitsMatch[1] === "five" ? "5" : exactDigitsMatch[1];
    return `ровно ${count} цифр`;
  }
  const singleMatch = line.match(/^a single (.+)$/i);
  if (singleMatch) {
    return `один символ типа: ${singleMatch[1]}`;
  }
  const literalMatch = line.match(/^the literal "(.+)"$/i);
  if (literalMatch) {
    return `литерал "${literalMatch[1]}"`;
  }
  const quantifierMatch = line.match(
    /^(zero or more|one or more|optional)\s+(.+?)(?:\s+\((greedy|lazy)\))?$/i
  );
  if (quantifierMatch) {
    const quantifier = (quantifierMatch[1] ?? "").toLowerCase();
    const rawItem = quantifierMatch[2] ?? "";
    const item = quantifierMap[rawItem.toLowerCase()] ?? rawItem;
    const mode = quantifierMatch[3]
      ? ` (${quantifierMatch[3] === "lazy" ? "ленивый" : "жадный"})`
      : "";
    if (quantifier === "zero or more") {
      return `ноль или более ${item}${mode}`;
    }
    if (quantifier === "one or more") {
      return `один или более ${item}${mode}`;
    }
    return `опционально: ${item}${mode}`;
  }
  const rangeMatch = line.match(/^between (\d+) and (\d+) (.+)$/i);
  if (rangeMatch) {
    return `от ${rangeMatch[1]} до ${rangeMatch[2]}: ${rangeMatch[3]}`;
  }
  const startsWithMap: Record<string, string> = {
    "must match the **entire** string": "должно совпадать со всей строкой",
    "must start at the beginning of the string":
      "должно начинаться с начала строки",
    "must end at the end of the string": "должно заканчиваться в конце строки",
    "any character except newline": "любой символ, кроме перевода строки",
  };
  return startsWithMap[line] ?? line;
}

function describeEscape(
  next: string | undefined,
  locale: RegexExplanationLocale
): string {
  if (!next) {
    return isRussianLocale(locale)
      ? "Символ экранирования"
      : "Escape character";
  }
  const map: Record<string, { en: string; ru: string }> = {
    d: { en: "Digit [0-9]", ru: "Цифра [0-9]" },
    D: { en: "Non-digit", ru: "Не цифра" },
    w: { en: "Word character [a-zA-Z0-9_]", ru: "Символ слова [a-zA-Z0-9_]" },
    W: { en: "Non-word character", ru: "Не-символ слова" },
    s: { en: "Whitespace", ru: "Пробельный символ" },
    S: { en: "Non-whitespace", ru: "Не пробельный символ" },
    b: { en: "Word boundary", ru: "Граница слова" },
    B: { en: "Non-word boundary", ru: "Не граница слова" },
    n: { en: "Newline", ru: "Перевод строки" },
    r: { en: "Carriage return", ru: "Возврат каретки" },
    t: { en: "Tab", ru: "Табуляция" },
  };
  const item = map[next];
  if (item) {
    return isRussianLocale(locale) ? item.ru : item.en;
  }
  return isRussianLocale(locale)
    ? `Экранированный символ "${next}"`
    : `Escaped "${next}"`;
}

interface TokenParseResult {
  token: RegexPatternToken;
  nextIndex: number;
}

function parseEscapeToken(
  pattern: string,
  start: number,
  locale: RegexExplanationLocale
): TokenParseResult {
  const next = pattern[start + 1];
  const raw = next ? `\\${next}` : "\\";
  return {
    token: {
      type: "escape",
      description: describeEscape(next, locale),
      raw,
      start,
      end: start + raw.length,
    },
    nextIndex: start + raw.length,
  };
}

function parseGroupToken(
  pattern: string,
  start: number,
  locale: RegexExplanationLocale
): TokenParseResult {
  const knownPrefixes: Array<{
    prefix: string;
    ru: string;
    en: string;
  }> = [
    { prefix: "(?:", ru: "Незахватывающая группа", en: "Non-capturing group" },
    {
      prefix: "(?=",
      ru: "Позитивный просмотр вперёд",
      en: "Positive lookahead",
    },
    {
      prefix: "(?!",
      ru: "Негативный просмотр вперёд",
      en: "Negative lookahead",
    },
    {
      prefix: "(?<=",
      ru: "Позитивный просмотр назад",
      en: "Positive lookbehind",
    },
    {
      prefix: "(?<!",
      ru: "Негативный просмотр назад",
      en: "Negative lookbehind",
    },
  ];

  const prefix = knownPrefixes.find((item) =>
    pattern.startsWith(item.prefix, start)
  );
  if (prefix) {
    const end = start + prefix.prefix.length;
    return {
      token: {
        type: "group",
        description: isRussianLocale(locale) ? prefix.ru : prefix.en,
        raw: prefix.prefix,
        start,
        end,
      },
      nextIndex: end,
    };
  }

  if (pattern.startsWith("(?<", start)) {
    let cursor = start + 3;
    while (cursor < pattern.length && pattern[cursor] !== ">") {
      cursor++;
    }
    const end = Math.min(pattern.length, cursor + 1);
    return {
      token: {
        type: "group",
        description: isRussianLocale(locale)
          ? "Именованная захватывающая группа"
          : "Named capturing group",
        raw: pattern.slice(start, end),
        start,
        end,
      },
      nextIndex: end,
    };
  }

  return {
    token: {
      type: "group",
      description: isRussianLocale(locale)
        ? "Захватывающая группа"
        : "Capturing group",
      raw: "(",
      start,
      end: start + 1,
    },
    nextIndex: start + 1,
  };
}

function parseCharClassToken(
  pattern: string,
  start: number,
  locale: RegexExplanationLocale
): TokenParseResult {
  let cursor = start + 1;
  let escaped = false;
  while (cursor < pattern.length) {
    const current = pattern[cursor] ?? "";
    if (!escaped && current === "\\") {
      escaped = true;
      cursor++;
      continue;
    }
    if (!escaped && current === "]") {
      cursor++;
      break;
    }
    escaped = false;
    cursor++;
  }

  const end = Math.max(start + 1, cursor);
  const raw = pattern.slice(start, end);
  const negated = pattern[start + 1] === "^";
  const description = isRussianLocale(locale)
    ? `${negated ? "Отрицательный класс символов" : "Класс символов"} ${raw}`
    : `${negated ? "Negated c" : "C"}haracter class ${raw}`;

  return {
    token: {
      type: "charclass",
      description,
      raw,
      start,
      end,
    },
    nextIndex: end,
  };
}

function parseCurlyQuantifierToken(
  pattern: string,
  start: number,
  locale: RegexExplanationLocale
): TokenParseResult {
  let cursor = start + 1;
  while (cursor < pattern.length && pattern[cursor] !== "}") {
    cursor++;
  }
  const end = Math.min(pattern.length, cursor + 1);
  const raw = pattern.slice(start, end);
  return {
    token: {
      type: "quantifier",
      description: isRussianLocale(locale) ? `Повтор ${raw}` : `Repeat ${raw}`,
      raw,
      start,
      end,
    },
    nextIndex: end,
  };
}

function parseGreedyQuantifierToken(
  ch: "*" | "+",
  pattern: string,
  start: number,
  locale: RegexExplanationLocale
): TokenParseResult {
  const lazy = pattern[start + 1] === "?";
  const raw = lazy ? `${ch}?` : ch;
  const description = isRussianLocale(locale)
    ? ch === "*"
      ? lazy
        ? "Ноль или более (ленивый)"
        : "Ноль или более (жадный)"
      : lazy
        ? "Один или более (ленивый)"
        : "Один или более (жадный)"
    : ch === "*"
      ? lazy
        ? "Zero or more (lazy)"
        : "Zero or more (greedy)"
      : lazy
        ? "One or more (lazy)"
        : "One or more (greedy)";

  return {
    token: {
      type: "quantifier",
      description,
      raw,
      start,
      end: start + raw.length,
    },
    nextIndex: start + raw.length,
  };
}

function parseLiteralToken(
  pattern: string,
  start: number,
  specials: Set<string>,
  locale: RegexExplanationLocale
): TokenParseResult {
  let cursor = start + 1;
  while (cursor < pattern.length && !specials.has(pattern[cursor] ?? "")) {
    cursor++;
  }
  const raw = pattern.slice(start, cursor);
  return {
    token: {
      type: "literal",
      description: isRussianLocale(locale)
        ? raw.length === 1
          ? `Символ "${raw}"`
          : `Литерал "${raw}"`
        : raw.length === 1
          ? `Character "${raw}"`
          : `Literal "${raw}"`,
      raw,
      start,
      end: cursor,
    },
    nextIndex: cursor,
  };
}

function parseSimpleSymbolToken(
  ch: string,
  start: number,
  locale: RegexExplanationLocale
): TokenParseResult {
  const descriptors: Record<
    string,
    {
      type: RegexPatternToken["type"];
      ru: string;
      en: string;
    }
  > = {
    "^": { type: "anchor", ru: "Начало строки", en: "Start of string" },
    $: { type: "anchor", ru: "Конец строки", en: "End of string" },
    ".": { type: "meta", ru: "Любой символ", en: "Any character" },
    ")": { type: "group", ru: "Конец группы", en: "End of group" },
    "?": {
      type: "quantifier",
      ru: "Опционально (0 или 1)",
      en: "Optional (0 or 1)",
    },
    "|": { type: "alternation", ru: "ИЛИ", en: "OR" },
  };
  const descriptor = descriptors[ch];
  if (!descriptor) {
    return {
      token: {
        type: "literal",
        description: isRussianLocale(locale)
          ? `Символ "${ch}"`
          : `Character "${ch}"`,
        raw: ch,
        start,
        end: start + 1,
      },
      nextIndex: start + 1,
    };
  }
  return {
    token: {
      type: descriptor.type,
      description: isRussianLocale(locale) ? descriptor.ru : descriptor.en,
      raw: ch,
      start,
      end: start + 1,
    },
    nextIndex: start + 1,
  };
}

function readNextToken(
  pattern: string,
  start: number,
  specials: Set<string>,
  locale: RegexExplanationLocale
): TokenParseResult {
  const ch = pattern[start] ?? "";

  if (ch === "\\") {
    return parseEscapeToken(pattern, start, locale);
  }
  if (ch === "(") {
    return parseGroupToken(pattern, start, locale);
  }
  if (ch === "[") {
    return parseCharClassToken(pattern, start, locale);
  }
  if (ch === "{") {
    return parseCurlyQuantifierToken(pattern, start, locale);
  }
  if (ch === "*" || ch === "+") {
    return parseGreedyQuantifierToken(ch, pattern, start, locale);
  }
  if (
    ch === "^" ||
    ch === "$" ||
    ch === "." ||
    ch === ")" ||
    ch === "?" ||
    ch === "|"
  ) {
    return parseSimpleSymbolToken(ch, start, locale);
  }

  return parseLiteralToken(pattern, start, specials, locale);
}

function tokenizeRegexPattern(
  pattern: string,
  locale: RegexExplanationLocale
): RegexPatternToken[] {
  const tokens: RegexPatternToken[] = [];
  const specials = new Set([
    "^",
    "$",
    ".",
    "\\",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    "*",
    "+",
    "?",
    "|",
  ]);
  let i = 0;

  while (i < pattern.length) {
    const parsed = readNextToken(pattern, i, specials, locale);
    tokens.push(parsed.token);
    i = parsed.nextIndex;
  }

  return tokens;
}

export function explainRegex(
  pattern: string,
  locale: RegexExplanationLocale = "en"
): RegexExplanation {
  if (!pattern.trim()) {
    return {
      heading: null,
      lines: [],
      canHighlightPattern: false,
      patternTokens: [],
    };
  }

  try {
    const explanation = explainWithSimplifier(pattern);
    const normalized = normalizeExplanation(explanation, locale);
    const patternTokens = tokenizeRegexPattern(pattern, locale);
    const rebuiltPattern = patternTokens.map((token) => token.raw).join("");
    const canHighlightPattern =
      normalized.lines.length > 0 &&
      patternTokens.length > 0 &&
      rebuiltPattern === pattern;

    return {
      ...normalized,
      canHighlightPattern,
      patternTokens: canHighlightPattern ? patternTokens : [],
    };
  } catch {
    return {
      heading: null,
      lines: [],
      canHighlightPattern: false,
      patternTokens: [],
    };
  }
}
