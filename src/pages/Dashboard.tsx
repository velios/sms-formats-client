import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ModalDialog } from "@/components/ModalDialog";
import { PullRequestLabels } from "@/components/PullRequestLabels";
import { config } from "@/config";
import { buildBankWorkspacePath } from "@/domain/bank-route";
import { fetchPullRequestValidationDetails } from "@/domain/github";
import type { BankInfo, PullRequestLabel } from "@/domain/types";
import { useOpenPRs, useRepoTree, useSwitchSource } from "@/hooks/useGitHub";
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

export function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const sourceChangedFiles = useSourceStore((s) => s.sourceChangedFiles);
  const repository = useSourceStore((s) => s.repository);
  const banks = useSourceStore((s) => s.banks);
  const switchSource = useSwitchSource();
  const draftStore = useDraftStore();
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
    [navigate, repository, sourceRef?.name, sourceRef?.type, switchSource]
  );

  const handlePRSelect = useCallback(
    async (pr: { number: number; headRef: string; headSha: string }) => {
      addRecentPR(repoSlug, pr.number);
      await switchSource("pr", pr.headRef, pr.number, pr.headSha);
      const changedBankPaths = collectChangedBankPaths(
        useSourceStore.getState().sourceChangedFiles
      );
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
    },
    [navigate, repoSlug, repository, switchSource]
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
      <div className="flex items-center gap-sm">
        <span className="spinner" />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="badge badge--error">
        {t("app.error")}: {String(error)}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <div className="dashboard-grid">
        <div className="panel dashboard-panel">
          <div className="panel__header">
            {t("source.pullRequest")} · {sortedPRs.length}
          </div>
          <div className="tabs">
            <button
              className={`tab ${prTab === "all" ? "tab--active" : ""}`}
              onClick={() => setPrTab("all")}
            >
              {t("source.pullRequest")}
            </button>
            <button
              className={`tab ${prTab === "recent" ? "tab--active" : ""}`}
              onClick={() => setPrTab("recent")}
            >
              {t("source.recentPullRequests", { defaultValue: "Recent PR" })}
            </button>
          </div>
          <div className="dashboard-panel__list">
            {isPRsLoading ? (
              <div className="p-md text-muted">{t("app.loading")}</div>
            ) : visiblePRs.length === 0 ? (
              <div className="p-md text-muted">{t("bank.noResults")}</div>
            ) : (
              visiblePRs.map((pr) => {
                const isActive =
                  sourceRef?.type === "pr" && sourceRef.prNumber === pr.number;
                const prUrl = `https://github.com/${repository.owner}/${repository.repo}/pull/${pr.number}`;
                const validationErrorsTitle = t(
                  "source.validatorErrorsClickable",
                  {
                    defaultValue:
                      "Нажмите, чтобы открыть детали ошибок валидатора",
                  }
                );
                return (
                  <div
                    className={`autocomplete__item ${isActive ? "autocomplete__item--active" : ""}`}
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
                    <span className="text-muted text-sm">#{pr.number}</span>
                    <div
                      className="flex-col gap-xs"
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <span className="truncate text-sm">{pr.title}</span>
                      <span className="text-dim text-xs">{pr.headRef}</span>
                    </div>
                    <PullRequestLabels
                      className="dashboard-pr-labels"
                      labels={pr.labels}
                    />
                    <span className="badge badge--info">
                      ✓ {pr.approvedCount}
                    </span>
                    {pr.failedValidationCount > 0 && (
                      <span
                        className="badge badge--error badge--interactive"
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
                      >
                        ✗ {pr.failedValidationCount}
                      </span>
                    )}
                    <a
                      aria-label={`PR #${pr.number}`}
                      className="format-row-link"
                      href={prUrl}
                      onClick={(event) => event.stopPropagation()}
                      rel="noreferrer"
                      target="_blank"
                      title={prUrl}
                    >
                      ↗
                    </a>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="panel dashboard-panel">
          <div className="panel__header">
            {t("bank.banks")} · {banks.length}
          </div>
          <div className="tabs">
            <button
              className={`tab ${banksTab === "all" ? "tab--active" : ""}`}
              onClick={() => setBanksTab("all")}
            >
              {t("bank.banks")}
            </button>
            <button
              className={`tab ${banksTab === "recent" ? "tab--active" : ""}`}
              onClick={() => setBanksTab("recent")}
            >
              {t("bank.recentBanks")}
            </button>
          </div>
          {banksTab === "all" && (
            <div
              style={{
                padding: "8px",
                borderBottom: "1px solid var(--c-border)",
              }}
            >
              <div className="autocomplete">
                <input
                  aria-label={t("bank.search")}
                  autoFocus
                  className="input"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("bank.search")}
                  ref={inputRef}
                  value={query}
                />
              </div>
            </div>
          )}
          <div className="dashboard-panel__list">
            {visibleBanks.length === 0 ? (
              <div className="p-md text-muted">{t("bank.noResults")}</div>
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
          className="validation-details-modal"
          onClose={() => {
            setValidationDetailsModal(null);
            setValidationDetailsError(null);
          }}
          title={t("source.validatorErrorsTitle", {
            defaultValue: "Ошибки валидатора",
          })}
          titleId={validationDetailsTitleId}
        >
          <div className="text-muted text-sm">
            PR #{validationDetailsModal.prNumber} ·{" "}
            {validationDetailsModal.prTitle}
          </div>
          <pre className="validation-details-modal__content">
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
            <div className="badge badge--error">{validationDetailsError}</div>
          )}
          <div className="modal__actions">
            <button
              className="btn btn--primary"
              disabled={isValidationDetailsLoading}
              onClick={handleRetryValidationDetails}
              type="button"
            >
              {isValidationDetailsLoading
                ? t("source.loadingValidationResult", {
                    defaultValue: "Загружаем...",
                  })
                : t("source.loadValidationResult", {
                    defaultValue: "Попробовать снова",
                  })}
            </button>
            <a
              className="btn"
              href={validationDetailsModal.checksUrl}
              rel="noreferrer"
              target="_blank"
            >
              {t("source.openValidatorChecks", {
                defaultValue: "Открыть checks",
              })}
            </a>
            <button
              className="btn"
              onClick={() => {
                setValidationDetailsModal(null);
                setValidationDetailsError(null);
              }}
              type="button"
            >
              {t("app.close")}
            </button>
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
      className={`autocomplete__item ${isActive ? "autocomplete__item--active" : ""}`}
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
      style={{ padding: "10px 16px" }}
      tabIndex={0}
    >
      <div className="flex-col gap-xs" style={{ flex: 1 }}>
        <div className="flex items-center gap-sm">
          <span className="font-medium">{bank.displayName}</span>
          {bank.bankId && (
            <span className="text-dim text-sm">#{bank.bankId}</span>
          )}
          {hasChanges && <span className="badge badge--modified">●</span>}
        </div>
        <div className="text-muted text-sm">
          {bank.formatFiles.length} format(s)
          {!bank.hasSenders && (
            <span
              className="badge badge--warning ml-sm"
              style={{ marginLeft: 8 }}
            >
              no senders
            </span>
          )}
        </div>
        {hasChanges && (
          <div className="text-dim text-sm">
            {changedLabels.join(", ")}
            {extraChangedCount > 0 && ` +${extraChangedCount}`}
          </div>
        )}
      </div>
      <a
        aria-label={`${openInRepoLabel}: ${bank.displayName}`}
        className="format-row-link"
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
