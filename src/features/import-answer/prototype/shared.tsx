// ПРОТОТИП — не продакшн-код. Мелочи, общие для трёх вариантов: словарь
// человеческих формулировок для проблем парсера и нарушений границы, значки
// вида изменения, сводная строка. Варианты спорят про компоновку, а не про
// эти слова.

import type { AnswerProblemKind } from "./parse-answer";
import type { BoundaryViolation, ChangeRow, ScenarioView } from "./scenarios";

export const PROBLEM_TEXT: Record<AnswerProblemKind, string> = {
  unclosed: "блок открыт, но не закрыт — ответ оборвался",
  "orphan-close": "закрывающий тег без открывающего",
  "malformed-open": "тег похож на блок, но не разобрался",
  "empty-path": "у блока пустой path — непонятно, куда писать",
  "duplicate-path": "путь встретился дважды, применится последний",
  "conflicting-path": "по одному пути и запись, и удаление",
  "unsupported-rename": "переименование не поддерживается, блок пропущен",
};

export function violationText(violation: BoundaryViolation): string {
  return violation.reason === "foreign-bank"
    ? "файл другого банка"
    : "не файл формата и не senders.txt";
}

export const KIND_LABEL: Record<ChangeRow["kind"], string> = {
  changed: "изменён",
  created: "новый",
  deleted: "удалён",
  identical: "без изменений",
};

export const KIND_COLOR: Record<ChangeRow["kind"], string> = {
  changed: "text-[color:#d29922]",
  created: "text-[color:#3fb950]",
  deleted: "text-[color:#f85149]",
  identical: "text-[color:var(--c-text-dim)]",
};

export function summarize(view: ScenarioView): string {
  const counts = { changed: 0, created: 0, deleted: 0, identical: 0 };
  for (const row of view.rows) {
    counts[row.kind] += 1;
  }
  const parts: string[] = [];
  if (counts.changed) {
    parts.push(`${counts.changed} изменено`);
  }
  if (counts.created) {
    parts.push(`${counts.created} новых`);
  }
  if (counts.deleted) {
    parts.push(`${counts.deleted} удалено`);
  }
  if (counts.identical) {
    parts.push(`${counts.identical} без изменений`);
  }
  return parts.length > 0 ? parts.join(", ") : "изменений нет";
}

export function Prose({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={`whitespace-pre-wrap text-[13px] text-[color:var(--c-text-muted)] leading-[1.6] ${className ?? ""}`}
    >
      {text}
    </div>
  );
}
