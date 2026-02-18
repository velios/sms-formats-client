import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { config } from "@/config";
import {
  useAvailableSourceRepos,
  useBranches,
  useOpenPRs,
  useStartableIssues,
  useSwitchRepository,
  useSwitchSource,
} from "@/hooks/useGitHub";
import { useSourceStore } from "@/store";

type Mode = "branch" | "pr" | "issue";

interface Props {
  allowRepoSwitch?: boolean;
}

function repoSlug(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function filterBranches(
  branches: Array<{ name: string }> | undefined,
  query: string
) {
  const normalized = query.toLowerCase();
  return (branches ?? []).filter((branch) =>
    branch.name.toLowerCase().includes(normalized)
  );
}

function filterPullRequests(
  prs:
    | Array<{
        number: number;
        title: string;
        headRef: string;
        headSha: string;
        headOwner: string;
        headRepo: string;
      }>
    | undefined,
  query: string
) {
  const normalized = query.toLowerCase();
  return (prs ?? []).filter(
    (pr) =>
      pr.title.toLowerCase().includes(normalized) ||
      `#${pr.number}`.includes(query)
  );
}

function filterIssues(
  issues:
    | Array<{ number: number; title: string; state: "open" | "closed" }>
    | undefined,
  query: string
) {
  const normalized = query.toLowerCase();
  return (issues ?? []).filter(
    (issue) =>
      issue.title.toLowerCase().includes(normalized) ||
      `#${issue.number}`.includes(query)
  );
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

function resolveModeItems(
  mode: Mode,
  filteredBranches: Array<{ name: string }>,
  filteredPRs: Array<{
    number: number;
    title: string;
    headRef: string;
    headOwner: string;
    headRepo: string;
  }>,
  filteredIssues: Array<{
    number: number;
    title: string;
    state: "open" | "closed";
  }>
) {
  if (mode === "branch") {
    return filteredBranches;
  }
  if (mode === "pr") {
    return filteredPRs;
  }
  return filteredIssues;
}

function resolveSearchPlaceholder(
  mode: Mode,
  t: (key: string) => string
): string {
  if (mode === "branch") {
    return t("source.searchBranch");
  }
  if (mode === "pr") {
    return t("source.searchPR");
  }
  return t("source.searchIssue");
}

function resolveNoItemsText(mode: Mode, t: (key: string) => string): string {
  return mode === "issue" ? t("source.noStartableIssues") : t("bank.noResults");
}

function resolveRefreshingState(
  mode: Mode,
  states: {
    isBranchesFetching: boolean;
    isPRsFetching: boolean;
    isIssuesFetching: boolean;
  }
): boolean {
  if (mode === "branch") {
    return states.isBranchesFetching;
  }
  if (mode === "pr") {
    return states.isPRsFetching;
  }
  return states.isIssuesFetching;
}

async function refreshModeData(
  mode: Mode,
  actions: {
    refetchBranches: () => Promise<unknown>;
    refetchPRs: () => Promise<unknown>;
    refetchIssues: () => Promise<unknown>;
  }
): Promise<void> {
  if (mode === "branch") {
    await actions.refetchBranches();
    return;
  }
  if (mode === "pr") {
    await actions.refetchPRs();
    return;
  }
  await actions.refetchIssues();
}

function renderItemsList(params: {
  mode: Mode;
  activeIndex: number;
  filteredBranches: Array<{ name: string }>;
  filteredPRs: Array<{
    number: number;
    title: string;
    headRef: string;
    headOwner: string;
    headRepo: string;
  }>;
  filteredIssues: Array<{
    number: number;
    title: string;
    state: "open" | "closed";
  }>;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
  t: (key: string) => string;
}) {
  const {
    mode,
    activeIndex,
    filteredBranches,
    filteredPRs,
    filteredIssues,
    onSelect,
    onHover,
    t,
  } = params;

  if (mode === "branch") {
    return filteredBranches.map((branch, index) => (
      <button
        aria-label={branch.name}
        className={`autocomplete__item ${index === activeIndex ? "autocomplete__item--active" : ""}`}
        key={branch.name}
        onClick={() => onSelect(index)}
        onFocus={() => onHover(index)}
        onMouseEnter={() => onHover(index)}
        type="button"
      >
        <span className="text-mono text-sm">{branch.name}</span>
      </button>
    ));
  }

  if (mode === "pr") {
    return filteredPRs.map((pr, index) => (
      <button
        aria-label={`#${pr.number} ${pr.title}`}
        className={`autocomplete__item ${index === activeIndex ? "autocomplete__item--active" : ""}`}
        key={pr.number}
        onClick={() => onSelect(index)}
        onFocus={() => onHover(index)}
        onMouseEnter={() => onHover(index)}
        type="button"
      >
        <span className="text-muted text-sm">#{pr.number}</span>
        <div className="flex-col" style={{ minWidth: 0 }}>
          <span className="truncate text-sm">{pr.title}</span>
          <span className="text-dim text-xs">
            {repoSlug(pr.headOwner, pr.headRepo)}:{pr.headRef}
          </span>
        </div>
      </button>
    ));
  }

  return filteredIssues.map((issue, index) => (
    <button
      aria-label={`#${issue.number} ${issue.title}`}
      className={`autocomplete__item ${index === activeIndex ? "autocomplete__item--active" : ""}`}
      key={issue.number}
      onClick={() => onSelect(index)}
      onFocus={() => onHover(index)}
      onMouseEnter={() => onHover(index)}
      type="button"
    >
      <span className="text-muted text-sm">#{issue.number}</span>
      <span className="truncate text-sm">{issue.title}</span>
      <span
        className={`badge ${issue.state === "open" ? "badge--success" : "badge--warning"}`}
      >
        {t(`source.issueState.${issue.state}`)}
      </span>
    </button>
  ));
}

export function SourceSelector({ allowRepoSwitch = false }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const repoSelectId = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("branch");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const switchSource = useSwitchSource();
  const switchRepository = useSwitchRepository();
  const repository = useSourceStore((s) => s.repository);

  const {
    data: branches,
    refetch: refetchBranches,
    isFetching: isBranchesFetching,
  } = useBranches(open && mode === "branch");
  const {
    data: prs,
    refetch: refetchPRs,
    isFetching: isPRsFetching,
  } = useOpenPRs(open && mode === "pr");
  const {
    data: issues,
    refetch: refetchIssues,
    isFetching: isIssuesFetching,
  } = useStartableIssues(open && mode === "issue");
  const { data: availableRepos, isFetching: isReposFetching } =
    useAvailableSourceRepos(open && allowRepoSwitch);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredBranches = filterBranches(branches, query);
  const filteredPRs = filterPullRequests(prs, query);
  const filteredIssues = filterIssues(issues, query);

  const items = resolveModeItems(
    mode,
    filteredBranches,
    filteredPRs,
    filteredIssues
  );
  const itemCount = items.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (itemCount === 0) {
      if (e.key === "Escape") {
        setOpen(false);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, itemCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && itemCount > 0) {
      e.preventDefault();
      void handleSelect(activeIndex);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const closeSelector = () => {
    setOpen(false);
    setQuery("");
  };

  const handleBranchSelect = async (index: number) => {
    const branch = filteredBranches[index];
    if (!branch) {
      return;
    }
    await switchSource("branch", branch.name);
    closeSelector();
  };

  const handlePRSelect = async (index: number) => {
    const pr = filteredPRs[index];
    if (!pr) {
      return;
    }

    await switchSource("pr", pr.headRef, pr.number, pr.headSha);
    const changedBankPaths = collectChangedBankPaths(
      useSourceStore.getState().sourceChangedFiles
    );
    if (changedBankPaths.length === 1) {
      const [bankPath] = changedBankPaths;
      if (bankPath) {
        navigate(`/bank/${encodeURIComponent(bankPath)}`);
      }
    } else {
      navigate("/workspace");
    }
    closeSelector();
  };

  const handleIssueSelect = (index: number) => {
    const issue = filteredIssues[index];
    if (!issue) {
      return;
    }
    try {
      sessionStorage.setItem("sms-game-selected-issue", JSON.stringify(issue));
    } catch {
      // ignore storage errors, fallback to network fetch on next screen
    }
    navigate(`/share-your-sms?stage=issue&issue=${issue.number}&autostart=1`);
    closeSelector();
  };

  const handleSelect = async (index: number) => {
    if (mode === "branch") {
      await handleBranchSelect(index);
      return;
    }

    if (mode === "pr") {
      await handlePRSelect(index);
      return;
    }

    handleIssueSelect(index);
  };

  const handleRepositoryChange = async (nextRepoSlug: string) => {
    const [owner, repo] = nextRepoSlug.split("/");
    if (!(owner && repo)) {
      return;
    }

    await switchRepository({ owner, repo });
    setMode("branch");
    setQuery("");
    setActiveIndex(0);
  };

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setQuery("");
    setActiveIndex(0);
  };

  const isRefreshing = resolveRefreshingState(mode, {
    isBranchesFetching,
    isPRsFetching,
    isIssuesFetching,
  });

  const refreshCurrentMode = async () => {
    setActiveIndex(0);
    await refreshModeData(mode, {
      refetchBranches,
      refetchPRs,
      refetchIssues,
    });
  };

  const searchPlaceholder = resolveSearchPlaceholder(mode, t);

  const noItemsText = resolveNoItemsText(mode, t);

  const repositoryOptions = availableRepos ?? [repository];
  const currentRepoSlug = repoSlug(repository.owner, repository.repo);
  const sourceRepoSlug = repoSlug(config.sourceOwner, config.sourceRepo);

  return (
    <div className="autocomplete" ref={ref}>
      <button className="btn btn--sm" onClick={() => setOpen(!open)}>
        {t("source.label")}
      </button>

      {open && (
        <div
          className="autocomplete__dropdown"
          style={{ width: "460px", right: 0, left: "auto" }}
        >
          <div
            className="flex items-center justify-between gap-sm"
            style={{
              padding: "8px",
              borderBottom: "1px solid var(--c-border)",
            }}
          >
            <div className="flex gap-xs">
              <button
                className={`tab ${mode === "branch" ? "tab--active" : ""}`}
                onClick={() => switchMode("branch")}
              >
                {t("source.branch")}
              </button>
              <button
                className={`tab ${mode === "pr" ? "tab--active" : ""}`}
                onClick={() => switchMode("pr")}
              >
                {t("source.pullRequest")}
              </button>
              <button
                className={`tab ${mode === "issue" ? "tab--active" : ""}`}
                onClick={() => switchMode("issue")}
              >
                {t("source.startIssue")}
              </button>
            </div>
            <button
              className="btn btn--sm"
              disabled={isRefreshing}
              onClick={() => {
                void refreshCurrentMode();
              }}
            >
              {isRefreshing ? t("app.loading") : t("source.refresh")}
            </button>
          </div>

          {allowRepoSwitch && (
            <div
              style={{
                padding: "8px",
                borderBottom: "1px solid var(--c-border)",
              }}
            >
              <label
                className="text-muted text-sm"
                htmlFor={repoSelectId}
                style={{ marginBottom: 6 }}
              >
                {t("source.repository")}
              </label>
              <select
                className="input"
                disabled={isReposFetching}
                id={repoSelectId}
                onChange={(e) => {
                  void handleRepositoryChange(e.target.value);
                }}
                value={currentRepoSlug}
              >
                {repositoryOptions.map((item) => {
                  const slug = repoSlug(item.owner, item.repo);
                  const labels: string[] = [];
                  if (slug === sourceRepoSlug) {
                    labels.push(t("source.repoSource"));
                  }
                  if (slug === currentRepoSlug) {
                    labels.push(t("source.repoSelected"));
                  }
                  const suffix =
                    labels.length > 0 ? ` (${labels.join(", ")})` : "";
                  return (
                    <option key={slug} value={slug}>
                      {slug}
                      {suffix}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div style={{ padding: "8px" }}>
            <input
              aria-label={searchPlaceholder}
              autoFocus
              className="input"
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              value={query}
            />
          </div>

          <div style={{ maxHeight: "260px", overflowY: "auto" }}>
            {renderItemsList({
              mode,
              activeIndex,
              filteredBranches,
              filteredPRs,
              filteredIssues,
              onSelect: (index) => {
                void handleSelect(index);
              },
              onHover: setActiveIndex,
              t,
            })}

            {itemCount === 0 && (
              <div className="autocomplete__item text-muted text-sm">
                {noItemsText}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
