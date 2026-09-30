import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { buildPullRequestWorkspacePath } from "@/domain/bank-route";
import {
  useAvailableSourceRepos,
  useOpenPRs,
  useSwitchRepository,
} from "@/hooks/useGitHub";
import {
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
  subscribeGitHubAuthChange,
} from "@/infrastructure/github";
import { getPullRequestGitHubUrl } from "@/lib/pull-request-navigation";
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
}

const sourceNavDropdownClassName =
  "z-[120] max-h-[min(420px,calc(100vh-120px))] overflow-y-auto rounded-md border border-border bg-card shadow-[var(--shadow-md)]";

const sourceNavOptionClassName = (isActive: boolean) =>
  cn(
    "ui-panel-inset flex w-full items-center gap-2 bg-transparent py-2 text-left transition-colors",
    isActive
      ? "bg-accent text-primary"
      : "outline-none hover:bg-accent data-highlighted:bg-accent"
  );

const sourceNavLabelClassName =
  "max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap bg-transparent p-0 text-left text-foreground hover:text-primary";

const sourceNavExternalLinkClassName =
  "ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-muted-foreground no-underline hover:bg-primary-soft hover:text-primary hover:no-underline";

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
  useSyncExternalStore(
    subscribeGitHubAuthChange,
    getGitHubAuthChangeVersion,
    getGitHubAuthChangeVersion
  );
  const hasToken = Boolean(getGitHubUserToken());
  const location = useLocation();
  const navigate = useNavigate();
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const repository = useSourceStore((state) => state.repository);
  const sourceRef = useSourceStore((state) => state.sourceRef);
  const switchRepository = useSwitchRepository();
  const isHome = location.pathname === "/";
  const routePrNumber = getRoutePullRequestNumber(location.pathname);

  const { data: availableRepos = [], isFetching: isReposFetching } =
    useAvailableSourceRepos(openMenu === "repo" && allowRepoSwitch && hasToken);
  const { data: openPRs = [], isFetching: isPRsFetching } = useOpenPRs(
    openMenu === "source" && !isHome && hasToken
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
    : location.pathname.includes("/main")
      ? "main"
      : t("source.pullRequest", { defaultValue: "PR" });
  const sourceUrl = activePrNumber
    ? getPullRequestGitHubUrl(activePrNumber, repository)
    : repositoryUrl;

  const closeMenu = () => {
    setOpenMenu(null);
  };

  const repositoryOptions =
    availableRepos.length > 0 ? availableRepos : [repository];
  const currentRepositorySlug = `${repository.owner}/${repository.repo}`;

  return (
    <div className="relative flex min-w-0 items-center gap-2">
      {allowRepoSwitch && (
        <div className="relative flex min-w-0 items-center gap-1">
          <DropdownMenu.Root
            onOpenChange={(open) => setOpenMenu(open ? "repo" : null)}
            open={hasToken && openMenu === "repo"}
          >
            <DropdownMenu.Trigger asChild>
              <button
                className={sourceNavLabelClassName}
                title={repositoryLabel}
                type="button"
              >
                {repositoryLabel}
              </button>
            </DropdownMenu.Trigger>
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

            <DropdownMenu.Content
              align="start"
              className={sourceNavDropdownClassName}
              sideOffset={6}
              style={{ minWidth: 320 }}
            >
              {isReposFetching && (
                <div className="ui-panel-inset py-2 text-muted-foreground text-sm">
                  {t("app.loading")}
                </div>
              )}
              {!isReposFetching &&
                repositoryOptions.map((repoRef) => {
                  const repoSlug = `${repoRef.owner}/${repoRef.repo}`;
                  return (
                    <DropdownMenu.Item asChild key={repoSlug}>
                      <button
                        className={sourceNavOptionClassName(
                          repoSlug === currentRepositorySlug
                        )}
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
                    </DropdownMenu.Item>
                  );
                })}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      )}

      {!isHome && (
        <>
          <span className="mr-0.5 text-muted-foreground">/</span>
          <div className="relative flex min-w-0 items-center gap-1">
            <DropdownMenu.Root
              onOpenChange={(open) => setOpenMenu(open ? "source" : null)}
              open={hasToken && openMenu === "source"}
            >
              <DropdownMenu.Trigger asChild>
                <button
                  className={sourceNavLabelClassName}
                  title={sourceLabel}
                  type="button"
                >
                  {sourceLabel}
                </button>
              </DropdownMenu.Trigger>
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

              <DropdownMenu.Content
                align="start"
                className={sourceNavDropdownClassName}
                sideOffset={6}
                style={{ minWidth: 420 }}
              >
                <DropdownMenu.Item asChild>
                  <button
                    className={sourceNavOptionClassName(!activePrNumber)}
                    onClick={() => {
                      closeMenu();
                      navigate(
                        `/repo/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/main${location.search}`
                      );
                    }}
                    type="button"
                  >
                    main
                  </button>
                </DropdownMenu.Item>
                {isPRsFetching && (
                  <div className="ui-panel-inset py-2 text-muted-foreground text-sm">
                    {t("app.loading")}
                  </div>
                )}
                {!isPRsFetching &&
                  sortedPRs.map((pullRequest) => (
                    <DropdownMenu.Item asChild key={pullRequest.number}>
                      <button
                        className={sourceNavOptionClassName(
                          pullRequest.number === activePrNumber
                        )}
                        onClick={() => {
                          closeMenu();
                          navigate(
                            buildPullRequestWorkspacePath({
                              repository,
                              prNumber: pullRequest.number,
                            })
                          );
                        }}
                        type="button"
                      >
                        <span className="text-muted-foreground text-sm">
                          #{pullRequest.number}
                        </span>
                        <span className="truncate text-sm">
                          {pullRequest.title}
                        </span>
                      </button>
                    </DropdownMenu.Item>
                  ))}
                {!isPRsFetching && sortedPRs.length === 0 && (
                  <div className="ui-panel-inset py-2 text-muted-foreground text-sm">
                    {t("bank.noResults")}
                  </div>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </>
      )}
    </div>
  );
}
