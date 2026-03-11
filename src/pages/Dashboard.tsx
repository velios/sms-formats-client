import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { PullRequestLabels } from "@/components/PullRequestLabels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import type { PullRequestLabel, RepoRef } from "@/domain/types";
import { useOpenPRs } from "@/hooks/useGitHub";
import {
  getPullRequestGitHubUrl,
  getPullRequestWorkspacePath,
} from "@/lib/pull-request-navigation";
import { cn } from "@/lib/utils";
import { useDraftStore, useSourceStore } from "@/store";

interface OpenPullRequestItem {
  number: number;
  title: string;
  headRef: string;
  headSha: string;
  approvedCount: number;
  failedValidationCount: number;
  validationErrors: string[];
  validationUrl: string | null;
  lastCommitAuthorLogin: string | null;
  labels: PullRequestLabel[];
}

const dashboardPanelClassName =
  "flex min-h-0 flex-col overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)]";

const dashboardPanelHeaderClassName =
  "flex items-center justify-between border-b border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-4 py-3 text-[13px] font-semibold tracking-[0.5px] text-[color:var(--c-text-muted)] uppercase";

const dashboardRowClassName = (isActive: boolean) =>
  cn(
    "flex cursor-pointer items-center gap-3 border-[color:var(--c-border)] border-b px-4 py-3 text-[13px] last:border-b-0",
    isActive
      ? "bg-[color:var(--c-bg-hover)] text-[color:var(--c-accent)]"
      : "hover:bg-[color:var(--c-bg-hover)]"
  );

const dashboardIconLinkClassName =
  "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px] leading-none text-[color:var(--c-text-dim)] no-underline hover:text-[color:var(--c-accent)] hover:no-underline";

function sortPRs(prs: OpenPullRequestItem[] | undefined) {
  return [...(prs ?? [])].sort((a, b) => {
    if (a.failedValidationCount !== b.failedValidationCount) {
      return a.failedValidationCount - b.failedValidationCount;
    }
    if (a.approvedCount !== b.approvedCount) {
      return b.approvedCount - a.approvedCount;
    }
    return b.number - a.number;
  });
}

function getDraftPullRequestNumber(
  sourceRef: string,
  repository: RepoRef
): number | null {
  const prefix = `${repository.owner}/${repository.repo}:pr:`;
  if (!sourceRef.startsWith(prefix)) {
    return null;
  }

  const prNumber = Number.parseInt(sourceRef.slice(prefix.length), 10);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return null;
  }

  return prNumber;
}

export function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const draftStore = useDraftStore();
  const repository = useSourceStore((state) => state.repository);
  const sourceRef = useSourceStore((state) => state.sourceRef);
  const [query, setQuery] = useState("");
  const {
    data: openPRs = [],
    isLoading,
    error,
    refetch,
  } = useOpenPRs() as {
    data?: OpenPullRequestItem[];
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
  };
  const sortedPRs = useMemo(() => sortPRs(openPRs), [openPRs]);
  const persistedDraftPullRequests = useMemo(() => {
    if (!draftStore.hasHydrated) {
      return new Set<number>();
    }

    const next = new Set<number>();
    for (const [draftScopeKey, scopeDrafts] of Object.entries(
      draftStore.storedDraftsByScope
    )) {
      const prNumber = getDraftPullRequestNumber(draftScopeKey, repository);
      if (prNumber === null) {
        continue;
      }
      const hasChanges = Object.values(scopeDrafts).some(
        (draft) => draft.content !== draft.remoteContent || draft.isDeleted
      );
      if (hasChanges) {
        next.add(prNumber);
      }
    }

    return next;
  }, [
    draftStore.hasHydrated,
    draftStore.storedDraftsByScope,
    repository.owner,
    repository.repo,
  ]);
  const localChangedFiles = useMemo(
    () => draftStore.getChangedFiles().map((item) => item.filePath),
    [draftStore, draftStore.drafts]
  );
  const activePullRequestHasLocalDrafts =
    sourceRef?.type === "pr" && localChangedFiles.length > 0;
  const pullRequestsWithLocalDrafts = useMemo(() => {
    const next = new Set(persistedDraftPullRequests);
    if (sourceRef?.type !== "pr" || typeof sourceRef.prNumber !== "number") {
      return next;
    }

    if (activePullRequestHasLocalDrafts) {
      next.add(sourceRef.prNumber);
    } else {
      next.delete(sourceRef.prNumber);
    }

    return next;
  }, [
    activePullRequestHasLocalDrafts,
    persistedDraftPullRequests,
    sourceRef?.prNumber,
    sourceRef?.type,
  ]);
  const normalizedQuery = query.trim().toLowerCase();
  const visiblePRs = useMemo(() => {
    if (!normalizedQuery) {
      return sortedPRs;
    }
    return sortedPRs.filter(
      (pullRequest) =>
        pullRequest.title.toLowerCase().includes(normalizedQuery) ||
        `#${pullRequest.number}`.includes(normalizedQuery) ||
        pullRequest.headRef.toLowerCase().includes(normalizedQuery)
    );
  }, [normalizedQuery, sortedPRs]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex justify-end">
        <div className="w-full max-w-md">
          <Input
            aria-label={t("source.search", {
              defaultValue: "Search pull requests",
            })}
            className="bg-[color:var(--c-bg-input)]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("source.search", {
              defaultValue: "Search by title, branch, or PR number",
            })}
            value={query}
          />
        </div>
      </div>

      <div className={dashboardPanelClassName}>
        <div className={dashboardPanelHeaderClassName}>
          <span>
            {t("source.pullRequest", { defaultValue: "Pull Requests" })} ·{" "}
            {sortedPRs.length}
          </span>
        </div>

        <div className="min-h-0 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 p-4 text-[color:var(--c-text-muted)] text-sm">
              <Spinner />
              <span>{t("app.loading")}</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-between gap-3 p-4">
              <StatusBadge variant="error">
                {error.message || t("app.error")}
              </StatusBadge>
              <Button onClick={() => refetch()} size="sm" type="button">
                {t("app.retry", { defaultValue: "Retry" })}
              </Button>
            </div>
          ) : visiblePRs.length === 0 ? (
            <div className="p-4 text-[color:var(--c-text-muted)] text-sm">
              {normalizedQuery
                ? t("bank.noResults")
                : t("source.empty", {
                    defaultValue: "No open pull requests in this repository.",
                  })}
            </div>
          ) : (
            visiblePRs.map((pullRequest) => {
              const isActive =
                sourceRef?.type === "pr" &&
                sourceRef.prNumber === pullRequest.number;
              const hasLocalDrafts = pullRequestsWithLocalDrafts.has(
                pullRequest.number
              );
              const localDraftsTitle = t("source.unsavedDraftsInPr", {
                defaultValue: "You have unsaved local changes in this PR",
              });
              const prUrl = getPullRequestGitHubUrl(
                pullRequest.number,
                repository
              );
              return (
                <div
                  className={dashboardRowClassName(isActive)}
                  key={pullRequest.number}
                  onClick={() =>
                    navigate(
                      getPullRequestWorkspacePath({
                        repository,
                        prNumber: pullRequest.number,
                      })
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(
                        getPullRequestWorkspacePath({
                          repository,
                          prNumber: pullRequest.number,
                        })
                      );
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="text-[color:var(--c-text-muted)] text-xs">
                    #{pullRequest.number}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="inline-flex max-w-full min-w-0 items-center gap-1">
                      <span className="min-w-0 truncate text-sm">
                        {pullRequest.title}
                      </span>
                      {hasLocalDrafts && (
                        <StatusBadge
                          className="h-4 min-w-4 shrink-0 px-1 text-[10px] leading-none"
                          title={localDraftsTitle}
                          variant="modified"
                        >
                          ●
                        </StatusBadge>
                      )}
                      <a
                        aria-label={`PR #${pullRequest.number}`}
                        className={dashboardIconLinkClassName}
                        href={prUrl}
                        onClick={(event) => event.stopPropagation()}
                        rel="noreferrer"
                        target="_blank"
                        title={prUrl}
                      >
                        ↗
                      </a>
                    </div>
                    <span className="truncate text-[color:var(--c-text-dim)] text-xs">
                      {pullRequest.headRef}
                    </span>
                  </div>
                  <PullRequestLabels
                    className="ml-2 flex-[0_1_220px] justify-end"
                    labels={pullRequest.labels}
                    neutralLabels={
                      pullRequest.lastCommitAuthorLogin
                        ? [pullRequest.lastCommitAuthorLogin]
                        : []
                    }
                  />
                  <StatusBadge variant="info">
                    ✓ {pullRequest.approvedCount}
                  </StatusBadge>
                  {pullRequest.failedValidationCount > 0 && (
                    <StatusBadge variant="error">
                      ✗ {pullRequest.failedValidationCount}
                    </StatusBadge>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
