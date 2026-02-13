import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchFileContent } from "@/domain/github";
import type { BankInfo, RepoRef, ValidationIssue } from "@/domain/types";
import { validateBankLevel } from "@/domain/validation";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
  bank: BankInfo | null;
  onClose: () => void;
}

interface ValidationDraftStore {
  drafts: Map<string, { content: string; remoteContent: string }>;
  getDraft: (
    filePath: string
  ) => { content: string; remoteContent: string } | undefined;
}

function isBankFormatPath(bankPath: string, path: string): boolean {
  return path.startsWith(`${bankPath}/formats/`) && path.endsWith(".txt");
}

function collectAllFormatPaths(
  bankPath: string,
  bank: BankInfo,
  draftStore: ValidationDraftStore
): string[] {
  const allPaths = new Set(bank.formatFiles);
  for (const [path] of draftStore.drafts) {
    if (isBankFormatPath(bankPath, path)) {
      allPaths.add(path);
    }
  }
  return Array.from(allPaths);
}

function splitDraftAndRemotePaths(
  paths: string[],
  draftStore: ValidationDraftStore
): { formatContents: Map<string, string>; pathsToLoadRemotely: string[] } {
  const formatContents = new Map<string, string>();
  const pathsToLoadRemotely: string[] = [];

  for (const path of paths) {
    const draft = draftStore.getDraft(path);
    if (draft && draft.content !== draft.remoteContent) {
      formatContents.set(path, draft.content);
      continue;
    }
    pathsToLoadRemotely.push(path);
  }

  return { formatContents, pathsToLoadRemotely };
}

async function loadRemoteFormatContents(params: {
  pathsToLoadRemotely: string[];
  sourceRefName: string;
  repository: RepoRef;
  draftStore: ValidationDraftStore;
  formatContents: Map<string, string>;
}) {
  const {
    pathsToLoadRemotely,
    sourceRefName,
    repository,
    draftStore,
    formatContents,
  } = params;

  await Promise.all(
    pathsToLoadRemotely.map(async (path) => {
      try {
        const remoteContent = await fetchFileContent(
          path,
          sourceRefName,
          repository
        );
        formatContents.set(path, remoteContent);
      } catch {
        const draft = draftStore.getDraft(path);
        if (draft) {
          formatContents.set(path, draft.content);
        }
      }
    })
  );
}

function loadDraftFallbackContents(params: {
  pathsToLoadRemotely: string[];
  draftStore: ValidationDraftStore;
  formatContents: Map<string, string>;
}) {
  const { pathsToLoadRemotely, draftStore, formatContents } = params;
  for (const path of pathsToLoadRemotely) {
    const draft = draftStore.getDraft(path);
    if (draft) {
      formatContents.set(path, draft.content);
    }
  }
}

function hasDraftSenders(
  bankPath: string,
  draftStore: ValidationDraftStore
): boolean {
  return !!draftStore.getDraft(`${bankPath}/senders.txt`);
}

export function ValidationPanel({ bankPath, bank, onClose }: Props) {
  const { t } = useTranslation();
  const dialogTitleId = useId();
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
            message: "Bank not found",
          },
        ]);
        return;
      }

      const sourceRefName = sourceRef?.sha ?? sourceRef?.name ?? null;
      const allPaths = collectAllFormatPaths(bankPath, bank, draftStore);
      const { formatContents, pathsToLoadRemotely } = splitDraftAndRemotePaths(
        allPaths,
        draftStore
      );

      if (sourceRefName) {
        await loadRemoteFormatContents({
          pathsToLoadRemotely,
          sourceRefName,
          repository,
          draftStore,
          formatContents,
        });
      } else {
        loadDraftFallbackContents({
          pathsToLoadRemotely,
          draftStore,
          formatContents,
        });
      }

      const bankForValidation: BankInfo = {
        ...bank,
        hasSenders: bank.hasSenders || hasDraftSenders(bankPath, draftStore),
      };
      setIssues(validateBankLevel(bankForValidation, formatContents));
    } finally {
      setRan(true);
      setRunning(false);
    }
  }, [bank, bankPath, draftStore, repository, sourceRef]);

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
    <div className="modal-overlay" onClick={onClose}>
      <div
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        style={{ minWidth: 500 }}
      >
        <div className="modal__title" id={dialogTitleId}>
          {t("validation.title")}
        </div>

        {running ? (
          <div
            aria-live="polite"
            className="flex items-center gap-sm"
            role="status"
          >
            <span className="spinner" />
            <span>{t("app.loading")}</span>
          </div>
        ) : ran ? (
          <div aria-live="polite" className="flex-col gap-md" role="status">
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
        ) : null}

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            {t("app.close")}
          </button>
          {!running && ran && (
            <button
              className="btn btn--primary"
              onClick={() => void runValidation()}
            >
              {t("app.retry")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
