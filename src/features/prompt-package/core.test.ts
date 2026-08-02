import { describe, expect, it } from "vitest";
import {
  buildPromptPackage,
  type PromptPackageInput,
} from "@/features/prompt-package/core";

// The legend text as fixed by the PRD ("Состав пакета" → "Легенда"), written
// out here independently of the module so a silent edit of the constant fails.
const LEGEND_VERBATIM = `Это пакет данных для работы с форматами банковских SMS банка «Т-Банк». Структура пакета: этот блок \`legend\`, затем \`docs\` — справочные документы, затем блоки \`files\` — файлы банка в трёх слоях, в конце \`task\` — задача от пользователя.

Слои файлов: \`layer="main"\` — состояние в основной ветке репозитория; \`layer="pr"\` — версии из открытого pull request; \`layer="draft"\` — несохранённые правки из браузерного редактора. Слои независимы: если файла нет в слое \`pr\` или \`draft\`, в этом слое он не менялся, и действует его версия из предыдущего слоя. Слой может отсутствовать целиком — это значит, что в нём нет ни одного файла банка: нет \`layer="pr"\` или \`layer="draft"\` — банк в этом слое не менялся; нет \`layer="main"\` — банка ещё нет в основной ветке, он создаётся в этом pull request. Актуальность: \`draft\` новее \`pr\`, \`pr\` новее \`main\` — свежайшее намерение автора ищи в самом позднем слое, где файл присутствует.

Выполни задачу из блока \`task\`. Если задача требует изменить или создать файлы — верни полное новое тело каждого затронутого файла с указанием его \`path\`, без diff и без сокращений. Файлы, которых задача не касается, не трогай.`;

function buildPackage(overrides: Partial<PromptPackageInput> = {}) {
  return buildPromptPackage({
    bankName: "Т-Банк",
    layers: { main: [], pr: [], draft: [] },
    documents: [],
    task: "Сведи два формата в один",
    skipped: [],
    ...overrides,
  });
}

function tagsInOrder(text: string): string[] {
  return Array.from(text.matchAll(/^<(legend|docs|files[^>]*|task)>$/gm)).map(
    (match) => match[1] ?? ""
  );
}

describe("buildPromptPackage text", () => {
  it("orders blocks: legend, docs, three layers, task", () => {
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
    expect(tagsInOrder(text)).toEqual(["legend", 'files layer="main"', "task"]);
  });

  it('omits layer="main" for a bank created in this pull request', () => {
    const { text } = buildPackage({
      layers: {
        main: [],
        pr: [{ path: "banks/new/formats/a.txt", content: "regex-a" }],
        draft: [],
      },
    });

    expect(tagsInOrder(text)).toEqual(["legend", 'files layer="pr"', "task"]);
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
