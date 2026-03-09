import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { config } from "@/config";
import {
  createAuthenticatedOctokit,
  createCommit,
  createOrUpdateBranch,
  createPullRequest,
  ensureFork,
  fetchBranchSha,
  getCachedPullRequestApprovalPermission,
  updatePullRequestHead,
} from "@/domain/github";
import type { BankInfo, RepoRef } from "@/domain/types";
import { validateBankLevel } from "@/domain/validation";
import type { PublishStep } from "@/store";
import { cn } from "@/lib/utils";
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
  baseSha: string;
}

interface PublishStoreLike {
  setStep: (step: PublishStep) => void;
  setToken: (token: string | null) => void;
  setValidationIssues: (issues: ReturnType<typeof validateBankLevel>) => void;
  setError: (error: string | null) => void;
  setPrUrl: (url: string | null) => void;
  reset: () => void;
  validationIssues: ReturnType<typeof validateBankLevel>;
}

interface DraftStoreLike {
  getDraft: (filePath: string) => { content: string } | undefined;
}

type PublishMode = "create" | "update-pr";

function buildFormatContents(changedFiles: ChangedFile[]): Map<string, string> {
  const formatContents = new Map<string, string>();
  for (const file of changedFiles) {
    if (file.isDeleted) {
      continue;
    }
    if (
      !(file.filePath.endsWith(".txt") && file.filePath.includes("/formats/"))
    ) {
      continue;
    }
    formatContents.set(file.filePath, file.content);
  }
  return formatContents;
}

function runPublishValidation(params: {
  bank: BankInfo | undefined;
  bankPath: string;
  changedFiles: ChangedFile[];
  draftStore: DraftStoreLike;
  publishStore: PublishStoreLike;
  t: (key: string, options?: Record<string, unknown>) => string;
}): string | null {
  const { bank, bankPath, changedFiles, draftStore, publishStore, t } = params;
  if (!(bank || changedFiles.length > 0)) {
    return null;
  }
  if (!bank) {
    return null;
  }

  const sendersDraft = draftStore.getDraft(`${bankPath}/senders.txt`);
  const bankForValidation: BankInfo = {
    ...bank,
    hasSenders: bank.hasSenders || !!sendersDraft,
  };
  const issues = validateBankLevel(
    bankForValidation,
    buildFormatContents(changedFiles)
  );
  const blockingIssues = issues.filter((issue) => issue.level === "error");
  publishStore.setValidationIssues(issues);

  if (blockingIssues.length === 0) {
    return null;
  }
  return t("validation.errors", { count: blockingIssues.length });
}

function buildValidationSummary(
  issues: ReturnType<typeof validateBankLevel>
): string {
  if (issues.length === 0) {
    return "✅ All local validation checks passed";
  }
  return issues
    .map((issue) => `- [${issue.level}] ${issue.filePath}: ${issue.message}`)
    .join("\n");
}

function buildPullRequestBody(params: {
  bankName: string;
  changedFilesCount: number;
  validationIssues: ReturnType<typeof validateBankLevel>;
}): string {
  const { bankName, changedFilesCount, validationIssues } = params;
  const validationSummary = buildValidationSummary(validationIssues);
  return `## Changes\n\nBank: \`${bankName}\`\nFiles changed: ${changedFilesCount}\n\n## Validation\n\n${validationSummary}\n\n---\n*Created by Zenmoney SMS Formats*`;
}

function resolvePublishError(params: {
  bank: BankInfo | undefined;
  bankPath: string;
  changedFiles: ChangedFile[];
  draftStore: DraftStoreLike;
  isMultiBank: boolean;
  publishStore: PublishStoreLike;
  sourceSha: string | undefined;
  t: (key: string, options?: Record<string, unknown>) => string;
}): string | null {
  const {
    bank,
    bankPath,
    changedFiles,
    draftStore,
    isMultiBank,
    publishStore,
    sourceSha,
    t,
  } = params;
  const validationError = runPublishValidation({
    bank,
    bankPath,
    changedFiles,
    draftStore,
    publishStore,
    t,
  });
  if (validationError) {
    return validationError;
  }
  if (isMultiBank) {
    return t("validation.multiBankPublish");
  }
  if (changedFiles.length === 0) {
    return "No changes to publish";
  }
  if (sourceSha && changedFiles.some((file) => file.baseSha !== sourceSha)) {
    return t("publish.outdatedBase");
  }
  return null;
}

async function publishBankChanges(params: {
  publishStore: PublishStoreLike;
  token: string;
  bankName: string;
  prTitle: string;
  changedFiles: ChangedFile[];
  repository: RepoRef;
}): Promise<string> {
  const { publishStore, token, bankName, prTitle, changedFiles, repository } =
    params;
  const octokit = createAuthenticatedOctokit(token);

  publishStore.setStep("forking");
  const fork = await ensureFork(octokit, repository);

  publishStore.setStep("branching");
  const baseSha = await fetchBranchSha(config.defaultBranch, repository);
  const branchName = `sms-formats-editor/${bankName.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}`;
  await createOrUpdateBranch(
    octokit,
    fork.owner,
    branchName,
    baseSha,
    repository
  );

  publishStore.setStep("committing");
  await createCommit(
    octokit,
    fork.owner,
    branchName,
    baseSha,
    changedFiles.map((file) => ({
      path: file.filePath,
      content: file.isDeleted ? undefined : file.content,
      delete: file.isDeleted,
    })),
    prTitle,
    repository
  );

  publishStore.setStep("opening-pr");
  const body = buildPullRequestBody({
    bankName,
    changedFilesCount: changedFiles.length,
    validationIssues: publishStore.validationIssues,
  });
  const pr = await createPullRequest(
    octokit,
    fork.owner,
    branchName,
    prTitle,
    body,
    repository
  );
  return pr.url;
}

async function updateExistingPullRequestChanges(params: {
  publishStore: PublishStoreLike;
  token: string;
  changedFiles: ChangedFile[];
  repository: RepoRef;
  prNumber: number;
}): Promise<string> {
  const { publishStore, token, changedFiles, repository, prNumber } = params;

  publishStore.setStep("committing");
  const result = await updatePullRequestHead(
    token,
    prNumber,
    changedFiles.map((file) => ({
      path: file.filePath,
      content: file.isDeleted ? undefined : file.content,
      delete: file.isDeleted,
    })),
    repository
  );

  publishStore.setStep("opening-pr");
  return result.url;
}

export function PublishPanel({ bankPath, bankName, onClose }: Props) {
  const { t } = useTranslation();
  const dialogTitleId = useId();
  const tokenInputId = useId();
  const prTitleInputId = useId();
  const draftStore = useDraftStore();
  const publishStore = usePublishStore();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const banks = useSourceStore((s) => s.banks);
  const repository = useSourceStore((s) => s.repository);

  const [token, setToken] = useState(publishStore.token ?? "");
  const [storeInSession, setStoreInSession] = useState(false);
  const [prTitle, setPrTitle] = useState(
    t("publish.prTitleDefault", { bank: bankName })
  );

  // Get changed files for this bank
  const changedFiles = draftStore
    .getChangedFiles()
    .filter((f) => f.filePath.startsWith(bankPath));

  // Check multi-bank scope
  const allChanged = draftStore.getChangedFiles();
  const changedBanks = new Set<string>();
  for (const f of allChanged) {
    const parts = f.filePath.split("/");
    if (parts[0] === "src" && parts[1]) {
      changedBanks.add(`src/${parts[1]}`);
    }
  }

  const isMultiBank = changedBanks.size > 1;
  const canUpdateCurrentPullRequest = Boolean(
    sourceRef?.type === "pr" &&
      sourceRef.prNumber &&
      getCachedPullRequestApprovalPermission(repository)
  );
  const publishMode: PublishMode = canUpdateCurrentPullRequest
    ? "update-pr"
    : "create";
  const publishActionLabel =
    publishMode === "update-pr" ? t("publish.updatePR") : t("publish.createPR");
  const publishSuccessLabel =
    publishMode === "update-pr"
      ? t("publish.successUpdate")
      : t("publish.success");

  const handlePublish = useCallback(async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      return;
    }

    publishStore.reset();

    try {
      publishStore.setStep("validating");
      publishStore.setToken(trimmedToken);

      const bank = banks.find((b) => b.folderPath === bankPath);
      const publishError = resolvePublishError({
        bank,
        bankPath,
        changedFiles,
        draftStore,
        isMultiBank,
        publishStore,
        sourceSha: sourceRef?.sha,
        t,
      });
      if (publishError) {
        publishStore.setError(publishError);
        return;
      }

      const prUrl =
        publishMode === "update-pr" &&
        sourceRef?.type === "pr" &&
        sourceRef.prNumber
          ? await updateExistingPullRequestChanges({
              publishStore,
              token: trimmedToken,
              changedFiles,
              repository,
              prNumber: sourceRef.prNumber,
            })
          : await publishBankChanges({
              publishStore,
              token: trimmedToken,
              bankName,
              prTitle,
              changedFiles,
              repository,
            });

      if (storeInSession) {
        sessionStorage.setItem("sms-formats-token", trimmedToken);
      }

      publishStore.setPrUrl(prUrl);
      publishStore.setStep("done");
    } catch (e) {
      publishStore.setError(e instanceof Error ? e.message : String(e));
    }
  }, [
    token,
    storeInSession,
    prTitle,
    bankPath,
    bankName,
    changedFiles,
    banks,
    isMultiBank,
    draftStore,
    publishMode,
    publishStore,
    repository,
    sourceRef?.prNumber,
    sourceRef?.type,
    t,
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
      <div className="mb-4 flex flex-col gap-4">
        <div className="text-sm">
          <span className="text-[color:var(--c-text-muted)]">
            {t("publish.scopeCheck", { bank: bankName })}
          </span>
        </div>
        <div className="text-sm text-[color:var(--c-text-muted)]">
          {changedFiles.length} file(s) changed
        </div>

        {isMultiBank && (
          <div className="rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-2 text-xs text-[color:var(--c-error)]">
            {t("validation.multiBankPublish")}
          </div>
        )}

        {changedFiles.length === 0 && (
          <div className="rounded-[var(--radius-sm)] bg-[color:var(--c-warning-soft)] px-3 py-2 text-xs text-[color:var(--c-warning)]">
            No changes to publish for this bank
          </div>
        )}
      </div>

      {step === "idle" && (
        <div className="mb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label
              className="text-xs text-[color:var(--c-text-muted)]"
              htmlFor={tokenInputId}
            >
              {t("publish.tokenLabel")}
            </label>
            <Input
              className="font-mono"
              id={tokenInputId}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..."
              type="password"
              value={token}
            />
            <span className="text-xs text-[color:var(--c-text-dim)]">
              {t("publish.tokenHint")}
            </span>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              checked={storeInSession}
              onChange={(e) => setStoreInSession(e.target.checked)}
              type="checkbox"
            />
            {t("publish.storeInSession")}
          </label>

          <div className="flex flex-col gap-1">
            <label
              className="text-xs text-[color:var(--c-text-muted)]"
              htmlFor={prTitleInputId}
            >
              {t("publish.prTitle")}
            </label>
            <Input
              id={prTitleInputId}
              onChange={(e) => setPrTitle(e.target.value)}
              value={prTitle}
            />
          </div>
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
            label={t("publish.forking")}
            status={stepStatus("forking", step)}
          />
          <PublishStepItem
            label={t("publish.branching")}
            status={stepStatus("branching", step)}
          />
          <PublishStepItem
            label={t("publish.committing")}
            status={stepStatus("committing", step)}
          />
          <PublishStepItem
            label={t("publish.openingPR")}
            status={stepStatus("opening-pr", step)}
          />
        </div>
      )}

      {step === "done" && publishStore.prUrl && (
        <div
          aria-live="polite"
          className="mb-4 flex flex-col gap-2"
          role="status"
        >
          <StatusBadge variant="success">{publishSuccessLabel}</StatusBadge>
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
          className="mb-4 rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-2 text-xs text-[color:var(--c-error)]"
          role="alert"
        >
          {publishStore.error}
        </div>
      )}

      {publishStore.validationIssues.length > 0 && (
        <div
          className="mb-4 flex max-h-[200px] flex-col gap-1 overflow-y-auto"
          style={{ maxHeight: 200, overflowY: "auto" }}
        >
          {publishStore.validationIssues.map((issue, i) => (
            <div
              className={
                issue.level === "error"
                  ? "flex gap-2 rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-1.5 text-xs text-[color:var(--c-error)]"
                  : "flex gap-2 rounded-[var(--radius-sm)] bg-[color:var(--c-warning-soft)] px-3 py-1.5 text-xs text-[color:var(--c-warning)]"
              }
              key={i}
            >
              <span className="text-mono text-sm">
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
            disabled={
              isPublishing ||
              !token.trim() ||
              changedFiles.length === 0 ||
              isMultiBank
            }
            onClick={handlePublish}
            type="button"
            variant="primary"
          >
            {isPublishing ? <Spinner /> : null}
            {publishActionLabel}
          </Button>
        )}
      </div>
    </ModalDialog>
  );
}

const STEP_ORDER = [
  "validating",
  "forking",
  "branching",
  "committing",
  "opening-pr",
  "done",
] as const;

function stepStatus(
  target: string,
  current: string
): "pending" | "active" | "done" | "error" {
  if (current === "error") {
    const ci = STEP_ORDER.indexOf(current as any);
    const ti = STEP_ORDER.indexOf(target as any);
    return ti < ci ? "done" : ti === ci ? "error" : "pending";
  }
  const ci = STEP_ORDER.indexOf(current as any);
  const ti = STEP_ORDER.indexOf(target as any);
  if (ci === -1) {
    return "pending";
  }
  if (ti < ci) {
    return "done";
  }
  if (ti === ci) {
    return "active";
  }
  return "pending";
}

function PublishStepItem({ label, status }: { label: string; status: string }) {
  const cls = cn(
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
    <div className={cls}>
      {status === "active" && <span className="spinner" />}
      {status === "done" && "✓"}
      {status === "error" && "✗"}
      {status === "pending" && "○"}
      <span>{label}</span>
    </div>
  );
}
