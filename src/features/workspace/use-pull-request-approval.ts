import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  approvePullRequest,
  fetchPullRequestApprovalByCurrentUser,
  getCachedPullRequestApprovalPermission,
  getGitHubAuthChangeVersion,
  refreshPullRequestApprovalPermission,
  subscribeGitHubAuthChange,
} from "@/infrastructure/github";

export function usePullRequestApproval(params: {
  canApprovePullRequest: boolean;
  repository: { owner: string; repo: string };
  sourceRef: { type: "pr"; prNumber: number } | null;
  t: (key: string) => string;
}) {
  const { canApprovePullRequest, repository, sourceRef, t } = params;
  const [isCheckingPullRequestApproval, setIsCheckingPullRequestApproval] =
    useState(false);
  const [isApprovingPullRequest, setIsApprovingPullRequest] = useState(false);
  const [isPullRequestApproved, setIsPullRequestApproved] = useState(false);
  const [approvePullRequestError, setApprovePullRequestError] = useState<
    string | null
  >(null);

  useEffect(() => {
    setIsCheckingPullRequestApproval(false);
    setIsApprovingPullRequest(false);
    setIsPullRequestApproved(false);
    setApprovePullRequestError(null);
  }, [repository.owner, repository.repo, sourceRef?.prNumber, sourceRef?.type]);

  useEffect(() => {
    let cancelled = false;
    if (
      !(sourceRef?.type === "pr" && sourceRef.prNumber && canApprovePullRequest)
    ) {
      setIsCheckingPullRequestApproval(false);
      setIsPullRequestApproved(false);
      return;
    }

    setIsCheckingPullRequestApproval(true);
    void fetchPullRequestApprovalByCurrentUser(sourceRef.prNumber, repository)
      .then((isApproved) => {
        if (!cancelled) {
          setIsPullRequestApproved(isApproved);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsPullRequestApproved(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingPullRequestApproval(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    canApprovePullRequest,
    repository.owner,
    repository.repo,
    sourceRef?.prNumber,
    sourceRef?.type,
  ]);

  const handleApprovePullRequest = useCallback(async () => {
    if (
      !(sourceRef?.type === "pr" && sourceRef.prNumber) ||
      isPullRequestApproved
    ) {
      return;
    }

    setIsApprovingPullRequest(true);
    setApprovePullRequestError(null);
    try {
      await approvePullRequest(sourceRef.prNumber, repository);
      setIsPullRequestApproved(true);
    } catch (error) {
      setIsPullRequestApproved(false);
      setApprovePullRequestError(
        error instanceof Error ? error.message : t("source.approvePrError")
      );
    } finally {
      setIsApprovingPullRequest(false);
    }
  }, [
    isPullRequestApproved,
    repository,
    sourceRef?.prNumber,
    sourceRef?.type,
    t,
  ]);

  const showApprovePullRequestButton = Boolean(
    sourceRef?.type === "pr" && sourceRef.prNumber && canApprovePullRequest
  );
  const approvePullRequestLabel = isApprovingPullRequest
    ? t("source.approvingPr")
    : isPullRequestApproved
      ? t("source.approvePrDone")
      : t("source.approvePr");

  return {
    approvePullRequestError,
    approvePullRequestLabel,
    handleApprovePullRequest,
    isCheckingPullRequestApproval,
    isApprovingPullRequest,
    isPullRequestApproved,
    showApprovePullRequestButton,
  };
}

export function usePullRequestApprovalPermission(params: {
  repository: { owner: string; repo: string };
  sourceRef: { type: "pr"; prNumber: number } | null;
}) {
  const { repository, sourceRef } = params;
  const authChangeVersion = useSyncExternalStore(
    subscribeGitHubAuthChange,
    getGitHubAuthChangeVersion,
    getGitHubAuthChangeVersion
  );
  const [canApprovePullRequest, setCanApprovePullRequest] = useState(() =>
    getCachedPullRequestApprovalPermission(repository)
  );

  useEffect(() => {
    let cancelled = false;
    if (!(sourceRef?.type === "pr" && sourceRef.prNumber)) {
      setCanApprovePullRequest(false);
      return;
    }

    setCanApprovePullRequest(
      getCachedPullRequestApprovalPermission(repository)
    );
    void refreshPullRequestApprovalPermission(repository)
      .then((canApprove) => {
        if (!cancelled) {
          setCanApprovePullRequest(canApprove);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCanApprovePullRequest(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    authChangeVersion,
    repository.owner,
    repository.repo,
    sourceRef?.prNumber,
    sourceRef?.type,
  ]);

  return canApprovePullRequest;
}
