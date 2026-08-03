import { describe, expect, it } from "vitest";
import {
  buildPromptPackage,
  type PromptPackageInput,
} from "@/features/prompt-package/core";

// The legend text as fixed by the PRD ("Состав пакета" → "Легенда"), written
// out here independently of the module so a silent edit of the constant fails.
const LEGEND_VERBATIM = `Это пакет данных для работы с форматами банковских SMS банка «Т-Банк». Структура пакета: этот блок \`legend\`, затем \`docs\` — справочные документы, затем \`intersections\` — пересечения форматов, затем блоки \`files\` — файлы банка в трёх слоях, в конце \`task\` — задача от пользователя.

Слои файлов: \`layer="main"\` — состояние в основной ветке репозитория; \`layer="pr"\` — версии из открытого pull request; \`layer="draft"\` — несохранённые правки из браузерного редактора. Слои независимы: если файла нет в слое \`pr\` или \`draft\`, в этом слое он не менялся, и действует его версия из предыдущего слоя. Слой может отсутствовать целиком — это значит, что в нём нет ни одного файла банка: нет \`layer="pr"\` или \`layer="draft"\` — банк в этом слое не менялся; нет \`layer="main"\` — банка ещё нет в основной ветке, он создаётся в этом pull request. Актуальность: \`draft\` новее \`pr\`, \`pr\` новее \`main\` — свежайшее намерение автора ищи в самом позднем слое, где файл присутствует.

Выполни задачу из блока \`task\` и верни ответ той же псевдо-XML, что и запрос: изменённый или новый файл — блоком \`<file path="…">\` с полным новым телом, без diff и без сокращений; удаление — блоком \`<delete path="…">\` с причиной одной строкой внутри; переименование — блоком \`<rename from="…" to="…">\` с причиной одной строкой внутри. Перед блоками всегда пиши краткий отчёт прозой: что сделал и чего делать не стал и почему.

Объём работ: по умолчанию меняй только те файлы, которых задача касается прямо. Массовую переделку остальных форматов банка делай только тогда, когда задача просит об этом явно. Когда задача разрешила её явно, убирай дубли объединением форматов: все примеры удаляемого файла до одного переноси в консолидирующий, а сам файл оформляй блоком \`<delete>\` с причиной. Ни один EXAMPLE не должен пропасть из банка.

Приоритет: прямые указания из блока \`task\` важнее правил этой легенды.`;

const BANK_PATH = "banks/tinkoff";

function formatFile(regex: string, examples: string[]): string {
  return [
    regex,
    "",
    "-----COLUMNS-----",
    "comment",
    ...examples.flatMap((example) => ["", "-----EXAMPLE-----", example]),
  ].join("\n");
}

function buildPackage(overrides: Partial<PromptPackageInput> = {}) {
  return buildPromptPackage({
    bankName: "Т-Банк",
    bankPath: BANK_PATH,
    layers: { main: [], pr: [], draft: [] },
    documents: [],
    task: "Сведи два формата в один",
    skipped: [],
    ...overrides,
  });
}

function tagsInOrder(text: string): string[] {
  return Array.from(
    text.matchAll(/^<(legend|docs|intersections|files[^>]*|task)>$/gm)
  ).map((match) => match[1] ?? "");
}

describe("buildPromptPackage text", () => {
  it("orders blocks: legend, docs, intersections, three layers, task", () => {
    const { text } = buildPackage({
      documents: [{ name: "cookbook.md", content: "# Cookbook" }],
      layers: {
        main: [{ path: "banks/tinkoff/senders.txt", content: "900" }],
        pr: [{ path: "banks/tinkoff/formats/a.txt", content: "regex-a" }],
        draft: [{ path: "banks/tinkoff/formats/b.txt", content: "regex-b" }],
      },
    });

    expect(tagsInOrder(text)).toEqual([
      "legend",
      "docs",
      "intersections",
      'files layer="main"',
      'files layer="pr"',
      'files layer="draft"',
      "task",
    ]);
  });

  it("omits an empty layer block entirely", () => {
    const { text } = buildPackage({
      layers: {
        main: [{ path: "banks/tinkoff/senders.txt", content: "900" }],
        pr: [],
        draft: [],
      },
    });

    expect(text).toContain('<files layer="main">');
    expect(text).not.toContain('layer="pr"></files>');
    expect(tagsInOrder(text)).toEqual([
      "legend",
      "intersections",
      'files layer="main"',
      "task",
    ]);
  });

  it('omits layer="main" for a bank created in this pull request', () => {
    const { text } = buildPackage({
      layers: {
        main: [],
        pr: [{ path: "banks/new/formats/a.txt", content: "regex-a" }],
        draft: [],
      },
    });

    expect(tagsInOrder(text)).toEqual([
      "legend",
      "intersections",
      'files layer="pr"',
      "task",
    ]);
    expect(text).not.toContain('<files layer="main">');
  });

  it("puts the legend verbatim with the bank name interpolated", () => {
    const { text } = buildPackage();

    expect(text.startsWith(`<legend>\n${LEGEND_VERBATIM}\n</legend>`)).toBe(
      true
    );
  });

  it("keeps file bodies raw, without escaping", () => {
    const { text } = buildPackage({
      layers: {
        main: [
          {
            path: "banks/tinkoff/formats/a.txt",
            content: "^Оплата (?<sum>\\d+) & <карта>",
          },
        ],
        pr: [],
        draft: [],
      },
    });

    expect(text).toContain(
      '<file path="banks/tinkoff/formats/a.txt">\n^Оплата (?<sum>\\d+) & <карта>\n</file>'
    );
  });

  it("puts the task text into the task block", () => {
    const { text } = buildPackage({ task: "Перепиши по cookbook" });

    expect(text).toContain("<task>\nПерепиши по cookbook\n</task>");
  });
});

describe("buildPromptPackage intersections", () => {
  function intersectionsBlock(text: string): string {
    return text.slice(
      text.indexOf("<intersections>"),
      text.indexOf("</intersections>") + "</intersections>".length
    );
  }

  it("quotes the recognized foreign example, counting the effective versions", () => {
    // The `main` version of a.txt is harmless; its `draft` version is the one
    // that reaches over into b.txt — and the one the block must judge.
    const { text } = buildPackage({
      layers: {
        main: [
          {
            path: `${BANK_PATH}/formats/a.txt`,
            content: formatFile("^PAY (\\d+)$", ["PAY 100"]),
          },
          {
            path: `${BANK_PATH}/formats/b.txt`,
            content: formatFile("^СБП: Перевод (.+)$", [
              "СБП: Перевод Ольга В. Списано 10000 р.",
            ]),
          },
          { path: `${BANK_PATH}/senders.txt`, content: "900" },
        ],
        pr: [],
        draft: [
          {
            path: `${BANK_PATH}/formats/a.txt`,
            content: formatFile("^СБП: (.+)$", ["СБП: Списано 100 р."]),
          },
        ],
      },
    });

    expect(intersectionsBlock(text)).toContain(
      `${BANK_PATH}/formats/a.txt → ${BANK_PATH}/formats/b.txt\n  «СБП: Перевод Ольга В. Списано 10000 р.»`
    );
    // Directed metric: b.txt does not recognize the example of a.txt.
    expect(intersectionsBlock(text)).not.toContain(
      `${BANK_PATH}/formats/b.txt → `
    );
    expect(intersectionsBlock(text)).toContain(
      "Примеры, не распознанные собственным regex (example_no_match):\n  (нет)"
    );
  });

  it("prints the block with (нет) when there is nothing to report", () => {
    const { text } = buildPackage({
      layers: {
        main: [
          {
            path: `${BANK_PATH}/formats/a.txt`,
            content: formatFile("^PAY (\\d+)$", ["PAY 100"]),
          },
        ],
        pr: [],
        draft: [],
      },
    });

    expect(intersectionsBlock(text)).toContain("\n\n(нет)\n\n");
  });

  it("lists own examples the format's own regex misses", () => {
    const { text } = buildPackage({
      layers: {
        main: [
          {
            path: `${BANK_PATH}/formats/a.txt`,
            content: formatFile("^PAY (\\d+)$", ["PAY 100", "REFUND 5"]),
          },
        ],
        pr: [],
        draft: [],
      },
    });

    expect(intersectionsBlock(text)).toContain(
      `example_no_match):\n  ${BANK_PATH}/formats/a.txt\n    «REFUND 5»`
    );
  });
});

describe("buildPromptPackage summary", () => {
  it("reports all three layers including zeroes, in package order", () => {
    const { summary } = buildPackage({
      layers: {
        main: [
          { path: "banks/tinkoff/senders.txt", content: "900" },
          { path: "banks/tinkoff/formats/a.txt", content: "regex-a" },
        ],
        pr: [],
        draft: [],
      },
    });

    expect(summary.layers).toEqual([
      { layer: "main", fileCount: 2 },
      { layer: "pr", fileCount: 0 },
      { layer: "draft", fileCount: 0 },
    ]);
    expect(summary.fileCount).toBe(2);
  });

  it("lists the included documents", () => {
    const { summary } = buildPackage({
      documents: [
        { name: "cookbook.md", content: "# Cookbook" },
        { name: "regex-snippets.toml", content: "[snippet]" },
      ],
    });

    expect(summary.documents).toEqual(["cookbook.md", "regex-snippets.toml"]);
  });

  it("passes through the files that did not make it into the package", () => {
    const skipped = [
      { path: "banks/tinkoff/formats/big.txt", reason: "truncated" as const },
      { path: "banks/tinkoff/formats/bin.txt", reason: "binary" as const },
    ];
    const { summary, text } = buildPackage({ skipped });

    expect(summary.skipped).toEqual(skipped);
    expect(text).not.toContain("big.txt");
  });

  it("counts UTF-8 bytes, not characters, on Cyrillic text", () => {
    const { text, summary } = buildPackage();

    const utf8Bytes = new TextEncoder().encode(text).length;
    expect(summary.bytes).toBe(utf8Bytes);
    // Cyrillic is two bytes per character: a character-based count would be
    // roughly half of this.
    expect(summary.bytes).toBeGreaterThan(text.length * 1.5);
    expect(summary.estimatedTokens).toBe(Math.round(utf8Bytes / 4));
  });
});
