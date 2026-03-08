import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { parseFormatFile } from "@/domain/format";
import { fetchFileContent } from "@/domain/github";
import type { BankInfo, RepoRef, ValidationIssue } from "@/domain/types";
import {
  checkCrossFormatCollisions,
  validateFormat,
} from "@/domain/validation";
import { useDraftStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
  bank: BankInfo | null;
  changedFormatPaths: string[];
  onClose: () => void;
}

interface ValidationDraftStore {
  drafts: Map<string, { content: string; remoteContent: string }>;
  getDraft: (
    filePath: string
  ) => { content: string; remoteContent: string } | undefined;
}

async function loadLatestFormatContent(params: {
  path: string;
  sourceRefName: string | null;
  repository: RepoRef;
  draftStore: ValidationDraftStore;
}): Promise<string | null> {
  const { path, sourceRefName, repository, draftStore } = params;
  const draft = draftStore.getDraft(path);
  if (draft && draft.content !== draft.remoteContent) {
    return draft.content;
  }
  if (!sourceRefName) {
    return draft?.content ?? null;
  }
  try {
    return await fetchFileContent(path, sourceRefName, repository);
  } catch {
    return draft?.content ?? null;
  }
}

async function collectChangedFormatContents(params: {
  changedFormatPaths: string[];
  sourceRefName: string | null;
  repository: RepoRef;
  draftStore: ValidationDraftStore;
}): Promise<Map<string, string>> {
  const { changedFormatPaths, sourceRefName, repository, draftStore } = params;
  const entries = await Promise.all(
    changedFormatPaths.map(async (path) => {
      const latestContent = await loadLatestFormatContent({
        path,
        sourceRefName,
        repository,
        draftStore,
      });
      return latestContent == null ? null : ([path, latestContent] as const);
    })
  );

  const formatContents = new Map<string, string>();
  for (const entry of entries) {
    if (!entry) {
      continue;
    }
    formatContents.set(entry[0], entry[1]);
  }
  return formatContents;
}

function runChangedFormatsValidation(
  formatContents: Map<string, string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const parsedFormats: Array<{
    filePath: string;
    parsed: ReturnType<typeof parseFormatFile>;
  }> = [];

  for (const [path, content] of formatContents) {
    const parsed = parseFormatFile(content, path);
    parsedFormats.push({ filePath: path, parsed });
    issues.push(...validateFormat(parsed, path));
  }

  issues.push(...checkCrossFormatCollisions(parsedFormats));
  return issues;
}

export function ValidationPanel({
  bankPath,
  bank,
  changedFormatPaths,
  onClose,
}: Props) {
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
      if (changedFormatPaths.length === 0) {
        setIssues([]);
        return;
      }

      const formatContents = await collectChangedFormatContents({
        changedFormatPaths,
        sourceRefName,
        repository,
        draftStore,
      });
      setIssues(runChangedFormatsValidation(formatContents));
    } finally {
      setRan(true);
      setRunning(false);
    }
  }, [bank, bankPath, changedFormatPaths, draftStore, repository, sourceRef]);

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
      onClose={onClose}
      style={{ minWidth: 500 }}
      title={t("validation.title")}
      titleId={dialogTitleId}
    >
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
    </ModalDialog>
  );
}
