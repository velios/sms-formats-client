import { useEffect, useState } from "react";
import type { BankInfo, RepoRef } from "@/domain/types";
import { resolvePublishPreflightState } from "@/features/publish-panel/preflight";
import type { CommitMessageInput } from "@/features/publish-panel/UpdatePullRequestDialog";
import { validateBankSnapshot } from "@/features/workspace/bank-snapshot";
import {
  getGitHubUserToken,
  resolvePullRequestWorkspace,
  updatePullRequestHead,
} from "@/infrastructure/github";
import { useDraftStore } from "@/store";
import { waitForDraftPersistence } from "@/store/persistence";
import type {
  PublicationTicket,
  WorkspaceSessionController,
} from "./workspace-session";

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

function publishErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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
  controller: WorkspaceSessionController;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { bank, controller, t } = params;
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);
  const isOpening = controller.getSnapshot().operation === "opening";
  const isPublishing =
    controller.getSnapshot().operation === "publishing" ||
    controller.getSnapshot().operation === "syncing";

  useEffect(() => {
    setPublishError(null);
    setIsUpdateDialogOpen(false);
  }, [controller, isOpening]);

  const runPreflight = async (ticket: PublicationTicket) => {
    const { session, scopeKey } = ticket;
    const { repository, prNumber, headSha, bankPath } = session;
    const token = getGitHubUserToken()?.trim() ?? "";
    if (!token) {
      throw new Error(t("githubAuth.emptyToken"));
    }
    const draftStore = useDraftStore.getState();
    const files = draftStore.getChangedFiles();
    const resolution = await resolvePullRequestWorkspace(prNumber, repository, {
      forceFresh: true,
    });
    if (!controller.isPublicationCurrent(ticket)) {
      return null;
    }
    controller.observeResolution(ticket, resolution);
    if (resolution.status !== "supported") {
      throw new Error(t("publish.updateError"));
    }
    const preflight = resolvePublishPreflightState({
      resolverHeadSha: resolution.headSha,
      sessionHeadSha: headSha,
      writable: resolution.writable,
      localChangesCount: files.filter((file) =>
        file.filePath.startsWith(`${bankPath}/`)
      ).length,
      hasInvalidScopeChanges: files.some(
        (file) => !file.filePath.startsWith(`${bankPath}/`)
      ),
      validationErrorsCount: 0,
    });
    const errors = {
      stale: "publish.outdatedBase",
      "read-only": "publish.readOnly",
      "no-changes": "publish.noChanges",
      "invalid-scope": "validation.multiBankPublish",
      "validation-failed": "validation.errors",
    };
    if (preflight !== "can-publish") {
      throw new Error(t(errors[preflight]));
    }
    const count = await countBlockingPublishValidationIssues({
      bank,
      bankPath,
      repository,
      headSha,
      draftStore,
    });
    if (!controller.isPublicationCurrent(ticket)) {
      return null;
    }
    if (count > 0) {
      throw new Error(t("validation.errors", { count }));
    }
    if (!isDraftSnapshotCurrent(files, scopeKey)) {
      throw new Error(t("publish.editedDuringValidation"));
    }
    return { token, files };
  };

  const beginUpdate = async () => {
    const ticket = controller.beginPublication();
    if (!ticket) {
      return;
    }
    setPublishError(null);
    try {
      if (await runPreflight(ticket)) {
        setIsUpdateDialogOpen(true);
      }
    } catch (error) {
      if (controller.isTicketCurrent(ticket)) {
        setPublishError(publishErrorMessage(error, t("publish.updateError")));
      }
    } finally {
      controller.finishPublication(ticket);
    }
  };

  const submitUpdate = async (
    commit: CommitMessageInput | null
  ): Promise<void> => {
    const ticket = controller.beginPublication();
    if (!ticket) {
      return;
    }
    setPublishError(null);
    let committed = false;
    try {
      const pre = await runPreflight(ticket);
      if (!pre) {
        return;
      }
      const { session, scopeKey } = ticket;
      const { headSha } = await updatePullRequestHead(
        pre.token,
        session.prNumber,
        session.headSha,
        pre.files.map((file) => ({
          path: file.filePath,
          content: file.isDeleted ? undefined : file.content,
          delete: file.isDeleted,
        })),
        session.repository,
        buildCommitMessage(commit)
      );
      committed = true;
      controller.recordPublication(ticket, headSha);
      useDraftStore
        .getState()
        .acknowledgePublished(pre.files, headSha, scopeKey);
      await waitForDraftPersistence();
      await controller.syncPublication(ticket);
    } catch (error) {
      if (controller.isTicketCurrent(ticket)) {
        setPublishError(
          committed
            ? null
            : publishErrorMessage(error, t("publish.updateError"))
        );
      }
    } finally {
      if (controller.isTicketCurrent(ticket)) {
        setIsUpdateDialogOpen(false);
      }
      controller.finishPublication(ticket);
    }
  };

  return {
    isPublishing,
    publishError,
    isUpdateDialogOpen,
    submitUpdate,
    closeUpdateDialog: () => setIsUpdateDialogOpen(false),
    onPublish: () => {
      void beginUpdate();
    },
    publishActionLabel: isPublishing
      ? t("publish.publishing")
      : t("publish.updatePR"),
  };
}
