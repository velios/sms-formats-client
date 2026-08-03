// ПРОТОТИП. Прогон парсера по реальному корпусу (#23). Запуск:
//   bun .agents/prototypes/answer-parser/report.ts
import { readFileSync } from "node:fs";
import { parseAnswer } from "./parse-answer";

const CORPUS = ".agents/research-corpus";
const PAIRS = ["amex-us", "centercredit-kz", "sber-ru"];

function show(title: string, text: string): void {
  const result = parseAnswer(text);
  console.log(`\n=== ${title} ===`);

  if (result.status === "broken") {
    console.log(`ОТКАЗ ЦЕЛИКОМ; прозы: ${result.prose.length} символов`);
  } else {
    const kinds = result.changes.reduce<Record<string, number>>(
      (acc, change) => {
        acc[change.kind] = (acc[change.kind] ?? 0) + 1;
        return acc;
      },
      {}
    );
    console.log(
      `разобрано: ${result.changes.length} ${JSON.stringify(kinds)}; прозы: ${result.prose.length} символов; проблем: ${result.problems.length}`
    );
    for (const change of result.changes) {
      const tail =
        change.kind === "write"
          ? `${change.content.split("\n").length} строк тела`
          : `причина: «${change.reason.slice(0, 60)}…»`;
      console.log(`  [${change.kind}] стр.${change.line} ${change.path} — ${tail}`);
    }
  }

  for (const problem of result.problems) {
    console.log(`  ! ${problem.kind} стр.${problem.line}: ${problem.excerpt}`);
  }
  console.log(
    `  проза (первые 120): «${result.prose.slice(0, 120).replace(/\n/g, "⏎")}…»`
  );
}

for (const pair of PAIRS) {
  show(pair, readFileSync(`${CORPUS}/${pair}.response.txt`, "utf8"));
}

// Загрязнение съёма в centercredit-kz: две последние строки — протёкшие теги
// tool-call субагента, не поведение модели. Смотрим и как есть, и без них.
const cleaned = readFileSync(`${CORPUS}/centercredit-kz.response.txt`, "utf8")
  .split("\n")
  .filter((line) => line !== "</content>" && line !== "</invoke>")
  .join("\n");
show("centercredit-kz (без мусора съёма)", cleaned);

// Синтетика: корпус поломок не содержит, а решение про отказ принимать надо.
const truncated = readFileSync(`${CORPUS}/sber-ru.response.txt`, "utf8")
  .split("\n")
  .slice(0, 95)
  .join("\n");
show("sber-ru, оборванный на 95-й строке (синтетика)", truncated);
