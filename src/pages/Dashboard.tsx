import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { ModalDialog } from "@/components/ModalDialog";
import { PullRequestLabels } from "@/components/PullRequestLabels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { config } from "@/config";
import { buildBankWorkspacePath } from "@/domain/bank-route";
import { fetchPullRequestValidationDetails } from "@/domain/github";
import type { BankInfo, PullRequestLabel } from "@/domain/types";
import { useOpenPRs, useRepoTree, useSwitchSource } from "@/hooks/useGitHub";
import {
  getPullRequestWorkspacePath,
  type PullRequestShortcutNotice,
} from "@/lib/pull-request-navigation";
import { confirmSourceSwitch } from "@/lib/source-switch";
import { cn } from "@/lib/utils";
import { useDraftStore, useSourceStore } from "@/store";

// ─── Recent banks persistence ───
const RECENT_BANKS_KEY = "sms-formats-recent-banks";
const MAX_RECENT_BANKS = 10;
const RECENT_PRS_KEY = "sms-formats-recent-prs";
const MAX_RECENT_PRS = 20;

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

interface ValidationDetailsModalState {
  prNumber: number;
  prTitle: string;
  checksUrl: string;
  validationErrors: string[];
}

function getRecentBanks(): string[] {
  try {
    return JSON.parse(
      localStorage.getItem(RECENT_BANKS_KEY) ?? "[]"
    ) as string[];
  } catch {
    return [];
  }
}

export function addRecentBank(bankPath: string) {
  try {
    const list = getRecentBanks().filter((b) => b !== bankPath);
    list.unshift(bankPath);
    localStorage.setItem(
      RECENT_BANKS_KEY,
      JSON.stringify(list.slice(0, MAX_RECENT_BANKS))
    );
  } catch {
    /* ignore */
  }
}

function getRecentPRs(repoSlug: string): number[] {
  try {
    const allData = JSON.parse(localStorage.getItem(RECENT_PRS_KEY) ?? "{}") as
      | Record<string, number[]>
      | undefined;
    const repoItems = allData?.[repoSlug];
    if (!Array.isArray(repoItems)) {
      return [];
    }
    return repoItems.filter((item): item is number => Number.isInteger(item));
  } catch {
    return [];
  }
}

function addRecentPR(repoSlug: string, prNumber: number) {
  try {
    const allData = JSON.parse(localStorage.getItem(RECENT_PRS_KEY) ?? "{}") as
      | Record<string, number[]>
      | undefined;
    const next = { ...(allData ?? {}) };
    const current = Array.isArray(next[repoSlug]) ? next[repoSlug] : [];
    const deduplicated = current.filter((item) => item !== prNumber);
    deduplicated.unshift(prNumber);
    next[repoSlug] = deduplicated.slice(0, MAX_RECENT_PRS);
    localStorage.setItem(RECENT_PRS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function sortPRs(prs: OpenPullRequestItem[] | undefined) {
  return [...(prs ?? [])].sort((a, b) => {
    const aHasValidationErrors = a.failedValidationCount > 0 ? 1 : 0;
    const bHasValidationErrors = b.failedValidationCount > 0 ? 1 : 0;
    if (aHasValidationErrors !== bHasValidationErrors) {
      return aHasValidationErrors - bHasValidationErrors;
    }
    if (a.approvedCount !== b.approvedCount) {
      return b.approvedCount - a.approvedCount;
    }
    return b.number - a.number;
  });
}

const dashboardPanelClassName =
  "flex min-h-0 flex-col overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)]";

const dashboardPanelHeaderClassName =
  "flex items-center justify-between border-b border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-4 py-2 text-[13px] font-semibold tracking-[0.5px] text-[color:var(--c-text-muted)] uppercase";

const dashboardTabsClassName =
  "flex gap-0 border-b border-[color:var(--c-border)]";

const dashboardTabClassName = (isActive: boolean) =>
  cn(
    "cursor-pointer border-x-0 border-t-0 border-b-2 border-solid px-4 py-2 font-sans text-[13px] font-medium transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)] focus-visible:ring-offset-[-2px]",
    isActive
      ? "border-b-[color:var(--c-accent)] bg-[color:var(--c-bg-surface)] text-[color:var(--c-accent)] shadow-[inset_0_-1px_0_var(--c-accent-soft)]"
      : "border-b-transparent text-[color:var(--c-text-muted)] hover:border-b-[color:var(--c-accent-soft)] hover:bg-[color:var(--c-bg-surface)] hover:text-[color:var(--c-accent)]"
  );

const dashboardRowClassName = (isActive: boolean) =>
  cn(
    "flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px]",
    isActive
      ? "bg-[color:var(--c-bg-hover)] text-[color:var(--c-accent)]"
      : "hover:bg-[color:var(--c-bg-hover)]"
  );

const dashboardIconLinkClassName =
  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-[color:var(--c-text-dim)] no-underline hover:bg-[color:var(--c-accent-soft)] hover:text-[color:var(--c-accent)] hover:no-underline";

interface DashboardLocationState {
  pullRequestShortcutNotice?: PullRequestShortcutNotice;
}

export function Dashboard() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const sourceChangedFiles = useSourceStore((s) => s.sourceChangedFiles);
  const repository = useSourceStore((s) => s.repository);
  const banks = useSourceStore((s) => s.banks);
  const switchSource = useSwitchSource();
  const draftStore = useDraftStore();
  const shortcutNotice =
    (location.state as DashboardLocationState | null)
      ?.pullRequestShortcutNotice ?? null;
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [prTab, setPrTab] = useState<"all" | "recent">("all");
  const [banksTab, setBanksTab] = useState<"all" | "recent">("all");
  const [reloadAttemptKey, setReloadAttemptKey] = useState<string | null>(null);
  const [validationDetailsModal, setValidationDetailsModal] =
    useState<ValidationDetailsModalState | null>(null);
  const [isValidationDetailsLoading, setIsValidationDetailsLoading] =
    useState(false);
  const [validationDetailsError, setValidationDetailsError] = useState<
    string | null
  >(null);
  const validationDetailsTitleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: openPRs = [], isLoading: isPRsLoading } = useOpenPRs();
  const sortedPRs = useMemo(() => sortPRs(openPRs), [openPRs]);
  const repoSlug = `${repository.owner}/${repository.repo}`;

  // Load tree when source is set
  const { isLoading, error } = useRepoTree(sourceRef?.sha);

  const localChangedFiles = useMemo(
    () => draftStore.getChangedFiles().map((item) => item.filePath),
    [draftStore, draftStore.drafts]
  );
  const activePullRequestHasLocalDrafts =
    sourceRef?.type === "pr" && localChangedFiles.length > 0;

  const changedFilesByBank = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const allChanged = [...sourceChangedFiles, ...localChangedFiles];
    for (const path of allChanged) {
      if (!path.startsWith("src/")) {
        continue;
      }
      const bankPath = path.split("/").slice(0, 2).join("/");
      const current = map.get(bankPath) ?? new Set<string>();
      current.add(path);
      map.set(bankPath, current);
    }
    return map;
  }, [sourceChangedFiles, localChangedFiles]);

  const sortedBanks = useMemo(() => {
    return [...banks].sort((a, b) => {
      const aChanged = changedFilesByBank.get(a.folderPath)?.size ?? 0;
      const bChanged = changedFilesByBank.get(b.folderPath)?.size ?? 0;
      if (aChanged !== bChanged) {
        return bChanged - aChanged;
      }
      return a.displayName.localeCompare(b.displayName, undefined, {
        sensitivity: "base",
      });
    });
  }, [banks, changedFilesByBank]);

  const filtered = useMemo(() => {
    if (!query) {
      return sortedBanks;
    }
    const q = query.toLowerCase();
    return sortedBanks.filter(
      (b) =>
        b.displayName.toLowerCase().includes(q) ||
        b.bankId?.includes(q) ||
        b.folderPath.toLowerCase().includes(q)
    );
  }, [sortedBanks, query]);

  // Recent banks resolved to BankInfo
  const recentBanks = useMemo(() => {
    const paths = getRecentBanks();
    return paths
      .map((p) => banks.find((b) => b.folderPath === p))
      .filter((b): b is BankInfo => b != null);
  }, [banks]);
  const recentPRs = useMemo(() => {
    const numbers = getRecentPRs(repoSlug);
    return numbers
      .map((number) => sortedPRs.find((pr) => pr.number === number))
      .filter((pr): pr is OpenPullRequestItem => pr != null);
  }, [repoSlug, sortedPRs]);
  const visiblePRs = prTab === "recent" ? recentPRs : sortedPRs;
  const visibleBanks = banksTab === "recent" ? recentBanks : filtered;

  useEffect(() => {
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (!sourceRef) {
      return;
    }
    const sourceKey = `${sourceRef.type}:${sourceRef.name}:${sourceRef.sha}`;
    setReloadAttemptKey((current) =>
      current && current !== sourceKey ? null : current
    );
  }, [sourceRef]);

  useEffect(() => {
    if (!sourceRef) {
      return;
    }
    if (isLoading || error) {
      return;
    }
    if (banks.length > 0) {
      return;
    }

    const sourceKey = `${sourceRef.type}:${sourceRef.name}:${sourceRef.sha}`;
    if (reloadAttemptKey === sourceKey) {
      return;
    }

    setReloadAttemptKey(sourceKey);
    void switchSource(sourceRef.type, sourceRef.name, sourceRef.prNumber);
  }, [
    sourceRef,
    isLoading,
    error,
    banks.length,
    reloadAttemptKey,
    switchSource,
  ]);

  const handleSelect = useCallback(
    async (bank: BankInfo) => {
      if (
        !confirmSourceSwitch({
          confirmMessage: t("source.switchDiscardConfirm"),
          draftStore,
        })
      ) {
        return;
      }
      if (
        !(
          sourceRef?.type === "branch" &&
          sourceRef.name === config.defaultBranch
        )
      ) {
        await switchSource("branch", config.defaultBranch);
      }
      addRecentBank(bank.folderPath);
      navigate(
        buildBankWorkspacePath({
          bankPath: bank.folderPath,
          repository,
          source: { type: "branch", name: config.defaultBranch },
        })
      );
    },
    [
      draftStore,
      navigate,
      repository,
      sourceRef?.name,
      sourceRef?.type,
      switchSource,
      t,
    ]
  );

  const handlePRSelect = useCallback(
    async (pr: { number: number; headRef: string; headSha: string }) => {
      const isCurrentPullRequest =
        sourceRef?.type === "pr" && sourceRef.prNumber === pr.number;

      addRecentPR(repoSlug, pr.number);
      if (isCurrentPullRequest) {
        const preferredChangedPaths =
          localChangedFiles.length > 0
            ? localChangedFiles
            : useSourceStore.getState().sourceChangedFiles;
        navigate(
          getPullRequestWorkspacePath({
            changedPaths: preferredChangedPaths,
            prNumber: pr.number,
            repository,
            sourceSha: sourceRef.sha ?? pr.headSha,
          })
        );
        return;
      }

      if (
        !confirmSourceSwitch({
          confirmMessage: t("source.switchDiscardConfirm"),
          draftStore,
        })
      ) {
        return;
      }
      await switchSource("pr", pr.headRef, pr.number, pr.headSha);
      navigate(
        getPullRequestWorkspacePath({
          changedPaths: useSourceStore.getState().sourceChangedFiles,
          prNumber: pr.number,
          repository,
          sourceSha: pr.headSha,
        })
      );
    },
    [
      draftStore,
      localChangedFiles,
      navigate,
      repoSlug,
      repository,
      sourceRef,
      switchSource,
      t,
    ]
  );

  const loadValidationDetails = useCallback(
    async (prNumber: number) => {
      setIsValidationDetailsLoading(true);
      setValidationDetailsError(null);
      try {
        const details = await fetchPullRequestValidationDetails(
          prNumber,
          repository
        );
        setValidationDetailsModal((current) => {
          if (!(current && current.prNumber === prNumber)) {
            return current;
          }
          const nextErrors =
            details.validationErrors.length > 0
              ? details.validationErrors
              : current.validationErrors;
          return {
            ...current,
            checksUrl: details.validationUrl ?? current.checksUrl,
            validationErrors: nextErrors,
          };
        });
        if (details.validationErrors.length === 0) {
          setValidationDetailsError(
            t("source.validatorLoadFailed", {
              defaultValue:
                "Не удалось загрузить подробности валидации. Откройте checks в GitHub.",
            })
          );
        }
      } catch (error) {
        setValidationDetailsError(
          error instanceof Error
            ? error.message
            : t("source.validatorLoadFailed", {
                defaultValue:
                  "Не удалось загрузить подробности валидации. Откройте checks в GitHub.",
              })
        );
      } finally {
        setIsValidationDetailsLoading(false);
      }
    },
    [repository, t]
  );

  const openValidationDetails = useCallback(
    (pr: OpenPullRequestItem) => {
      const defaultChecksUrl = `https://github.com/${repository.owner}/${repository.repo}/pull/${pr.number}/checks`;
      const checksUrl = pr.validationUrl?.trim() || defaultChecksUrl;
      setValidationDetailsError(null);
      setIsValidationDetailsLoading(false);
      setValidationDetailsModal({
        prNumber: pr.number,
        prTitle: pr.title,
        checksUrl,
        validationErrors: pr.validationErrors,
      });
      void loadValidationDetails(pr.number);
    },
    [loadValidationDetails, repository.owner, repository.repo]
  );

  const handleRetryValidationDetails = useCallback(() => {
    if (!validationDetailsModal) {
      return;
    }
    void loadValidationDetails(validationDetailsModal.prNumber);
  }, [loadValidationDetails, validationDetailsModal]);

  const clearShortcutNotice = useCallback(() => {
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate]);

  const handleShortcutNoticeDiscardAndOpen = useCallback(() => {
    if (!shortcutNotice) {
      return;
    }
    draftStore.discardAll();
    navigate(`/pr/${shortcutNotice.prNumber}`, { replace: true });
  }, [draftStore, navigate, shortcutNotice]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (banksTab !== "all") {
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      const bank = filtered[activeIndex];
      if (bank) {
        void handleSelect(bank);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Spinner />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <StatusBadge variant="error">
        {t("app.error")}: {String(error)}
      </StatusBadge>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {shortcutNotice && (
        <div className="mb-4 rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <StatusBadge
                className="w-fit"
                variant={
                  shortcutNotice.reason === "open-failed" ? "error" : "warning"
                }
              >
                {shortcutNotice.reason === "open-failed"
                  ? t("prShortcut.bannerOpenFailedBadge", {
                      defaultValue: "Не удалось открыть PR",
                    })
                  : t("prShortcut.bannerBlockedBadge", {
                      defaultValue: "Нельзя открыть ссылку сейчас",
                    })}
              </StatusBadge>
              <div className="text-sm text-[color:var(--c-text)]">
                {shortcutNotice.reason === "same-pr-drafts"
                  ? t("prShortcut.samePrDraftsMessage", {
                      defaultValue:
                        "Нельзя открыть PR #{{prNumber}} по ссылке, потому что у вас есть незаконченные локальные правки в этом PR.",
                      prNumber: shortcutNotice.prNumber,
                    })
                  : shortcutNotice.reason === "other-drafts"
                    ? t("prShortcut.otherDraftsMessage", {
                        defaultValue:
                          "Нельзя открыть PR #{{prNumber}} по ссылке, пока у вас есть несброшенные локальные правки. Сначала сбросьте их или откройте PR в GitHub.",
                        prNumber: shortcutNotice.prNumber,
                      })
                    : t("prShortcut.openFailedMessage", {
                        defaultValue:
                          "Не удалось открыть PR #{{prNumber}} в приложении. Можно попробовать ещё раз после сброса локальных правок или открыть PR в GitHub.",
                        prNumber: shortcutNotice.prNumber,
                      })}
              </div>
            </div>
            <Button onClick={clearShortcutNotice} size="sm" type="button">
              {t("app.close")}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {shortcutNotice.reason !== "open-failed" && (
              <Button
                onClick={handleShortcutNoticeDiscardAndOpen}
                size="sm"
                type="button"
                variant="destructive"
              >
                {t("prShortcut.discardAndOpen", {
                  defaultValue: "Сбросить правки и открыть PR",
                })}
              </Button>
            )}
            <Button asChild size="sm" variant="default">
              <a
                href={shortcutNotice.githubUrl}
                rel="noreferrer"
                target="_blank"
              >
                {t("prShortcut.openOnGitHub", {
                  defaultValue: "Открыть PR в GitHub",
                })}
              </a>
            </Button>
          </div>
        </div>
      )}
      <div className="grid min-h-0 flex-1 gap-4 [grid-template-columns:minmax(360px,1fr)_minmax(520px,1.4fr)]">
        <div className={dashboardPanelClassName}>
          <div className={dashboardPanelHeaderClassName}>
            {t("source.pullRequest")} · {sortedPRs.length}
          </div>
          <div className={dashboardTabsClassName}>
            <button
              className={dashboardTabClassName(prTab === "all")}
              onClick={() => setPrTab("all")}
            >
              {t("source.pullRequest")}
            </button>
            <button
              className={dashboardTabClassName(prTab === "recent")}
              onClick={() => setPrTab("recent")}
            >
              {t("source.recentPullRequests", { defaultValue: "Recent PR" })}
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto">
            {isPRsLoading ? (
              <div className="p-4 text-[color:var(--c-text-muted)]">
                {t("app.loading")}
              </div>
            ) : visiblePRs.length === 0 ? (
              <div className="p-4 text-[color:var(--c-text-muted)]">
                {t("bank.noResults")}
              </div>
            ) : (
              visiblePRs.map((pr) => {
                const isActive =
                  sourceRef?.type === "pr" && sourceRef.prNumber === pr.number;
                const hasLocalDrafts =
                  activePullRequestHasLocalDrafts &&
                  sourceRef.prNumber === pr.number;
                const prUrl = `https://github.com/${repository.owner}/${repository.repo}/pull/${pr.number}`;
                const validationErrorsTitle = t(
                  "source.validatorErrorsClickable",
                  {
                    defaultValue:
                      "Нажмите, чтобы открыть детали ошибок валидатора",
                  }
                );
                const localDraftsTitle = t("source.unsavedDraftsInPr", {
                  defaultValue: "Есть несохранённые локальные правки в этом PR",
                });
                return (
                  <div
                    className={dashboardRowClassName(isActive)}
                    key={pr.number}
                    onClick={() => {
                      void handlePRSelect(pr);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void handlePRSelect(pr);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="text-xs text-[color:var(--c-text-muted)]">
                      #{pr.number}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="inline-flex max-w-full min-w-0 items-center gap-1">
                        <span className="min-w-0 truncate text-sm">
                          {pr.title}
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
                          aria-label={`PR #${pr.number}`}
                          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px] leading-none text-[color:var(--c-text-dim)] no-underline hover:text-[color:var(--c-accent)] hover:no-underline"
                          href={prUrl}
                          onClick={(event) => event.stopPropagation()}
                          rel="noreferrer"
                          target="_blank"
                          title={prUrl}
                        >
                          ↗
                        </a>
                      </div>
                      <span className="text-xs text-[color:var(--c-text-dim)]">
                        {pr.headRef}
                      </span>
                    </div>
                    <PullRequestLabels
                      className="ml-2 flex-[0_1_220px] justify-end"
                      labels={pr.labels}
                      neutralLabels={
                        pr.lastCommitAuthorLogin
                          ? [pr.lastCommitAuthorLogin]
                          : []
                      }
                    />
                    <StatusBadge variant="info">
                      ✓ {pr.approvedCount}
                    </StatusBadge>
                    {pr.failedValidationCount > 0 && (
                      <StatusBadge
                        interactive
                        onClick={(event) => {
                          event.stopPropagation();
                          openValidationDetails(pr);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            openValidationDetails(pr);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        title={validationErrorsTitle}
                        variant="error"
                      >
                        ✗ {pr.failedValidationCount}
                      </StatusBadge>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className={dashboardPanelClassName}>
          <div className={dashboardPanelHeaderClassName}>
            {t("bank.banks")} · {banks.length}
          </div>
          <div className={dashboardTabsClassName}>
            <button
              className={dashboardTabClassName(banksTab === "all")}
              onClick={() => setBanksTab("all")}
            >
              {t("bank.banks")}
            </button>
            <button
              className={dashboardTabClassName(banksTab === "recent")}
              onClick={() => setBanksTab("recent")}
            >
              {t("bank.recentBanks")}
            </button>
          </div>
          {banksTab === "all" && (
            <div className="border-b border-[color:var(--c-border)] p-2">
              <Input
                aria-label={t("bank.search")}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("bank.search")}
                ref={inputRef}
                value={query}
              />
            </div>
          )}
          <div className="min-h-0 overflow-y-auto">
            {visibleBanks.length === 0 ? (
              <div className="p-4 text-[color:var(--c-text-muted)]">
                {t("bank.noResults")}
              </div>
            ) : (
              visibleBanks.map((bank, i) => (
                <BankListItem
                  bank={bank}
                  changedFiles={Array.from(
                    changedFilesByBank.get(bank.folderPath) ?? []
                  )}
                  isActive={banksTab === "all" && i === activeIndex}
                  key={bank.folderPath}
                  onClick={() => {
                    void handleSelect(bank);
                  }}
                  onMouseEnter={() => {
                    if (banksTab === "all") {
                      setActiveIndex(i);
                    }
                  }}
                  openInRepoLabel={t("bank.openBankFolderInRepo")}
                  repository={repository}
                  sourceRefName={
                    sourceRef?.sha ?? sourceRef?.name ?? config.defaultBranch
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>

      {validationDetailsModal && (
        <ModalDialog
          className="flex max-w-[min(840px,92vw)] flex-col"
          onClose={() => {
            setValidationDetailsModal(null);
            setValidationDetailsError(null);
          }}
          title={t("source.validatorErrorsTitle", {
            defaultValue: "Ошибки валидатора",
          })}
          titleId={validationDetailsTitleId}
        >
          <div className="text-sm text-[color:var(--c-text-muted)]">
            PR #{validationDetailsModal.prNumber} ·{" "}
            {validationDetailsModal.prTitle}
          </div>
          <pre className="mt-4 max-h-[min(52vh,420px)] overflow-auto rounded-[var(--radius-sm)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] p-2 font-mono text-xs leading-6 whitespace-pre-wrap break-words">
            {isValidationDetailsLoading
              ? t("source.loadingValidationResult", {
                  defaultValue: "Загружаем результат валидации...",
                })
              : validationDetailsModal.validationErrors.length > 0
                ? validationDetailsModal.validationErrors.join("\n")
                : t("source.validatorErrorsUnavailable", {
                    defaultValue:
                      "Проверка валидатора не пройдена. Откройте checks в PR для деталей.",
                  })}
          </pre>
          {validationDetailsError && (
            <StatusBadge variant="error">{validationDetailsError}</StatusBadge>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              disabled={isValidationDetailsLoading}
              onClick={handleRetryValidationDetails}
              type="button"
              variant="primary"
            >
              {isValidationDetailsLoading
                ? t("source.loadingValidationResult", {
                    defaultValue: "Загружаем...",
                  })
                : t("source.loadValidationResult", {
                    defaultValue: "Попробовать снова",
                  })}
            </Button>
            <Button asChild variant="default">
              <a
                href={validationDetailsModal.checksUrl}
                rel="noreferrer"
                target="_blank"
              >
                {t("source.openValidatorChecks", {
                  defaultValue: "Открыть checks",
                })}
              </a>
            </Button>
            <Button
              onClick={() => {
                setValidationDetailsModal(null);
                setValidationDetailsError(null);
              }}
              type="button"
            >
              {t("app.close")}
            </Button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}

function BankListItem({
  bank,
  changedFiles,
  repository,
  sourceRefName,
  openInRepoLabel,
  isActive,
  onClick,
  onMouseEnter,
}: {
  bank: BankInfo;
  changedFiles: string[];
  repository: { owner: string; repo: string };
  sourceRefName: string;
  openInRepoLabel: string;
  isActive: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  const hasChanges = changedFiles.length > 0;
  const changedLabels = changedFiles
    .map((path) => path.split("/").pop() ?? path)
    .slice(0, 3);
  const extraChangedCount = Math.max(
    changedFiles.length - changedLabels.length,
    0
  );
  const encodedFolderPath = bank.folderPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const repoUrl = `https://github.com/${repository.owner}/${repository.repo}/tree/${encodeURIComponent(sourceRefName)}/${encodedFolderPath}`;

  return (
    <div
      className={cn(
        "flex cursor-pointer items-start gap-2 px-4 py-2.5 text-[13px]",
        isActive
          ? "bg-[color:var(--c-bg-hover)] text-[color:var(--c-accent)]"
          : "hover:bg-[color:var(--c-bg-hover)]"
      )}
      onClick={onClick}
      onFocus={onMouseEnter}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={onMouseEnter}
      role="button"
      tabIndex={0}
    >
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{bank.displayName}</span>
          {bank.bankId && (
            <span className="text-sm text-[color:var(--c-text-dim)]">
              #{bank.bankId}
            </span>
          )}
          {hasChanges && <StatusBadge variant="modified">●</StatusBadge>}
        </div>
        <div className="text-sm text-[color:var(--c-text-muted)]">
          {bank.formatFiles.length} format(s)
          {!bank.hasSenders && (
            <StatusBadge className="ml-2" variant="warning">
              no senders
            </StatusBadge>
          )}
        </div>
        {hasChanges && (
          <div className="text-sm text-[color:var(--c-text-dim)]">
            {changedLabels.join(", ")}
            {extraChangedCount > 0 && ` +${extraChangedCount}`}
          </div>
        )}
      </div>
      <a
        aria-label={`${openInRepoLabel}: ${bank.displayName}`}
        className={dashboardIconLinkClassName}
        href={repoUrl}
        onClick={(e) => e.stopPropagation()}
        rel="noreferrer"
        target="_blank"
        title={openInRepoLabel}
      >
        ↗
      </a>
    </div>
  );
}
