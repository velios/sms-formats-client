import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { isBankFormatFilePath } from "@/domain/format";
import {
  fetchOpenPRs,
  resolvePullRequestWorkspace,
  updatePullRequestHead,
} from "@/domain/github";
import type { BankInfo } from "@/domain/types";
import { validateBankLevel } from "@/domain/validation";
import { openPrsQueryKey } from "@/hooks/useGitHub";
import { cn } from "@/lib/utils";
import type { PublishStep } from "@/store";
import { useDraftStore, usePublishStore, useSourceStore } from "@/store";

interface Props {
  bankPath: string;
  bankName: string;
  onClose: () => void;
}

interface ChangedFile {
  filePath: string;
  content: string;
  isDeleted: boolean;
}

interface PublishStoreLike {
  setStep: (step: PublishStep) => void;
  setToken: (token: string | null) => void;
  setValidationIssues: (issues: ReturnType<typeof validateBankLevel>) => void;
  setError: (error: string | null) => void;
  setPrUrl: (url: string | null) => void;
  reset: () => void;
}

interface DraftStoreLike {
  getDraft: (filePath: string) => { content: string } | undefined;
  getChangedFiles: () => ChangedFile[];
}

export function resolvePublishPreflightState(params: {
  resolverHeadSha: string;
  sessionHeadSha: string;
  writable: boolean;
  localChangesCount: number;
  hasInvalidScopeChanges: boolean;
  validationErrorsCount: number;
}):
  | "stale"
  | "read-only"
  | "no-changes"
  | "invalid-scope"
  | "validation-failed"
  | "can-publish" {
  const {
    resolverHeadSha,
    sessionHeadSha,
    writable,
    localChangesCount,
    hasInvalidScopeChanges,
    validationErrorsCount,
  } = params;
  if (resolverHeadSha !== sessionHeadSha) {
    return "stale";
  }
  if (!writable) {
    return "read-only";
  }
  if (localChangesCount === 0) {
    return "no-changes";
  }
  if (hasInvalidScopeChanges) {
    return "invalid-scope";
  }
  if (validationErrorsCount > 0) {
    return "validation-failed";
  }
  return "can-publish";
}

function buildFormatContents(changedFiles: ChangedFile[]): Map<string, string> {
  const formatContents = new Map<string, string>();
  for (const file of changedFiles) {
    if (file.isDeleted) {
      continue;
    }
    const bankPath = file.filePath.split("/formats/")[0];
    if (!(bankPath && isBankFormatFilePath(file.filePath, bankPath))) {
      continue;
    }
    formatContents.set(file.filePath, file.content);
  }
  return formatContents;
}

function collectPublishValidationIssues(params: {
  bank: BankInfo | undefined;
  bankPath: string;
  changedFiles: ChangedFile[];
  draftStore: DraftStoreLike;
}) {
  const { bank, bankPath, changedFiles, draftStore } = params;
  if (!bank) {
    return [];
  }

  const sendersDraft = draftStore.getDraft(`${bankPath}/senders.txt`);
  const bankForValidation: BankInfo = {
    ...bank,
    hasSenders: bank.hasSenders || !!sendersDraft,
  };
  return validateBankLevel(
    bankForValidation,
    buildFormatContents(changedFiles)
  );
}

function resolvePublishPreflightError(params: {
  bank: BankInfo | undefined;
  bankPath: string;
  changedFiles: ChangedFile[];
  allChangedFiles: ChangedFile[];
  draftStore: DraftStoreLike;
  publishStore: PublishStoreLike;
  resolverHeadSha: string;
  sourceSha: string;
  writable: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}): string | null {
  const {
    bank,
    bankPath,
    changedFiles,
    allChangedFiles,
    draftStore,
    publishStore,
    resolverHeadSha,
    sourceSha,
    writable,
    t,
  } = params;
  const validationIssues = collectPublishValidationIssues({
    bank,
    bankPath,
    changedFiles,
    draftStore,
  });
  publishStore.setValidationIssues(validationIssues);
  const validationErrorsCount = validationIssues.filter(
    (issue) => issue.level === "error"
  ).length;
  const publishState = resolvePublishPreflightState({
    resolverHeadSha,
    sessionHeadSha: sourceSha,
    writable,
    localChangesCount: changedFiles.length,
    hasInvalidScopeChanges: allChangedFiles.some(
      (file) => !file.filePath.startsWith(`${bankPath}/`)
    ),
    validationErrorsCount,
  });

  if (publishState === "stale") {
    return t("publish.outdatedBase");
  }
  if (publishState === "read-only") {
    return t("publish.readOnly", {
      defaultValue: "This pull request is read-only.",
    });
  }
  if (publishState === "no-changes") {
    return t("publish.noChanges");
  }
  if (publishState === "invalid-scope") {
    return t("validation.multiBankPublish");
  }
  if (publishState === "validation-failed") {
    return t("validation.errors", { count: validationErrorsCount });
  }
  return null;
}

export function PublishPanel({ bankPath, bankName, onClose }: Props) {
  const { t } = useTranslation();
  const dialogTitleId = useId();
  const tokenInputId = useId();
  const draftStore = useDraftStore();
  const publishStore = usePublishStore();
  const sourceRef = useSourceStore((state) => state.sourceRef);
  const banks = useSourceStore((state) => state.banks);
  const repository = useSourceStore((state) => state.repository);
  const queryClient = useQueryClient();
  const [token, setToken] = useState(publishStore.token ?? "");

  const changedFiles = draftStore
    .getChangedFiles()
    .filter((entry) => entry.filePath.startsWith(bankPath))
    .map((entry) => ({
      filePath: entry.filePath,
      content: entry.content,
      isDeleted: entry.isDeleted,
    }));
  const allChangedFiles = draftStore.getChangedFiles().map((entry) => ({
    filePath: entry.filePath,
    content: entry.content,
    isDeleted: entry.isDeleted,
  }));

  const handlePublish = useCallback(async () => {
    const trimmedToken = token.trim();
    if (
      !trimmedToken ||
      sourceRef?.type !== "pr" ||
      !sourceRef.prNumber ||
      !sourceRef.sha
    ) {
      return;
    }

    publishStore.reset();
    publishStore.setToken(trimmedToken);

    try {
      publishStore.setStep("validating");
      const resolution = await resolvePullRequestWorkspace(
        sourceRef.prNumber,
        repository
      );
      if (resolution.status !== "supported") {
        publishStore.setError(t("publish.updateError"));
        return;
      }

      const bank = banks.find((item) => item.folderPath === bankPath);
      const publishError = resolvePublishPreflightError({
        bank,
        bankPath,
        changedFiles,
        allChangedFiles,
        draftStore,
        publishStore,
        resolverHeadSha: resolution.headSha,
        sourceSha: sourceRef.sha,
        writable: resolution.writable,
        t,
      });
      if (publishError) {
        publishStore.setError(publishError);
        return;
      }

      publishStore.setStep("committing");
      const result = await updatePullRequestHead(
        trimmedToken,
        sourceRef.prNumber,
        changedFiles.map((file) => ({
          path: file.filePath,
          content: file.isDeleted ? undefined : file.content,
          delete: file.isDeleted,
        })),
        repository
      );

      publishStore.setStep("syncing");
      const syncedResolution = await resolvePullRequestWorkspace(
        sourceRef.prNumber,
        repository,
        { forceFresh: true, headShaOverride: result.headSha }
      );
      if (syncedResolution.status !== "supported") {
        publishStore.setError(t("publish.updateError"));
        return;
      }

      const freshOpenPrs = await fetchOpenPRs(repository, { forceFresh: true });
      queryClient.setQueryData(openPrsQueryKey(repository), freshOpenPrs);

      publishStore.setPrUrl(result.url);
      publishStore.setStep("done");
    } catch (error) {
      publishStore.setError(
        error instanceof Error ? error.message : t("publish.updateError")
      );
    }
  }, [
    allChangedFiles,
    bankPath,
    banks,
    changedFiles,
    draftStore,
    publishStore,
    queryClient,
    repository,
    sourceRef,
    t,
    token,
  ]);

  const step = publishStore.step;
  const isPublishing = step !== "idle" && step !== "done" && step !== "error";

  return (
    <ModalDialog
      className="sm:max-w-[500px]"
      onClose={onClose}
      title={t("publish.title")}
      titleId={dialogTitleId}
    >
      <div className="mb-4 flex flex-col gap-2">
        <div className="text-[color:var(--c-text-muted)] text-sm">
          {bankName}
        </div>
        <div className="text-[color:var(--c-text-muted)] text-sm">
          {changedFiles.length} file(s) changed
        </div>
      </div>

      {step === "idle" && (
        <div className="mb-4 flex flex-col gap-1">
          <label
            className="text-[color:var(--c-text-muted)] text-xs"
            htmlFor={tokenInputId}
          >
            {t("publish.tokenLabel")}
          </label>
          <Input
            className="font-mono"
            id={tokenInputId}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ghp_..."
            type="password"
            value={token}
          />
          <span className="text-[color:var(--c-text-dim)] text-xs">
            {t("publish.tokenHint")}
          </span>
        </div>
      )}

      {step !== "idle" && (
        <div
          aria-live="polite"
          className="mb-4 flex flex-col gap-2"
          role="status"
        >
          <PublishStepItem
            label={t("publish.validating")}
            status={stepStatus("validating", step)}
          />
          <PublishStepItem
            label={t("publish.committing")}
            status={stepStatus("committing", step)}
          />
          <PublishStepItem
            label={t("publish.syncing", {
              defaultValue: "Syncing workspace…",
            })}
            status={stepStatus("syncing", step)}
          />
        </div>
      )}

      {step === "done" && publishStore.prUrl && (
        <div
          aria-live="polite"
          className="mb-4 flex flex-col gap-2"
          role="status"
        >
          <StatusBadge variant="success">
            {t("publish.successUpdate")}
          </StatusBadge>
          <a
            href={publishStore.prUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {t("publish.prLink")}: {publishStore.prUrl}
          </a>
        </div>
      )}

      {step === "error" && publishStore.error && (
        <div
          aria-live="assertive"
          className="mb-4 rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-2 text-[color:var(--c-error)] text-xs"
          role="alert"
        >
          {publishStore.error}
        </div>
      )}

      {publishStore.validationIssues.length > 0 && (
        <div className="mb-4 flex max-h-[200px] flex-col gap-1 overflow-y-auto">
          {publishStore.validationIssues.map((issue, index) => (
            <div
              className={
                issue.level === "error"
                  ? "flex gap-2 rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-1.5 text-[color:var(--c-error)] text-xs"
                  : "flex gap-2 rounded-[var(--radius-sm)] bg-[color:var(--c-warning-soft)] px-3 py-1.5 text-[color:var(--c-warning)] text-xs"
              }
              key={`${issue.filePath}:${index}`}
            >
              <span className="font-mono text-sm">
                {issue.filePath.split("/").pop()}
              </span>
              <span className="text-sm">{issue.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onClose} type="button">
          {t("app.close")}
        </Button>
        {step !== "done" && (
          <Button
            disabled={isPublishing || !token.trim()}
            onClick={handlePublish}
            type="button"
            variant="primary"
          >
            {isPublishing ? <Spinner /> : null}
            {t("publish.updatePR")}
          </Button>
        )}
      </div>
    </ModalDialog>
  );
}

const STEP_ORDER = ["validating", "committing", "syncing", "done"] as const;

function stepStatus(
  target: (typeof STEP_ORDER)[number],
  current: PublishStep
): "pending" | "active" | "done" | "error" {
  if (current === "error" || current === "idle") {
    return "pending";
  }
  const currentIndex = STEP_ORDER.indexOf(current);
  const targetIndex = STEP_ORDER.indexOf(target);
  if (targetIndex < currentIndex) {
    return "done";
  }
  if (targetIndex === currentIndex) {
    return "active";
  }
  return "pending";
}

function PublishStepItem({
  label,
  status,
}: {
  label: string;
  status: "pending" | "active" | "done" | "error";
}) {
  const className = cn(
    "flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs",
    status === "active" &&
      "border-[color:var(--c-accent)] bg-[color:var(--c-accent-soft)] text-[color:var(--c-accent)]",
    status === "done" &&
      "border-[color:var(--c-success)] bg-[color:var(--c-success-soft)] text-[color:var(--c-success)]",
    status === "error" &&
      "border-[color:var(--c-error)] bg-[color:var(--c-error-soft)] text-[color:var(--c-error)]",
    status === "pending" &&
      "border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] text-[color:var(--c-text-muted)]"
  );

  return (
    <div className={className}>
      {status === "active" && <Spinner />}
      {status === "done" && "✓"}
      {status === "error" && "✗"}
      {status === "pending" && "○"}
      <span>{label}</span>
    </div>
  );
}
