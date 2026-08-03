// ПРОТОТИП — не продакшн-код. Показ «было → стало» по резолюции #24:
// текстового diff нет, формат-файл показывается структурно — regex двумя
// строками, колонки двумя строками, примеры списком добавленных/убранных.
// Оба состояния одновременно, без переключателя.
//
// Это общая деталь всех трёх вариантов: чем показывать — уже решено (#24),
// варианты спорят про то, где эта деталь живёт на экране.

import { parseFormatFile } from "@/domain/format";
import type { ChangeRow } from "./scenarios";

/** Грубая пословная разметка различий — вместо presentableDiff (#24, украшение). */
function markWords(before: string, after: string): [string, boolean][] {
  const beforeWords = new Set(before.split(/(\s+)/));
  return after
    .split(/(\s+)/)
    .map((word) => [word, word.trim() !== "" && !beforeWords.has(word)]);
}

function RegexLine(props: {
  label: string;
  text: string;
  marks?: [string, boolean][];
  tone: "before" | "after";
}) {
  const { label, text, marks, tone } = props;
  return (
    <div className="flex gap-2">
      <span className="w-12 shrink-0 pt-0.5 text-[11px] text-[color:var(--c-text-dim)]">
        {label}
      </span>
      <code
        className={`min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[12px] leading-[1.55] ${
          tone === "before"
            ? "text-[color:var(--c-text-dim)]"
            : "text-[color:var(--c-text)]"
        }`}
      >
        {marks
          ? marks.map(([word, changed], index) => (
              <span
                // Без скруглений и отступов: соседние помеченные куски должны
                // сливаться в одну полосу, а не рассыпаться в лесенку.
                className={
                  changed ? "bg-[color:var(--c-accent-soft)]" : undefined
                }
                key={index}
              >
                {word}
              </span>
            ))
          : text}
      </code>
    </div>
  );
}

export function StructuralDiff({ row }: { row: ChangeRow }) {
  if (row.kind === "deleted") {
    return (
      <div className="flex flex-col gap-2 text-[13px]">
        <div className="text-[color:var(--c-text-muted)]">
          Файл удаляется. Причина от агента:
        </div>
        <div className="border-[color:var(--c-border)] border-l-2 pl-3 text-[color:var(--c-text)]">
          {row.reason || "— не указана —"}
        </div>
        {row.before !== null && (
          <details>
            <summary className="cursor-pointer text-[12px] text-[color:var(--c-text-dim)]">
              Действующее тело файла
            </summary>
            <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[color:var(--c-text-dim)]">
              {row.before}
            </pre>
          </details>
        )}
      </div>
    );
  }

  const isSenders = row.path.endsWith("/senders.txt");
  if (isSenders) {
    const beforeLines = (row.before ?? "").trim().split("\n").filter(Boolean);
    const afterLines = (row.after ?? "").trim().split("\n").filter(Boolean);
    const added = afterLines.filter((line) => !beforeLines.includes(line));
    const removed = beforeLines.filter((line) => !afterLines.includes(line));
    return (
      <div className="flex flex-col gap-1 text-[13px]">
        <div className="text-[color:var(--c-text-muted)]">Отправители</div>
        {added.map((line) => (
          <div
            className="font-mono text-[12px] text-[color:var(--c-success)]"
            key={line}
          >
            + {line}
          </div>
        ))}
        {removed.map((line) => (
          <div
            className="font-mono text-[12px] text-[color:var(--c-error)]"
            key={line}
          >
            − {line}
          </div>
        ))}
        {added.length === 0 && removed.length === 0 && (
          <div className="text-[color:var(--c-text-dim)]">Без изменений</div>
        )}
      </div>
    );
  }

  const after = parseFormatFile(row.after ?? "", row.path);
  const before =
    row.before === null ? null : parseFormatFile(row.before, row.path);

  const norm = (example: string) => example.trim().replace(/\s+/g, " ");
  const beforeSet = new Set((before?.examples ?? []).map(norm));
  const afterSet = new Set(after.examples.map(norm));
  const addedExamples = after.examples.filter(
    (example) => !beforeSet.has(norm(example))
  );
  const removedExamples = (before?.examples ?? []).filter(
    (example) => !afterSet.has(norm(example))
  );
  const columnsChanged =
    before !== null && before.columns.join(";") !== after.columns.join(";");

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <div className="flex flex-col gap-1">
        <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
          Regex
        </div>
        {before !== null && (
          <RegexLine label="было" text={before.regex} tone="before" />
        )}
        <RegexLine
          label={before === null ? "новый" : "стало"}
          marks={
            before === null ? undefined : markWords(before.regex, after.regex)
          }
          text={after.regex}
          tone="after"
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
          Колонки {columnsChanged ? "" : "· без изменений"}
        </div>
        {before !== null && columnsChanged && (
          <RegexLine
            label="было"
            text={before.columns.join(";")}
            tone="before"
          />
        )}
        <RegexLine
          label={before === null ? "новые" : columnsChanged ? "стало" : ""}
          text={after.columns.join(";")}
          tone="after"
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
          Примеры
        </div>
        {addedExamples.map((example) => (
          <div
            className="font-mono text-[11px] text-[color:var(--c-success)] leading-[1.5]"
            key={example}
          >
            + {example}
          </div>
        ))}
        {removedExamples.map((example) => (
          <div
            className="font-mono text-[11px] text-[color:var(--c-error)] leading-[1.5]"
            key={example}
          >
            − {example}
          </div>
        ))}
        {addedExamples.length === 0 && removedExamples.length === 0 && (
          <div className="text-[color:var(--c-text-dim)]">
            Прежние {after.examples.length} — без изменений
          </div>
        )}
      </div>
    </div>
  );
}
