// The import surface (PRD #30, screen per variant D of the prototype): one
// screen with two states — the pasted text and the manifest of what will
// happen. Manifest on the left, details of the selected row on the right, the
// agent's prose as the first row and selected by default.

import {
  Ban,
  FilePlus2,
  MessageSquareText,
  Pencil,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import type { RepoRef } from "@/domain/types";
import type { AnswerProblem, PathViolation } from "./core";
import { type DiffKind, StructuralDiff } from "./StructuralDiff";
import {
  type ImportAnswerDraftStore,
  type ImportAnswerRow,
  useImportAnswer,
} from "./use-import-answer";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const PROSE_INDEX = -1;

/** Order in the legend — from the most common outcome to the rarest. */
const KIND_ORDER: DiffKind[] = ["changed", "created", "deleted", "identical"];

/**
 * Four kinds of change, a closed list. The colours come from the application
 * tokens, and blue "changed" / green "new" are the same ones the bank file
 * list already marks its rows with.
 */
const KIND_STYLE: Record<DiffKind, { dot: string; text: string }> = {
  changed: {
    dot: "bg-[color:var(--c-accent)]",
    text: "text-[color:var(--c-accent)]",
  },
  created: {
    dot: "bg-[color:var(--c-success)]",
    text: "text-[color:var(--c-success)]",
  },
  deleted: {
    dot: "bg-[color:var(--c-error)]",
    text: "text-[color:var(--c-error)]",
  },
  identical: {
    dot: "bg-[color:var(--c-text-dim)]",
    text: "text-[color:var(--c-text-dim)]",
  },
};

interface ManifestRow {
  path: string;
  fileName: string;
  kind: DiffKind;
  reason: string | null;
  /** The body in force; null when nothing stands at this path yet. */
  before: string | null;
  after: string | null;
  overwritesManualEdit: boolean;
  supersededBelow: boolean;
  violation: PathViolation | null;
}

function toManifestRow(row: ImportAnswerRow): ManifestRow {
  const { change } = row;
  // A file drafted into existence in this PR counts as existing: it is what
  // the import would overwrite.
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

/**
 * Splits the name into a head that may be truncated and a tail that may not:
 * `_11792.txt` is the format's upstream number, the sign that it is published.
 */
function splitName(fileName: string): { head: string; tail: string } {
  const withId = /^(.*?)(_\d+\.txt)$/.exec(fileName);
  if (withId) {
    return { head: withId[1] ?? "", tail: withId[2] ?? "" };
  }
  return { head: fileName, tail: "" };
}

/**
 * Where the file came from. "Has a number → the file exists" holds one way
 * only: the number is assigned upstream on publication, so a file created in
 * the current PR exists without one. The list cannot show that difference, so
 * the answer is given in words here.
 */
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

/**
 * The icon slot. Taken by deletion and creation only; for the rest it holds
 * the alignment empty so the trash can keeps meaning "this one is final".
 */
function KindIcon({ kind }: { kind: DiffKind }) {
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
 * A file outside the bank is neither "new" nor "changed": nothing will happen
 * to it, because nothing will happen at all. The gutter shows a ban instead.
 */
function Gutter({ kind, rejected }: { kind: DiffKind; rejected: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${
          rejected ? "bg-[color:var(--c-error)]" : KIND_STYLE[kind].dot
        }`}
      />
      {rejected ? (
        <Ban
          aria-hidden="true"
          className="size-3.5 shrink-0 text-[color:var(--c-error)]"
        />
      ) : (
        <KindIcon kind={kind} />
      )}
    </span>
  );
}

/**
 * The human phrase is truncated, the format number never is. Deletion is also
 * struck through — the one sign that survives colour blindness.
 */
function FileName({ row }: { row: ManifestRow }) {
  const { head, tail } = splitName(row.fileName);
  return (
    <span
      className={`flex min-w-0 flex-1 items-baseline text-[13px] ${
        row.kind === "deleted"
          ? "line-through decoration-1 decoration-current"
          : ""
      } ${row.supersededBelow ? "text-[color:var(--c-text-dim)]" : ""}`}
    >
      <span className="min-w-0 truncate">{head}</span>
      {tail !== "" && (
        <span
          className={`shrink-0 font-mono text-[11.5px] tabular-nums ${
            row.supersededBelow
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

type KindCounts = Record<DiffKind, number>;

/** Counts by kind — and at the same time the legend for the gutter. */
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
          <span className="text-[color:var(--c-text-muted)]">
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
      <span className="text-[color:var(--c-text-muted)]">
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
  /** The import already happened: there is no future left to warn about. */
  done: boolean;
  hasRows: boolean;
  onShowText: () => void;
  overwriteCount: number;
  t: Translate;
}) {
  return (
    <div className="flex items-center gap-4 rounded-[var(--radius-md)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-3 py-2 text-[13px]">
      {broken && (
        <span className="text-[color:var(--c-error)]">
          {t("importAnswer.status.broken")}
        </span>
      )}
      {!broken && blocked && (
        <span className="text-[color:var(--c-error)]">
          {t("importAnswer.status.outOfBounds")}
        </span>
      )}
      {!(broken || blocked || hasRows) && (
        <span className="text-[color:var(--c-text-muted)]">
          {t("importAnswer.status.noFiles")}
        </span>
      )}
      {/* Under a refusal the counts would lie: none of these files goes
          anywhere. */}
      {!blocked && hasRows && <CountsLegend counts={counts} t={t} />}
      {overwriteCount > 0 && !(blocked || done) && (
        <span className="flex items-center gap-1.5 text-[color:var(--c-warning)]">
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {t("importAnswer.overwriteWarning", { count: overwriteCount })}
        </span>
      )}
      <Button
        className="ml-auto"
        onClick={onShowText}
        size="xs"
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
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color:var(--c-error)] bg-[color:var(--c-error-soft)] p-3">
      <StatusBadge variant="error">
        {t(
          broken
            ? "importAnswer.refusal.brokenTitle"
            : "importAnswer.refusal.boundsTitle"
        )}
      </StatusBadge>
      <div className="flex flex-col gap-1 text-[12px]">
        <ProblemList problems={problems} t={t} />
        {violations.map((row) => (
          <div key={row.path}>
            <code className="font-mono">{row.path}</code>{" "}
            <span className="text-[color:var(--c-text-muted)]">
              — {t(`importAnswer.violation.${row.violation}`)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-1 text-[12px] text-[color:var(--c-text-muted)]">
        {t(
          broken
            ? "importAnswer.refusal.brokenHint"
            : "importAnswer.refusal.boundsHint"
        )}
        <Button
          onClick={onPasteAgain}
          size="xs"
          type="button"
          variant="secondary"
        >
          {t("importAnswer.refusal.pasteAgain")}
        </Button>
      </div>
    </div>
  );
}

/** Oddities that do not break the import but lose something from the answer. */
function LossNotice({
  problems,
  t,
}: {
  problems: AnswerProblem[];
  t: Translate;
}) {
  return (
    <div className="flex flex-col gap-1 border-[color:var(--c-warning)] border-l-2 py-1 pl-3 text-[12px]">
      <span className="font-medium text-[color:var(--c-warning)]">
        {t("importAnswer.loss.title")}
      </span>
      <div className="text-[color:var(--c-text-muted)]">
        <ProblemList problems={problems} t={t} />
      </div>
    </div>
  );
}

function ProsePanel({ text, t }: { text: string; t: Translate }) {
  const empty = text.trim() === "";
  return (
    <div className="flex flex-col gap-2">
      <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
        {t("importAnswer.prosePanelTitle")}
      </div>
      <div
        className={`max-w-[68ch] whitespace-pre-wrap text-[13.5px] leading-[1.7] ${
          empty
            ? "text-[color:var(--c-text-dim)]"
            : "text-[color:var(--c-text)]"
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
      {/* The same mark the row on the left carries, picked up here. */}
      <div className="flex items-center gap-2 border-[color:var(--c-border)] border-b pb-3">
        <Gutter kind={row.kind} rejected={rejected} />
        <span className="min-w-0 flex-1 break-all font-mono text-[12px] leading-[1.5]">
          {row.path}
        </span>
        <span
          className={`shrink-0 text-[12px] ${
            rejected ? "text-[color:var(--c-error)]" : KIND_STYLE[row.kind].text
          }`}
        >
          {rejected
            ? t("importAnswer.rejected")
            : t(`importAnswer.kind.${row.kind}`)}
        </span>
      </div>

      {!rejected && (
        <div className="text-[12px] text-[color:var(--c-text-muted)]">
          {provenanceText(row, t)}
        </div>
      )}

      {row.supersededBelow && (
        <div className="border-[color:var(--c-warning)] border-l-2 py-1 pl-3 text-[12px] text-[color:var(--c-text-muted)]">
          {t("importAnswer.supersededNote")}
        </div>
      )}

      {row.overwritesManualEdit && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--c-warning)] bg-[color:var(--c-warning-soft)] p-2 text-[12px] text-[color:var(--c-warning)]">
          <Pencil aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {t("importAnswer.overwriteNote")}
        </div>
      )}

      {rejected ? (
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="text-[color:var(--c-error)]">
            {t("importAnswer.violationNote", {
              reason: t(`importAnswer.violation.${row.violation}`),
            })}
          </div>
          <div className="text-[color:var(--c-text-muted)]">
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
      <CountsLegend className="text-[14px]" counts={counts} t={t} />
      <div className="text-[13px] text-[color:var(--c-text-muted)]">
        {t(
          recalculated
            ? "importAnswer.result.recalculated"
            : "importAnswer.result.notRecalculated"
        )}
      </div>
      {/* An empty screen after an action is room for the next step, not for
          congratulations. */}
      <div className="border-[color:var(--c-border)] border-t pt-3 text-[13px] text-[color:var(--c-text-muted)] leading-[1.6]">
        {t("importAnswer.result.hint")}
      </div>
    </div>
  );
}

/**
 * The manifest: what happens to every bank file. Rows live by index, not by
 * path — one path may appear in the answer twice.
 */
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
  /** The import already happened — reading is fine, choosing is pointless. */
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
    `flex w-full items-center gap-2 border-[color:var(--c-border)] border-b border-l-2 px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)] focus-visible:ring-inset ${
      isSelected
        ? "border-l-[color:var(--c-accent)] bg-[color:var(--c-bg-hover)] font-medium"
        : "border-l-transparent hover:bg-[color:var(--c-bg-elevated)]"
    }`;

  return (
    <div
      aria-label={t("importAnswer.manifestLabel")}
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
        {/* A comment is not a file, so it gets no dot: the slot stays empty
            and the alignment with the files survives. */}
        <span className="flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0" />
          <MessageSquareText
            aria-hidden="true"
            className="size-3.5 shrink-0 text-[color:var(--c-text-dim)]"
          />
        </span>
        <span className="flex-1 text-[13px]">{t("importAnswer.prose")}</span>
        {!hasProse && (
          <span className="text-[11px] text-[color:var(--c-text-dim)]">
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
            <span className="shrink-0 text-[11px] text-[color:var(--c-error)]">
              {t("importAnswer.rejected")}
            </span>
          )}
          {row.supersededBelow && (
            <span className="shrink-0 text-[11px] text-[color:var(--c-text-dim)]">
              {t("importAnswer.superseded")}
            </span>
          )}
          {row.overwritesManualEdit && (
            <span
              className="flex shrink-0 items-center text-[color:var(--c-warning)]"
              title={t("importAnswer.overwriteMark")}
            >
              <Pencil aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{t("importAnswer.overwriteMark")}</span>
            </span>
          )}
        </button>
      ))}

      {rows.length === 0 && (
        <div className="px-3 py-4 text-[12px] text-[color:var(--c-text-dim)]">
          {t(broken ? "importAnswer.emptyBroken" : "importAnswer.emptyParsed")}
        </div>
      )}
    </div>
  );
}

/** The paste state — where the screen starts in real life. */
function PasteView({
  onCancel,
  onChange,
  onPasted,
  onShowChanges,
  text,
  t,
}: {
  onCancel: () => void;
  onChange: (next: string) => void;
  onPasted: () => void;
  onShowChanges: () => void;
  text: string;
  t: Translate;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pastedRef = useRef(false);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    // Read as UTF-8 text, extension unchecked: the answer is a text file
    // whatever the chat named it.
    onChange(await file.text());
    onPasted();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="font-semibold text-[11px] text-[color:var(--c-text-dim)] uppercase tracking-[0.5px]">
        {t("importAnswer.answerLabel")}
      </div>
      <Textarea
        className="min-h-0 flex-1 font-mono text-[12px] leading-[1.6]"
        onChange={(event) => {
          onChange(event.target.value);
          // Parsing happens on paste — there is no separate "parse" step
          // (PRD). Typing by hand leaves the human on this screen.
          if (pastedRef.current) {
            pastedRef.current = false;
            onPasted();
          }
        }}
        onPaste={() => {
          pastedRef.current = true;
        }}
        placeholder={t("importAnswer.answerPlaceholder")}
        value={text}
      />
      <div className="flex items-center gap-3 border-[color:var(--c-border)] border-t pt-4">
        <Button
          disabled={text.trim() === ""}
          onClick={onShowChanges}
          type="button"
          variant="primary"
        >
          {t("importAnswer.showChanges")}
        </Button>
        <input
          accept=".txt,.md,text/plain"
          className="hidden"
          onChange={(event) => void handleFile(event)}
          ref={fileRef}
          type="file"
        />
        <Button
          onClick={() => fileRef.current?.click()}
          type="button"
          variant="secondary"
        >
          {t("importAnswer.chooseFile")}
        </Button>
        <Button
          className="ml-auto"
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          {t("importAnswer.cancel")}
        </Button>
      </div>
    </div>
  );
}

interface Props {
  bankName: string;
  bankPath: string;
  repository: RepoRef;
  prNumber: number | null;
  sourceRefName: string | undefined;
  headSha: string | undefined;
  existingPaths: ReadonlySet<string>;
  draftStore: ImportAnswerDraftStore;
  calculateIntersections: () => Promise<void>;
  onClose: () => void;
}

export function ImportAnswerModal({
  bankName,
  bankPath,
  repository,
  prNumber,
  sourceRefName,
  headSha,
  existingPaths,
  draftStore,
  calculateIntersections,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const [showingText, setShowingText] = useState(true);
  // By index, not by path: one path may appear twice.
  const [selectedIndex, setSelectedIndex] = useState(PROSE_INDEX);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const importAnswer = useImportAnswer({
    bankPath,
    repository,
    prNumber,
    sourceRefName,
    headSha,
    existingPaths,
    draftStore,
    calculateIntersections,
  });
  const { parsed, summary } = importAnswer;

  const rows = useMemo(
    () => importAnswer.rows.map(toManifestRow),
    [importAnswer.rows]
  );
  const counts = useMemo(() => {
    const next: KindCounts = {
      changed: 0,
      created: 0,
      deleted: 0,
      identical: 0,
    };
    for (const row of rows) {
      next[row.kind] += 1;
    }
    return next;
  }, [rows]);

  const broken = parsed?.status === "broken";
  const violations = rows.filter((row) => row.violation !== null);
  const blocked = broken || violations.length > 0;
  const imported = summary !== null;
  // Non-carrying problems are shown only when the answer arrived as a whole:
  // for a broken one the refusal banner names them.
  const lossProblems = parsed?.status === "parsed" ? parsed.problems : [];
  const selectedRow = rows[selectedIndex] ?? null;

  // The screen is opened to be read, so the focus lands on the list, not on
  // the first button around: arrows work at once and Enter starts nothing.
  const focusList = useCallback((event: Event) => {
    event.preventDefault();
    const list = listRef.current;
    (
      list?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? list
    )?.focus();
  }, []);

  const select = useCallback((index: number) => {
    setSelectedIndex(index);
    if (detailRef.current) {
      detailRef.current.scrollTop = 0;
    }
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
        rows.length - 1,
        Math.max(PROSE_INDEX, selectedIndex + step)
      );
      select(next);
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)
        ?.focus();
    },
    [rows.length, select, selectedIndex]
  );

  return (
    <ModalDialog
      className="flex h-[calc(100vh-64px)] max-h-[860px] flex-col gap-0 sm:max-w-[1080px]"
      onClose={onClose}
      onOpenAutoFocus={showingText ? undefined : focusList}
      title={t("importAnswer.title", { bank: bankName })}
      titleId={titleId}
    >
      {showingText ? (
        <PasteView
          onCancel={onClose}
          onChange={importAnswer.setText}
          onPasted={() => setShowingText(false)}
          onShowChanges={() => setShowingText(false)}
          t={t}
          text={importAnswer.text}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ParseSummary
            blocked={blocked}
            broken={broken}
            counts={counts}
            done={imported}
            hasRows={rows.length > 0}
            onShowText={() => setShowingText(true)}
            overwriteCount={importAnswer.overwriteCount}
            t={t}
          />

          {blocked && (
            <RefusalBanner
              broken={broken}
              onPasteAgain={() => setShowingText(true)}
              problems={parsed?.status === "broken" ? parsed.problems : []}
              t={t}
              violations={violations}
            />
          )}

          {!blocked && lossProblems.length > 0 && (
            <LossNotice problems={lossProblems} t={t} />
          )}

          {importAnswer.loadError !== null && (
            <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--c-error)] bg-[color:var(--c-error-soft)] p-3">
              <StatusBadge variant="error">
                {t(`importAnswer.error.${importAnswer.loadError}`)}
              </StatusBadge>
              {importAnswer.loadError === "load-failed" && (
                <Button
                  onClick={importAnswer.retry}
                  size="xs"
                  type="button"
                  variant="secondary"
                >
                  {t("importAnswer.retry")}
                </Button>
              )}
            </div>
          )}

          <div className="flex min-h-0 flex-1 gap-3">
            <Manifest
              broken={broken}
              frozen={imported}
              hasProse={(parsed?.prose ?? "").trim() !== ""}
              onKeyDown={onListKeyDown}
              onSelect={select}
              ref={listRef}
              rows={rows}
              selectedIndex={selectedIndex}
              t={t}
            />

            <div
              className="min-w-0 flex-1 overflow-y-auto rounded-[var(--radius-md)] border border-[color:var(--c-border)] p-4"
              ref={detailRef}
            >
              {(() => {
                if (summary !== null) {
                  return (
                    <ResultPanel
                      counts={counts}
                      recalculated={summary.intersectionsRecalculated}
                      t={t}
                    />
                  );
                }
                if (importAnswer.isLoadingBodies) {
                  return (
                    <div className="flex items-center gap-2 text-[13px] text-[color:var(--c-text-muted)]">
                      <Spinner />
                      {t("importAnswer.loading")}
                    </div>
                  );
                }
                if (selectedIndex === PROSE_INDEX) {
                  return <ProsePanel t={t} text={parsed?.prose ?? ""} />;
                }
                return selectedRow === null ? (
                  <div className="text-[13px] text-[color:var(--c-text-dim)]">
                    {t("importAnswer.pickRow")}
                  </div>
                ) : (
                  <RowPanel row={selectedRow} t={t} />
                );
              })()}
            </div>
          </div>

          <div className="flex items-center gap-3 border-[color:var(--c-border)] border-t pt-3">
            {!imported && (
              <>
                <Button
                  disabled={!importAnswer.canImport}
                  onClick={() => void importAnswer.write()}
                  type="button"
                  variant="primary"
                >
                  {t("importAnswer.writeAction")}
                </Button>
                <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] has-disabled:cursor-default has-disabled:text-[color:var(--c-text-dim)]">
                  <input
                    checked={importAnswer.recalculateIntersections}
                    className="accent-[color:var(--c-border-focus)]"
                    disabled={!importAnswer.canImport}
                    onChange={(event) =>
                      importAnswer.setRecalculateIntersections(
                        event.target.checked
                      )
                    }
                    type="checkbox"
                  />
                  {t("importAnswer.recalculate")}
                </label>
                {!(importAnswer.canImport || blocked) && (
                  <span className="text-[12px] text-[color:var(--c-text-muted)]">
                    {t("importAnswer.nothingToWrite")}
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
              {t(imported ? "importAnswer.toDrafts" : "importAnswer.cancel")}
            </Button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
