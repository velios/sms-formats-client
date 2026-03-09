import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
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
      className="sm:max-w-[500px]"
      onClose={onClose}
      title={t("validation.title")}
      titleId={dialogTitleId}
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
                    ? "flex gap-2 rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-1.5 text-xs text-[color:var(--c-error)]"
                    : "flex gap-2 rounded-[var(--radius-sm)] bg-[color:var(--c-warning-soft)] px-3 py-1.5 text-xs text-[color:var(--c-warning)]"
                }
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
