import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { config } from "@/config";
import type { BankInfo } from "@/domain/types";
import { CreateBankModal } from "@/features/create-entity/CreateBankModal";
import { useRepoTree, useSwitchSource } from "@/hooks/useGitHub";
import { useDraftStore, useSourceStore } from "@/store";

// ─── Recent banks persistence ───
const RECENT_BANKS_KEY = "sms-formats-recent-banks";
const MAX_RECENT_BANKS = 10;

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
  const [showCreateBank, setShowCreateBank] = useState(false);
  const [banksTab, setBanksTab] = useState<"all" | "recent">("all");
  const [reloadAttemptKey, setReloadAttemptKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    (bank: BankInfo) => {
      addRecentBank(bank.folderPath);
      const encodedPath = encodeURIComponent(bank.folderPath);
      navigate(`/bank/${encodedPath}`);
    },
    [navigate]
  );

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
        handleSelect(bank);
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
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      <div className="mb-md flex items-center justify-between">
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>{t("app.title")}</h2>
        <div className="flex items-center gap-sm">
          <button
            className="btn btn--sm"
            onClick={() => navigate("/share-your-sms")}
          >
            {t("smsGame.openPage")}
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={() => setShowCreateBank(true)}
          >
            + {t("bank.createBank")}
          </button>
        </div>
      </div>

      <div className="panel">
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
        <div style={{ maxHeight: "calc(100vh - 320px)", overflowY: "auto" }}>
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
                onClick={() => handleSelect(bank)}
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

      {showCreateBank && (
        <CreateBankModal onClose={() => setShowCreateBank(false)} />
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
      onMouseEnter={onMouseEnter}
      style={{ padding: "10px 16px" }}
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
