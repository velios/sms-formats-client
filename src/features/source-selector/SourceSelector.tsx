import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { PullRequestLabels } from "@/components/PullRequestLabels";
import { config } from "@/config";
import { buildBankWorkspacePath } from "@/domain/bank-route";
import type { PullRequestLabel } from "@/domain/types";
import {
  useAvailableSourceRepos,
  useOpenPRs,
  useSwitchRepository,
  useSwitchSource,
} from "@/hooks/useGitHub";
import { useSourceStore } from "@/store";

type OpenMenu = "repo" | "source" | null;

interface Props {
  allowRepoSwitch?: boolean;
}

interface OpenPullRequestItem {
  number: number;
  title: string;
  headRef: string;
  headSha: string;
  approvedCount: number;
  labels: PullRequestLabel[];
}

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

export function SourceSelector({ allowRepoSwitch = false }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [sourceQuery, setSourceQuery] = useState("");
  const repository = useSourceStore((s) => s.repository);
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const switchSource = useSwitchSource();
  const switchRepository = useSwitchRepository();
  const isHome = location.pathname === "/";

  const { data: availableRepos = [], isFetching: isReposFetching } =
    useAvailableSourceRepos(openMenu === "repo" && allowRepoSwitch);
  const { data: openPRs = [], isFetching: isPRsFetching } = useOpenPRs(
    openMenu === "source" || sourceRef?.type === "pr"
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

  const handleRepositoryChange = async (repoSlug: string) => {
    const [owner, repo] = repoSlug.split("/");
    if (!(owner && repo)) {
      return;
    }

    await switchRepository({ owner, repo });
    closeMenu();
    navigate("/");
  };

  const handleMainSelect = async () => {
    await switchSource("branch", config.defaultBranch);
    closeMenu();
    navigate("/workspace");
  };

  const handlePRSelect = async (pr: {
    number: number;
    headRef: string;
    headSha: string;
  }) => {
    await switchSource("pr", pr.headRef, pr.number, pr.headSha);
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
            source: { type: "pr", prNumber: pr.number },
          })
        );
        return;
      }
    }
    navigate("/workspace");
  };

  const repositoryOptions =
    availableRepos.length > 0 ? availableRepos : [repository];
  const currentRepoSlug = `${repository.owner}/${repository.repo}`;

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

          {openMenu === "repo" && (
            <div className="source-nav__dropdown" style={{ minWidth: 320 }}>
              {isReposFetching && (
                <div className="source-nav__empty">{t("app.loading")}</div>
              )}
              {!isReposFetching &&
                repositoryOptions.map((repoOption) => {
                  const repoSlug = `${repoOption.owner}/${repoOption.repo}`;
                  return (
                    <button
                      className={`source-nav__option ${repoSlug === currentRepoSlug ? "source-nav__option--active" : ""}`}
                      key={repoSlug}
                      onClick={() => {
                        void handleRepositoryChange(repoSlug);
                      }}
                      type="button"
                    >
                      {repoSlug}
                    </button>
                  );
                })}
            </div>
          )}
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
            <PullRequestLabels
              className="source-nav__pr-labels"
              labels={activePullRequest?.labels ?? []}
            />

            {openMenu === "source" && (
              <div className="source-nav__dropdown" style={{ minWidth: 420 }}>
                <div className="source-nav__search-wrap">
                  <input
                    aria-label={t("source.searchPR")}
                    className="input"
                    onChange={(event) => setSourceQuery(event.target.value)}
                    placeholder={t("source.searchPR")}
                    value={sourceQuery}
                  />
                </div>
                <button
                  className={`source-nav__option ${sourceRef?.type === "branch" && sourceRef.name === config.defaultBranch ? "source-nav__option--active" : ""}`}
                  onClick={() => {
                    void handleMainSelect();
                  }}
                  type="button"
                >
                  <span>{config.defaultBranch}</span>
                </button>

                {isPRsFetching && (
                  <div className="source-nav__empty">{t("app.loading")}</div>
                )}

                {!isPRsFetching &&
                  filteredPRs.map((pr) => (
                    <button
                      className={`source-nav__option ${sourceRef?.type === "pr" && sourceRef.prNumber === pr.number ? "source-nav__option--active" : ""}`}
                      key={pr.number}
                      onClick={() => {
                        void handlePRSelect(pr);
                      }}
                      type="button"
                    >
                      <span className="text-muted text-sm">#{pr.number}</span>
                      <span className="truncate text-sm">{pr.title}</span>
                      <span className="badge badge--info">
                        ✓ {pr.approvedCount}
                      </span>
                    </button>
                  ))}

                {!isPRsFetching && filteredPRs.length === 0 && (
                  <div className="source-nav__empty">{t("bank.noResults")}</div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
