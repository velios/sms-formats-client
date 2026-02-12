import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BankInfo, ValidationIssue } from "@/domain/types";
import { validateBankLevel } from "@/domain/validation";
import { useDraftStore } from "@/store";

interface Props {
  bankPath: string;
  bank: BankInfo | null;
  onClose: () => void;
}

export function ValidationPanel({ bankPath, bank, onClose }: Props) {
  const { t } = useTranslation();
  const draftStore = useDraftStore();
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [ran, setRan] = useState(false);

  const runValidation = useCallback(() => {
    if (!bank) {
      setIssues([
        {
          code: "NO_BANK",
          level: "error",
          filePath: bankPath,
          message: "Bank not found",
        },
      ]);
      setRan(true);
      return;
    }

    // Gather all format contents from drafts or mark as missing
    const formatContents = new Map<string, string>();

    // Include remote + draft format files
    const allPaths = new Set([...bank.formatFiles]);
    for (const [path] of draftStore.drafts) {
      if (path.startsWith(`${bankPath}/formats/`) && path.endsWith(".txt")) {
        allPaths.add(path);
      }
    }

    for (const path of allPaths) {
      const draft = draftStore.getDraft(path);
      if (draft) {
        formatContents.set(path, draft.content);
      }
    }

    // Also check if senders.txt exists in drafts for new banks
    const sendersPath = `${bankPath}/senders.txt`;
    const sendersDraft = draftStore.getDraft(sendersPath);
    const hasSenders = bank.hasSenders || !!sendersDraft;

    const bankForValidation: BankInfo = { ...bank, hasSenders };

    const result = validateBankLevel(bankForValidation, formatContents);
    setIssues(result);
    setRan(true);
  }, [bank, bankPath, draftStore]);

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ minWidth: 500 }}
      >
        <div className="modal__title">{t("validation.title")}</div>

        {ran ? (
          <div className="flex-col gap-md">
            {/* Summary */}
            <div className="flex gap-sm">
              {errors.length === 0 && warnings.length === 0 ? (
                <span className="badge badge--success">
                  {t("validation.valid")}
                </span>
              ) : (
                <>
                  {errors.length > 0 && (
                    <span className="badge badge--error">
                      {t("validation.errors", { count: errors.length })}
                    </span>
                  )}
                  {warnings.length > 0 && (
                    <span className="badge badge--warning">
                      {t("validation.warnings", { count: warnings.length })}
                    </span>
                  )}
                </>
              )}
            </div>

            {/* Issue list */}
            <div
              className="issue-list"
              style={{ maxHeight: 400, overflowY: "auto" }}
            >
              {issues.map((issue, i) => (
                <div
                  className={`issue-item ${issue.level === "error" ? "issue-item--error" : "issue-item--warning"}`}
                  key={i}
                >
                  <span className="text-mono text-sm" style={{ minWidth: 100 }}>
                    {issue.filePath.split("/").pop()}
                  </span>
                  <span className="text-sm">{issue.message}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex-col items-center gap-md">
            <button className="btn btn--primary" onClick={runValidation}>
              {t("validation.runValidation")}
            </button>
          </div>
        )}

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            {t("app.close")}
          </button>
          {ran && (
            <button className="btn btn--primary" onClick={runValidation}>
              {t("app.retry")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
