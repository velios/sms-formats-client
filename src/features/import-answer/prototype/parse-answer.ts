// @ts-nocheck — копия прототипа парсера (#26) как есть; строгий
// noUncheckedIndexedAccess из src/ на неё не распространялся.
// ПРОТОТИП — не продакшн-код. Тикет #26 «Парсер ответа: что разбираем, где
// отказываем». Задача — дать факты на реальном корпусе, а не уехать в src/.
//
// Грамматика зеркалит сборку пакета (src/features/prompt-package/core.ts):
// блок пишется как `<tag ...>\n${body}\n</tag>`, тела вкладываются сырыми, без
// экранирования. Значит и разбирать надо построчно: открывающий и закрывающий
// теги — это отдельные строки целиком, а всё между ними — тело как есть.
// Поэтому `<` и `>` внутри regex формата не могут быть приняты за теги.

export type AnswerChange =
  | { kind: "write"; path: string; content: string; line: number }
  | { kind: "delete"; path: string; reason: string; line: number };

export type AnswerProblemKind =
  /** Блок открыт, но закрывающей строки до конца ответа нет. */
  | "unclosed"
  /** Закрывающая строка без открытой — обрыв начала или мусор съёма. */
  | "orphan-close"
  /** Открывающая строка похожа на тег, но атрибуты не разобрались. */
  | "malformed-open"
  /** Пустой `path` — блок есть, а куда его писать, неизвестно. */
  | "empty-path"
  /** Один и тот же путь встретился в двух блоках. */
  | "duplicate-path"
  /** По одному пути и запись, и удаление. */
  | "conflicting-path"
  /**
   * `<rename>` легенда пакета обещает, но принимаем мы его не изменением, а
   * отказом: в корпусе он не встретился ни разу (0 из 4), а поддержка стоит
   * отдельного вида строки на экране импорта и доработки записи в черновики
   * (`renameDraft` работает только поверх уже существующего черновика,
   * `src/store/index.ts:374`). Тег узнаём обязательно — иначе блок утечёт в
   * прозу и изменение потеряется молча.
   */
  | "unsupported-rename";

export interface AnswerProblem {
  kind: AnswerProblemKind;
  /** Номер строки в ответе, 1-based — чтобы человек нашёл место глазами. */
  line: number;
  /** Начало проблемного места, для показа человеку. */
  excerpt: string;
}

/**
 * Проблемы, означающие «блок не доехал»: что именно потеряно — неизвестно.
 * Импортировать разобранное нельзя: ответ агента — связное предложение
 * (решение 3 карты), и его половина может стереть форматы, не записав тех,
 * куда перенесены примеры.
 */
const BLOCK_LOST: ReadonlySet<AnswerProblemKind> = new Set([
  "unclosed",
  "orphan-close",
  "malformed-open",
  "empty-path",
]);

/**
 * Исход разбора. Объединение, а не флаг: у сломанного ответа поля `changes`
 * нет физически, поэтому нарисовать над ним список файлов и кнопку импорта
 * невозможно.
 *
 * Пустой `changes` при `status: "parsed"` — рабочий исход «импортировать
 * нечего» (ответ amex-us целиком проза), а не ошибка.
 */
export type ParsedAnswer =
  | {
      status: "broken";
      /** Хотя бы одна проблема из BLOCK_LOST. */
      problems: AnswerProblem[];
      /** Текст всё равно показываем — читать ответ можно и без импорта. */
      prose: string;
    }
  | {
      status: "parsed";
      /**
       * Строго в порядке появления в ответе — так же, как ответ читает
       * человек. Порядок ответа и есть порядок применения: если один путь
       * встретился дважды, побеждает последний блок. Разруливать дубли
       * парсер не должен — он только называет их в `problems`.
       */
      changes: AnswerChange[];
      /** Весь текст вне блоков, одним куском, как есть (п. 9 карты). */
      prose: string;
      /** Локальные странности: дубль пути, конфликт, `<rename>`. Могут быть пустыми. */
      problems: AnswerProblem[];
    };

const OPEN_FILE = /^<file\s+path="(.*)">\s*$/;
const OPEN_DELETE = /^<delete\s+path="(.*)">\s*$/;
const OPEN_RENAME = /^<rename\s+from="(.*)"\s+to="(.*)">\s*$/;
const CLOSE = /^<\/(file|delete|rename)>\s*$/;
// «Строка выглядит как открывающий тег» — по ней ловим malformed-open, чтобы
// сломанный тег не утёк молча в прозу.
const LOOKS_LIKE_OPEN = /^<(file|delete|rename)\b/;

export function parseAnswer(text: string): ParsedAnswer {
  const lines = text.split("\n");
  const changes: AnswerChange[] = [];
  const problems: AnswerProblem[] = [];
  const proseLines: string[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const lineNumber = index + 1;

    const file = OPEN_FILE.exec(line);
    const remove = OPEN_DELETE.exec(line);
    const rename = OPEN_RENAME.exec(line);

    if (!(file || remove || rename)) {
      const close = CLOSE.exec(line);
      if (close) {
        problems.push({
          kind: "orphan-close",
          line: lineNumber,
          excerpt: line,
        });
      } else if (LOOKS_LIKE_OPEN.test(line)) {
        problems.push({
          kind: "malformed-open",
          line: lineNumber,
          excerpt: line,
        });
      } else {
        proseLines.push(line);
      }
      index += 1;
      continue;
    }

    const tag = file ? "file" : remove ? "delete" : "rename";
    const body = readBody(lines, index + 1, tag);
    if (body === null) {
      problems.push({ kind: "unclosed", line: lineNumber, excerpt: line });
      // Незакрытый блок съедает остаток ответа — дальше разбирать нечего.
      break;
    }

    if (file) {
      pushChange(changes, problems, {
        kind: "write",
        path: file[1],
        content: body.text,
        line: lineNumber,
      });
    } else if (remove) {
      pushChange(changes, problems, {
        kind: "delete",
        path: remove[1],
        reason: body.text.trim(),
        line: lineNumber,
      });
    } else if (rename) {
      problems.push({
        kind: "unsupported-rename",
        line: lineNumber,
        excerpt: `${rename[1]} → ${rename[2]}`,
      });
    }

    index = body.nextIndex;
  }

  reportPathConflicts(changes, problems);

  const prose = proseLines.join("\n").trim();
  if (problems.some((problem) => BLOCK_LOST.has(problem.kind))) {
    return { status: "broken", problems, prose };
  }
  return { status: "parsed", changes, prose, problems };
}

function readBody(
  lines: string[],
  start: number,
  tag: string
): { text: string; nextIndex: number } | null {
  for (let index = start; index < lines.length; index += 1) {
    const close = CLOSE.exec(lines[index]);
    if (close && close[1] === tag) {
      return {
        text: lines.slice(start, index).join("\n"),
        nextIndex: index + 1,
      };
    }
  }
  return null;
}

function pushChange(
  changes: AnswerChange[],
  problems: AnswerProblem[],
  change: AnswerChange
): void {
  if (change.path.trim() === "") {
    problems.push({
      kind: "empty-path",
      line: change.line,
      excerpt: describe(change),
    });
    return;
  }
  changes.push(change);
}

function reportPathConflicts(
  changes: AnswerChange[],
  problems: AnswerProblem[]
): void {
  const seen = new Map<string, AnswerChange>();
  for (const change of changes) {
    const path = change.path;
    const previous = seen.get(path);
    if (previous) {
      const conflicting = previous.kind !== change.kind;
      problems.push({
        kind: conflicting ? "conflicting-path" : "duplicate-path",
        line: change.line,
        excerpt: `${path} (строка ${previous.line} и ${change.line})`,
      });
    }
    seen.set(path, change);
  }
}

function describe(change: AnswerChange): string {
  return `<${change.kind === "write" ? "file" : "delete"} path="${change.path}">`;
}
