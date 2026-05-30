/**
 * Hardcoded Corpus for the tracer bullet (issue #4): the set of formats the
 * Recognition Bot matches against. Real corpus sync (git clone + open PR refs,
 * ADR-0004) is a later slice — here the formats are fixed fixtures, no git/net.
 *
 * A bank may appear twice — once from `main` and once as a proposal in an open
 * PR — and that duplication is intentional (a PR re-recognizes the same SMS).
 */

export type Source = { kind: "main" } | { kind: "pr"; number: number };

export interface CorpusFormat {
  source: Source;
  bank: string;
  formatId: string;
  regex: string;
}

export const CORPUS: CorpusFormat[] = [
  {
    source: { kind: "main" },
    bank: "sberbank",
    formatId: "12",
    regex: "^Pokupka \\d+ RUB\\. Karta \\*\\d+\\. Dostupno \\d+ RUB$",
  },
  {
    source: { kind: "main" },
    bank: "tinkoff",
    formatId: "24",
    regex: "^Spisanie \\d+ RUB",
  },
  {
    // Same bank as main can reappear as a proposal in an open PR — intentional.
    source: { kind: "pr", number: 45 },
    bank: "tinkoff",
    formatId: "24",
    regex: "Pokupka (\\d+) RUB",
  },
  {
    source: { kind: "pr", number: 50 },
    bank: "alfabank",
    formatId: "3",
    regex: "^Popolnenie (\\d+) RUB",
  },
  {
    // Invalid regex — must be silently skipped by recognition, never crash.
    source: { kind: "main" },
    bank: "vtb",
    formatId: "9",
    regex: "[broken(",
  },
];

/** Number of distinct open PRs represented in the corpus. */
export function openPrCount(corpus: CorpusFormat[]): number {
  const numbers = new Set<number>();
  for (const format of corpus) {
    if (format.source.kind === "pr") {
      numbers.add(format.source.number);
    }
  }
  return numbers.size;
}
