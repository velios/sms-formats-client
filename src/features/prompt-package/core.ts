// Pure assembly of the prompt package: facts in, one text artifact out.
// No network, no stores, no localStorage, no React — the module is imported
// and tested in isolation (ADR-0016).

import {
  calculateFormatIntersectionStats,
  type FormatIntersectionStat,
  isBankFormatFilePath,
  parseFormatFile,
} from "@/domain/format";

export type PromptPackageLayer = "main" | "pr" | "draft";

export interface PromptPackageFile {
  path: string;
  content: string;
}

// A file the fetching boundary could not put into the package: a binary blob
// (`Blob.text == null`) or a truncated body (`isTruncated`). Never printed —
// "missing from the layer" must keep meaning what the legend says it means.
export interface PromptPackageSkippedFile {
  path: string;
  reason: "binary" | "truncated";
}

// A reference document as the human edits it: `name` is its source file name
// (`cookbook.md`, `format-rules.md`, `regex-snippets.toml`), `content` is the
// raw source.
export interface PromptPackageDocument {
  name: string;
  content: string;
}

export interface PromptPackageInput {
  bankName: string;
  // Needed to tell the bank's format files from `senders.txt`: intersections
  // are counted over formats only.
  bankPath: string;
  layers: Record<PromptPackageLayer, PromptPackageFile[]>;
  documents: PromptPackageDocument[];
  task: string;
  skipped: PromptPackageSkippedFile[];
}

export interface PromptPackageLayerSummary {
  layer: PromptPackageLayer;
  fileCount: number;
}

// The subject of the preview: answers "did anything get lost?".
export interface PromptPackageSummary {
  // Always all three layers, in package order, zeroes included: an explicit
  // zero explains a missing block and catches "drafts 0" on unsaved edits.
  layers: PromptPackageLayerSummary[];
  documents: string[];
  fileCount: number;
  bytes: number;
  // UTF-8 bytes / 4, no tokenizer: the agent is foreign and unknown, so
  // precision would be for show; a rough "how much am I dumping into the chat".
  estimatedTokens: number;
  skipped: PromptPackageSkippedFile[];
}

export interface PromptPackage {
  text: string;
  summary: PromptPackageSummary;
}

// Package language is Russian, fixed in module constants and not switched by
// the interface language: it is a property of the artifact, not of the UI
// (ADR-0016).
const LEGEND_TEMPLATE = `Это пакет данных для работы с форматами банковских SMS банка «{bank}». Структура пакета: этот блок \`legend\`, затем \`docs\` — справочные документы, затем \`intersections\` — пересечения форматов, затем блоки \`files\` — файлы банка в трёх слоях, в конце \`task\` — задача от пользователя.

Слои файлов: \`layer="main"\` — состояние в основной ветке репозитория; \`layer="pr"\` — версии из открытого pull request; \`layer="draft"\` — несохранённые правки из браузерного редактора. Слои независимы: если файла нет в слое \`pr\` или \`draft\`, в этом слое он не менялся, и действует его версия из предыдущего слоя. Слой может отсутствовать целиком — это значит, что в нём нет ни одного файла банка: нет \`layer="pr"\` или \`layer="draft"\` — банк в этом слое не менялся; нет \`layer="main"\` — банка ещё нет в основной ветке, он создаётся в этом pull request. Актуальность: \`draft\` новее \`pr\`, \`pr\` новее \`main\` — свежайшее намерение автора ищи в самом позднем слое, где файл присутствует.

Выполни задачу из блока \`task\` и верни ответ той же псевдо-XML, что и запрос: изменённый или новый файл — блоком \`<file path="…">\` с полным новым телом, без diff и без сокращений; удаление — блоком \`<delete path="…">\` с причиной одной строкой внутри; переименование — блоком \`<rename from="…" to="…">\` с причиной одной строкой внутри.

Объём работ: по умолчанию меняй только те файлы, которых задача касается прямо. Массовую переделку остальных форматов банка делай только тогда, когда задача просит об этом явно.`;

const INTERSECTIONS_INTRO =
  "Пересечения посчитаны при сборке пакета по действующим версиям файлов (draft перекрывает pr, pr перекрывает main). Направление: regex файла слева распознаёт пример файла справа — это cross_match, ошибка уровня банка. Считает движок регулярных выражений браузера, а валидатор апстрима — Python re; на паттернах с (?i) результат может расходиться.";

const OWN_MISSES_HEADER =
  "Примеры, не распознанные собственным regex (example_no_match):";

const NOTHING = "(нет)";

const LAYER_ORDER: PromptPackageLayer[] = ["main", "pr", "draft"];

const BYTES_PER_TOKEN = 4;

function block(tag: string, body: string): string {
  return `<${tag}>\n${body}\n</${tag}>`;
}

function renderDocuments(documents: PromptPackageDocument[]): string {
  return documents
    .map(
      (document) =>
        `<document name="${document.name}">\n${document.content}\n</document>`
    )
    .join("\n");
}

function renderFile(file: PromptPackageFile): string {
  // Bodies go in raw: no escaping, no CDATA — regexes and SMS text stay as in
  // the file.
  return `<file path="${file.path}">\n${file.content}\n</file>`;
}

function renderLayer(
  layer: PromptPackageLayer,
  files: PromptPackageFile[]
): string | null {
  // An empty layer is not printed — the block is omitted entirely.
  if (files.length === 0) {
    return null;
  }
  return `<files layer="${layer}">\n${files.map(renderFile).join("\n")}\n</files>`;
}

// The versions that actually apply: a later layer wins over an earlier one, the
// same reading the legend gives the agent.
function resolveEffectiveFormats(
  input: PromptPackageInput
): Array<{ filePath: string; regex: string; examples: string[] }> {
  const effective = new Map<string, string>();
  for (const layer of LAYER_ORDER) {
    for (const file of input.layers[layer]) {
      effective.set(file.path, file.content);
    }
  }
  return [...effective]
    .filter(([path]) => isBankFormatFilePath(path, input.bankPath))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => {
      const parsed = parseFormatFile(content, path);
      return {
        filePath: path,
        regex: parsed.regex,
        examples: parsed.examples,
      };
    });
}

function renderCrossMatches(stats: FormatIntersectionStat[]): string {
  const lines: string[] = [];
  for (const stat of stats) {
    for (const otherPath of stat.intersectingFormatPaths) {
      lines.push(`${stat.filePath} → ${otherPath}`);
      for (const hit of stat.intersectingExamples) {
        if (hit.filePath === otherPath) {
          lines.push(`  «${hit.example}»`);
        }
      }
    }
  }
  return lines.length > 0 ? lines.join("\n") : NOTHING;
}

function renderOwnMisses(stats: FormatIntersectionStat[]): string {
  const lines: string[] = [];
  for (const stat of stats) {
    if (stat.ownUnmatchedExamples.length === 0) {
      continue;
    }
    lines.push(`  ${stat.filePath}`);
    for (const example of stat.ownUnmatchedExamples) {
      lines.push(`    «${example}»`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : `  ${NOTHING}`;
}

// The block is printed even when there is nothing to report: a missing block
// would be indistinguishable from "no intersections".
function renderIntersections(input: PromptPackageInput): string {
  const stats = [
    ...calculateFormatIntersectionStats(
      resolveEffectiveFormats(input)
    ).values(),
  ];
  return [
    INTERSECTIONS_INTRO,
    "",
    renderCrossMatches(stats),
    "",
    OWN_MISSES_HEADER,
    renderOwnMisses(stats),
  ].join("\n");
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function buildPromptPackage(input: PromptPackageInput): PromptPackage {
  const blocks: string[] = [
    block("legend", LEGEND_TEMPLATE.replace("{bank}", input.bankName)),
  ];

  if (input.documents.length > 0) {
    blocks.push(block("docs", renderDocuments(input.documents)));
  }

  blocks.push(block("intersections", renderIntersections(input)));

  for (const layer of LAYER_ORDER) {
    const rendered = renderLayer(layer, input.layers[layer]);
    if (rendered !== null) {
      blocks.push(rendered);
    }
  }

  blocks.push(block("task", input.task));

  const text = `${blocks.join("\n\n")}\n`;
  const bytes = utf8Bytes(text);
  const layerSummaries = LAYER_ORDER.map((layer) => ({
    layer,
    fileCount: input.layers[layer].length,
  }));

  return {
    text,
    summary: {
      layers: layerSummaries,
      documents: input.documents.map((document) => document.name),
      fileCount: layerSummaries.reduce(
        (total, summary) => total + summary.fileCount,
        0
      ),
      bytes,
      estimatedTokens: Math.round(bytes / BYTES_PER_TOKEN),
      skipped: input.skipped,
    },
  };
}
