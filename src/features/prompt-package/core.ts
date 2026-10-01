import {
  calculateFormatIntersectionStats,
  type FormatIntersectionStat,
  isBankFormatFilePath,
  parseFormatFile,
} from "@/domain/format";

export type PromptPackageLayer = "main" | "pr" | "draft";

export interface PromptPackageFile {
  path: string;
  content: string | null;
}

export interface PromptPackageSkippedFile {
  path: string;
  reason: "binary" | "truncated";
}

export interface PromptPackageDocument {
  name: string;
  content: string;
}

export interface PromptPackageInput {
  bankName: string;
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

export interface PromptPackageSummary {
  layers: PromptPackageLayerSummary[];
  documents: string[];
  fileCount: number;
  bytes: number;
  estimatedTokens: number;
  skipped: PromptPackageSkippedFile[];
}

export interface PromptPackage {
  text: string;
  summary: PromptPackageSummary;
}

const LEGEND_TEMPLATE = `Пакет форматов банковских SMS банка «{bank}»: docs — справочники, intersections — результаты проверки, files — версии файлов, task — задача. Прямые указания task имеют приоритет над легендой и справочниками.

Слои: main — базовая версия, pr — изменения PR, draft — несохранённые правки. Собери действующее состояние по путям: main → pr → draft; поздний слой заменяет ранний, <delete path="…"> удаляет файл. Отсутствующий файл или слой ничего не меняет; без main банк создаётся в PR.

Выполни task. По умолчанию меняй только затронутые задачей файлы; массовая переработка требует прямого указания. При объединении перенеси все EXAMPLE в остающийся файл и удали донор.

EXAMPLE действующих версий копируй посимвольно, включая пробелы и переносы. Допустимы перенос между файлами и удаление точных дублей с сохранением копии. Перед ответом сверь исходные и итоговые уникальные тексты: они совпадают.

Перед ответом проверь имена новых и изменяемых форматов, включая файлы с ID. Основа имени — первый пригодный EXAMPLE: по правилам Python Unicode замени серии [^\\w]+ и каждую \\d пробелами, схлопни пробелы и срежь края, возьми первые 50 символов, срежь края, затем замени _ пробелами и снова схлопни/срежь пробелы. Именам con/prn/aux/nul/com1…com9/lpt1…lpt9 добавь « file» (без учёта регистра). Не транслитерируй и не дописывай оборванное слово. При слиянии или перестановке примеров пересчитай имя; существующий суффикс _ID сохрани, новый ID не выдумывай.

Ответ: краткий отчёт об изменениях и обоснованных исключениях, затем <file path="…"> с полным новым содержимым каждого нового/изменённого файла; удаление — <delete path="…"> с однострочной причиной. Переименование — новый <file> и <delete> старого пути. Используй псевдо-XML пакета, без diff и сокращённых тел.`;

export type PromptPresetKey = "fixChanged" | "tidyBank";

export const PROMPT_PRESETS: Array<{ key: PromptPresetKey; task: string }> = [
  {
    key: "fixChanged",
    task: `Почини добавленные/изменённые файлы pr и draft: устрани связанные с ними ошибки intersections и несовместимость с банком.

Каждый новый формат сначала примерь к main. Кандидатов ищи по COLUMNS и общему статичному тексту EXAMPLE, затем заново выдели сущности обоих файлов: совпадать должны истинные наборы. Из подходящих кандидатов выбери ближайший по regex и тексту, независимо от id/свежести. Слей в существующий файл, сохранив распознавание всех его прежних примеров. Отдельный файл оставь только при действительно разных сущностях или существенном усложнении regex; объясни причину.

Нетронутые в PR файлы меняй только для такого слияния или необходимого устранения пересечения; объясни каждое исключение. В изменяемых местах используй дефолты каталога без подрезки; альтернативу допускай по подтверждённому EXAMPLE триггеру и объясняй. Остальной regex сохраняй. Якоря бери из EXAMPLE.

Проверь весь итоговый банк поверх действующих слоёв: каждый пример распознаётся своим regex, чужим не распознаётся; при непустой строке COLUMNS число capture-групп равно числу колонок. Учитывай различия Python re и браузера; непроверенное явно назови.`,
  },
  {
    key: "tidyBank",
    task: `Приведи весь банк к современному стандарту:

1. Устрани cross_match и реальные example_no_match из intersections, учитывая различия движков.
2. Обнови каждый транзакционный формат: дефолты каталога вставляй без подрезки, включая замену недефолтных форм без подтверждённого триггера. Альтернативы объясняй. date#dd.MM.yyyy и подобные формы замени порядком компонентов, например date#dMy. Для пробелов используй \\s+; \\s* и опциональность — только по наблюдаемой вариации EXAMPLE. Информационные форматы с пустыми COLUMNS сохраняй в их классификаторном стиле.
3. Объедини одинаковые шаблоны, включая различия только в префиксе/хвосте. Перед решением заново выдели сущности из EXAMPLE: старым COLUMNS нельзя доверять. Совпадают истинные наборы — слей; действительно различаются — сохрани отдельные форматы и разведи негативным lookahead по Cookbook.
4. Пиши минимально достаточную склейку и реальные стабильные якоря EXAMPLE. Обобщай переменные сущности; URL с параметрами, мерчанты и суммы не фиксируй литералами.
5. Проверь весь итоговый банк поверх действующих слоёв: каждый пример распознаётся своим regex, чужим не распознаётся (все пары); при непустой строке COLUMNS число capture-групп равно числу колонок. Учитывай различия Python re и браузера; непроверенное явно назови.

В отчёте обоснуй слияния, удаления, оставленные исключения и неизменённые форматы.`,
  },
];

const INTERSECTIONS_INTRO =
  "Проверка действующих версий (draft > pr > main): слева regex, справа чужой пример; стрелка означает cross_match. Ниже — example_no_match. Расчёт выполнен браузером; апстрим использует Python re. На (?i), Unicode-регистре и классах \\w, \\W, \\d, \\b результаты могут различаться. Подтверждённое расхождение движков не считай дефектом формата.";

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
  if (file.content === null) {
    return `<delete path="${file.path}"></delete>`;
  }
  return `<file path="${file.path}">\n${file.content}\n</file>`;
}

function renderLayer(
  layer: PromptPackageLayer,
  files: PromptPackageFile[]
): string | null {
  if (files.length === 0) {
    return null;
  }
  return `<files layer="${layer}">\n${files.map(renderFile).join("\n")}\n</files>`;
}

function resolveEffectiveFormats(
  input: PromptPackageInput
): Array<{ filePath: string; regex: string; examples: string[] }> {
  const effective = new Map<string, string>();
  for (const layer of LAYER_ORDER) {
    for (const file of input.layers[layer]) {
      if (file.content === null) {
        effective.delete(file.path);
      } else {
        effective.set(file.path, file.content);
      }
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
