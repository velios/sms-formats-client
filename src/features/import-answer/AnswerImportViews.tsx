import {
  Ban,
  FilePlus2,
  MessageSquareText,
  PenLine,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AnswerProblem, PathViolation } from "./core";
import { type DiffKind, StructuralDiff } from "./StructuralDiff";
import type { ImportAnswerRow } from "./use-import-answer";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const PROSE_INDEX = -1;

const KIND_ORDER: DiffKind[] = ["changed", "created", "deleted", "identical"];

const KIND_STYLE: Record<DiffKind, { dot: string; text: string }> = {
  changed: {
    dot: "bg-primary",
    text: "text-primary",
  },
  created: {
    dot: "bg-success",
    text: "text-success",
  },
  deleted: {
    dot: "bg-destructive",
    text: "text-destructive",
  },
  identical: {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
  },
};

interface ManifestRow {
  path: string;
  fileName: string;
  kind: DiffKind;
  reason: string | null;
  before: string | null;
  after: string | null;
  overwritesManualEdit: boolean;
  supersededBelow: boolean;
  violation: PathViolation | null;
}

function toManifestRow(row: ImportAnswerRow): ManifestRow {
  const { change } = row;
  const exists = row.existsAtHead || row.currentContent !== "";
  const before = exists ? row.currentContent : null;
  const after = change.kind === "write" ? change.content : null;
  const kind: DiffKind =
    change.kind === "delete"
      ? "deleted"
      : before === null
        ? "created"
        : before.trim() === change.content.trim()
          ? "identical"
          : "changed";
  return {
    path: change.path,
    fileName: change.path.split("/").pop() ?? change.path,
    kind,
    reason: change.kind === "delete" ? change.reason : null,
    before,
    after,
    overwritesManualEdit: row.overwritesManualEdit,
    supersededBelow: row.supersededBelow,
    violation: row.violation,
  };
}

function splitName(fileName: string): { head: string; tail: string } {
  const withId = /^(.*?)(_\d+\.txt)$/.exec(fileName);
  if (withId) {
    return { head: withId[1] ?? "", tail: withId[2] ?? "" };
  }
  return { head: fileName, tail: "" };
}

function provenanceText(row: ManifestRow, t: Translate): string {
  if (row.path.endsWith("/senders.txt")) {
    return t("importAnswer.provenance.senders");
  }
  const { tail } = splitName(row.fileName);
  const id = tail === "" ? null : tail.replace(/^_/, "").replace(/\.txt$/, "");
  const exists = row.before !== null;
  if (id !== null) {
    return exists
      ? t("importAnswer.provenance.published", { id })
      : t("importAnswer.provenance.idWithoutFile", { id });
  }
  return exists
    ? t("importAnswer.provenance.createdInPr")
    : t("importAnswer.provenance.absent");
}

function KindDot({ kind }: { kind: DiffKind }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 shrink-0 rounded-full ${KIND_STYLE[kind].dot}`}
    />
  );
}

function KindIcon({ kind }: { kind: DiffKind }) {
  if (kind === "deleted") {
    return (
      <Trash2
        aria-hidden="true"
        className="size-3.5 shrink-0 text-destructive"
      />
    );
  }
  if (kind === "created") {
    return (
      <FilePlus2
        aria-hidden="true"
        className="size-3.5 shrink-0 text-success"
      />
    );
  }
  return <span aria-hidden="true" className="size-3.5 shrink-0" />;
}

function Gutter({ kind, rejected }: { kind: DiffKind; rejected: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${
          rejected ? "bg-destructive" : KIND_STYLE[kind].dot
        }`}
      />
      {rejected ? (
        <Ban
          aria-hidden="true"
          className="size-3.5 shrink-0 text-destructive"
        />
      ) : (
        <KindIcon kind={kind} />
      )}
    </span>
  );
}

function FileName({ row }: { row: ManifestRow }) {
  const { head, tail } = splitName(row.fileName);
  return (
    <span
      className={`flex min-w-0 flex-1 items-baseline text-sm ${
        row.kind === "deleted"
          ? "line-through decoration-1 decoration-current"
          : ""
      } ${row.supersededBelow ? "text-muted-foreground" : ""}`}
    >
      <span className="min-w-0 truncate">{head}</span>
      {tail !== "" && (
        <span
          className={`shrink-0 font-mono text-[11.5px] tabular-nums ${
            row.supersededBelow
              ? "text-muted-foreground"
              : "text-muted-foreground"
          }`}
        >
          {tail}
        </span>
      )}
    </span>
  );
}

type KindCounts = Record<DiffKind, number>;

function CountsLegend({
  counts,
  className,
  t,
}: {
  counts: KindCounts;
  className?: string;
  t: Translate;
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
          <span className="text-muted-foreground">
            {t(`importAnswer.kindCount.${kind}`, { count: counts[kind] })}
          </span>
        </span>
      ))}
    </span>
  );
}

function ProblemList({
  problems,
  t,
}: {
  problems: AnswerProblem[];
  t: Translate;
}) {
  return problems.map((problem) => (
    <div key={`${problem.kind}-${problem.line}`}>
      <span className="text-muted-foreground">
        {t("importAnswer.line", { line: problem.line })}
      </span>{" "}
      — {t(`importAnswer.problem.${problem.kind}`)}
    </div>
  ));
}

function ParseSummary({
  blocked,
  broken,
  counts,
  done,
  hasRows,
  onShowText,
  overwriteCount,
  t,
}: {
  blocked: boolean;
  broken: boolean;
  counts: KindCounts;
  done: boolean;
  hasRows: boolean;
  onShowText: () => void;
  overwriteCount: number;
  t: Translate;
}) {
  return (
    <div className="flex items-center gap-4 rounded-md border border-border bg-muted px-3 py-2 text-sm">
      {broken && (
        <span className="text-destructive">
          {t("importAnswer.status.broken")}
        </span>
      )}
      {!broken && blocked && (
        <span className="text-destructive">
          {t("importAnswer.status.outOfBounds")}
        </span>
      )}
      {!(broken || blocked || hasRows) && (
        <span className="text-muted-foreground">
          {t("importAnswer.status.noFiles")}
        </span>
      )}
      {!blocked && hasRows && <CountsLegend counts={counts} t={t} />}
      {overwriteCount > 0 && !(blocked || done) && (
        <span className="flex items-center gap-1.5 text-warning">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {t("importAnswer.overwriteWarning", { count: overwriteCount })}
        </span>
      )}
      <Button
        className="ml-auto"
        onClick={onShowText}
        size="sm"
        type="button"
        variant="default"
      >
        {t("importAnswer.showText")}
      </Button>
    </div>
  );
}

function RefusalBanner({
  broken,
  problems,
  violations,
  onPasteAgain,
  t,
}: {
  broken: boolean;
  problems: AnswerProblem[];
  violations: ManifestRow[];
  onPasteAgain: () => void;
  t: Translate;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive bg-destructive-soft p-3">
      <StatusBadge variant="error">
        {t(
          broken
            ? "importAnswer.refusal.brokenTitle"
            : "importAnswer.refusal.boundsTitle"
        )}
      </StatusBadge>
      <div className="flex flex-col gap-1 text-xs">
        <ProblemList problems={problems} t={t} />
        {violations.map((row) => (
          <div key={row.path}>
            <code className="font-mono">{row.path}</code>{" "}
            <span className="text-muted-foreground">
              — {t(`importAnswer.violation.${row.violation}`)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-1 text-muted-foreground text-xs">
        {t(
          broken
            ? "importAnswer.refusal.brokenHint"
            : "importAnswer.refusal.boundsHint"
        )}
        <Button
          onClick={onPasteAgain}
          size="sm"
          type="button"
          variant="secondary"
        >
          {t("importAnswer.refusal.pasteAgain")}
        </Button>
      </div>
    </div>
  );
}

function LossNotice({
  problems,
  t,
}: {
  problems: AnswerProblem[];
  t: Translate;
}) {
  return (
    <div className="flex flex-col gap-1 border-warning border-l-2 py-1 pl-3 text-xs">
      <span className="font-medium text-warning">
        {t("importAnswer.loss.title")}
      </span>
      <div className="text-muted-foreground">
        <ProblemList problems={problems} t={t} />
      </div>
    </div>
  );
}

function ProsePanel({ text, t }: { text: string; t: Translate }) {
  const empty = text.trim() === "";
  return (
    <div className="flex flex-col gap-2">
      <div className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.5px]">
        {t("importAnswer.prosePanelTitle")}
      </div>
      <div
        className={`max-w-[68ch] whitespace-pre-wrap text-[13.5px] leading-[1.7] ${
          empty ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {empty ? t("importAnswer.proseNone") : text}
      </div>
    </div>
  );
}

function RowPanel({ row, t }: { row: ManifestRow; t: Translate }) {
  const rejected = row.violation !== null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 border-border border-b pb-3">
        <Gutter kind={row.kind} rejected={rejected} />
        <span className="min-w-0 flex-1 break-all font-mono text-xs leading-[1.5]">
          {row.path}
        </span>
        <span
          className={`shrink-0 text-xs ${
            rejected ? "text-destructive" : KIND_STYLE[row.kind].text
          }`}
        >
          {rejected
            ? t("importAnswer.rejected")
            : t(`importAnswer.kind.${row.kind}`)}
        </span>
      </div>

      {!rejected && (
        <div className="text-muted-foreground text-xs">
          {provenanceText(row, t)}
        </div>
      )}

      {row.supersededBelow && (
        <div className="border-warning border-l-2 py-1 pl-3 text-muted-foreground text-xs">
          {t("importAnswer.supersededNote")}
        </div>
      )}

      {row.overwritesManualEdit && (
        <div className="flex items-start gap-2 rounded-md border border-warning bg-warning-soft p-2 text-warning text-xs">
          <PenLine aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {t("importAnswer.overwriteNote")}
        </div>
      )}

      {rejected ? (
        <div className="flex flex-col gap-2 text-sm">
          <div className="text-destructive">
            {t("importAnswer.violationNote", {
              reason: t(`importAnswer.violation.${row.violation}`),
            })}
          </div>
          <div className="text-muted-foreground">
            {t("importAnswer.violationHint")}
          </div>
        </div>
      ) : (
        <StructuralDiff
          after={row.after}
          before={row.before}
          kind={row.kind}
          path={row.path}
          reason={row.reason}
        />
      )}
    </div>
  );
}

function ResultPanel({
  counts,
  recalculated,
  t,
}: {
  counts: KindCounts;
  recalculated: boolean;
  t: Translate;
}) {
  return (
    <div className="flex max-w-[52ch] flex-col gap-3">
      <StatusBadge variant="success">
        {t("importAnswer.result.title")}
      </StatusBadge>
      <CountsLegend className="text-sm" counts={counts} t={t} />
      <div className="text-muted-foreground text-sm">
        {t(
          recalculated
            ? "importAnswer.result.recalculated"
            : "importAnswer.result.notRecalculated"
        )}
      </div>
      <div className="border-border border-t pt-3 text-muted-foreground text-sm leading-[1.6]">
        {t("importAnswer.result.hint")}
      </div>
    </div>
  );
}

function Manifest({
  broken,
  frozen,
  hasProse,
  onKeyDown,
  onSelect,
  ref,
  rows,
  selectedIndex,
  t,
}: {
  broken: boolean;
  frozen: boolean;
  hasProse: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onSelect: (index: number) => void;
  ref: RefObject<HTMLDivElement | null>;
  rows: ManifestRow[];
  selectedIndex: number;
  t: Translate;
}) {
  const rowClassName = (isSelected: boolean) =>
    `flex w-full items-center gap-2 border-border border-b border-l-2 px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
      isSelected
        ? "border-l-[color:var(--primary)] bg-accent font-medium"
        : "border-l-transparent hover:bg-muted"
    }`;

  return (
    <div
      aria-label={t("importAnswer.manifestLabel")}
      className={`flex w-[384px] shrink-0 flex-col overflow-y-auto rounded-md border border-border ${
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
        <span className="flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0" />
          <MessageSquareText
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        </span>
        <span className="flex-1 text-sm">{t("importAnswer.prose")}</span>
        {!hasProse && (
          <span className="text-muted-foreground text-xs">
            {t("importAnswer.proseEmpty")}
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
          <Gutter kind={row.kind} rejected={row.violation !== null} />
          <FileName row={row} />
          {row.violation !== null && (
            <span className="shrink-0 text-destructive text-xs">
              {t("importAnswer.rejected")}
            </span>
          )}
          {row.supersededBelow && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {t("importAnswer.superseded")}
            </span>
          )}
          {row.overwritesManualEdit && (
            <span
              className="flex shrink-0 items-center text-warning"
              title={t("importAnswer.overwriteMark")}
            >
              <PenLine aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{t("importAnswer.overwriteMark")}</span>
            </span>
          )}
        </button>
      ))}

      {rows.length === 0 && (
        <div className="px-3 py-4 text-muted-foreground text-xs">
          {t(broken ? "importAnswer.emptyBroken" : "importAnswer.emptyParsed")}
        </div>
      )}
    </div>
  );
}

export type { KindCounts, Translate };
export {
  LossNotice,
  Manifest,
  ParseSummary,
  PROSE_INDEX,
  ProsePanel,
  RefusalBanner,
  ResultPanel,
  RowPanel,
  toManifestRow,
};
