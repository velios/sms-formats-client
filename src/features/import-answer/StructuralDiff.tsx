// "Before → after", structural rather than textual (ADR-0017): a format file
// is laid out by the existing `parseFormatFile` — the regex as two lines, the
// columns as two lines, the examples as an added/removed list, both states at
// once. `presentableDiff` only tints the differing runs inside the regex line;
// it carries nothing.

import { presentableDiff } from "@codemirror/merge";
import { useTranslation } from "react-i18next";
import { parseFormatFile } from "@/domain/format";

export type DiffKind = "changed" | "created" | "deleted" | "identical";

interface Props {
  path: string;
  kind: DiffKind;
  /** The body in force; null when nothing stands at this path yet. */
  before: string | null;
  after: string | null;
  /** Reason from the `<delete>` block. */
  reason: string | null;
}

type Run = [text: string, changed: boolean];

function diffRuns(before: string, after: string): Run[] {
  const runs: Run[] = [];
  let position = 0;
  for (const change of presentableDiff(before, after)) {
    if (change.fromB > position) {
      runs.push([after.slice(position, change.fromB), false]);
    }
    if (change.toB > change.fromB) {
      runs.push([after.slice(change.fromB, change.toB), true]);
    }
    position = Math.max(position, change.toB);
  }
  if (position < after.length) {
    runs.push([after.slice(position), false]);
  }
  return runs;
}

function Line(props: {
  label: string;
  text: string;
  runs?: Run[];
  tone: "before" | "after";
}) {
  const { label, text, runs, tone } = props;
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
        {runs
          ? runs.map(([run, changed], index) => (
              // No rounding, no padding: neighbouring marked runs have to melt
              // into one band instead of falling apart into a staircase.
              <span
                className={
                  changed ? "bg-[color:var(--c-accent-soft)]" : undefined
                }
                key={index}
              >
                {run}
              </span>
            ))
          : text}
      </code>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
        {title}
      </div>
      {children}
    </div>
  );
}

function DeletionDetails({
  before,
  reason,
}: {
  before: string | null;
  reason: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <div className="text-[color:var(--c-text-muted)]">
        {t("importAnswer.diff.deleting")}
      </div>
      <div className="border-[color:var(--c-border)] border-l-2 pl-3 text-[color:var(--c-text)]">
        {reason || t("importAnswer.diff.noReason")}
      </div>
      {before !== null && (
        <details>
          <summary className="cursor-pointer text-[12px] text-[color:var(--c-text-dim)]">
            {t("importAnswer.diff.currentBody")}
          </summary>
          <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[color:var(--c-text-dim)]">
            {before}
          </pre>
        </details>
      )}
    </div>
  );
}

function SendersDiff({
  before,
  after,
}: {
  before: string | null;
  after: string | null;
}) {
  const { t } = useTranslation();
  const beforeLines = (before ?? "").trim().split("\n").filter(Boolean);
  const afterLines = (after ?? "").trim().split("\n").filter(Boolean);
  const added = afterLines.filter((line) => !beforeLines.includes(line));
  const removed = beforeLines.filter((line) => !afterLines.includes(line));
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <div className="text-[color:var(--c-text-muted)]">
        {t("importAnswer.diff.senders")}
      </div>
      {added.map((line) => (
        <div
          className="font-mono text-[12px] text-[color:var(--c-success)]"
          key={`+${line}`}
        >
          + {line}
        </div>
      ))}
      {removed.map((line) => (
        <div
          className="font-mono text-[12px] text-[color:var(--c-error)]"
          key={`-${line}`}
        >
          − {line}
        </div>
      ))}
      {added.length === 0 && removed.length === 0 && (
        <div className="text-[color:var(--c-text-dim)]">
          {t("importAnswer.diff.unchanged")}
        </div>
      )}
    </div>
  );
}

function normalizeExample(example: string): string {
  return example.trim().replace(/\s+/g, " ");
}

function FormatDiff({
  path,
  before,
  after,
}: {
  path: string;
  before: string | null;
  after: string;
}) {
  const { t } = useTranslation();
  const parsedAfter = parseFormatFile(after, path);
  const parsedBefore = before === null ? null : parseFormatFile(before, path);

  const beforeExamples = new Set(
    (parsedBefore?.examples ?? []).map(normalizeExample)
  );
  const afterExamples = new Set(parsedAfter.examples.map(normalizeExample));
  const addedExamples = parsedAfter.examples.filter(
    (example) => !beforeExamples.has(normalizeExample(example))
  );
  const removedExamples = (parsedBefore?.examples ?? []).filter(
    (example) => !afterExamples.has(normalizeExample(example))
  );
  const columnsChanged =
    parsedBefore !== null &&
    parsedBefore.columns.join(";") !== parsedAfter.columns.join(";");

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <Section title={t("importAnswer.diff.regex")}>
        {parsedBefore !== null && (
          <Line
            label={t("importAnswer.diff.before")}
            text={parsedBefore.regex}
            tone="before"
          />
        )}
        <Line
          label={
            parsedBefore === null
              ? t("importAnswer.diff.new")
              : t("importAnswer.diff.after")
          }
          runs={
            parsedBefore === null
              ? undefined
              : diffRuns(parsedBefore.regex, parsedAfter.regex)
          }
          text={parsedAfter.regex}
          tone="after"
        />
      </Section>

      <Section
        title={
          columnsChanged || parsedBefore === null
            ? t("importAnswer.diff.columns")
            : t("importAnswer.diff.columnsUnchanged")
        }
      >
        {parsedBefore !== null && columnsChanged && (
          <Line
            label={t("importAnswer.diff.before")}
            text={parsedBefore.columns.join(";")}
            tone="before"
          />
        )}
        <Line
          label={
            parsedBefore === null
              ? t("importAnswer.diff.newPlural")
              : columnsChanged
                ? t("importAnswer.diff.after")
                : ""
          }
          text={parsedAfter.columns.join(";")}
          tone="after"
        />
      </Section>

      <Section title={t("importAnswer.diff.examples")}>
        {addedExamples.map((example) => (
          <div
            className="font-mono text-[11px] text-[color:var(--c-success)] leading-[1.5]"
            key={`+${example}`}
          >
            + {example}
          </div>
        ))}
        {removedExamples.map((example) => (
          <div
            className="font-mono text-[11px] text-[color:var(--c-error)] leading-[1.5]"
            key={`-${example}`}
          >
            − {example}
          </div>
        ))}
        {addedExamples.length === 0 && removedExamples.length === 0 && (
          <div className="text-[color:var(--c-text-dim)]">
            {t("importAnswer.diff.examplesUnchanged", {
              count: parsedAfter.examples.length,
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

export function StructuralDiff({ path, kind, before, after, reason }: Props) {
  if (kind === "deleted") {
    return <DeletionDetails before={before} reason={reason} />;
  }
  if (path.endsWith("/senders.txt")) {
    return <SendersDiff after={after} before={before} />;
  }
  return <FormatDiff after={after ?? ""} before={before} path={path} />;
}
