export type FormatSearchDocSource =
  | "draft"
  | "remote"
  | "remote-error"
  | "none";

export interface FormatSearchDoc {
  path: string;
  name: string;
  exampleText: string;
  isLoaded: boolean;
  source: FormatSearchDocSource;
}

export interface FormatMatchScore {
  score: number;
  matchedInName: boolean;
  matchedInExample: boolean;
}

interface SearchFormatPathsParams {
  formatPaths: string[];
  query: string;
  docsByPath: Map<string, FormatSearchDoc>;
  changedFormatFiles?: Set<string>;
}

export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function splitQueryTokens(normalizedQuery: string): string[] {
  return normalizedQuery
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function scoreFuzzyMatch(text: string, query: string): number {
  if (!(text && query)) {
    return 0;
  }

  let queryIndex = 0;
  let startIndex = -1;
  let lastMatchIndex = -1;
  let currentStreak = 0;
  let maxStreak = 0;
  let gaps = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] !== query[queryIndex]) {
      continue;
    }

    if (startIndex === -1) {
      startIndex = i;
    }
    if (lastMatchIndex + 1 === i) {
      currentStreak += 1;
    } else {
      currentStreak = 1;
      if (lastMatchIndex !== -1) {
        gaps += 1;
      }
    }

    maxStreak = Math.max(maxStreak, currentStreak);
    lastMatchIndex = i;
    queryIndex += 1;
    if (queryIndex === query.length) {
      break;
    }
  }

  if (queryIndex !== query.length) {
    return 0;
  }

  const density = query.length / Math.max(text.length, 1);
  const contiguity = maxStreak / Math.max(query.length, 1);
  const startBonus = 1 - startIndex / Math.max(text.length, 1);
  const gapPenalty = gaps / Math.max(query.length, 1);

  const rawScore =
    density * 0.45 + contiguity * 0.35 + startBonus * 0.25 - gapPenalty * 0.2;
  return clamp(rawScore, 0, 1);
}

function scoreExactContains(text: string, normalizedQuery: string): number {
  const index = text.indexOf(normalizedQuery);
  if (index === -1) {
    return 0;
  }
  return 1 - index / Math.max(text.length, 1);
}

function scoreTokenCoverage(
  tokens: string[],
  normalizedName: string,
  normalizedExample: string
): number {
  if (tokens.length === 0) {
    return 0;
  }

  let matched = 0;
  for (const token of tokens) {
    if (normalizedName.includes(token) || normalizedExample.includes(token)) {
      matched += 1;
    }
  }
  return matched / tokens.length;
}

export function matchAndScore(
  doc: FormatSearchDoc,
  query: string
): FormatMatchScore | null {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return null;
  }

  const normalizedName = normalizeSearchText(doc.name);
  const normalizedExample = normalizeSearchText(doc.exampleText);
  const queryTokens = splitQueryTokens(normalizedQuery);

  const nameExact = scoreExactContains(normalizedName, normalizedQuery);
  const exampleExact = scoreExactContains(normalizedExample, normalizedQuery);
  const nameFuzzy = scoreFuzzyMatch(normalizedName, normalizedQuery);
  const exampleFuzzy = scoreFuzzyMatch(normalizedExample, normalizedQuery);
  const tokenCoverage = scoreTokenCoverage(
    queryTokens,
    normalizedName,
    normalizedExample
  );

  const matchedInName = nameExact > 0 || nameFuzzy > 0;
  const matchedInExample = exampleExact > 0 || exampleFuzzy > 0;
  if (!(matchedInName || matchedInExample || tokenCoverage > 0)) {
    return null;
  }

  const score =
    nameExact * 1500 +
    exampleExact * 1200 +
    tokenCoverage * 300 +
    nameFuzzy * 240 +
    exampleFuzzy * 140;

  return { score, matchedInName, matchedInExample };
}

export function searchFormatPaths({
  formatPaths,
  query,
  docsByPath,
  changedFormatFiles,
}: SearchFormatPathsParams): string[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return formatPaths;
  }

  const scored = formatPaths
    .map((path) => {
      const fallbackName = extractFileName(path);
      const doc = docsByPath.get(path) ?? {
        path,
        name: fallbackName,
        exampleText: "",
        isLoaded: false,
        source: "none" as const,
      };
      const score = matchAndScore(doc, normalizedQuery);
      if (!score) {
        return null;
      }
      return {
        path,
        score: score.score,
        changed: changedFormatFiles?.has(path) ?? false,
        name: doc.name || fallbackName,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  scored.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    if (a.changed !== b.changed) {
      return a.changed ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return scored.map((item) => item.path);
}
