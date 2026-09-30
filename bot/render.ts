import { buildFormatUrl } from "@/domain/format";
import { type CorpusFormat, openPrCount, type Source } from "./corpus";
import type { RecognizedFormat } from "./recognize";

export const GUEST_USAGE_HINT =
  "Чтобы распознать SMS: сделайте reply с сообщением @zenmoneysms_bot /sms или напишите @zenmoneysms_bot /sms <текст SMS>";

export const CONFLICT_HINT =
  "Вы указали SMS сразу двумя способами — в ответе на сообщение и текстом после /sms. Оставьте что-то одно.";

export const DIRECT_USAGE_HINT =
  "Пришлите SMS текстом — просто сообщением или командой /sms <текст>, — и я покажу, какие форматы его распознают.";

export const INITIALIZING_MESSAGE =
  "Бот запускается — попробуйте через несколько секунд.";

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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatLine(format: RecognizedFormat, sms: string): string {
  const title = escapeHtml(`${format.bank}/${format.formatId}`);
  const [, owner, repo, , , ...fileSegments] = new URL(format.fileUrl).pathname
    .split("/")
    .map(decodeURIComponent);
  if (!(owner && repo && fileSegments.length)) {
    throw new Error(`Invalid corpus file URL: ${format.fileUrl}`);
  }
  const formatUrl = buildFormatUrl({
    origin: "https://sms.zentable.ru",
    repository: { owner, repo },
    source:
      format.source.kind === "main"
        ? { type: "main" }
        : { type: "pr", prNumber: format.source.number },
    filePath: fileSegments.join("/"),
    sms,
  });
  return `- <a href="${escapeHtml(format.fileUrl)}">${title}</a> (<a href="${escapeHtml(formatUrl)}">zensms</a>)`;
}

function groupBySource(
  recognized: RecognizedFormat[],
  sms: string
): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const format of recognized) {
    const key = sourceKey(format.source);
    let group = groups.get(key);
    if (!group) {
      group = { source: format.source, lines: [] };
      groups.set(key, group);
    }
    group.lines.push(formatLine(format, sms));
  }
  return [...groups.values()].sort(
    (a, b) => sourceOrder(a.source) - sourceOrder(b.source)
  );
}

export function renderResponse(
  recognized: RecognizedFormat[],
  corpus: CorpusFormat[],
  sms: string
): string {
  if (recognized.length === 0) {
    return noMatchMessage(corpus);
  }
  return groupBySource(recognized, sms)
    .map((group) => [sourceHeader(group.source), ...group.lines].join("\n"))
    .join("\n");
}
