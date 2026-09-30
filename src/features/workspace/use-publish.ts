import { useCallback, useEffect, useState } from "react";
import type { BankInfo, RepoRef } from "@/domain/types";
import { resolvePublishPreflightState } from "@/features/publish-panel/preflight";
import type { CommitMessageInput } from "@/features/publish-panel/UpdatePullRequestDialog";
import { validateBankSnapshot } from "@/features/workspace/bank-snapshot";
import type { ActiveRouteSession } from "@/features/workspace/use-workspace-session";
import {
  getGitHubUserToken,
  resolvePullRequestWorkspace,
  updatePullRequestHead,
} from "@/infrastructure/github";
import { useDraftStore, useSourceStore } from "@/store";

async function countBlockingPublishValidationIssues(params: {
  bank: BankInfo | undefined;
  bankPath: string;
  repository: RepoRef;
  headSha: string;
  draftStore: ReturnType<typeof useDraftStore.getState>;
}): Promise<number> {
  const { bank, bankPath, draftStore, repository, headSha } = params;
  if (!bank) {
    throw new Error("Bank not found");
  }
  const issues = await validateBankSnapshot({
    bank,
    bankPath,
    draftStore,
    repository,
    sourceRefName: headSha,
  });
  return issues.filter((issue) => issue.level === "error").length;
}

function buildCommitMessage(
  commit: CommitMessageInput | null
): string | undefined {
  if (!commit) {
    return undefined;
  }
  const title = commit.title.trim();
  if (!title) {
    return undefined;
  }
  const description = commit.description.trim();
  return description ? `${title}\n\n${description}` : title;
}

function isDraftSnapshotCurrent(
  files: ReturnType<
    ReturnType<typeof useDraftStore.getState>["getChangedFiles"]
  >,
  scopeKey: string | null
): boolean {
  // Draft identity detects edits during validation.
  const current = useDraftStore.getState();
  return (
    current.draftScopeKey === scopeKey &&
    current.getChangedFiles().length === files.length &&
    files.every((file) => current.getDraft(file.filePath) === file)
  );
}

export function useBankPublishAction(params: {
  bank: BankInfo | undefined;
  bankPath: string;
  writable: boolean;
  draftStore: ReturnType<typeof useDraftStore.getState>;
  onWorkspaceReadOnly: (session: ActiveRouteSession) => void;
  onWorkspaceStale: (session: ActiveRouteSession) => void;
  onWorkspaceSynced: (
    session: ActiveRouteSession,
    preserveDrafts?: boolean
  ) => Promise<void>;
  repository: { owner: string; repo: string };
  sourceRef: { type: "pr"; prNumber: number; sha: string } | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const {
    bank,
    bankPath,
    writable,
    draftStore,
    onWorkspaceReadOnly,
    onWorkspaceStale,
    onWorkspaceSynced,
    repository,
    sourceRef,
    t,
  } = params;
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);

  useEffect(() => {
    setIsPublishing(false);
    setPublishError(null);
    setIsUpdateDialogOpen(false);
  }, [repository.owner, repository.repo, sourceRef?.prNumber, sourceRef?.type]);

  const runPreflight = useCallback(async (): Promise<
    | {
        ok: true;
        token: string;
        prNumber: number;
        headSha: string;
        files: ReturnType<typeof draftStore.getChangedFiles>;
        scopeKey: string | null;
      }
    | { ok: false }
  > => {
    if (!(writable && sourceRef)) {
      setPublishError(t("publish.readOnly"));
      return { ok: false };
    }
    const token = getGitHubUserToken()?.trim() ?? "";
    if (!token) {
      setPublishError(t("githubAuth.emptyToken"));
      return { ok: false };
    }
    const scopeKey = useDraftStore.getState().draftScopeKey;
    const files = draftStore.getChangedFiles();
    const resolution = await resolvePullRequestWorkspace(
      sourceRef.prNumber,
      repository,
      { forceFresh: true }
    );
    if (resolution.status !== "supported") {
      setPublishError(t("publish.updateError"));
      return { ok: false };
    }
    const publishPreflightState = resolvePublishPreflightState({
      resolverHeadSha: resolution.headSha,
      sessionHeadSha: sourceRef.sha,
      writable: resolution.writable,
      localChangesCount: files.filter((file) =>
        file.filePath.startsWith(`${bankPath}/`)
      ).length,
      hasInvalidScopeChanges: files.some(
        (file) => !file.filePath.startsWith(`${bankPath}/`)
      ),
      validationErrorsCount: 0,
    });
    if (publishPreflightState === "stale") {
      onWorkspaceStale(resolution);
      setPublishError(t("publish.outdatedBase"));
      return { ok: false };
    }
    if (publishPreflightState === "read-only") {
      onWorkspaceReadOnly(resolution);
      setPublishError(
        t("publish.readOnly", {
          defaultValue: "This pull request is read-only.",
        })
      );
      return { ok: false };
    }
    if (publishPreflightState === "no-changes") {
      setPublishError(t("publish.noChanges"));
      return { ok: false };
    }
    if (publishPreflightState === "invalid-scope") {
      setPublishError(t("validation.multiBankPublish"));
      return { ok: false };
    }
    const validationErrorsCount = await countBlockingPublishValidationIssues({
      bank,
      bankPath,
      repository,
      headSha: sourceRef.sha,
      draftStore,
    });
    if (validationErrorsCount > 0) {
      setPublishError(t("validation.errors", { count: validationErrorsCount }));
      return { ok: false };
    }
    if (!isDraftSnapshotCurrent(files, scopeKey)) {
      setPublishError(t("publish.editedDuringValidation"));
      return { ok: false };
    }
    return {
      ok: true,
      token,
      prNumber: sourceRef.prNumber,
      headSha: sourceRef.sha,
      files,
      scopeKey,
    };
  }, [
    bank,
    bankPath,
    draftStore,
    onWorkspaceReadOnly,
    onWorkspaceStale,
    repository,
    sourceRef?.prNumber,
    sourceRef?.type,
    sourceRef?.sha,
    t,
    writable,
  ]);

  const pushAndSync = useCallback(
    async (
      token: string,
      prNumber: number,
      expectedHeadSha: string,
      files: ReturnType<typeof draftStore.getChangedFiles>,
      scopeKey: string | null,
      commitMessage?: string
    ): Promise<boolean> => {
      const { headSha: newHeadSha } = await updatePullRequestHead(
        token,
        prNumber,
        expectedHeadSha,
        files.map((file) => ({
          path: file.filePath,
          content: file.isDeleted ? undefined : file.content,
          delete: file.isDeleted,
        })),
        repository,
        commitMessage
      );
      useDraftStore
        .getState()
        .acknowledgePublished(files, newHeadSha, scopeKey);
      const active = useSourceStore.getState();
      if (
        active.repository.owner !== repository.owner ||
        active.repository.repo !== repository.repo ||
        active.sourceRef?.prNumber !== prNumber
      ) {
        return true;
      }
      try {
        const syncedResolution = await resolvePullRequestWorkspace(
          prNumber,
          repository,
          { forceFresh: true, headShaOverride: newHeadSha }
        );
        if (syncedResolution.status !== "supported") {
          setPublishError(t("publish.updatedRefreshFailed"));
          return false;
        }
        await onWorkspaceSynced(syncedResolution, true);
        return true;
      } catch {
        setPublishError(t("publish.updatedRefreshFailed"));
        return false;
      }
    },
    [onWorkspaceSynced, repository, t]
  );

  const beginUpdate = useCallback(async () => {
    setPublishError(null);
    setIsPublishing(true);
    try {
      const pre = await runPreflight();
      if (pre.ok) {
        setIsUpdateDialogOpen(true);
      }
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : t("publish.updateError")
      );
    } finally {
      setIsPublishing(false);
    }
  }, [runPreflight, t]);

  const submitUpdate = useCallback(
    async (commit: CommitMessageInput | null): Promise<void> => {
      setIsPublishing(true);
      setPublishError(null);
      try {
        const pre = await runPreflight();
        if (!pre.ok) {
          setIsUpdateDialogOpen(false);
          return;
        }
        await pushAndSync(
          pre.token,
          pre.prNumber,
          pre.headSha,
          pre.files,
          pre.scopeKey,
          buildCommitMessage(commit)
        );
        setIsUpdateDialogOpen(false);
      } catch (error) {
        setPublishError(
          error instanceof Error ? error.message : t("publish.updateError")
        );
        setIsUpdateDialogOpen(false);
      } finally {
        setIsPublishing(false);
      }
    },
    [pushAndSync, runPreflight, t]
  );

  const closeUpdateDialog = useCallback(() => {
    setIsUpdateDialogOpen(false);
  }, []);

  const canUpdateCurrentPullRequest = Boolean(sourceRef && writable);
  const publishActionLabel = isPublishing
    ? t("publish.publishing")
    : t("publish.updatePR");
  const onPublish = useCallback(() => {
    void beginUpdate();
  }, [beginUpdate]);

  return {
    canUpdateCurrentPullRequest,
    isPublishing,
    onPublish,
    publishActionLabel,
    publishError,
    isUpdateDialogOpen,
    submitUpdate,
    closeUpdateDialog,
  };
}
