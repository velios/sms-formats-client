import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { config } from "@/config";
import {
  createAuthenticatedOctokit,
  createCommit,
  createOrUpdateBranch,
  createPullRequest,
  ensureFork,
  fetchBranchSha,
  validateToken,
} from "@/domain/github";
import type { BankInfo, RepoRef } from "@/domain/types";
import { validateBankLevel } from "@/domain/validation";
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
}

interface PublishStoreLike {
  setStep: (step: PublishStep) => void;
  setToken: (token: string | null) => void;
  setForkOwner: (owner: string | null) => void;
  setValidationIssues: (issues: ReturnType<typeof validateBankLevel>) => void;
  setError: (error: string | null) => void;
  setPrUrl: (url: string | null) => void;
  reset: () => void;
  validationIssues: ReturnType<typeof validateBankLevel>;
}

interface DraftStoreLike {
  getDraft: (filePath: string) => { content: string } | undefined;
}

function buildFormatContents(changedFiles: ChangedFile[]): Map<string, string> {
  const formatContents = new Map<string, string>();
  for (const file of changedFiles) {
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
      content: file.content,
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

export function PublishPanel({ bankPath, bankName, onClose }: Props) {
  const { t } = useTranslation();
  const dialogTitleId = useId();
  const tokenInputId = useId();
  const prTitleInputId = useId();
  const draftStore = useDraftStore();
  const publishStore = usePublishStore();
  const _sourceRef = useSourceStore((s) => s.sourceRef);
  const banks = useSourceStore((s) => s.banks);
  const repository = useSourceStore((s) => s.repository);

  const [token, setToken] = useState(publishStore.token ?? "");
  const [storeInSession, setStoreInSession] = useState(false);
  const [prTitle, setPrTitle] = useState(
    t("publish.prTitleDefault", { bank: bankName })
  );
  const [showTokenInput, _setShowTokenInput] = useState(true);

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

  const handlePublish = useCallback(async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      return;
    }

    publishStore.reset();

    try {
      publishStore.setStep("validating");
      const username = await validateToken(trimmedToken);
      publishStore.setToken(trimmedToken);
      publishStore.setForkOwner(username);

      if (storeInSession) {
        sessionStorage.setItem("sms-formats-token", trimmedToken);
      }

      const bank = banks.find((b) => b.folderPath === bankPath);
      const validationError = runPublishValidation({
        bank,
        bankPath,
        changedFiles,
        draftStore,
        publishStore,
        t,
      });
      if (validationError) {
        publishStore.setError(validationError);
        return;
      }

      if (isMultiBank) {
        publishStore.setError(t("validation.multiBankPublish"));
        return;
      }

      if (changedFiles.length === 0) {
        publishStore.setError("No changes to publish");
        return;
      }

      const prUrl = await publishBankChanges({
        publishStore,
        token: trimmedToken,
        bankName,
        prTitle,
        changedFiles,
        repository,
      });
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
    publishStore,
    repository,
    t,
  ]);

  const step = publishStore.step;
  const isPublishing = step !== "idle" && step !== "done" && step !== "error";

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
          {t("publish.title")}
        </div>

        {/* Preflight info */}
        <div className="mb-md flex-col gap-md">
          <div className="text-sm">
            <span className="text-muted">
              {t("publish.scopeCheck", { bank: bankName })}
            </span>
          </div>
          <div className="text-muted text-sm">
            {changedFiles.length} file(s) changed
          </div>

          {isMultiBank && (
            <div className="issue-item issue-item--error">
              {t("validation.multiBankPublish")}
            </div>
          )}

          {changedFiles.length === 0 && (
            <div className="issue-item issue-item--warning">
              No changes to publish for this bank
            </div>
          )}
        </div>

        {/* Token input */}
        {showTokenInput && step === "idle" && (
          <div className="mb-md flex-col gap-md">
            <div className="flex-col gap-xs">
              <label className="text-muted text-sm" htmlFor={tokenInputId}>
                {t("publish.tokenLabel")}
              </label>
              <input
                className="input input--mono"
                id={tokenInputId}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_..."
                type="password"
                value={token}
              />
              <span className="text-dim text-sm">{t("publish.tokenHint")}</span>
            </div>

            <label className="flex items-center gap-sm text-sm">
              <input
                checked={storeInSession}
                onChange={(e) => setStoreInSession(e.target.checked)}
                type="checkbox"
              />
              {t("publish.storeInSession")}
            </label>

            <div className="flex-col gap-xs">
              <label className="text-muted text-sm" htmlFor={prTitleInputId}>
                {t("publish.prTitle")}
              </label>
              <input
                className="input"
                id={prTitleInputId}
                onChange={(e) => setPrTitle(e.target.value)}
                value={prTitle}
              />
            </div>
          </div>
        )}

        {/* Publish progress */}
        {step !== "idle" && (
          <div
            aria-live="polite"
            className="publish-progress mb-md"
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

        {/* Success */}
        {step === "done" && publishStore.prUrl && (
          <div
            aria-live="polite"
            className="mb-md flex-col gap-sm"
            role="status"
          >
            <div className="badge badge--success">{t("publish.success")}</div>
            <a
              href={publishStore.prUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("publish.prLink")}: {publishStore.prUrl}
            </a>
          </div>
        )}

        {/* Error */}
        {step === "error" && publishStore.error && (
          <div
            aria-live="assertive"
            className="issue-item issue-item--error mb-md"
            role="alert"
          >
            {publishStore.error}
          </div>
        )}

        {/* Validation issues from publish */}
        {publishStore.validationIssues.length > 0 && (
          <div
            className="issue-list mb-md"
            style={{ maxHeight: 200, overflowY: "auto" }}
          >
            {publishStore.validationIssues.map((issue, i) => (
              <div
                className={`issue-item ${issue.level === "error" ? "issue-item--error" : "issue-item--warning"}`}
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

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            {t("app.close")}
          </button>
          {step !== "done" && (
            <button
              className="btn btn--primary"
              disabled={
                isPublishing ||
                !token.trim() ||
                changedFiles.length === 0 ||
                isMultiBank
              }
              onClick={handlePublish}
            >
              {isPublishing ? <span className="spinner" /> : null}
              {t("publish.createPR")}
            </button>
          )}
        </div>
      </div>
    </div>
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
  const cls =
    status === "active"
      ? "publish-step publish-step--active"
      : status === "done"
        ? "publish-step publish-step--done"
        : status === "error"
          ? "publish-step publish-step--error"
          : "publish-step";

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
