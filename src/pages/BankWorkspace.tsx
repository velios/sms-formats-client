import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { config } from "@/config";
import { CreateFormatModal } from "@/features/create-entity/CreateFormatModal";
import { FormatEditor } from "@/features/format-editor/FormatEditor";
import { PublishPanel } from "@/features/publish-panel/PublishPanel";
import { RefreshButton } from "@/features/refresh/RefreshButton";
import { SendersEditor } from "@/features/senders-editor/SendersEditor";
import { ValidationPanel } from "@/features/validation/ValidationPanel";
import { useDraftStore, useSourceStore } from "@/store";

// ─── Recent formats persistence ───
const RECENT_FORMATS_KEY = "sms-formats-recent-formats";
const MAX_RECENT_FORMATS = 10;

function getRecentFormats(bankPath: string): string[] {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_FORMATS_KEY) ?? "{}");
    return (data[bankPath] ?? []) as string[];
  } catch {
    return [];
  }
}

function addRecentFormat(bankPath: string, filePath: string) {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_FORMATS_KEY) ?? "{}");
    const list: string[] = data[bankPath] ?? [];
    const filtered = list.filter((f: string) => f !== filePath);
    filtered.unshift(filePath);
    data[bankPath] = filtered.slice(0, MAX_RECENT_FORMATS);
    localStorage.setItem(RECENT_FORMATS_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function replaceRecentFormat(
  bankPath: string,
  oldPath: string,
  newPath: string
) {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_FORMATS_KEY) ?? "{}");
    const list: string[] = data[bankPath] ?? [];
    const replaced = list.map((path: string) =>
      path === oldPath ? newPath : path
    );
    const deduped = Array.from(new Set(replaced));
    data[bankPath] = deduped.slice(0, MAX_RECENT_FORMATS);
    localStorage.setItem(RECENT_FORMATS_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function BankWorkspace() {
  const { t } = useTranslation();
  const { bankPath: encodedBankPath } = useParams();
  const [searchParams] = useSearchParams();
  const bankPath = decodeURIComponent(encodedBankPath ?? "");
  const requestedFile = useMemo(() => {
    const rawValue = searchParams.get("file");
    if (!rawValue) {
      return null;
    }
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }, [searchParams]);

  const banks = useSourceStore((s) => s.banks);
  const setBanks = useSourceStore((s) => s.setBanks);
  const sourceRef = useSourceStore((s) => s.sourceRef);

  const bank = useMemo(
    () => banks.find((b) => b.folderPath === bankPath),
    [banks, bankPath]
  );

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showSenders, setShowSenders] = useState(false);
  const [showCreateFormat, setShowCreateFormat] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [formatSearch, setFormatSearch] = useState("");
  const [formatTab, setFormatTab] = useState<"all" | "recent">("all");

  // Get all format files including draft-only (new) files
  const draftStore = useDraftStore();
  const allFormatFiles = useMemo(() => {
    const remoteFiles = new Set(bank?.formatFiles ?? []);
    const draftFiles = new Set<string>();
    for (const [path] of draftStore.drafts) {
      if (path.startsWith(`${bankPath}/formats/`) && path.endsWith(".txt")) {
        draftFiles.add(path);
      }
    }
    return Array.from(new Set([...remoteFiles, ...draftFiles])).sort((a, b) => {
      const aName = a.split("/").pop() ?? a;
      const bName = b.split("/").pop() ?? b;
      return aName.localeCompare(bName, undefined, { sensitivity: "base" });
    });
  }, [bank, bankPath, draftStore.drafts]);

  // Filtered format files by search
  const filteredFormatFiles = useMemo(() => {
    if (!formatSearch) {
      return allFormatFiles;
    }
    const q = formatSearch.toLowerCase();
    return allFormatFiles.filter((f) => {
      const name = f.split("/").pop() ?? f;
      return name.toLowerCase().includes(q);
    });
  }, [allFormatFiles, formatSearch]);

  // Recent formats
  const recentFormats = useMemo(() => {
    const recent = getRecentFormats(bankPath);
    return recent.filter((f) => allFormatFiles.includes(f));
  }, [bankPath, allFormatFiles]);

  // Auto-select first file
  useEffect(() => {
    if (!requestedFile) {
      return;
    }
    if (!allFormatFiles.includes(requestedFile)) {
      return;
    }
    if (selectedFile === requestedFile) {
      return;
    }
    setSelectedFile(requestedFile);
    setShowSenders(false);
  }, [requestedFile, allFormatFiles, selectedFile]);

  // Auto-select first file
  useEffect(() => {
    if (!selectedFile && allFormatFiles.length > 0) {
      setSelectedFile(allFormatFiles[0]!);
    }
  }, [allFormatFiles, selectedFile]);

  const handleSelectFile = useCallback(
    (f: string) => {
      setSelectedFile(f);
      setShowSenders(false);
      addRecentFormat(bankPath, f);
    },
    [bankPath]
  );

  const handleRenameFile = useCallback(
    (fromPath: string, toPath: string): boolean => {
      if (fromPath === toPath) {
        return true;
      }
      if (
        !(toPath.startsWith(`${bankPath}/formats/`) && toPath.endsWith(".txt"))
      ) {
        return false;
      }
      if (allFormatFiles.includes(toPath)) {
        return false;
      }

      const draft = draftStore.getDraft(fromPath);
      if (!draft || draft.remoteContent !== "") {
        return false;
      }

      draftStore.renameDraft(fromPath, toPath);
      replaceRecentFormat(bankPath, fromPath, toPath);

      const currentBanks = useSourceStore.getState().banks;
      const nextBanks = currentBanks.map((item) => {
        if (item.folderPath !== bankPath) {
          return item;
        }
        if (!item.formatFiles.includes(fromPath)) {
          return item;
        }
        const renamedFormatFiles = item.formatFiles.map((path) =>
          path === fromPath ? toPath : path
        );
        return {
          ...item,
          formatFiles: Array.from(new Set(renamedFormatFiles)),
        };
      });
      setBanks(nextBanks);

      if (selectedFile === fromPath) {
        setSelectedFile(toPath);
      }
      return true;
    },
    [allFormatFiles, bankPath, draftStore, selectedFile, setBanks]
  );

  if (!bank && allFormatFiles.length === 0) {
    return (
      <div className="flex-col gap-md">
        <div className="text-muted">
          {t("bank.noResults")}: {bankPath}
        </div>
      </div>
    );
  }

  const sendersPath = `${bankPath}/senders.txt`;
  const displayName = bank?.displayName ?? bankPath.replace("src/", "");
  const refName = sourceRef?.name ?? config.defaultBranch;
  const encodedBankPathSegments = bankPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const bankRepoUrl = `https://github.com/${config.owner}/${config.repo}/tree/${encodeURIComponent(refName)}/${encodedBankPathSegments}`;
  const visibleFormats =
    formatTab === "recent" ? recentFormats : filteredFormatFiles;

  return (
    <div className="grid-sidebar">
      {/* ─── Sidebar ─── */}
      <div className="bank-workspace__sidebar flex-col gap-md">
        <div className="flex items-center gap-sm">
          <h2 className="truncate font-semibold" style={{ fontSize: 16 }}>
            {displayName}
          </h2>
          <a
            aria-label={t("bank.openBankFolderInRepo")}
            className="format-row-link"
            href={bankRepoUrl}
            rel="noreferrer"
            target="_blank"
            title={t("bank.openBankFolderInRepo")}
          >
            ↗
          </a>
        </div>

        {/* Action bar */}
        <div className="flex-col gap-xs">
          <RefreshButton bankPath={bankPath} />
          <button
            className="btn btn--sm w-full"
            onClick={() => setShowValidation(true)}
          >
            {t("validation.runValidation")}
          </button>
          <button
            className="btn btn--primary btn--sm w-full"
            onClick={() => setShowPublish(true)}
          >
            {t("publish.createPR")}
          </button>
        </div>

        {/* Formats and recent list */}
        <div className="panel">
          <div className="panel__header">
            {t("bank.formats")}
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => setShowCreateFormat(true)}
            >
              +
            </button>
          </div>
          <div className="tabs">
            <button
              className={`tab ${formatTab === "all" ? "tab--active" : ""}`}
              onClick={() => setFormatTab("all")}
            >
              {t("bank.formats")}
            </button>
            <button
              className={`tab ${formatTab === "recent" ? "tab--active" : ""}`}
              onClick={() => setFormatTab("recent")}
            >
              {t("bank.recentFormats")}
            </button>
          </div>
          {formatTab === "all" && (
            <div
              style={{
                padding: "8px",
                borderBottom: "1px solid var(--c-border)",
              }}
            >
              <input
                className="input"
                onChange={(e) => setFormatSearch(e.target.value)}
                placeholder={t("bank.searchFormat")}
                style={{ fontSize: 12, padding: "4px 8px" }}
                value={formatSearch}
              />
            </div>
          )}
          <div>
            {visibleFormats.map((f) => {
              const name = f.split("/").pop() ?? f;
              const draft = draftStore.getDraft(f);
              const isModified = draft && draft.content !== draft.remoteContent;
              const isSelected = selectedFile === f;
              const encodedPath = f
                .split("/")
                .map(encodeURIComponent)
                .join("/");
              const repoUrl = `https://github.com/${config.owner}/${config.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;
              return (
                <div
                  className={`autocomplete__item ${isSelected ? "autocomplete__item--active" : ""}`}
                  key={f}
                  onClick={() => handleSelectFile(f)}
                >
                  <span className="truncate text-mono text-sm">{name}</span>
                  {isModified && (
                    <span className="badge badge--modified text-sm">●</span>
                  )}
                  <a
                    aria-label={`${t("bank.openFormatInRepo")}: ${name}`}
                    className="format-row-link"
                    href={repoUrl}
                    onClick={(e) => e.stopPropagation()}
                    rel="noreferrer"
                    target="_blank"
                    title={t("bank.openFormatInRepo")}
                  >
                    ↗
                  </a>
                </div>
              );
            })}
            {visibleFormats.length === 0 && (
              <div className="p-md text-muted text-sm">
                {t("bank.noResults")}
              </div>
            )}
          </div>
        </div>

        {/* Senders */}
        <button
          className={`btn btn--sm w-full ${showSenders ? "btn--primary" : ""}`}
          onClick={() => {
            setShowSenders(true);
            setSelectedFile(null);
          }}
        >
          {t("bank.senders")}
          {bank && !bank.hasSenders && !draftStore.getDraft(sendersPath) && (
            <span className="badge badge--warning" style={{ marginLeft: 8 }}>
              !
            </span>
          )}
        </button>
      </div>

      {/* ─── Main content ─── */}
      <div className="bank-workspace__content flex-col gap-md">
        {showSenders ? (
          <SendersEditor bankPath={bankPath} />
        ) : selectedFile ? (
          <FormatEditor
            allFormatFiles={allFormatFiles}
            filePath={selectedFile}
            key={selectedFile}
            onRenameFile={handleRenameFile}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            {t("bank.formats")}: {t("bank.noResults")}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateFormat && (
        <CreateFormatModal
          bankPath={bankPath}
          onClose={() => setShowCreateFormat(false)}
          onCreated={(path) => {
            handleSelectFile(path);
            setShowCreateFormat(false);
          }}
        />
      )}
      {showPublish && (
        <PublishPanel
          bankName={displayName}
          bankPath={bankPath}
          onClose={() => setShowPublish(false)}
        />
      )}
      {showValidation && (
        <ValidationPanel
          bank={bank ?? null}
          bankPath={bankPath}
          onClose={() => setShowValidation(false)}
        />
      )}
    </div>
  );
}
