import { useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { PullRequestLabels } from "@/components/PullRequestLabels";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { config } from "@/config";
import { buildBankWorkspacePath } from "@/domain/bank-route";
import type { PullRequestLabel, RepoRef, SourceRef } from "@/domain/types";
import {
  useAvailableSourceRepos,
  useOpenPRs,
  usePullRequestCommits,
  useSwitchRepository,
  useSwitchSource,
} from "@/hooks/useGitHub";
import { confirmSourceSwitch } from "@/lib/source-switch";
import { cn } from "@/lib/utils";
import { useDraftStore, useSourceStore } from "@/store";

type OpenMenu = "repo" | "source" | "commit" | null;

interface Props {
  allowRepoSwitch?: boolean;
}

interface OpenPullRequestItem {
  number: number;
  title: string;
  headRef: string;
  headSha: string;
  approvedCount: number;
  lastCommitAuthorLogin: string | null;
  labels: PullRequestLabel[];
}

interface PullRequestCommitItem {
  sha: string;
  message: string;
}

interface DraftStoreGuard {
  clearAll: () => void;
  hasDrafts: () => boolean;
}

type SwitchSourceHandler = ReturnType<typeof useSwitchSource>;
type SwitchRepositoryHandler = ReturnType<typeof useSwitchRepository>;
type ConfirmDiscardHandler = () => boolean;

const sourceNavDropdownClassName =
  "absolute top-[calc(100%+6px)] left-0 z-[120] max-h-[min(420px,calc(100vh-120px))] overflow-y-auto rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)] shadow-[var(--shadow-md)]";

const sourceNavOptionClassName = (isActive: boolean) =>
  cn(
    "flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left transition-colors",
    isActive
      ? "bg-[color:var(--c-bg-hover)] text-[color:var(--c-accent)]"
      : "hover:bg-[color:var(--c-bg-hover)]"
  );

const sourceNavLabelClassName = (isHash = false) =>
  cn(
    "max-w-[360px] overflow-hidden bg-transparent p-0 text-left text-[color:var(--c-text)] text-ellipsis whitespace-nowrap hover:text-[color:var(--c-accent)]",
    isHash &&
      'font-[ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation_Mono","Courier_New",monospace] text-xs tracking-[0.04em]'
  );

const sourceNavExternalLinkClassName =
  "ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-[color:var(--c-text-dim)] no-underline hover:bg-[color:var(--c-accent-soft)] hover:text-[color:var(--c-accent)] hover:no-underline";

function collectChangedBankPaths(paths: string[]): string[] {
  const banks = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith("src/")) {
      continue;
    }
    const bankFolder = path.split("/")[1];
    if (bankFolder) {
      banks.add(`src/${bankFolder}`);
    }
  }
  return Array.from(banks).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function getSingleChangedBankPath(paths: string[]): string | null {
  const bankPaths = collectChangedBankPaths(paths);
  if (bankPaths.length !== 1) {
    return null;
  }
  return bankPaths[0] ?? null;
}

function getPreferredChangedFilePath(
  paths: string[],
  bankPath: string
): string | null {
  const bankPaths = paths.filter((path) => path.startsWith(`${bankPath}/`));
  return (
    bankPaths.find(
      (path) =>
        path.startsWith(`${bankPath}/formats/`) && path.endsWith(".txt")
    ) ??
    bankPaths[0] ??
    null
  );
}

function navigateToPullRequestWorkspace(params: {
  changedPaths: string[];
  navigate: ReturnType<typeof useNavigate>;
  prNumber: number;
  repository: RepoRef;
  sourceSha: string;
}): void {
  const { changedPaths, navigate, prNumber, repository, sourceSha } = params;
  const bankPath = getSingleChangedBankPath(changedPaths);
  if (!bankPath) {
    navigate("/workspace");
    return;
  }

  navigate(
    buildBankWorkspacePath({
      bankPath,
      filePath: getPreferredChangedFilePath(changedPaths, bankPath),
      repository,
      source: { type: "pr", prNumber, sha: sourceSha },
    })
  );
}

function sortPRs(prs: OpenPullRequestItem[] | undefined) {
  return [...(prs ?? [])].sort((a, b) => {
    if (a.approvedCount !== b.approvedCount) {
      return b.approvedCount - a.approvedCount;
    }
    return b.number - a.number;
  });
}

function filterPRs(prs: OpenPullRequestItem[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return prs;
  }
  return prs.filter(
    (pr) =>
      pr.title.toLowerCase().includes(normalized) ||
      `#${pr.number}`.includes(normalized)
  );
}

function buildPullRequestNeutralLabels(
  pullRequest: OpenPullRequestItem | null
): string[] {
  if (!pullRequest) {
    return [];
  }

  const labels = [`✓ ${pullRequest.approvedCount}`];
  if (pullRequest.lastCommitAuthorLogin) {
    labels.unshift(pullRequest.lastCommitAuthorLogin);
  }
  return labels;
}

function getShortSha(sha: string | undefined, length = 5): string {
  if (!sha) {
    return "";
  }
  return sha.slice(0, length);
}

function createDiscardDraftsGuard(
  confirmMessage: string,
  draftStore: DraftStoreGuard
): ConfirmDiscardHandler {
  return () => confirmSourceSwitch({ confirmMessage, draftStore });
}

const sourceSelectorItemClassName = "relative flex min-w-0 items-center gap-1";
const sourceSelectorLabelClassName =
  "max-w-[360px] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left text-[color:var(--c-text)] hover:text-[color:var(--c-accent)]";
const sourceSelectorHashLabelClassName = "font-mono text-xs tracking-[0.04em]";
const sourceSelectorExternalLinkClassName =
  "ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-[color:var(--c-text-dim)] no-underline hover:bg-[color:var(--c-accent-soft)] hover:text-[color:var(--c-accent)] hover:no-underline";
const sourceSelectorDropdownClassName =
  "absolute top-[calc(100%+6px)] left-0 z-[120] max-h-[min(420px,calc(100vh-120px))] overflow-y-auto rounded-[var(--radius-md)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)] shadow-[var(--shadow-md)]";
const sourceSelectorOptionClassName = (isActive: boolean) =>
  cn(
    "flex w-full items-center gap-2 border-0 bg-transparent px-3 py-2 text-left text-[13px] text-inherit",
    isActive
      ? "bg-[color:var(--c-bg-hover)] text-[color:var(--c-accent)]"
      : "hover:bg-[color:var(--c-bg-hover)]"
  );

async function selectRepository(params: {
  closeMenu: () => void;
  confirmDiscardDrafts: ConfirmDiscardHandler;
  navigate: ReturnType<typeof useNavigate>;
  repoSlug: string;
  switchRepository: SwitchRepositoryHandler;
}): Promise<void> {
  const {
    closeMenu,
    confirmDiscardDrafts,
    navigate,
    repoSlug,
    switchRepository,
  } = params;
  const [owner, repo] = repoSlug.split("/");
  if (!(owner && repo && confirmDiscardDrafts())) {
    return;
  }

  await switchRepository({ owner, repo });
  closeMenu();
  navigate("/");
}

async function selectMainSource(params: {
  closeMenu: () => void;
  confirmDiscardDrafts: ConfirmDiscardHandler;
  navigate: ReturnType<typeof useNavigate>;
  switchSource: SwitchSourceHandler;
}): Promise<void> {
  const { closeMenu, confirmDiscardDrafts, navigate, switchSource } = params;
  if (!confirmDiscardDrafts()) {
    return;
  }
  await switchSource("branch", config.defaultBranch);
  closeMenu();
  navigate("/workspace");
}

async function selectPullRequest(params: {
  closeMenu: () => void;
  confirmDiscardDrafts: ConfirmDiscardHandler;
  currentSource: SourceRef | null;
  localChangedFiles: string[];
  navigate: ReturnType<typeof useNavigate>;
  pullRequest: OpenPullRequestItem;
  repository: RepoRef;
  switchSource: SwitchSourceHandler;
}): Promise<void> {
  const {
    closeMenu,
    confirmDiscardDrafts,
    currentSource,
    localChangedFiles,
    navigate,
    pullRequest,
    repository,
    switchSource,
  } = params;
  const isCurrentPullRequest =
    currentSource?.type === "pr" && currentSource.prNumber === pullRequest.number;
  if (isCurrentPullRequest) {
    const preferredChangedPaths =
      localChangedFiles.length > 0
        ? localChangedFiles
        : useSourceStore.getState().sourceChangedFiles;
    closeMenu();
    navigateToPullRequestWorkspace({
      changedPaths: preferredChangedPaths,
      navigate,
      prNumber: pullRequest.number,
      repository,
      sourceSha: currentSource.sha,
    });
    return;
  }

  if (!confirmDiscardDrafts()) {
    return;
  }

  await switchSource(
    "pr",
    pullRequest.headRef,
    pullRequest.number,
    pullRequest.headSha
  );
  closeMenu();
  navigateToPullRequestWorkspace({
    changedPaths: useSourceStore.getState().sourceChangedFiles,
    navigate,
    prNumber: pullRequest.number,
    repository,
    sourceSha: pullRequest.headSha,
  });
}

async function selectPullRequestCommit(params: {
  activePullRequest: OpenPullRequestItem | null;
  closeMenu: () => void;
  confirmDiscardDrafts: ConfirmDiscardHandler;
  location: ReturnType<typeof useLocation>;
  navigate: ReturnType<typeof useNavigate>;
  sha: string;
  sourceRef: SourceRef | null;
  switchSource: SwitchSourceHandler;
}): Promise<void> {
  const {
    activePullRequest,
    closeMenu,
    confirmDiscardDrafts,
    location,
    navigate,
    sha,
    sourceRef,
    switchSource,
  } = params;
  if (!(activePullRequest && sourceRef?.type === "pr")) {
    return;
  }
  if (sourceRef.sha === sha) {
    closeMenu();
    return;
  }
  if (!confirmDiscardDrafts()) {
    return;
  }

  await switchSource(
    "pr",
    activePullRequest.headRef,
    activePullRequest.number,
    sha
  );
  closeMenu();

  if (location.pathname.startsWith("/bank/")) {
    const params = new URLSearchParams(location.search);
    params.set("commit", sha);
    navigate(`${location.pathname}?${params.toString()}`);
    return;
  }

  navigate("/workspace");
}

function RepositoryDropdown(props: {
  currentRepoSlug: string;
  isFetching: boolean;
  isOpen: boolean;
  onSelect: (repoSlug: string) => void;
  options: RepoRef[];
  t: TFunction;
}) {
  const { currentRepoSlug, isFetching, isOpen, onSelect, options, t } = props;
  if (!isOpen) {
    return null;
  }
  const localDraftsTitle = t("source.unsavedDraftsInPr", {
    defaultValue: "You have unsaved local changes in this PR",
  });

  return (
    <div className={sourceNavDropdownClassName} style={{ minWidth: 320 }}>
      {isFetching && (
        <div className="px-3 py-2 text-[13px] text-[color:var(--c-text-muted)]">
          {t("app.loading")}
        </div>
      )}
      {!isFetching &&
        options.map((repoOption) => {
          const repoSlug = `${repoOption.owner}/${repoOption.repo}`;
          return (
            <button
              className={sourceNavOptionClassName(repoSlug === currentRepoSlug)}
              key={repoSlug}
              onClick={() => onSelect(repoSlug)}
              type="button"
            >
              {repoSlug}
            </button>
          );
        })}
    </div>
  );
}

function SourceDropdown(props: {
  currentSource: SourceRef | null;
  hasActivePullRequestDrafts: boolean;
  isFetching: boolean;
  isOpen: boolean;
  onMainSelect: () => void;
  onSourceQueryChange: (value: string) => void;
  onPullRequestSelect: (pr: OpenPullRequestItem) => void;
  pullRequests: OpenPullRequestItem[];
  sourceQuery: string;
  t: TFunction;
}) {
  const {
    currentSource,
    hasActivePullRequestDrafts,
    isFetching,
    isOpen,
    onMainSelect,
    onPullRequestSelect,
    onSourceQueryChange,
    pullRequests,
    sourceQuery,
    t,
  } = props;
  if (!isOpen) {
    return null;
  }
  const localDraftsTitle = t("source.unsavedDraftsInPr", {
    defaultValue: "You have unsaved local changes in this PR",
  });

  return (
    <div className={sourceNavDropdownClassName} style={{ minWidth: 420 }}>
      <div className="border-b border-[color:var(--c-border)] p-2">
        <Input
          aria-label={t("source.searchPR")}
          onChange={(event) => onSourceQueryChange(event.target.value)}
          placeholder={t("source.searchPR")}
          value={sourceQuery}
        />
      </div>
      <button
        className={sourceNavOptionClassName(
          currentSource?.type === "branch" &&
            currentSource.name === config.defaultBranch
        )}
        onClick={onMainSelect}
        type="button"
      >
        <span>{config.defaultBranch}</span>
      </button>

      {isFetching && (
        <div className="px-3 py-2 text-[13px] text-[color:var(--c-text-muted)]">
          {t("app.loading")}
        </div>
      )}

      {!isFetching &&
        pullRequests.map((pr) => {
          const hasLocalDrafts =
            hasActivePullRequestDrafts &&
            currentSource?.type === "pr" &&
            currentSource.prNumber === pr.number;
          return (
            <button
              className={sourceNavOptionClassName(
                currentSource?.type === "pr" &&
                  currentSource.prNumber === pr.number
              )}
              key={pr.number}
              onClick={() => onPullRequestSelect(pr)}
              type="button"
            >
              <span className="text-xs text-[color:var(--c-text-muted)]">
                #{pr.number}
              </span>
              <span className="truncate text-sm">{pr.title}</span>
              {hasLocalDrafts && (
                <StatusBadge
                  aria-label={localDraftsTitle}
                  title={localDraftsTitle}
                  variant="modified"
                >
                  ●
                </StatusBadge>
              )}
              <StatusBadge variant="info">✓ {pr.approvedCount}</StatusBadge>
            </button>
          );
        })}

      {!isFetching && pullRequests.length === 0 && (
        <div className="px-3 py-2 text-[13px] text-[color:var(--c-text-muted)]">
          {t("bank.noResults")}
        </div>
      )}
    </div>
  );
}

function CommitDropdown(props: {
  commits: PullRequestCommitItem[];
  currentSha: string;
  isFetching: boolean;
  isOpen: boolean;
  onCommitSelect: (sha: string) => void;
  t: TFunction;
}) {
  const { commits, currentSha, isFetching, isOpen, onCommitSelect, t } = props;
  if (!isOpen) {
    return null;
  }

  return (
    <div className={sourceNavDropdownClassName} style={{ minWidth: 420 }}>
      {isFetching && (
        <div className="px-3 py-2 text-[13px] text-[color:var(--c-text-muted)]">
          {t("app.loading")}
        </div>
      )}

      {!isFetching &&
        commits.map((commit) => {
          const isActive = commit.sha === currentSha;
          return (
            <button
              className={sourceNavOptionClassName(isActive)}
              key={commit.sha}
              onClick={() => onCommitSelect(commit.sha)}
              type="button"
            >
              <span className='min-w-[44px] text-xs text-[color:var(--c-text-muted)] font-[ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation_Mono","Courier_New",monospace]'>
                {getShortSha(commit.sha)}
              </span>
              <span className="truncate text-sm">
                {commit.message || t("source.commitWithoutMessage")}
              </span>
            </button>
          );
        })}

      {!isFetching && commits.length === 0 && (
        <div className="px-3 py-2 text-[13px] text-[color:var(--c-text-muted)]">
          {t("source.noCommits")}
        </div>
      )}
    </div>
  );
}

export function SourceSelector({ allowRepoSwitch = false }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [sourceQuery, setSourceQuery] = useState("");
  const repository = useSourceStore((s) => s.repository);
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const draftStore = useDraftStore();
  const localChangedFiles = useMemo(
    () => draftStore.getChangedFiles().map((item) => item.filePath),
    [draftStore, draftStore.drafts]
  );
  const hasActivePullRequestDrafts = localChangedFiles.length > 0;
  const switchSource = useSwitchSource();
  const switchRepository = useSwitchRepository();
  const isHome = location.pathname === "/";

  const { data: availableRepos = [], isFetching: isReposFetching } =
    useAvailableSourceRepos(openMenu === "repo" && allowRepoSwitch);
  const { data: openPRs = [], isFetching: isPRsFetching } = useOpenPRs(
    openMenu === "source" || sourceRef?.type === "pr"
  );
  const { data: pullRequestCommits = [], isFetching: isCommitListFetching } =
    usePullRequestCommits(
      sourceRef?.type === "pr" ? sourceRef.prNumber : undefined,
      openMenu === "commit"
    );

  const sortedPRs = useMemo(() => sortPRs(openPRs), [openPRs]);
  const filteredPRs = useMemo(
    () => filterPRs(sortedPRs, sourceQuery),
    [sortedPRs, sourceQuery]
  );
  const activePullRequest = useMemo(
    () =>
      sourceRef?.type === "pr" && sourceRef.prNumber
        ? (sortedPRs.find((pr) => pr.number === sourceRef.prNumber) ?? null)
        : null,
    [sortedPRs, sourceRef]
  );
  const currentRepoSlug = `${repository.owner}/${repository.repo}`;
  const repositoryOptions =
    availableRepos.length > 0 ? availableRepos : [repository];
  const repositoryUrl = `https://github.com/${repository.owner}/${repository.repo}`;
  const sourceLabel =
    sourceRef?.type === "pr" && sourceRef.prNumber
      ? `PR #${sourceRef.prNumber}`
      : config.defaultBranch;
  const sourceUrl =
    sourceRef?.type === "pr" && sourceRef.prNumber
      ? `${repositoryUrl}/pull/${sourceRef.prNumber}`
      : `${repositoryUrl}/tree/${encodeURIComponent(config.defaultBranch)}`;

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const closeMenu = () => {
    setOpenMenu(null);
    setSourceQuery("");
  };

  const confirmDiscardDrafts = createDiscardDraftsGuard(
    t("source.switchDiscardConfirm"),
    draftStore
  );

  return (
    <div className="relative flex min-w-0 items-center gap-2" ref={ref}>
      {allowRepoSwitch && (
        <div className="relative flex min-w-0 items-center gap-1">
          <button
            className={sourceNavLabelClassName()}
            onClick={() =>
              setOpenMenu((current) => (current === "repo" ? null : "repo"))
            }
            title={currentRepoSlug}
            type="button"
          >
            {currentRepoSlug}
          </button>
          <a
            aria-label={currentRepoSlug}
            className={sourceNavExternalLinkClassName}
            href={repositoryUrl}
            rel="noreferrer"
            target="_blank"
            title={currentRepoSlug}
          >
            ↗
          </a>
          <RepositoryDropdown
            currentRepoSlug={currentRepoSlug}
            isFetching={isReposFetching}
            isOpen={openMenu === "repo"}
            onSelect={(repoSlug) => {
              void selectRepository({
                closeMenu,
                confirmDiscardDrafts,
                navigate,
                repoSlug,
                switchRepository,
              });
            }}
            options={repositoryOptions}
            t={t}
          />
        </div>
      )}

      {!isHome && (
        <>
          <span className="text-[color:var(--c-text-dim)]">/</span>
          <div className="relative flex min-w-0 items-center gap-1">
            <button
              className={sourceNavLabelClassName()}
              onClick={() =>
                setOpenMenu((current) =>
                  current === "source" ? null : "source"
                )
              }
              title={sourceLabel}
              type="button"
            >
              {sourceLabel}
            </button>
            <a
              aria-label={sourceLabel}
              className={sourceNavExternalLinkClassName}
              href={sourceUrl}
              rel="noreferrer"
              target="_blank"
              title={sourceLabel}
            >
              ↗
            </a>
            <SourceDropdown
              currentSource={sourceRef}
              hasActivePullRequestDrafts={hasActivePullRequestDrafts}
              isFetching={isPRsFetching}
              isOpen={openMenu === "source"}
              onMainSelect={() => {
                void selectMainSource({
                  closeMenu,
                  confirmDiscardDrafts,
                  navigate,
                  switchSource,
                });
              }}
              onPullRequestSelect={(pullRequest) => {
                void selectPullRequest({
                  closeMenu,
                  confirmDiscardDrafts,
                  currentSource: sourceRef,
                  localChangedFiles,
                  navigate,
                  pullRequest,
                  repository,
                  switchSource,
                });
              }}
              onSourceQueryChange={setSourceQuery}
              pullRequests={filteredPRs}
              sourceQuery={sourceQuery}
              t={t}
            />
          </div>

          {sourceRef?.type === "pr" && (
            <>
              <span className="text-[color:var(--c-text-dim)]">/</span>
              <div className="relative flex min-w-0 items-center gap-1">
                <button
                  className={sourceNavLabelClassName(true)}
                  onClick={() =>
                    setOpenMenu((current) =>
                      current === "commit" ? null : "commit"
                    )
                  }
                  title={sourceRef.sha}
                  type="button"
                >
                  {getShortSha(sourceRef.sha)}
                </button>
                <PullRequestLabels
                  className="ml-2 max-w-[min(280px,32vw)]"
                  labels={activePullRequest?.labels ?? []}
                  neutralLabels={buildPullRequestNeutralLabels(
                    activePullRequest
                  )}
                />
                <CommitDropdown
                  commits={pullRequestCommits}
                  currentSha={sourceRef.sha}
                  isFetching={isCommitListFetching}
                  isOpen={openMenu === "commit"}
                  onCommitSelect={(sha) => {
                    void selectPullRequestCommit({
                      activePullRequest,
                      closeMenu,
                      confirmDiscardDrafts,
                      location,
                      navigate,
                      sha,
                      sourceRef,
                      switchSource,
                    });
                  }}
                  t={t}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
