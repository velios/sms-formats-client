// ПРОТОТИП. Запуск: bun test ./.agents/prototypes/answer-parser/parse-answer.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { AnswerChange, ParsedAnswer } from "./parse-answer";
import { parseAnswer } from "./parse-answer";

const CORPUS = ".agents/research-corpus";

const read = (pair: string) =>
  readFileSync(`${CORPUS}/${pair}.response.txt`, "utf8");

// Так пакет печатает файл (src/features/prompt-package/core.ts:109) — ответ
// зеркалит эту же форму.
const renderFile = (path: string, content: string) =>
  `<file path="${path}">\n${content}\n</file>`;

function parsed(text: string): Extract<ParsedAnswer, { status: "parsed" }> {
  const result = parseAnswer(text);
  if (result.status !== "parsed") {
    throw new Error(`ожидался parsed, пришёл ${result.status}`);
  }
  return result;
}

function broken(text: string): Extract<ParsedAnswer, { status: "broken" }> {
  const result = parseAnswer(text);
  if (result.status !== "broken") {
    throw new Error(`ожидался broken, пришёл ${result.status}`);
  }
  return result;
}

function write(change: AnswerChange) {
  if (change.kind !== "write") {
    throw new Error("ожидался write");
  }
  return change;
}

describe("корпус", () => {
  it("amex-us: ответ целиком проза — рабочий исход «импортировать нечего»", () => {
    const result = parsed(read("amex-us"));
    expect(result.changes).toHaveLength(0);
    expect(result.problems).toHaveLength(0);
    expect(result.prose.length).toBeGreaterThan(1000);
  });

  it("centercredit-kz: два <file>, проза до и после, мусор съёма уходит в прозу", () => {
    const result = parsed(read("centercredit-kz"));
    expect(result.changes.map((c) => c.kind)).toEqual(["write", "write"]);
    expect(result.problems).toHaveLength(0);
    // </content> и </invoke> — чужие теги; парсер их не знает и не спотыкается.
    expect(result.prose).toContain("</invoke>");
  });

  it("centercredit-kz: тело формата с пустой секцией COLUMNS сохранено дословно", () => {
    const format = write(parsed(read("centercredit-kz")).changes[0]);
    expect(format.content).toContain("-----COLUMNS-----");
    expect(format.content).toContain("-----EXAMPLE-----");
    // Тело начинается сразу со строки regex, без пустой строки от тега.
    expect(format.content.startsWith("-(\\d[\\d\\s.,]*)")).toBe(true);
  });

  it("sber-ru: 10 записей + 4 удаления, причина удаления снята целиком", () => {
    const result = parsed(read("sber-ru"));
    expect(result.changes.filter((c) => c.kind === "write")).toHaveLength(10);
    const deletes = result.changes.filter((c) => c.kind === "delete");
    expect(deletes).toHaveLength(4);
    for (const change of deletes) {
      if (change.kind !== "delete") {
        throw new Error("не delete");
      }
      expect(change.reason.length).toBeGreaterThan(0);
      expect(change.reason).not.toContain("\n");
    }
    expect(result.problems).toHaveLength(0);
  });

  it("sber-ru: проза после блоков сохранена — в ней замечание, которое агент не стал править сам", () => {
    expect(parsed(read("sber-ru")).prose).toContain("av_balance");
  });
});

describe("ловушки: то, что нельзя принять за поломку", () => {
  it("regex с < и > внутри тела не принимается за теги", () => {
    const body =
      "^Оплата (?<sum>\\d+) & <карта> ->\\s*(\\S+)\n\n-----COLUMNS-----\noutcome";
    const result = parsed(renderFile("src/Bank-ru_1/formats/a.txt", body));
    expect(result.problems).toHaveLength(0);
    expect(write(result.changes[0]).content).toBe(body);
  });

  it("строка тела, похожая на открывающий тег, остаётся телом", () => {
    const body = '<file path="это строка внутри тела">\nхвост';
    const result = parsed(renderFile("src/Bank-ru_1/formats/a.txt", body));
    expect(result.changes).toHaveLength(1);
    expect(write(result.changes[0]).content).toBe(body);
  });

  it("кавычка внутри пути не рвёт разбор", () => {
    const path = 'src/Bank-ru_1/formats/Он сказал "привет" в кассе.txt';
    const result = parsed(renderFile(path, "тело"));
    expect(result.changes).toHaveLength(1);
    expect(write(result.changes[0]).path).toBe(path);
  });

  it("круговая проверка: тело возвращается байт в байт", () => {
    const bodies = [
      "одна строка",
      "с хвостовым переводом строки\n",
      "\nс пустой первой строкой",
      "  с ведущими пробелами  ",
    ];
    for (const body of bodies) {
      const result = parsed(renderFile("src/Bank-ru_1/formats/a.txt", body));
      expect(write(result.changes[0]).content).toBe(body);
    }
  });
});

describe("блок не доехал — отказ на весь ответ", () => {
  it("обрыв на середине файла", () => {
    const text = [
      "Правлю два формата.",
      renderFile("src/Bank-ru_1/formats/a.txt", "тело A"),
      '<file path="src/Bank-ru_1/formats/b.txt">',
      "начало тела B, дальше модель упёрлась в лимит",
    ].join("\n");
    const result = broken(text);
    expect(result.problems).toEqual([
      {
        kind: "unclosed",
        line: 5,
        excerpt: '<file path="src/Bank-ru_1/formats/b.txt">',
      },
    ]);
    // Разобранный первый файл наверх не отдаётся: импортировать половину
    // связного предложения нельзя (решение 3 карты).
    expect(result).not.toHaveProperty("changes");
    // Прозу всё равно показываем.
    expect(result.prose).toContain("Правлю два формата.");
  });

  it("закрывающий тег без открывающего", () => {
    expect(broken("проза\n</file>\nещё проза").problems.map((p) => p.kind)).toEqual([
      "orphan-close",
    ]);
  });

  it("сломанный открывающий тег не утекает в прозу молча", () => {
    expect(broken('<file path=src/a.txt>\nтело\n</file>').problems.map((p) => p.kind)).toEqual([
      "malformed-open",
      "orphan-close",
    ]);
  });

  it("пустой path", () => {
    expect(broken(renderFile("", "тело")).problems.map((p) => p.kind)).toEqual([
      "empty-path",
    ]);
  });
});

describe("блок доехал, но с ним что-то не так — импорт доступен", () => {
  it("один путь в двух <file>", () => {
    const path = "src/Bank-ru_1/formats/a.txt";
    const result = parsed(
      `${renderFile(path, "первое тело")}\n${renderFile(path, "второе тело")}`
    );
    expect(result.problems.map((p) => p.kind)).toEqual(["duplicate-path"]);
    // Оба блока разобраны — что с ними делать, решает уровень выше.
    expect(result.changes).toHaveLength(2);
  });

  it("<file> и <delete> на один путь", () => {
    const path = "src/Bank-ru_1/formats/a.txt";
    const result = parsed(
      `${renderFile(path, "тело")}\n<delete path="${path}">\nдубль\n</delete>`
    );
    expect(result.problems.map((p) => p.kind)).toEqual(["conflicting-path"]);
    expect(result.changes).toHaveLength(2);
  });

  it("порядок ответа = порядок применения: побеждает последний", () => {
    const path = "src/Bank-ru_1/formats/a.txt";
    const result = parsed(
      `${renderFile(path, "первое тело")}\n${renderFile(path, "второе тело")}`
    );
    // Именно так это применит запись в черновики — сверткой по порядку.
    const applied = new Map<string, AnswerChange>();
    for (const change of result.changes) {
      applied.set(change.path, change);
    }
    expect(write(applied.get(path) as AnswerChange).content).toBe("второе тело");
  });

  it("<rename> узнаём, но отказываем — блок не теряется в прозе и не рушит импорт", () => {
    const result = parsed(
      [
        renderFile("src/Bank-ru_1/formats/a.txt", "тело"),
        '<rename from="src/Bank-ru_1/formats/b.txt" to="src/Bank-ru_1/formats/c.txt">',
        "имя формата пересчитано",
        "</rename>",
        "после",
      ].join("\n")
    );
    expect(result.problems).toEqual([
      {
        kind: "unsupported-rename",
        line: 4,
        excerpt: "src/Bank-ru_1/formats/b.txt → src/Bank-ru_1/formats/c.txt",
      },
    ]);
    expect(result.changes).toHaveLength(1);
    // Тело блока не утекает в прозу — иначе причина переименования смешается
    // с текстом агента.
    expect(result.prose).toBe("после");
  });
});

describe("край", () => {
  it("пустой ответ", () => {
    expect(parseAnswer("")).toEqual({
      status: "parsed",
      changes: [],
      prose: "",
      problems: [],
    });
  });
});
