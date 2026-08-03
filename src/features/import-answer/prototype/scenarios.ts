// ПРОТОТИП — не продакшн-код. Тикет #27 «Экран импорта: от вставки до записи
// в черновики». Задача — дать на что реагировать, а не уехать в приложение.
//
// Материал — настоящий корпус (#23): три пары «пакет → ответ». «Было» взято из
// самого пакета (слой pr поверх main), то есть ровно то, что видел агент и что
// импорт перезапишет — база сравнения из резолюции #24.

import amexResponse from "./fixtures/amex-us.response.txt?raw";
import beforeBodies from "./fixtures/before.json";
import centercreditResponse from "./fixtures/centercredit-kz.response.txt?raw";
import sberResponse from "./fixtures/sber-ru.response.txt?raw";
import { type ParsedAnswer, parseAnswer } from "./parse-answer";

export interface Scenario {
  id: string;
  /** Что этот случай проверяет на экране. */
  title: string;
  bankName: string;
  bankPath: string;
  answer: string;
  /** Действующие тела файлов банка: путь → тело. */
  before: Record<string, string>;
  /** Пути, по которым уже есть ручная правка — источник предупреждения. */
  manuallyEdited: string[];
}

const sberBefore = beforeBodies["sber-ru"] as Record<string, string | null>;
const centercreditBefore = beforeBodies["centercredit-kz"] as Record<
  string,
  string | null
>;

function known(bodies: Record<string, string | null>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(bodies).filter(([, body]) => body !== null)
  ) as Record<string, string>;
}

const SBER_PATH = "src/СберБанк-ru_4624";
const CENTERCREDIT_PATH = "src/Банк ЦентрКредит-kz_15361";
const AMEX_PATH = "src/American Express-us_4534";

// Съёмный мусор из centercredit (#26): к поведению модели отношения не имеет,
// но как orphan-close уронил бы весь ответ в «сломан».
const centercreditClean = centercreditResponse
  .replace(/\n<\/content>\n<\/invoke>\s*$/, "\n")
  .replace(/\n<\/content>\s*\n<\/invoke>\s*$/, "\n");

// Обрыв на 95-й строке: модель упёрлась в лимит посреди тела файла. В корпусе
// такого не случилось ни разу (#26) — случай сконструирован.
const sberTruncated = sberResponse.split("\n").slice(0, 95).join("\n");

// Ответ, выходящий за границу применимого (#25): README в корне банка и файл
// чужого банка. Обе формы вне белого списка.
const outOfBounds = `Поправил формат и заодно положил обзор форматов банка, чтобы не потерялось.

<file path="${SBER_PATH}/formats/Сбер счёт Зачисление пенсии р Баланс р_11792.txt">
${sberBefore[`${SBER_PATH}/formats/Сбер счёт Зачисление пенсии р Баланс р_11792.txt`] ?? ""}
</file>

<file path="${SBER_PATH}/README.md">
# Форматы СберБанка

Здесь лежат форматы разбора SMS.
</file>

<file path="src/Halyk Bank-kz_15360/formats/KZT Spisanie.txt">
-(\\d[\\d\\s.,]*)\\s+([A-Z]{3})\\s+Spisanie

-----COLUMNS-----
outcome;instrument

-----EXAMPLE-----
-4880 KZT Spisanie
</file>
`;

// Странности, которые импорт не рушат (#26): новый файл, <rename>, дубль пути.
const edgeCases = `Свёл два формата в один и переименовал третий под новое имя.

<file path="${SBER_PATH}/formats/Ozon банк Котоперевод по СБП новый.txt">
банк\\s+(\\d[\\d\\s.,]*)\\s*(\\S+)\\s*—\\s*У тебя ещё:\\s*(-?\\d[\\d\\s.,]*)

-----COLUMNS-----
outcome;instrument;balance

-----EXAMPLE-----
Ozon банк 500 ₽ — У тебя ещё: 161 926,75 ₽
</file>

<rename from="${SBER_PATH}/formats/Сбер счёт Зачисление пенсии р Баланс р_11792.txt" to="${SBER_PATH}/formats/MIR Покупка Баланс_5962.txt">
Имя не совпадало с вычисленным по regex.
</rename>

<file path="${SBER_PATH}/formats/Сбер счёт Зачисление пенсии р Баланс р_11792.txt">
${sberBefore[`${SBER_PATH}/formats/Сбер счёт Зачисление пенсии р Баланс р_11792.txt`] ?? ""}
</file>

<file path="${SBER_PATH}/formats/Сбер счёт Зачисление пенсии р Баланс р_11792.txt">
${sberBefore[`${SBER_PATH}/formats/Сбер счёт Зачисление пенсии р Баланс р_11792.txt`] ?? ""}
</file>
`;

export const SCENARIOS: Scenario[] = [
  {
    id: "sber",
    title: "Сбер: 7 переписано, 4 удалено, длинная проза",
    bankName: "СберБанк",
    bankPath: SBER_PATH,
    answer: sberResponse,
    before: known(sberBefore),
    manuallyEdited: [
      `${SBER_PATH}/formats/Перенесли покупки на кредитную карту Зачислили p н_11803.txt`,
    ],
  },
  {
    id: "centercredit",
    title: "ЦентрКредит: 2 файла (один — senders.txt), в прозе два отказа",
    bankName: "Банк ЦентрКредит",
    bankPath: CENTERCREDIT_PATH,
    answer: centercreditClean,
    before: known(centercreditBefore),
    manuallyEdited: [],
  },
  {
    id: "amex",
    title: "Amex: ни одного блока, ответ целиком проза",
    bankName: "American Express",
    bankPath: AMEX_PATH,
    answer: amexResponse,
    before: {},
    manuallyEdited: [],
  },
  {
    id: "broken",
    title: "Обрыв на середине файла — импортировать нельзя",
    bankName: "СберБанк",
    bankPath: SBER_PATH,
    answer: sberTruncated,
    before: known(sberBefore),
    manuallyEdited: [],
  },
  {
    id: "out-of-bounds",
    title: "Выход за границу: README и чужой банк — отказ целиком",
    bankName: "СберБанк",
    bankPath: SBER_PATH,
    answer: outOfBounds,
    before: known(sberBefore),
    manuallyEdited: [],
  },
  {
    id: "edge",
    title: "Странности: новый файл, <rename>, дубль пути",
    bankName: "СберБанк",
    bankPath: SBER_PATH,
    answer: edgeCases,
    before: known(sberBefore),
    manuallyEdited: [],
  },
];

// ——— граница применимого (#25) ———

export interface BoundaryViolation {
  path: string;
  reason: "foreign-bank" | "not-a-format-file";
}

export function checkBoundary(
  bankPath: string,
  paths: string[]
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const path of paths) {
    if (path === `${bankPath}/senders.txt`) {
      continue;
    }
    const formats = `${bankPath}/formats/`;
    if (path.startsWith(formats)) {
      const tail = path.slice(formats.length);
      if (tail.endsWith(".txt") && !tail.includes("/")) {
        continue;
      }
    }
    violations.push({
      path,
      reason: path.startsWith(`${bankPath}/`)
        ? "not-a-format-file"
        : "foreign-bank",
    });
  }
  return violations;
}

// ——— разбор сценария в то, что рисует экран ———

export type RowKind = "changed" | "created" | "deleted" | "identical";

export interface ChangeRow {
  path: string;
  fileName: string;
  kind: RowKind;
  /** Причина из блока `<delete>`. */
  reason: string | null;
  before: string | null;
  after: string | null;
  /** По этому пути уже есть ручная правка — импорт её перезапишет. */
  overwritesManualEdit: boolean;
}

export interface ScenarioView {
  parsed: ParsedAnswer;
  prose: string;
  rows: ChangeRow[];
  violations: BoundaryViolation[];
  /** Импорт возможен: ответ разобран и границы не нарушены. */
  importable: boolean;
  overwriteCount: number;
}

export function buildView(scenario: Scenario): ScenarioView {
  const parsed = parseAnswer(scenario.answer);
  if (parsed.status === "broken") {
    return {
      parsed,
      prose: parsed.prose,
      rows: [],
      violations: [],
      importable: false,
      overwriteCount: 0,
    };
  }

  const violations = checkBoundary(
    scenario.bankPath,
    parsed.changes.map((change) => change.path)
  );

  const rows: ChangeRow[] = parsed.changes.map((change) => {
    const before = scenario.before[change.path] ?? null;
    const overwritesManualEdit = scenario.manuallyEdited.includes(change.path);
    const fileName = change.path.split("/").pop() ?? change.path;
    if (change.kind === "delete") {
      return {
        path: change.path,
        fileName,
        kind: "deleted",
        reason: change.reason,
        before,
        after: null,
        overwritesManualEdit,
      };
    }
    const identical =
      before !== null && before.trim() === change.content.trim();
    return {
      path: change.path,
      fileName,
      kind: before === null ? "created" : identical ? "identical" : "changed",
      reason: null,
      before,
      after: change.content,
      overwritesManualEdit,
    };
  });

  return {
    parsed,
    prose: parsed.prose,
    rows,
    violations,
    importable: violations.length === 0,
    overwriteCount: rows.filter((row) => row.overwritesManualEdit).length,
  };
}
