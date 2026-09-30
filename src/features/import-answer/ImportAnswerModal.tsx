import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
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
import {
  type KindCounts,
  LossNotice,
  Manifest,
  ParseSummary,
  PROSE_INDEX,
  ProsePanel,
  RefusalBanner,
  ResultPanel,
  RowPanel,
  type Translate,
  toManifestRow,
} from "./AnswerImportViews";
import {
  type ImportAnswerDraftStore,
  useImportAnswer,
} from "./use-import-answer";

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
    onChange(await file.text());
    onPasted();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="ui-field min-h-0 flex-1">
        <div className="ui-field-label font-semibold uppercase tracking-[0.5px]">
          {t("importAnswer.answerLabel")}
        </div>
        <Textarea
          className="min-h-0 flex-1 font-mono text-xs leading-[1.6]"
          onChange={(event) => {
            onChange(event.target.value);
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
      </div>
      <div className="ui-dialog-actions border-border border-t pt-3">
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
  calculateIntersections: (filePaths?: string[]) => Promise<boolean>;
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
  const [showingText, setShowingText] = useState(true);
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
  const lossProblems = parsed?.status === "parsed" ? parsed.problems : [];
  const selectedRow = rows[selectedIndex] ?? null;

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
      className="flex h-[calc(100vh-64px)] max-h-[860px] flex-col sm:max-w-[1080px]"
      onClose={onClose}
      onOpenAutoFocus={showingText ? undefined : focusList}
      title={t("importAnswer.title", { bank: bankName })}
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
            <div
              className="ui-notice flex items-center gap-2"
              data-tone="error"
            >
              <StatusBadge variant="error">
                {t(`importAnswer.error.${importAnswer.loadError}`)}
              </StatusBadge>
              {importAnswer.loadError === "load-failed" && (
                <Button
                  onClick={importAnswer.retry}
                  size="sm"
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
              className="ui-panel ui-panel-body min-w-0 flex-1 overflow-y-auto"
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
                    <div className="ui-state">
                      <Spinner />
                      {t("importAnswer.loading")}
                    </div>
                  );
                }
                if (selectedIndex === PROSE_INDEX) {
                  return <ProsePanel t={t} text={parsed?.prose ?? ""} />;
                }
                return selectedRow === null ? (
                  <div className="text-muted-foreground text-sm">
                    {t("importAnswer.pickRow")}
                  </div>
                ) : (
                  <RowPanel row={selectedRow} t={t} />
                );
              })()}
            </div>
          </div>

          <div className="ui-dialog-actions border-border border-t pt-3">
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
                <label className="flex cursor-pointer select-none items-center gap-2 text-sm has-disabled:cursor-default has-disabled:text-muted-foreground">
                  <input
                    checked={importAnswer.recalculateIntersections}
                    className="accent-[color:var(--ring)]"
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
                  <span className="text-muted-foreground text-xs">
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
