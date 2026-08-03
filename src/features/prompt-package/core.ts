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

Выполни задачу из блока \`task\` и верни ответ той же псевдо-XML, что и запрос: изменённый или новый файл — блоком \`<file path="…">\` с полным новым телом, без diff и без сокращений; удаление — блоком \`<delete path="…">\` с причиной одной строкой внутри; переименование — блоком \`<rename from="…" to="…">\` с причиной одной строкой внутри. Перед блоками всегда пиши краткий отчёт прозой: что сделал и чего делать не стал и почему.

Объём работ: по умолчанию меняй только те файлы, которых задача касается прямо. Массовую переделку остальных форматов банка делай только тогда, когда задача просит об этом явно. Когда задача разрешила её явно, убирай дубли объединением форматов: все примеры удаляемого файла до одного переноси в консолидирующий, а сам файл оформляй блоком \`<delete>\` с причиной. Ни один EXAMPLE не должен пропасть из банка.

Приоритет: прямые указания из блока \`task\` важнее правил этой легенды.`;

export type PromptPresetKey = "fixChanged" | "tidyBank";

// Default wordings of the task, offered in the modal and dropped into the field
// as a starting point. They are package content, not interface text: Russian and
// fixed here for the same reason as the legend (ADR-0016); i18n carries only
// their names.
export const PROMPT_PRESETS: Array<{ key: PromptPresetKey; task: string }> = [
  {
    key: "fixChanged",
    task: "Почини файлы, изменённые или добавленные в этом pull request (слои `pr` и `draft`): устрани из блока `intersections` всё, что относится к этим файлам, и сделай их совместимыми с остальными форматами банка. Файлы, не тронутые в этом PR, не меняй — кроме двух случаев, каждый из которых объясни в прозе. Первый: без правки соседа пересечение не устранить. Второй: файл из PR и соседний формат описывают один шаблон SMS с одним набором сущностей — тогда объединяй их, перенося все примеры удаляемого файла до одного в остающийся, а сам файл оформляй блоком `<delete>` с причиной. Место, которое правишь, приводи к дефолтным сниппетам каталога (у каждой сущности дефолт один; альтернатива — только по её триггеру, причину назови в отчёте); незатронутые места паттерна не переписывай. Якоря бери только из реальных текстов EXAMPLE. Перед выдачей проверь: каждый пример матчится своим regex, ни один пример не матчится regex другого формата банка, число capture-групп равно числу колонок.",
  },
  {
    key: "tidyBank",
    // Verified on a live bank (АТБ, 2026-08-03): the numbered structure is what
    // makes the agent consolidate at all — a vague wording gave zero merges.
    task: `Приведи форматы банка в порядок по современному стандарту. Работай в таком порядке:

1. Почини всё, что перечислено в блоке \`intersections\`: пересечения форматов и все примеры, не распознанные собственным regex (example_no_match).

2. Пройди по каждому формату банка и перепиши легаси на современный стандарт: используй дефолтные сниппеты каталога (regex-snippets.toml) вместо легаси-паттернов, замени легаси-формы колонок (date#dd.MM.yyyy → date#dMy). У каждой сущности дефолт ровно один — меняй на него и недефолтные формы (например ([A-Z]{3}) → (\\S+)), если EXAMPLE не дают явного триггера для альтернативы; оставленную альтернативу объясни в отчёте. Пробельную склейку меняй на \\s+; \\s* и опциональные (?:…)? оставляй только под вариацию, наблюдаемую в EXAMPLE. Дефолтные сниппеты вставляй как есть, не подрезай под единственный пример. Информационные форматы (пустые COLUMNS) не переводи на транзакционные правила — у них свой стиль.

3. Убери избыточность. Форматы с одинаковым набором COLUMNS, описывающие один и тот же шаблон SMS (отличия только в префиксе/хвосте), объединяй в один: все примеры удаляемого файла до одного переноси в остающийся — ни один пример не должен пропасть из банка, — лишний файл удаляй блоком <delete> с причиной. Разному набору COLUMNS не верь на слово: колонки легаси-файла могли быть ошибкой кривого regex — заново выдели сущности из текстов EXAMPLE, и если истинные наборы совпали, объединяй такие файлы так же. Форматы с действительно разным набором сущностей не сливай — разводи негативным lookahead, как в cookbook §5.

4. Якоря бери только из реальных текстов EXAMPLE, ничего не выдумывай. Не хардкодь переменные части (URL с параметрами, имена мерчантов, суммы) — якорь должен переживать следующую SMS того же шаблона. Склейку пиши минимально достаточной.

5. Перед выдачей проверь итоговое состояние банка целиком (ответ поверх слоёв pr и main): каждый пример матчится своим regex; ни один пример не матчится regex другого формата банка (по всем парам, включая нетронутые тобой файлы); число capture-групп равно числу колонок.

6. В прозе перед блоками кратко перечисли: что объединил и почему, что удалил, что оставил как есть и почему.

Мои прямые указания в этом задании имеют приоритет над общими правилами легенды.`,
  },
];

const INTERSECTIONS_INTRO =
  "Пересечения посчитаны при сборке пакета по действующим версиям файлов (draft перекрывает pr, pr перекрывает main). Направление: regex файла слева распознаёт пример файла справа — это cross_match, ошибка уровня банка. Считает движок регулярных выражений браузера, а валидатор апстрима — Python re; на паттернах с (?i) результат может расходиться, как и на \\w, \\W, \\b по кириллице: в браузере эти классы всегда ASCII, в Python re — юникодные. Такой example_no_match — артефакт нашего движка, а не дефект файла.";

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
