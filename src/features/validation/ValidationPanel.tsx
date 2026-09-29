import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import type { BankInfo, ValidationIssue } from "@/domain/types";
import { validateBankLevel } from "@/domain/validation";
import { loadBankSnapshot } from "@/features/workspace/bank-snapshot";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
  bank: BankInfo | null;
  formatPaths: string[];
  onClose: () => void;
}

export function ValidationPanel({
  bankPath,
  bank,
  formatPaths,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const draftStore = useDraftStore();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [ran, setRan] = useState(false);
  const [running, setRunning] = useState(false);
  const hasAutoRun = useRef(false);

  const runValidation = useCallback(async () => {
    setRunning(true);

    try {
      if (!bank) {
        setIssues([
          {
            code: "NO_BANK",
            level: "error",
            filePath: bankPath,
          },
        ]);
        return;
      }

      const sourceRefName = sourceRef?.sha ?? sourceRef?.name ?? null;
      const prNumber =
        sourceRef?.type === "pr" && sourceRef.prNumber ? sourceRef.prNumber : 0;
      if (!(prNumber && sourceRefName)) {
        throw new Error("No workspace revision");
      }
      const snapshot = await loadBankSnapshot({
        filePaths: formatPaths,
        draftStore,
        sourceRefName,
        repository,
      });
      const sendersDraft = draftStore.getDraft(`${bankPath}/senders.txt`);
      setIssues(
        validateBankLevel(
          {
            ...bank,
            hasSenders: sendersDraft
              ? !sendersDraft.isDeleted
              : bank.hasSenders,
          },
          snapshot.contents
        )
      );
    } catch (error) {
      setIssues([
        {
          code: "LOAD_FAILED",
          level: "error",
          filePath: bankPath,
          params: {
            detail: error instanceof Error ? error.message : String(error),
          },
        },
      ]);
    } finally {
      setRan(true);
      setRunning(false);
    }
  }, [bank, bankPath, formatPaths, draftStore, repository, sourceRef]);

  useEffect(() => {
    if (hasAutoRun.current) {
      return;
    }
    hasAutoRun.current = true;
    void runValidation();
  }, [runValidation]);

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  return (
    <ModalDialog
      className="sm:max-w-[500px]"
      onClose={onClose}
      title={t("validation.title")}
    >
      {running ? (
        <div
          aria-live="polite"
          className="flex items-center gap-2 text-muted-foreground text-sm"
          role="status"
        >
          <Spinner />
          <span>{t("app.loading")}</span>
        </div>
      ) : ran ? (
        <div aria-live="polite" className="flex flex-col gap-4" role="status">
          <div className="flex gap-2">
            {errors.length === 0 && warnings.length === 0 ? (
              <StatusBadge variant="success">
                {t("validation.valid")}
              </StatusBadge>
            ) : (
              <>
                {errors.length > 0 && (
                  <StatusBadge variant="error">
                    {t("validation.errors", { count: errors.length })}
                  </StatusBadge>
                )}
                {warnings.length > 0 && (
                  <StatusBadge variant="warning">
                    {t("validation.warnings", { count: warnings.length })}
                  </StatusBadge>
                )}
              </>
            )}
          </div>

          <div
            className="flex max-h-[400px] flex-col gap-1 overflow-y-auto"
            style={{ maxHeight: 400, overflowY: "auto" }}
          >
            {issues.map((issue, i) => (
              <div
                className={
                  issue.level === "error"
                    ? "flex gap-2 rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-1.5 text-[color:var(--c-error)] text-xs"
                    : "flex gap-2 rounded-[var(--radius-sm)] bg-[color:var(--c-warning-soft)] px-3 py-1.5 text-[color:var(--c-warning)] text-xs"
                }
                key={i}
              >
                <span className="font-mono text-sm" style={{ minWidth: 100 }}>
                  {issue.filePath.split("/").pop()}
                </span>
                <span className="text-sm">
                  {t(`validation.issue.${issue.code}`, issue.params)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onClose} type="button">
          {t("app.close")}
        </Button>
        {!running && ran && (
          <Button
            onClick={() => void runValidation()}
            type="button"
            variant="primary"
          >
            {t("app.retry")}
          </Button>
        )}
      </div>
    </ModalDialog>
  );
}
