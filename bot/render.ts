import { type CorpusFormat, openPrCount, type Source } from "./corpus";
import type { RecognizedFormat } from "./recognize";

export const USAGE_HINT =
  "Пришлите SMS — ответом на сообщение с ним или текстом после упоминания — и я покажу, какие форматы его распознают.";

function noMatchMessage(corpus: CorpusFormat[]): string {
  const prCount = openPrCount(corpus);
  return `Ни один формат не распознаёт этот SMS — ни на main, ни в ${prCount} открытых PR. Похоже, нужен новый формат.`;
}

function sourceKey(source: Source): string {
  return source.kind === "main" ? "main" : `pr:${source.number}`;
}

function sourceHeader(source: Source): string {
  return source.kind === "main"
    ? "main:"
    : `PR #${source.number} «${escapeHtml(source.title)}»`;
}

function sourceOrder(source: Source): number {
  return source.kind === "main" ? -1 : source.number;
}

interface SourceGroup {
  source: Source;
  lines: string[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatLine(format: RecognizedFormat): string {
  const title = escapeHtml(`${format.bank}/${format.formatId}`);
  return `- <a href="${escapeHtml(format.fileUrl)}">${title}</a>`;
}

function groupBySource(recognized: RecognizedFormat[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const format of recognized) {
    const key = sourceKey(format.source);
    let group = groups.get(key);
    if (!group) {
      group = { source: format.source, lines: [] };
      groups.set(key, group);
    }
    group.lines.push(formatLine(format));
  }
  return [...groups.values()].sort(
    (a, b) => sourceOrder(a.source) - sourceOrder(b.source)
  );
}

/**
 * Output contract (Telegram HTML parse mode): recognized formats grouped by
 * Source (main first, then open PRs ascending), each rendered as a link
 * `- bank/formatId` pointing at the file at that Source's SHA. No matches yields
 * the "needs a new format" message.
 */
export function renderResponse(
  recognized: RecognizedFormat[],
  corpus: CorpusFormat[]
): string {
  if (recognized.length === 0) {
    return noMatchMessage(corpus);
  }
  return groupBySource(recognized)
    .map((group) => [sourceHeader(group.source), ...group.lines].join("\n"))
    .join("\n");
}
