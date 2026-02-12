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
  const banks = useSourceStore((s) => s.banks);
  const switchSource = useSwitchSource();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [showCreateBank, setShowCreateBank] = useState(false);
  const [banksTab, setBanksTab] = useState<"all" | "recent">("all");
  const [reloadAttemptKey, setReloadAttemptKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load tree when source is set
  const { isLoading, error } = useRepoTree(sourceRef?.sha);

  const filtered = useMemo(() => {
    if (!query) {
      return banks;
    }
    const q = query.toLowerCase();
    return banks.filter(
      (b) =>
        b.displayName.toLowerCase().includes(q) ||
        b.bankId?.includes(q) ||
        b.folderPath.toLowerCase().includes(q)
    );
  }, [banks, query]);

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
                isActive={banksTab === "all" && i === activeIndex}
                key={bank.folderPath}
                onClick={() => handleSelect(bank)}
                onMouseEnter={() => {
                  if (banksTab === "all") {
                    setActiveIndex(i);
                  }
                }}
                openInRepoLabel={t("bank.openBankFolderInRepo")}
                sourceRefName={sourceRef?.name ?? config.defaultBranch}
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
  sourceRefName,
  openInRepoLabel,
  isActive,
  onClick,
  onMouseEnter,
}: {
  bank: BankInfo;
  sourceRefName: string;
  openInRepoLabel: string;
  isActive: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  const draftStore = useDraftStore();
  const hasLocalChanges = bank.formatFiles.some((f) => {
    const draft = draftStore.getDraft(f);
    return draft && draft.content !== draft.remoteContent;
  });
  const encodedFolderPath = bank.folderPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const repoUrl = `https://github.com/${config.owner}/${config.repo}/tree/${encodeURIComponent(sourceRefName)}/${encodedFolderPath}`;

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
          {hasLocalChanges && <span className="badge badge--modified">●</span>}
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
