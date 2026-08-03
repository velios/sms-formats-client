// ПРОТОТИП — вариант B, «Две панели»: один экран, слева список того, что
// приехало, справа детали выбранного. Шагов нет — поле ввода схлопывается в
// строку шапки, как только текст разобрался.
//
// Спорные ставки этого варианта:
// - проза — первая строка списка слева, наравне с файлами: «Комментарий агента»
//   выбирается и читается справа;
// - «было → стало» всегда открыто для выбранной строки, стрелками ↑↓ можно
//   пройти весь список, ничего не сворачивая;
// - предупреждение о перезаписи — метка в строке списка, а не отдельный блок;
// - после импорта правая панель превращается в сводку, левая гаснет.

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

export const NAME = "Две панели: список и детали";

const PROSE_KEY = "__prose__";

export function VariantB({
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
  const [parsedOnce, setParsedOnce] = useState(true);
  const [selected, setSelected] = useState<string>(PROSE_KEY);
  const [recalculate, setRecalculate] = useState(true);
  const [imported, setImported] = useState(false);

  const broken = view.parsed.status === "broken";
  const violated = view.violations.length > 0;
  const blocked = broken || violated;
  const selectedRow = view.rows.find((row) => row.path === selected) ?? null;

  return (
    <ModalDialog
      className="flex h-[calc(100vh-64px)] max-h-[860px] flex-col sm:max-w-[1040px]"
      onClose={onClose}
      title={`Импортировать ответ · ${scenario.bankName}`}
      titleId={titleId}
    >
      {!parsedOnce && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <Textarea
            className="min-h-0 flex-1 font-mono text-[12px]"
            onChange={(event) => setText(event.target.value)}
            placeholder="Вставьте ответ агента или перетащите файл"
            value={text}
          />
          <div className="flex gap-2 border-[color:var(--c-border)] border-t pt-4">
            <Button
              onClick={() => setParsedOnce(true)}
              type="button"
              variant="primary"
            >
              Разобрать
            </Button>
          </div>
        </div>
      )}

      {parsedOnce && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-3 py-2 text-[13px]">
            <span className="text-[color:var(--c-text-muted)]">
              Ответ разобран
            </span>
            <span>{blocked ? "—" : summarize(view)}</span>
            <Button
              className="ml-auto"
              onClick={() => setParsedOnce(false)}
              size="xs"
              type="button"
              variant="ghost"
            >
              Показать текст
            </Button>
          </div>

          {blocked && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color:#f85149] bg-[color:#f8514915] p-3">
              <StatusBadge variant="error">
                {broken
                  ? "Ответ не разобрался целиком"
                  : "Ответ трогает файлы за пределами банка"}
              </StatusBadge>
              {broken &&
                view.parsed.problems.map((problem) => (
                  <div
                    className="text-[12px]"
                    key={`${problem.kind}-${problem.line}`}
                  >
                    строка {problem.line} — {PROBLEM_TEXT[problem.kind]}
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

          <div className="flex min-h-0 flex-1 gap-3">
            <div className="flex w-[320px] shrink-0 flex-col overflow-y-auto rounded-[var(--radius-md)] border border-[color:var(--c-border)]">
              <button
                className={`flex items-center gap-2 border-[color:var(--c-border)] border-b px-3 py-2 text-left text-[13px] ${
                  selected === PROSE_KEY
                    ? "bg-[color:var(--c-bg-elevated)]"
                    : "hover:bg-[color:var(--c-bg-elevated)]"
                }`}
                onClick={() => setSelected(PROSE_KEY)}
                type="button"
              >
                <span className="flex-1">Комментарий агента</span>
                <span className="text-[11px] text-[color:var(--c-text-dim)]">
                  {view.prose.trim() === "" ? "пусто" : "текст"}
                </span>
              </button>
              {view.rows.map((row, rowIndex) => (
                <button
                  className={`flex items-center gap-2 border-[color:var(--c-border)] border-b px-3 py-2 text-left last:border-b-0 ${
                    selected === row.path
                      ? "bg-[color:var(--c-bg-elevated)]"
                      : "hover:bg-[color:var(--c-bg-elevated)]"
                  }`}
                  key={`${row.path}#${rowIndex}`}
                  onClick={() => setSelected(row.path)}
                  type="button"
                >
                  <span
                    className={`w-2 shrink-0 text-[14px] ${KIND_COLOR[row.kind]}`}
                  >
                    •
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {row.fileName}
                  </span>
                  {row.overwritesManualEdit && (
                    <span
                      className="shrink-0 text-[color:#d29922]"
                      title="перезапишет ручную правку"
                    >
                      ✎
                    </span>
                  )}
                </button>
              ))}
              {view.rows.length === 0 && !blocked && (
                <div className="px-3 py-4 text-[12px] text-[color:var(--c-text-dim)]">
                  Файлов в ответе нет
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 overflow-y-auto rounded-[var(--radius-md)] border border-[color:var(--c-border)] p-4">
              {imported ? (
                <div className="flex flex-col gap-3">
                  <StatusBadge variant="success">
                    Записано в черновики
                  </StatusBadge>
                  <div className="text-[14px]">{summarize(view)}.</div>
                  <div className="text-[13px] text-[color:var(--c-text-muted)]">
                    {recalculate
                      ? "Пересечения пересчитаны: было 3 пары, стало 0."
                      : "Пересечения не пересчитывались."}
                  </div>
                </div>
              ) : selected === PROSE_KEY ? (
                <div className="flex flex-col gap-2">
                  <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
                    Текст ответа вне блоков
                  </div>
                  <Prose
                    text={
                      view.prose ||
                      "Агент не написал ничего, кроме самих изменений."
                    }
                  />
                </div>
              ) : selectedRow ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 break-all font-mono text-[12px]">
                      {selectedRow.path}
                    </span>
                    <span
                      className={`text-[12px] ${KIND_COLOR[selectedRow.kind]}`}
                    >
                      {KIND_LABEL[selectedRow.kind]}
                    </span>
                  </div>
                  {selectedRow.overwritesManualEdit && (
                    <div className="rounded-[var(--radius-md)] border border-[color:#d29922] bg-[color:#d2992215] p-2 text-[12px]">
                      Здесь есть ваша правка — импорт её перезапишет.
                    </div>
                  )}
                  <StructuralDiff row={selectedRow} />
                </div>
              ) : (
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
                  disabled={blocked || view.rows.length === 0}
                  onClick={() => setImported(true)}
                  type="button"
                  variant="primary"
                >
                  Импортировать
                  {view.rows.length > 0 && ` (${view.rows.length})`}
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
