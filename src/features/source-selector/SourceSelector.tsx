import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  useAvailableSourceRepos,
  useOpenPRs,
  useSwitchRepository,
} from "@/hooks/useGitHub";
import {
  getPullRequestGitHubUrl,
  getPullRequestWorkspacePath,
} from "@/lib/pull-request-navigation";
import { cn } from "@/lib/utils";
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
}

const sourceNavDropdownClassName =
  "absolute top-[calc(100%+6px)] left-0 z-[120] max-h-[min(420px,calc(100vh-120px))] overflow-y-auto rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)] shadow-[var(--shadow-md)]";

const sourceNavOptionClassName = (isActive: boolean) =>
  cn(
    "flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left transition-colors",
    isActive
      ? "bg-[color:var(--c-bg-hover)] text-[color:var(--c-accent)]"
      : "hover:bg-[color:var(--c-bg-hover)]"
  );

const sourceNavLabelClassName =
  "max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap bg-transparent p-0 text-left text-[color:var(--c-text)] hover:text-[color:var(--c-accent)]";

const sourceNavExternalLinkClassName =
  "ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-[color:var(--c-text-dim)] no-underline hover:bg-[color:var(--c-accent-soft)] hover:text-[color:var(--c-accent)] hover:no-underline";

function sortPRs(prs: OpenPullRequestItem[] | undefined) {
  return [...(prs ?? [])].sort((a, b) => b.number - a.number);
}

function getRoutePullRequestNumber(pathname: string): number | null {
  const match = pathname.match(/\/pr\/(\d+)(?:\/|$)/);
  if (!match?.[1]) {
    return null;
  }
  const prNumber = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(prNumber) && prNumber > 0 ? prNumber : null;
}

export function SourceSelector({ allowRepoSwitch = false }: Props) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const repository = useSourceStore((state) => state.repository);
  const sourceRef = useSourceStore((state) => state.sourceRef);
  const switchRepository = useSwitchRepository();
  const isHome = location.pathname === "/";
  const routePrNumber = getRoutePullRequestNumber(location.pathname);

  const { data: availableRepos = [], isFetching: isReposFetching } =
    useAvailableSourceRepos(openMenu === "repo" && allowRepoSwitch);
  const { data: openPRs = [], isFetching: isPRsFetching } = useOpenPRs(
    openMenu === "source" && !isHome
  );

  const sortedPRs = useMemo(() => sortPRs(openPRs), [openPRs]);
  const repositoryUrl = `https://github.com/${repository.owner}/${repository.repo}`;
  const repositoryLabel = `${repository.owner}/${repository.repo}`;
  const activePrNumber =
    sourceRef?.type === "pr" && sourceRef.prNumber
      ? sourceRef.prNumber
      : routePrNumber;
  const sourceLabel = activePrNumber
    ? `PR #${activePrNumber}`
    : t("source.pullRequest", { defaultValue: "PR" });
  const sourceUrl = activePrNumber
    ? getPullRequestGitHubUrl(activePrNumber, repository)
    : repositoryUrl;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const closeMenu = () => {
    setOpenMenu(null);
  };

  const repositoryOptions =
    availableRepos.length > 0 ? availableRepos : [repository];
  const currentRepositorySlug = `${repository.owner}/${repository.repo}`;

  return (
    <div className="relative flex min-w-0 items-center gap-2" ref={ref}>
      {allowRepoSwitch && (
        <div className="relative flex min-w-0 items-center gap-1">
          <button
            className={sourceNavLabelClassName}
            onClick={() =>
              setOpenMenu((current) => (current === "repo" ? null : "repo"))
            }
            title={repositoryLabel}
            type="button"
          >
            {repositoryLabel}
          </button>
          <a
            aria-label={repositoryLabel}
            className={sourceNavExternalLinkClassName}
            href={repositoryUrl}
            rel="noreferrer"
            target="_blank"
            title={repositoryLabel}
          >
            ↗
          </a>

          {openMenu === "repo" && (
            <div
              className={sourceNavDropdownClassName}
              style={{ minWidth: 320 }}
            >
              {isReposFetching && (
                <div className="px-3 py-2 text-[color:var(--c-text-muted)] text-sm">
                  {t("app.loading")}
                </div>
              )}
              {!isReposFetching &&
                repositoryOptions.map((repoRef) => {
                  const repoSlug = `${repoRef.owner}/${repoRef.repo}`;
                  return (
                    <button
                      className={sourceNavOptionClassName(
                        repoSlug === currentRepositorySlug
                      )}
                      key={repoSlug}
                      onClick={() => {
                        void switchRepository(repoRef).then(() => {
                          closeMenu();
                          navigate("/");
                        });
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
          <span className="mr-0.5 text-[color:var(--c-text-dim)]">/</span>
          <div className="relative flex min-w-0 items-center gap-1">
            <button
              className={sourceNavLabelClassName}
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

            {openMenu === "source" && (
              <div
                className={sourceNavDropdownClassName}
                style={{ minWidth: 420 }}
              >
                {isPRsFetching && (
                  <div className="px-3 py-2 text-[color:var(--c-text-muted)] text-sm">
                    {t("app.loading")}
                  </div>
                )}
                {!isPRsFetching &&
                  sortedPRs.map((pullRequest) => (
                    <button
                      className={sourceNavOptionClassName(
                        pullRequest.number === activePrNumber
                      )}
                      key={pullRequest.number}
                      onClick={() => {
                        closeMenu();
                        navigate(
                          getPullRequestWorkspacePath({
                            repository,
                            prNumber: pullRequest.number,
                          })
                        );
                      }}
                      type="button"
                    >
                      <span className="text-[color:var(--c-text-muted)] text-sm">
                        #{pullRequest.number}
                      </span>
                      <span className="truncate text-sm">
                        {pullRequest.title}
                      </span>
                    </button>
                  ))}
                {!isPRsFetching && sortedPRs.length === 0 && (
                  <div className="px-3 py-2 text-[color:var(--c-text-muted)] text-sm">
                    {t("bank.noResults")}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
