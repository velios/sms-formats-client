// ПРОТОТИП — вариант A, «Мастер»: три состояния одной модалки, содержимое
// заменяется целиком. Вставка → разбор → список изменений → итог.
//
// Спорные ставки этого варианта:
// - проза свёрнута под заголовок «Что сказал агент» (её читают по желанию);
// - «было → стало» раскрывается по клику, по одному файлу за раз (аккордеон);
// - предупреждение о перезаписи — жёлтая полоса прямо над кнопкой импорта;
// - после импорта — отдельный экран итога, модалка сама не закрывается.

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

export const NAME = "Мастер: три шага";

type Step = "input" | "review" | "done";

export function VariantA({
  scenario,
  view,
  onClose,
}: {
  scenario: Scenario;
  view: ScenarioView;
  onClose: () => void;
}) {
  const titleId = useId();
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState(scenario.answer);
  const [open, setOpen] = useState<string | null>(null);
  const [recalculate, setRecalculate] = useState(true);
  const [showProse, setShowProse] = useState(false);

  const broken = view.parsed.status === "broken";
  const violated = view.violations.length > 0;

  return (
    <ModalDialog
      className="flex max-h-[calc(100vh-40px)] flex-col sm:max-w-[760px]"
      onClose={onClose}
      title={`Импортировать ответ · ${scenario.bankName}`}
      titleId={titleId}
    >
      {step === "input" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="text-[13px] text-[color:var(--c-text-muted)]">
            Вставьте ответ агента или перетащите файл.
          </div>
          <Textarea
            className="min-h-[320px] font-mono text-[12px]"
            onChange={(event) => setText(event.target.value)}
            value={text}
          />
          <div className="flex items-center gap-2 border-[color:var(--c-border)] border-t pt-4">
            <Button
              disabled={text.trim() === ""}
              onClick={() => setStep("review")}
              type="button"
              variant="primary"
            >
              Разобрать
            </Button>
            <Button onClick={onClose} type="button" variant="ghost">
              Отмена
            </Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
            {broken && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color:#f85149] bg-[color:#f8514915] p-3">
                <StatusBadge variant="error">Ответ не разобрался</StatusBadge>
                <div className="text-[13px] text-[color:var(--c-text-muted)]">
                  Импортировать нельзя: часть ответа потеряна, а половина
                  предложения агента может стереть форматы, не записав те, куда
                  перенесены примеры.
                </div>
                {view.parsed.problems.map((problem) => (
                  <div
                    className="font-mono text-[12px]"
                    key={`${problem.kind}-${problem.line}`}
                  >
                    строка {problem.line} — {PROBLEM_TEXT[problem.kind]}
                    <div className="text-[color:var(--c-text-dim)]">
                      {problem.excerpt.slice(0, 90)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {violated && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color:#f85149] bg-[color:#f8514915] p-3">
                <StatusBadge variant="error">
                  Ответ трогает файлы за пределами банка
                </StatusBadge>
                <div className="text-[13px] text-[color:var(--c-text-muted)]">
                  Не импортируется ничего. Поправьте ответ и вставьте снова.
                </div>
                {view.violations.map((violation) => (
                  <div className="text-[12px]" key={violation.path}>
                    <code className="font-mono">{violation.path}</code> —{" "}
                    {violationText(violation)}
                  </div>
                ))}
              </div>
            )}

            {!broken && (
              <button
                className="flex items-center gap-2 self-start text-[13px] text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]"
                onClick={() => setShowProse((value) => !value)}
                type="button"
              >
                {showProse ? "▾" : "▸"} Что сказал агент
                {view.prose.trim() !== "" && (
                  <span className="text-[color:var(--c-text-dim)]">
                    ({view.prose.split("\n").filter(Boolean).length} абз.)
                  </span>
                )}
              </button>
            )}
            {showProse && <Prose text={view.prose || "— нет текста —"} />}

            {!(broken || violated) && (
              <>
                <div className="font-semibold text-[12px] text-[color:var(--c-text-muted)] uppercase tracking-[0.5px]">
                  Изменения · {summarize(view)}
                </div>
                {view.rows.length === 0 && (
                  <div className="rounded-[var(--radius-md)] border border-[color:var(--c-border)] p-4 text-[13px] text-[color:var(--c-text-muted)]">
                    Импортировать нечего: агент не предложил ни одного изменения
                    файлов. Всё, что он сказал, — выше.
                  </div>
                )}
                <div className="flex flex-col rounded-[var(--radius-md)] border border-[color:var(--c-border)]">
                  {view.rows.map((row, rowIndex) => (
                    <div
                      className="border-[color:var(--c-border)] border-b last:border-b-0"
                      key={`${row.path}#${rowIndex}`}
                    >
                      <button
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[color:var(--c-bg-elevated)]"
                        onClick={() =>
                          setOpen((value) =>
                            value === row.path ? null : row.path
                          )
                        }
                        type="button"
                      >
                        <span className="w-4 text-[color:var(--c-text-dim)]">
                          {open === row.path ? "▾" : "▸"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {row.fileName}
                        </span>
                        {row.overwritesManualEdit && (
                          <StatusBadge variant="warning">
                            ручная правка
                          </StatusBadge>
                        )}
                        <span
                          className={`text-[12px] ${KIND_COLOR[row.kind]} shrink-0`}
                        >
                          {KIND_LABEL[row.kind]}
                        </span>
                      </button>
                      {open === row.path && (
                        <div className="border-[color:var(--c-border)] border-t bg-[color:var(--c-bg-elevated)] px-3 py-3">
                          <StructuralDiff row={row} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {view.parsed.status === "parsed" &&
                  view.parsed.problems.length > 0 && (
                    <div className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[color:#d29922] bg-[color:#d2992215] p-3 text-[12px]">
                      <div className="font-semibold">
                        В ответе есть странности — импорт возможен
                      </div>
                      {view.parsed.problems.map((problem) => (
                        <div key={`${problem.kind}-${problem.line}`}>
                          строка {problem.line} — {PROBLEM_TEXT[problem.kind]}:{" "}
                          <code className="font-mono">{problem.excerpt}</code>
                        </div>
                      ))}
                    </div>
                  )}
              </>
            )}
          </div>

          <div className="flex flex-col gap-2 border-[color:var(--c-border)] border-t pt-3">
            {view.overwriteCount > 0 && !(broken || violated) && (
              <div className="rounded-[var(--radius-md)] border border-[color:#d29922] bg-[color:#d2992215] p-2 text-[12px]">
                Импорт перезапишет ваши правки в{" "}
                {view.rows
                  .filter((row) => row.overwritesManualEdit)
                  .map((row) => row.fileName)
                  .join(", ")}
                . Откатить можно через Ctrl+Z или «Вернуть как в PR».
              </div>
            )}
            <label className="flex cursor-pointer select-none items-center gap-2 text-[13px]">
              <input
                checked={recalculate}
                className="accent-[color:var(--c-border-focus)]"
                onChange={(event) => setRecalculate(event.target.checked)}
                type="checkbox"
              />
              Пересчитать пересечения после импорта
            </label>
            <div className="flex items-center gap-2">
              <Button
                disabled={broken || violated || view.rows.length === 0}
                onClick={() => setStep("done")}
                type="button"
                variant="primary"
              >
                Импортировать
              </Button>
              <Button
                onClick={() => setStep("input")}
                type="button"
                variant="secondary"
              >
                Назад к тексту
              </Button>
              <Button
                className="ml-auto"
                onClick={onClose}
                type="button"
                variant="ghost"
              >
                Отмена
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <StatusBadge variant="success">Записано в черновики</StatusBadge>
          <div className="text-[14px]">{summarize(view)}.</div>
          <div className="text-[13px] text-[color:var(--c-text-muted)]">
            {recalculate
              ? "Пересечения пересчитаны: было 3 пары, стало 0."
              : "Пересечения не пересчитывались."}
          </div>
          <div className="text-[13px] text-[color:var(--c-text-muted)]">
            Изменения лежат в черновиках банка. Дальше — проверить в редакторе и
            опубликовать в PR.
          </div>
          <div className="mt-auto flex items-center gap-2 border-[color:var(--c-border)] border-t pt-4">
            <Button onClick={onClose} type="button" variant="primary">
              К черновикам
            </Button>
            <Button onClick={onClose} type="button" variant="ghost">
              Закрыть
            </Button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
