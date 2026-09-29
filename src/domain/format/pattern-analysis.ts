export type RegexPatternLocale = "en" | "ru";
export interface RegexPatternAnalysis {
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

function isRussianLocale(locale: RegexPatternLocale): boolean {
  return locale === "ru";
}

function describeEscape(
  next: string | undefined,
  locale: RegexPatternLocale
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
  locale: RegexPatternLocale
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
  locale: RegexPatternLocale
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
  locale: RegexPatternLocale
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
  locale: RegexPatternLocale
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
  locale: RegexPatternLocale
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
  locale: RegexPatternLocale
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
  locale: RegexPatternLocale
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
  locale: RegexPatternLocale
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

export function tokenizeRegexPattern(
  pattern: string,
  locale: RegexPatternLocale
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

export function analyzeRegexPattern(
  pattern: string,
  locale: RegexPatternLocale = "en"
): RegexPatternAnalysis {
  if (!pattern.trim()) {
    return { canHighlightPattern: false, patternTokens: [] };
  }
  try {
    new RegExp(pattern);
  } catch {
    return { canHighlightPattern: false, patternTokens: [] };
  }
  const patternTokens = tokenizeRegexPattern(pattern, locale);
  const canHighlightPattern =
    patternTokens.length > 0 &&
    patternTokens.map((token) => token.raw).join("") === pattern;
  return {
    canHighlightPattern,
    patternTokens: canHighlightPattern ? patternTokens : [],
  };
}
