// ПРОТОТИП — вариант C, «Лента»: одна прокрутка, всё раскрыто сразу, ни одного
// клика на пути к решению. Поле ввода — первый экран ленты, разбор происходит
// прямо при вставке, дальше человек просто листает вниз.
//
// Спорные ставки этого варианта:
// - проза стоит первой и целиком, крупно: это единственное место, где видно,
//   чего агент делать не стал, — значит читается раньше списка файлов;
// - «было → стало» не сворачивается вообще, карточки идут подряд;
// - предупреждение о перезаписи — красная карточка в самой ленте, на своём
//   месте среди файлов, плюс счётчик в липкой нижней панели;
// - после импорта модалка закрывается сама, итог уезжает тостом в workspace.

import { useId, useState } from "react";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { StructuralDiff } from "./StructuralDiff";
import type { Scenario, ScenarioView } from "./scenarios";
import {
  KIND_COLOR,
  KIND_LABEL,
  PROBLEM_TEXT,
  Prose,
  summarize,
  violationText,
} from "./shared";

export const NAME = "Лента: всё раскрыто, одна прокрутка";

export function VariantC({
  scenario,
  view,
  onClose,
  onToast,
}: {
  scenario: Scenario;
  view: ScenarioView;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const titleId = useId();
  const [text, setText] = useState(scenario.answer);
  const [recalculate, setRecalculate] = useState(true);

  const broken = view.parsed.status === "broken";
  const violated = view.violations.length > 0;
  const blocked = broken || violated;

  return (
    <ModalDialog
      className="flex h-[calc(100vh-64px)] max-h-[900px] flex-col sm:max-w-[820px]"
      onClose={onClose}
      title={`Импортировать ответ · ${scenario.bankName}`}
      titleId={titleId}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
        <div className="flex flex-col gap-1.5">
          <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
            Ответ агента
          </div>
          <Textarea
            className="max-h-32 min-h-16 font-mono text-[11px]"
            onChange={(event) => setText(event.target.value)}
            placeholder="Вставьте ответ агента или перетащите файл"
            value={text}
          />
        </div>

        {blocked && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color:#f85149] bg-[color:#f8514915] p-3">
            <StatusBadge variant="error">
              {broken
                ? "Ответ не разобрался целиком — импортировать нельзя"
                : "Ответ выходит за пределы банка — не импортируется ничего"}
            </StatusBadge>
            {broken &&
              view.parsed.problems.map((problem) => (
                <div
                  className="text-[12px]"
                  key={`${problem.kind}-${problem.line}`}
                >
                  строка {problem.line} — {PROBLEM_TEXT[problem.kind]}:{" "}
                  <code className="font-mono">
                    {problem.excerpt.slice(0, 80)}
                  </code>
                </div>
              ))}
            {view.violations.map((violation) => (
              <div className="text-[12px]" key={violation.path}>
                <code className="font-mono">{violation.path}</code> —{" "}
                {violationText(violation)}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] p-4">
          <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
            Что сказал агент
          </div>
          <Prose
            className="text-[color:var(--c-text)]"
            text={view.prose || "Ничего, кроме самих изменений."}
          />
        </div>

        {!blocked && (
          <div className="flex flex-col gap-3">
            <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
              Изменения · {summarize(view)}
            </div>
            {view.rows.length === 0 && (
              <div className="rounded-[var(--radius-md)] border border-[color:var(--c-border)] p-4 text-[13px] text-[color:var(--c-text-muted)]">
                Ни одного файла — импортировать нечего.
              </div>
            )}
            {view.rows.map((row, rowIndex) => (
              <div
                className={`flex flex-col gap-3 rounded-[var(--radius-md)] border p-4 ${
                  row.overwritesManualEdit
                    ? "border-[color:#d29922] bg-[color:#d2992210]"
                    : "border-[color:var(--c-border)]"
                }`}
                key={`${row.path}#${rowIndex}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 break-all text-[13px]">
                    {row.fileName}
                  </span>
                  <span className={`text-[12px] ${KIND_COLOR[row.kind]}`}>
                    {KIND_LABEL[row.kind]}
                  </span>
                </div>
                {row.overwritesManualEdit && (
                  <div className="text-[12px] text-[color:#d29922]">
                    Здесь есть ваша ручная правка — импорт её перезапишет.
                  </div>
                )}
                <StructuralDiff row={row} />
              </div>
            ))}
            {view.parsed.status === "parsed" &&
              view.parsed.problems.length > 0 && (
                <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[color:#d29922] bg-[color:#d2992215] p-3 text-[12px]">
                  {view.parsed.problems.map((problem) => (
                    <div key={`${problem.kind}-${problem.line}`}>
                      строка {problem.line} — {PROBLEM_TEXT[problem.kind]}:{" "}
                      <code className="font-mono">{problem.excerpt}</code>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-3 border-[color:var(--c-border)] border-t pt-4">
        <Button
          disabled={blocked || view.rows.length === 0}
          onClick={() => {
            onToast(
              `Импортировано: ${summarize(view)}.${recalculate ? " Пересечения пересчитаны: 3 → 0." : ""}`
            );
            onClose();
          }}
          type="button"
          variant="primary"
        >
          Импортировать{view.rows.length > 0 && ` ${view.rows.length} файлов`}
        </Button>
        <label className="flex cursor-pointer select-none items-center gap-2 text-[13px]">
          <input
            checked={recalculate}
            className="accent-[color:var(--c-border-focus)]"
            onChange={(event) => setRecalculate(event.target.checked)}
            type="checkbox"
          />
          Пересчитать пересечения
        </label>
        {view.overwriteCount > 0 && !blocked && (
          <span className="text-[12px] text-[color:#d29922]">
            перезапишет ручных правок: {view.overwriteCount}
          </span>
        )}
        <Button
          className="ml-auto"
          onClick={onClose}
          type="button"
          variant="ghost"
        >
          Отмена
        </Button>
      </div>
    </ModalDialog>
  );
}
