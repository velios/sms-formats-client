import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { PullRequestLabels } from "@/components/PullRequestLabels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { buildPullRequestWorkspacePath } from "@/domain/bank-route";
import type { PullRequestLabel, RepoRef } from "@/domain/types";
import { useOpenPRs } from "@/hooks/useGitHub";
import { getPullRequestGitHubUrl } from "@/lib/pull-request-navigation";
import { cn } from "@/lib/utils";
import { useDraftStore, useSourceStore } from "@/store";

interface OpenPullRequestItem {
  number: number;
  title: string;
  headRef: string;
  headSha: string;
  approvedCount: number | null;
  failedValidationCount: number | null;
  validationErrors: string[];
  validationUrl: string | null;
  lastCommitAuthorLogin: string | null;
  labels: PullRequestLabel[];
}

const dashboardPanelClassName =
  "ui-panel flex h-full min-h-0 w-full max-w-[1280px] flex-col";

const dashboardPanelHeaderClassName =
  "ui-panel-inset flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border bg-muted";

const dashboardRowClassName = (isActive: boolean) =>
  cn(
    "ui-panel-inset grid cursor-pointer grid-cols-[52px_minmax(0,1fr)_280px_116px] items-center gap-x-4 border-border border-b py-2.5 text-sm",
    isActive ? "bg-accent text-primary" : "hover:bg-accent"
  );

const dashboardIconLinkClassName =
  "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-xs leading-none text-muted-foreground no-underline hover:bg-primary-soft hover:text-primary hover:no-underline";

function sortPRs(prs: OpenPullRequestItem[] | undefined) {
  return [...(prs ?? [])].sort((a, b) => {
    if (a.failedValidationCount !== b.failedValidationCount) {
      return (
        (a.failedValidationCount ?? Number.POSITIVE_INFINITY) -
        (b.failedValidationCount ?? Number.POSITIVE_INFINITY)
      );
    }
    if (a.approvedCount !== b.approvedCount) {
      return (b.approvedCount ?? -1) - (a.approvedCount ?? -1);
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
        (draft) => draft.content !== draft.headContent || draft.isDeleted
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
    <div className="flex h-full min-h-0 justify-center">
      <div className={dashboardPanelClassName}>
        <div className={dashboardPanelHeaderClassName}>
          <span className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.5px]">
            {t("source.pullRequest", { defaultValue: "Pull Requests" })}
          </span>
          <span className="inline-flex h-[18px] items-center rounded-full bg-border px-[7px] font-semibold text-muted-foreground text-xs tabular-nums">
            {sortedPRs.length}
          </span>
          <div className="flex-1" />
          <Input
            aria-label={t("source.search", {
              defaultValue: "Search pull requests",
            })}
            className="w-[340px] bg-card px-3 text-sm"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("source.search", {
              defaultValue: "Search by title, branch, or PR number",
            })}
            value={query}
          />
        </div>

        <div className="min-h-0 overflow-y-auto">
          {isLoading ? (
            <div className="ui-panel-body flex items-center gap-2 text-muted-foreground text-sm">
              <Spinner />
              <span>{t("app.loading")}</span>
            </div>
          ) : error ? (
            <div className="ui-panel-body flex items-center justify-between gap-3">
              <StatusBadge variant="error">
                {error.message || t("app.error")}
              </StatusBadge>
              <Button onClick={() => refetch()} size="sm" type="button">
                {t("app.retry", { defaultValue: "Retry" })}
              </Button>
            </div>
          ) : visiblePRs.length === 0 ? (
            <div className="ui-panel-body text-muted-foreground text-sm">
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
                      buildPullRequestWorkspacePath({
                        repository,
                        prNumber: pullRequest.number,
                      })
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(
                        buildPullRequestWorkspacePath({
                          repository,
                          prNumber: pullRequest.number,
                        })
                      );
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="text-muted-foreground text-xs tabular-nums">
                    #{pullRequest.number}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate font-medium text-sm">
                        {pullRequest.title}
                      </span>
                      {hasLocalDrafts && (
                        <span
                          className="inline-flex h-2 w-2 shrink-0 rounded-full bg-warning"
                          title={localDraftsTitle}
                        />
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
                    <span className="truncate font-mono text-muted-foreground text-xs">
                      {pullRequest.headRef}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden">
                    <PullRequestLabels
                      className="justify-end"
                      labels={pullRequest.labels}
                    />
                    {pullRequest.lastCommitAuthorLogin && (
                      <span
                        className="inline-flex h-5 max-w-[160px] items-center truncate whitespace-nowrap rounded-full px-2 font-semibold text-muted-foreground text-xs leading-none shadow-[inset_0_0_0_1px_var(--border)]"
                        title={pullRequest.lastCommitAuthorLogin}
                      >
                        {pullRequest.lastCommitAuthorLogin}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <StatusBadge className="shrink-0" variant="info">
                      ✓ {pullRequest.approvedCount ?? "?"}
                    </StatusBadge>
                    {pullRequest.failedValidationCount === null && (
                      <span title={t("source.checksUnavailable")}>✗ ?</span>
                    )}
                    {(pullRequest.failedValidationCount ?? 0) > 0 && (
                      <StatusBadge className="shrink-0" variant="error">
                        ✗ {pullRequest.failedValidationCount}
                      </StatusBadge>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
