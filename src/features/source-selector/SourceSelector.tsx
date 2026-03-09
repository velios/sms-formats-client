import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { PullRequestLabels } from "@/components/PullRequestLabels";
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
  navigate: ReturnType<typeof useNavigate>;
  pullRequest: OpenPullRequestItem;
  repository: RepoRef;
  switchSource: SwitchSourceHandler;
}): Promise<void> {
  const {
    closeMenu,
    confirmDiscardDrafts,
    navigate,
    pullRequest,
    repository,
    switchSource,
  } = params;
  if (!confirmDiscardDrafts()) {
    return;
  }

  await switchSource(
    "pr",
    pullRequest.headRef,
    pullRequest.number,
    pullRequest.headSha
  );
  const changedBankPaths = collectChangedBankPaths(
    useSourceStore.getState().sourceChangedFiles
  );
  closeMenu();

  if (changedBankPaths.length === 1) {
    const [bankPath] = changedBankPaths;
    if (bankPath) {
      navigate(
        buildBankWorkspacePath({
          bankPath,
          repository,
          source: {
            type: "pr",
            prNumber: pullRequest.number,
            sha: pullRequest.headSha,
          },
        })
      );
      return;
    }
  }

  navigate("/workspace");
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
  t: (key: string) => string;
}) {
  const { currentRepoSlug, isFetching, isOpen, onSelect, options, t } = props;
  if (!isOpen) {
    return null;
  }

  return (
    <div className="source-nav__dropdown" style={{ minWidth: 320 }}>
      {isFetching && (
        <div className="source-nav__empty">{t("app.loading")}</div>
      )}
      {!isFetching &&
        options.map((repoOption) => {
          const repoSlug = `${repoOption.owner}/${repoOption.repo}`;
          return (
            <button
              className={`source-nav__option ${repoSlug === currentRepoSlug ? "source-nav__option--active" : ""}`}
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
  isFetching: boolean;
  isOpen: boolean;
  onMainSelect: () => void;
  onSourceQueryChange: (value: string) => void;
  onPullRequestSelect: (pr: OpenPullRequestItem) => void;
  pullRequests: OpenPullRequestItem[];
  sourceQuery: string;
  t: (key: string) => string;
}) {
  const {
    currentSource,
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

  return (
    <div className="source-nav__dropdown" style={{ minWidth: 420 }}>
      <div className="source-nav__search-wrap">
        <input
          aria-label={t("source.searchPR")}
          className="input"
          onChange={(event) => onSourceQueryChange(event.target.value)}
          placeholder={t("source.searchPR")}
          value={sourceQuery}
        />
      </div>
      <button
        className={`source-nav__option ${currentSource?.type === "branch" && currentSource.name === config.defaultBranch ? "source-nav__option--active" : ""}`}
        onClick={onMainSelect}
        type="button"
      >
        <span>{config.defaultBranch}</span>
      </button>

      {isFetching && (
        <div className="source-nav__empty">{t("app.loading")}</div>
      )}

      {!isFetching &&
        pullRequests.map((pr) => (
          <button
            className={`source-nav__option ${currentSource?.type === "pr" && currentSource.prNumber === pr.number ? "source-nav__option--active" : ""}`}
            key={pr.number}
            onClick={() => onPullRequestSelect(pr)}
            type="button"
          >
            <span className="text-muted text-sm">#{pr.number}</span>
            <span className="truncate text-sm">{pr.title}</span>
            <span className="badge badge--info">✓ {pr.approvedCount}</span>
          </button>
        ))}

      {!isFetching && pullRequests.length === 0 && (
        <div className="source-nav__empty">{t("bank.noResults")}</div>
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
  t: (key: string) => string;
}) {
  const { commits, currentSha, isFetching, isOpen, onCommitSelect, t } = props;
  if (!isOpen) {
    return null;
  }

  return (
    <div className="source-nav__dropdown" style={{ minWidth: 420 }}>
      {isFetching && (
        <div className="source-nav__empty">{t("app.loading")}</div>
      )}

      {!isFetching &&
        commits.map((commit) => {
          const isActive = commit.sha === currentSha;
          return (
            <button
              className={`source-nav__option ${isActive ? "source-nav__option--active" : ""}`}
              key={commit.sha}
              onClick={() => onCommitSelect(commit.sha)}
              type="button"
            >
              <span className="source-nav__commit-sha">
                {getShortSha(commit.sha)}
              </span>
              <span className="truncate text-sm">
                {commit.message || t("source.commitWithoutMessage")}
              </span>
            </button>
          );
        })}

      {!isFetching && commits.length === 0 && (
        <div className="source-nav__empty">{t("source.noCommits")}</div>
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
    <div className="source-nav" ref={ref}>
      {allowRepoSwitch && (
        <div className="source-nav__item">
          <button
            className="source-nav__label"
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
            className="format-row-link source-nav__external"
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
          <span className="source-nav__separator">/</span>
          <div className="source-nav__item">
            <button
              className="source-nav__label"
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
              className="format-row-link source-nav__external"
              href={sourceUrl}
              rel="noreferrer"
              target="_blank"
              title={sourceLabel}
            >
              ↗
            </a>
            <SourceDropdown
              currentSource={sourceRef}
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
              <span className="source-nav__separator">/</span>
              <div className="source-nav__item">
                <button
                  className="source-nav__label source-nav__label--hash"
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
                  className="source-nav__pr-labels"
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
