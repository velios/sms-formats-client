// ПРОТОТИП — вариант D: B с двумя правками по замечаниям, доведённый до вида,
// который можно брать в продакшн почти как есть.
//
// Что было выбрано человеком и здесь не пересматривается:
// 1. Удаление несёт два признака, а не один: красная точка и корзина — в том
//    же слоте, где у перезаписи ручной правки стоит карандаш. Одного цвета
//    мало: цвет различает четыре вида, корзина называет тот, который необратим.
// 2. Имя обрезается посередине: хвост `_11792.txt` — номер формата в апстриме,
//    и он виден всегда.
// 3. Компоновка B: список слева, детали справа, проза первой строкой списка,
//    итог в правой панели.
//
// Что доведено здесь:
// • Палитра — из токенов приложения, а не из тёмной темы GitHub. Синий
//   `--c-accent` для «изменён» и зелёный `--c-success` для «нового» — это то
//   же, чем список файлов банка (`BankWorkspace.tsx`) метит свои строки, так
//   что человек, закрыв модалку, видит те же цвета. `--c-warning` потрачен
//   ровно на один смысл: «что-то потеряется». `--c-error` — «необратимо или
//   нельзя».
// • Жёлоб статуса: точка — геометрическая, а не глиф `•`, ширина слота
//   постоянная, и та же метка поднимается в шапку правой панели, когда строка
//   выбрана. Взгляду не приходится заново находить, на что он смотрит.
// • Удаление опознаётся ещё и зачёркиванием — как в списке файлов банка. Это
//   единственный признак, который переживает чёрно-белую печать и дальтонизм:
//   красный и зелёный кружки рядом различает не каждый.
// • Строка разбора говорит правду в каждом состоянии (была «Ответ разобран»
//   поверх неразобранного ответа) и заодно работает легендой для жёлоба.
// • Ненесущие проблемы разбора (выброшенный `<rename>`, дубль пути) больше не
//   теряются молча.
// • Выделение хранится индексом, а не путём: у `edge` один путь встречается
//   дважды, и по пути подсвечивались обе строки сразу.
// • Клавиатура: список — настоящий listbox со стрелками, ролями и кольцом
//   фокуса.

import {
  Ban,
  FilePlus2,
  MessageSquareText,
  Pencil,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { StructuralDiff } from "./StructuralDiff";
import type {
  BoundaryViolation,
  ChangeRow,
  RowKind,
  Scenario,
  ScenarioView,
} from "./scenarios";
import { PROBLEM_TEXT, violationText } from "./shared";

export const NAME = "Две панели + корзина и номер файла";

const PROSE_INDEX = -1;

/** Порядок в легенде — от самого частого исхода к самому редкому. */
const KIND_ORDER: RowKind[] = ["changed", "created", "deleted", "identical"];

/**
 * Четыре вида изменения — закрытый список. Цвет берётся из токенов, а не из
 * тёмной темы GitHub: синий «изменён» и зелёный «новый» совпадают с тем, чем
 * список файлов банка метит локально изменённый и локально созданный файл.
 */
const KIND: Record<
  RowKind,
  { label: string; dot: string; text: string; forms: [string, string, string] }
> = {
  changed: {
    label: "изменён",
    dot: "bg-[color:var(--c-accent)]",
    text: "text-[color:var(--c-accent)]",
    forms: ["изменённый", "изменённых", "изменённых"],
  },
  created: {
    label: "новый",
    dot: "bg-[color:var(--c-success)]",
    text: "text-[color:var(--c-success)]",
    forms: ["новый", "новых", "новых"],
  },
  deleted: {
    label: "удалён",
    dot: "bg-[color:var(--c-error)]",
    text: "text-[color:var(--c-error)]",
    forms: ["удалённый", "удалённых", "удалённых"],
  },
  identical: {
    label: "без изменений",
    dot: "bg-[color:var(--c-text-dim)]",
    text: "text-[color:var(--c-text-dim)]",
    forms: ["без изменений", "без изменений", "без изменений"],
  },
};

function plural(count: number, forms: [string, string, string]): string {
  const tens = count % 100;
  const ones = count % 10;
  if (ones === 1 && tens !== 11) {
    return forms[0];
  }
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) {
    return forms[1];
  }
  return forms[2];
}

/**
 * Делит имя на голову (её можно обрезать) и хвост, который обрезать нельзя:
 * `_11792.txt` — номер формата в апстриме, главный признак «файл уже есть».
 */
function splitName(fileName: string): { head: string; tail: string } {
  const withId = /^(.*?)(_\d+\.txt)$/.exec(fileName);
  if (withId) {
    return { head: withId[1] ?? "", tail: withId[2] ?? "" };
  }
  // Номера нет — вешать отдельно `.txt` незачем, это шум: пусть имя
  // обрезается как обычно, а «номера нет» само по себе признак.
  return { head: fileName, tail: "" };
}

/**
 * Откуда файл взялся. Правило «есть номер → файл существует» держится только
 * в одну сторону: номер присваивает апстрим при публикации, поэтому файл,
 * заведённый в текущем PR, существует, но номера не имеет. В списке это
 * различать нечем, поэтому ответ даётся словами в правой панели.
 */
function provenanceText(row: ChangeRow): string {
  if (row.path.endsWith("/senders.txt")) {
    return "Список отправителей банка — номера у него нет и не будет";
  }
  const { tail } = splitName(row.fileName);
  const id = tail === "" ? null : tail.replace(/^_/, "").replace(/\.txt$/, "");
  const exists = row.before !== null;
  if (id !== null && exists) {
    return `Опубликован в апстриме — № ${id}`;
  }
  if (id !== null) {
    return `Номер № ${id} в имени есть, а файла в банке нет`;
  }
  if (exists) {
    return "Заведён в этом PR — номер апстрим присвоит при публикации";
  }
  return "Файла в банке нет — агент создаёт его";
}

// ─── мелкие детали, общие для списка и правой панели ───

function KindDot({ kind }: { kind: RowKind }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 shrink-0 rounded-full ${KIND[kind].dot}`}
    />
  );
}

/**
 * Слот значка. Занят только у удаления: если значок появится ещё у одного
 * вида, он перестанет означать «вот необратимое» и станет просто украшением.
 * У остальных слот держит выравнивание пустым.
 */
function KindIcon({ kind }: { kind: RowKind }) {
  if (kind === "deleted") {
    return (
      <Trash2
        aria-hidden="true"
        className="size-3.5 shrink-0 text-[color:var(--c-error)]"
      />
    );
  }
  if (kind === "created") {
    return (
      <FilePlus2
        aria-hidden="true"
        className="size-3.5 shrink-0 text-[color:var(--c-success)]"
      />
    );
  }
  return <span aria-hidden="true" className="size-3.5 shrink-0" />;
}

/**
 * Файл за границей банка не «новый» и не «изменённый»: с ним не произойдёт
 * ничего, потому что из-за него не произойдёт ничего вообще. Вид изменения для
 * такой строки — неправда, поэтому жёлоб показывает запрет.
 */
function Gutter({ kind, rejected }: { kind: RowKind; rejected?: boolean }) {
  if (rejected) {
    return (
      <span className="flex shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full bg-[color:var(--c-error)]"
        />
        <Ban
          aria-hidden="true"
          className="size-3.5 shrink-0 text-[color:var(--c-error)]"
        />
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-2">
      <KindDot kind={kind} />
      <KindIcon kind={kind} />
    </span>
  );
}

/**
 * Имя: человеческая фраза обрезается, номер формата — никогда.
 *
 * Удаление зачёркивается так же, как в списке файлов банка: цветом самой
 * строки, а не красным. Красное здесь уже есть — точка и корзина; третий
 * красный признак только шумит, а зачёркивание нужно ради тех, кто красный
 * от зелёного не отличает.
 */
function FileName({
  row,
  superseded,
}: {
  row: ChangeRow;
  superseded: boolean;
}) {
  const { head, tail } = splitName(row.fileName);
  // Зачёркивание значит ровно одно — «файла не станет». Перекрытый дубль
  // только гаснет и подписывается словами: иначе один приём означал бы два
  // разных исхода.
  return (
    <span
      className={`flex min-w-0 flex-1 items-baseline text-[13px] ${
        row.kind === "deleted"
          ? "line-through decoration-1 decoration-current"
          : ""
      } ${superseded ? "text-[color:var(--c-text-dim)]" : ""}`}
    >
      <span className="min-w-0 truncate">{head}</span>
      {tail !== "" && (
        <span
          className={`shrink-0 font-mono text-[11.5px] tabular-nums ${
            superseded
              ? "text-[color:var(--c-text-dim)]"
              : "text-[color:var(--c-text-muted)]"
          }`}
        >
          {tail}
        </span>
      )}
    </span>
  );
}

/** Сводка по видам — она же легенда жёлоба: те же точки, что в строках. */
function CountsLegend({
  counts,
  className,
}: {
  counts: Record<RowKind, number>;
  className?: string;
}) {
  const shown = KIND_ORDER.filter((kind) => counts[kind] > 0);
  if (shown.length === 0) {
    return null;
  }
  return (
    <span
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className ?? ""}`}
    >
      {shown.map((kind) => (
        <span className="flex items-center gap-1.5" key={kind}>
          <KindDot kind={kind} />
          <span className="tabular-nums">{counts[kind]}</span>
          <span className="text-[color:var(--c-text-muted)]">
            {plural(counts[kind], KIND[kind].forms)}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Метка «здесь пропадёт ваша правка» — тот же слот, что у корзины напротив. */
function OverwriteMark() {
  return (
    <span
      className="flex shrink-0 items-center text-[color:var(--c-warning)]"
      title="Импорт перезапишет вашу ручную правку"
    >
      <Pencil aria-hidden="true" className="size-3.5" />
      <span className="sr-only">перезапишет вашу ручную правку</span>
    </span>
  );
}

// ─── шапка: что вообще приехало ───

function ParseSummary({
  blocked,
  broken,
  counts,
  done,
  hasRows,
  onShowText,
  overwriteCount,
}: {
  blocked: boolean;
  broken: boolean;
  counts: Record<RowKind, number>;
  /** Импорт уже состоялся: предупреждать о будущем больше не о чем. */
  done: boolean;
  hasRows: boolean;
  onShowText: () => void;
  overwriteCount: number;
}) {
  return (
    <div className="flex items-center gap-4 rounded-[var(--radius-md)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-3 py-2 text-[13px]">
      {broken && (
        <span className="text-[color:var(--c-error)]">Ответ не разобран</span>
      )}
      {!broken && blocked && (
        <span className="text-[color:var(--c-error)]">
          Разобран, но выходит за границу банка
        </span>
      )}
      {!(broken || blocked || hasRows) && (
        <span className="text-[color:var(--c-text-muted)]">
          Ответ разобран — файлов в нём нет
        </span>
      )}
      {/* При отказе счётчики врут: ни один из этих файлов никуда не поедет. */}
      {!blocked && hasRows && <CountsLegend counts={counts} />}
      {overwriteCount > 0 && !(blocked || done) && (
        <span className="flex items-center gap-1.5 text-[color:var(--c-warning)]">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {overwriteCount} {plural(overwriteCount, ["файл", "файла", "файлов"])}{" "}
          {plural(overwriteCount, [
            "перезапишет",
            "перезапишут",
            "перезапишут",
          ])}{" "}
          вашу правку
        </span>
      )}
      <Button
        className="ml-auto"
        onClick={onShowText}
        size="xs"
        type="button"
        variant="default"
      >
        Показать текст
      </Button>
    </div>
  );
}

// ─── отказ целиком: что случилось и что с этим делать ───

function RefusalBanner({
  broken,
  problems,
  violations,
  onPasteAgain,
}: {
  broken: boolean;
  problems: Array<{ kind: keyof typeof PROBLEM_TEXT; line: number }>;
  violations: BoundaryViolation[];
  onPasteAgain: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color:var(--c-error)] bg-[color:var(--c-error-soft)] p-3">
      <StatusBadge variant="error">
        {broken
          ? "Ответ оборвался — импортировать нечего"
          : "Ответ трогает файлы за пределами банка"}
      </StatusBadge>
      <div className="flex flex-col gap-1 text-[12px]">
        {problems.map((problem) => (
          <div key={`${problem.kind}-${problem.line}`}>
            <span className="text-[color:var(--c-text-muted)]">
              строка {problem.line}
            </span>{" "}
            — {PROBLEM_TEXT[problem.kind]}
          </div>
        ))}
        {violations.map((violation) => (
          <div key={violation.path}>
            <code className="font-mono">{violation.path}</code>{" "}
            <span className="text-[color:var(--c-text-muted)]">
              — {violationText(violation)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-1 text-[12px] text-[color:var(--c-text-muted)]">
        {broken
          ? "Попросите агента дописать ответ и вставьте его целиком."
          : "Уберите эти файлы из ответа и вставьте его заново."}
        <Button
          onClick={onPasteAgain}
          size="xs"
          type="button"
          variant="secondary"
        >
          Вставить заново
        </Button>
      </div>
    </div>
  );
}

/** Странности, которые импорт не рушат, но что-то из ответа теряют. */
function LossNotice({
  problems,
}: {
  problems: Array<{ kind: keyof typeof PROBLEM_TEXT; line: number }>;
}) {
  return (
    <div className="flex flex-col gap-1 border-[color:var(--c-warning)] border-l-2 py-1 pl-3 text-[12px]">
      <span className="font-medium text-[color:var(--c-warning)]">
        Часть ответа не доехала
      </span>
      {problems.map((problem) => (
        <div
          className="text-[color:var(--c-text-muted)]"
          key={`${problem.kind}-${problem.line}`}
        >
          строка {problem.line} — {PROBLEM_TEXT[problem.kind]}
        </div>
      ))}
    </div>
  );
}

// ─── правая панель ───

function ProsePanel({ text }: { text: string }) {
  const empty = text.trim() === "";
  return (
    <div className="flex flex-col gap-2">
      <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
        Текст ответа вне блоков
      </div>
      <div
        className={`max-w-[68ch] whitespace-pre-wrap text-[13.5px] leading-[1.7] ${
          empty
            ? "text-[color:var(--c-text-dim)]"
            : "text-[color:var(--c-text)]"
        }`}
      >
        {empty ? "Агент не написал ничего, кроме самих изменений." : text}
      </div>
    </div>
  );
}

function RowPanel({
  row,
  superseded,
  violation,
}: {
  row: ChangeRow;
  superseded: boolean;
  violation: BoundaryViolation | undefined;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Та же метка, что в строке слева, — подхваченная сюда. */}
      <div className="flex items-center gap-2 border-[color:var(--c-border)] border-b pb-3">
        <Gutter kind={row.kind} rejected={violation !== undefined} />
        <span className="min-w-0 flex-1 break-all font-mono text-[12px] leading-[1.5]">
          {row.path}
        </span>
        <span
          className={`shrink-0 text-[12px] ${
            violation === undefined
              ? KIND[row.kind].text
              : "text-[color:var(--c-error)]"
          }`}
        >
          {violation === undefined ? KIND[row.kind].label : "за границей"}
        </span>
      </div>

      {violation === undefined && (
        <div className="text-[12px] text-[color:var(--c-text-muted)]">
          {provenanceText(row)}
        </div>
      )}

      {superseded && (
        <div className="border-[color:var(--c-warning)] border-l-2 py-1 pl-3 text-[12px] text-[color:var(--c-text-muted)]">
          Этот блок не применится: ниже в ответе тот же путь, и побеждает
          последний.
        </div>
      )}

      {row.overwritesManualEdit && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--c-warning)] bg-[color:var(--c-warning-soft)] p-2 text-[12px] text-[color:var(--c-warning)]">
          <Pencil aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          Здесь есть ваша правка — импорт её перезапишет.
        </div>
      )}

      {violation ? (
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="text-[color:var(--c-error)]">
            Файл за границей банка: {violationText(violation)}.
          </div>
          <div className="text-[color:var(--c-text-muted)]">
            Пока он в ответе, импортировать нельзя — ни его, ни остальные.
          </div>
        </div>
      ) : (
        <StructuralDiff row={row} />
      )}
    </div>
  );
}

function ResultPanel({
  counts,
  recalculate,
}: {
  counts: Record<RowKind, number>;
  recalculate: boolean;
}) {
  return (
    <div className="flex max-w-[52ch] flex-col gap-3">
      <StatusBadge variant="success">Записано в черновики</StatusBadge>
      <CountsLegend className="text-[14px]" counts={counts} />
      <div className="text-[13px] text-[color:var(--c-text-muted)]">
        {recalculate
          ? "Пересечения пересчитаны: было 3 пары, стало 0."
          : "Пересечения не пересчитывались."}
      </div>
      {/* Пустой экран после действия — место для следующего шага, а не для
          поздравления. */}
      <div className="border-[color:var(--c-border)] border-t pt-3 text-[13px] text-[color:var(--c-text-muted)] leading-[1.6]">
        Черновики видны в списке файлов банка. Пока они не опубликованы, их
        можно править и откатывать.
      </div>
    </div>
  );
}

/**
 * Список — манифест: что произойдёт с каждым файлом банка. Строки живут
 * индексами, а не путями: один путь может встретиться в ответе дважды.
 */
function Manifest({
  broken,
  frozen,
  hasProse,
  onKeyDown,
  onSelect,
  ref,
  rejectedPaths,
  rows,
  selectedIndex,
  supersededIndexes,
}: {
  broken: boolean;
  /** Импорт уже случился — читать можно, менять выбор незачем. */
  frozen: boolean;
  hasProse: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onSelect: (index: number) => void;
  ref: RefObject<HTMLDivElement | null>;
  rejectedPaths: Map<string, BoundaryViolation>;
  rows: ChangeRow[];
  selectedIndex: number;
  supersededIndexes: Set<number>;
}) {
  const rowClassName = (isSelected: boolean) =>
    `flex w-full items-center gap-2 border-[color:var(--c-border)] border-b border-l-2 px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)] focus-visible:ring-inset ${
      isSelected
        ? "border-l-[color:var(--c-accent)] bg-[color:var(--c-bg-hover)] font-medium"
        : "border-l-transparent hover:bg-[color:var(--c-bg-elevated)]"
    }`;

  return (
    <div
      aria-label="Что изменится"
      className={`flex w-[384px] shrink-0 flex-col overflow-y-auto rounded-[var(--radius-md)] border border-[color:var(--c-border)] ${
        frozen ? "pointer-events-none opacity-55" : ""
      }`}
      onKeyDown={onKeyDown}
      ref={ref}
      role="listbox"
      tabIndex={-1}
    >
      <button
        aria-selected={selectedIndex === PROSE_INDEX}
        className={rowClassName(selectedIndex === PROSE_INDEX)}
        data-index={PROSE_INDEX}
        onClick={() => onSelect(PROSE_INDEX)}
        role="option"
        tabIndex={selectedIndex === PROSE_INDEX ? 0 : -1}
        type="button"
      >
        {/* Комментарий — не файл, поэтому точки у него нет: слот пустой, а
            выравнивание с файлами сохраняется. */}
        <span className="flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0" />
          <MessageSquareText
            aria-hidden="true"
            className="size-3.5 shrink-0 text-[color:var(--c-text-dim)]"
          />
        </span>
        <span className="flex-1 text-[13px]">Комментарий агента</span>
        {!hasProse && (
          <span className="text-[11px] text-[color:var(--c-text-dim)]">
            пусто
          </span>
        )}
      </button>

      {rows.map((row, rowIndex) => (
        <button
          aria-selected={selectedIndex === rowIndex}
          className={rowClassName(selectedIndex === rowIndex)}
          data-index={rowIndex}
          key={`${row.path}#${rowIndex}`}
          onClick={() => onSelect(rowIndex)}
          role="option"
          tabIndex={selectedIndex === rowIndex ? 0 : -1}
          type="button"
        >
          <Gutter kind={row.kind} rejected={rejectedPaths.has(row.path)} />
          <FileName row={row} superseded={supersededIndexes.has(rowIndex)} />
          {rejectedPaths.has(row.path) && (
            <span className="shrink-0 text-[11px] text-[color:var(--c-error)]">
              за границей
            </span>
          )}
          {supersededIndexes.has(rowIndex) && (
            <span className="shrink-0 text-[11px] text-[color:var(--c-text-dim)]">
              перекрыт ниже
            </span>
          )}
          {row.overwritesManualEdit && <OverwriteMark />}
        </button>
      ))}

      {rows.length === 0 && (
        <div className="px-3 py-4 text-[12px] text-[color:var(--c-text-dim)]">
          {broken
            ? "Файлов нет: ответ оборвался раньше, чем закрылся первый блок."
            : "Файлов в ответе нет — агент только написал комментарий."}
        </div>
      )}
    </div>
  );
}

/** Вставка — состояние, с которого экран начинается в жизни. */
function PasteView({
  onCancel,
  onChange,
  onParse,
  text,
}: {
  onCancel: () => void;
  onChange: (next: string) => void;
  onParse: () => void;
  text: string;
}) {
  const lines = text.split("\n").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
        Ответ агента
      </div>
      <Textarea
        className="min-h-0 flex-1 font-mono text-[12px] leading-[1.6]"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Вставьте ответ агента или перетащите файл"
        value={text}
      />
      <div className="flex items-center gap-3 border-[color:var(--c-border)] border-t pt-4">
        <Button
          disabled={text.trim() === ""}
          onClick={onParse}
          type="button"
          variant="primary"
        >
          Разобрать
        </Button>
        <span className="text-[12px] text-[color:var(--c-text-dim)] tabular-nums">
          {text.trim() === ""
            ? "Пока пусто"
            : `${lines} ${plural(lines, ["строка", "строки", "строк"])}`}
        </span>
        <Button
          className="ml-auto"
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          Отмена
        </Button>
      </div>
    </div>
  );
}

// ─── экран ───

export function VariantD({
  scenario,
  view,
  onClose,
}: {
  scenario: Scenario;
  view: ScenarioView;
  onClose: () => void;
}) {
  const titleId = useId();
  const [text, setText] = useState(scenario.answer);
  const [showingText, setShowingText] = useState(false);
  // Индексом, а не путём: один путь может встретиться дважды (`edge`).
  const [selectedIndex, setSelectedIndex] = useState(PROSE_INDEX);
  const [recalculate, setRecalculate] = useState(true);
  const [imported, setImported] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const broken = view.parsed.status === "broken";
  const violated = view.violations.length > 0;
  const blocked = broken || violated;
  const hasRows = view.rows.length > 0;
  const canImport = !blocked && hasRows;
  const selectedRow = view.rows[selectedIndex] ?? null;

  const counts = useMemo(() => {
    const next: Record<RowKind, number> = {
      changed: 0,
      created: 0,
      deleted: 0,
      identical: 0,
    };
    for (const row of view.rows) {
      next[row.kind] += 1;
    }
    return next;
  }, [view.rows]);

  const violationByPath = useMemo(
    () => new Map(view.violations.map((item) => [item.path, item])),
    [view.violations]
  );

  // Один путь может встретиться дважды: применится последний блок. Строку,
  // которую перекрыли, надо назвать — иначе человек читает список, где две
  // строки говорят разное про один файл, и не знает, какая победит.
  const superseded = useMemo(() => {
    const lastIndexByPath = new Map<string, number>();
    view.rows.forEach((row, index) => lastIndexByPath.set(row.path, index));
    return new Set(
      view.rows
        .map((row, index) =>
          lastIndexByPath.get(row.path) === index ? -1 : index
        )
        .filter((index) => index >= 0)
    );
  }, [view.rows]);

  // Ненесущие проблемы показываем только когда ответ в целом доехал: у
  // сломанного их называет баннер отказа.
  const lossProblems = useMemo(
    () => (view.parsed.status === "parsed" ? view.parsed.problems : []),
    [view.parsed]
  );

  // Экран открывается для чтения, поэтому фокус встаёт на список, а не на
  // первую попавшуюся кнопку: стрелки работают сразу, и Enter ничего не
  // запускает случайно.
  const focusList = useCallback((event: Event) => {
    event.preventDefault();
    const list = listRef.current;
    (
      list?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? list
    )?.focus();
  }, []);

  const select = useCallback((index: number) => {
    setSelectedIndex(index);
    detailRef.current?.scrollTo({ top: 0 });
  }, []);

  const onListKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const step =
        event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step === 0) {
        return;
      }
      event.preventDefault();
      const next = Math.min(
        view.rows.length - 1,
        Math.max(PROSE_INDEX, selectedIndex + step)
      );
      select(next);
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)
        ?.focus();
    },
    [select, selectedIndex, view.rows.length]
  );

  return (
    <ModalDialog
      className="flex h-[calc(100vh-64px)] max-h-[860px] flex-col gap-0 sm:max-w-[1080px]"
      onClose={onClose}
      onOpenAutoFocus={focusList}
      title={`Импортировать ответ · ${scenario.bankName}`}
      titleId={titleId}
    >
      {showingText && (
        <PasteView
          onCancel={onClose}
          onChange={setText}
          onParse={() => setShowingText(false)}
          text={text}
        />
      )}

      {!showingText && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ParseSummary
            blocked={blocked}
            broken={broken}
            counts={counts}
            done={imported}
            hasRows={hasRows}
            onShowText={() => setShowingText(true)}
            overwriteCount={view.overwriteCount}
          />

          {blocked && (
            <RefusalBanner
              broken={broken}
              onPasteAgain={() => setShowingText(true)}
              problems={broken ? view.parsed.problems : []}
              violations={view.violations}
            />
          )}

          {!blocked && lossProblems.length > 0 && (
            <LossNotice problems={lossProblems} />
          )}

          <div className="flex min-h-0 flex-1 gap-3">
            <Manifest
              broken={broken}
              frozen={imported}
              hasProse={view.prose.trim() !== ""}
              onKeyDown={onListKeyDown}
              onSelect={select}
              ref={listRef}
              rejectedPaths={violationByPath}
              rows={view.rows}
              selectedIndex={selectedIndex}
              supersededIndexes={superseded}
            />

            <div
              className="min-w-0 flex-1 overflow-y-auto rounded-[var(--radius-md)] border border-[color:var(--c-border)] p-4"
              ref={detailRef}
            >
              {imported && (
                <ResultPanel counts={counts} recalculate={recalculate} />
              )}
              {!imported && selectedIndex === PROSE_INDEX && (
                <ProsePanel text={view.prose} />
              )}
              {!imported && selectedRow !== null && (
                <RowPanel
                  row={selectedRow}
                  superseded={superseded.has(selectedIndex)}
                  violation={violationByPath.get(selectedRow.path)}
                />
              )}
              {!(imported || selectedIndex === PROSE_INDEX) &&
                selectedRow === null && (
                  <div className="text-[13px] text-[color:var(--c-text-dim)]">
                    Выберите строку слева.
                  </div>
                )}
            </div>
          </div>

          <div className="flex items-center gap-3 border-[color:var(--c-border)] border-t pt-3">
            {!imported && (
              <>
                <Button
                  disabled={!canImport}
                  onClick={() => setImported(true)}
                  type="button"
                  variant="primary"
                >
                  Записать в черновики
                </Button>
                <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] has-disabled:cursor-default has-disabled:text-[color:var(--c-text-dim)]">
                  <input
                    checked={recalculate}
                    className="accent-[color:var(--c-border-focus)]"
                    disabled={!canImport}
                    onChange={(event) => setRecalculate(event.target.checked)}
                    type="checkbox"
                  />
                  Пересчитать пересечения
                </label>
                {!(canImport || blocked) && (
                  <span className="text-[12px] text-[color:var(--c-text-muted)]">
                    Записывать нечего.
                  </span>
                )}
              </>
            )}
            <Button
              className="ml-auto"
              onClick={onClose}
              type="button"
              variant={imported ? "primary" : "ghost"}
            >
              {imported ? "К черновикам" : "Отмена"}
            </Button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
