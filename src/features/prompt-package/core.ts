// Pure assembly of the prompt package: facts in, one text artifact out.
// No network, no stores, no localStorage, no React — the module is imported
// and tested in isolation (ADR-0016).

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
const LEGEND_TEMPLATE = `Это пакет данных для работы с форматами банковских SMS банка «{bank}». Структура пакета: этот блок \`legend\`, затем \`docs\` — справочные документы, затем блоки \`files\` — файлы банка в трёх слоях, в конце \`task\` — задача от пользователя.

Слои файлов: \`layer="main"\` — состояние в основной ветке репозитория; \`layer="pr"\` — версии из открытого pull request; \`layer="draft"\` — несохранённые правки из браузерного редактора. Слои независимы: если файла нет в слое \`pr\` или \`draft\`, в этом слое он не менялся, и действует его версия из предыдущего слоя. Слой может отсутствовать целиком — это значит, что в нём нет ни одного файла банка: нет \`layer="pr"\` или \`layer="draft"\` — банк в этом слое не менялся; нет \`layer="main"\` — банка ещё нет в основной ветке, он создаётся в этом pull request. Актуальность: \`draft\` новее \`pr\`, \`pr\` новее \`main\` — свежайшее намерение автора ищи в самом позднем слое, где файл присутствует.

Выполни задачу из блока \`task\`. Если задача требует изменить или создать файлы — верни полное новое тело каждого затронутого файла с указанием его \`path\`, без diff и без сокращений. Файлы, которых задача не касается, не трогай.`;

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
