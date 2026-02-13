import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { config } from "@/config";
import { parseFormatFile } from "@/domain/format";
import { fetchFileContent } from "@/domain/github";
import { type FormatSearchDoc, searchFormatPaths } from "@/domain/search";
import type { BankInfo } from "@/domain/types";
import { CreateFormatModal } from "@/features/create-entity/CreateFormatModal";
import { FormatEditor } from "@/features/format-editor/FormatEditor";
import { PublishPanel } from "@/features/publish-panel/PublishPanel";
import { QuickCheckPanel } from "@/features/quick-check/QuickCheckPanel";
import { RefreshButton } from "@/features/refresh/RefreshButton";
import { SendersEditor } from "@/features/senders-editor/SendersEditor";
import { ValidationPanel } from "@/features/validation/ValidationPanel";
import { useDraftStore, useSourceStore } from "@/store";

// ─── Recent formats persistence ───
const RECENT_FORMATS_KEY = "sms-formats-recent-formats";
const MAX_RECENT_FORMATS = 10;
const SEARCH_EXAMPLE_MIN_QUERY_LENGTH = 2;
const SEARCH_INDEX_PARALLELISM = 4;

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

function decodeRequestedFileValue(
  searchParams: URLSearchParams
): string | null {
  const rawValue = searchParams.get("file");
  if (!rawValue) {
    return null;
  }
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

function collectChangedFilesInBank(
  bankPath: string,
  sourceChangedFiles: string[],
  localChangedFiles: string[]
): Set<string> {
  const files = [...sourceChangedFiles, ...localChangedFiles];
  const result = new Set<string>();
  for (const filePath of files) {
    if (filePath.startsWith(`${bankPath}/`)) {
      result.add(filePath);
    }
  }
  return result;
}

function collectChangedFormatFiles(
  bankPath: string,
  changedFilesInBank: Set<string>
): Set<string> {
  return new Set(
    Array.from(changedFilesInBank).filter(
      (path) => path.startsWith(`${bankPath}/formats/`) && path.endsWith(".txt")
    )
  );
}

function sortFormatPaths(
  formatPaths: string[],
  changedFormatFiles: Set<string>
): string[] {
  return [...formatPaths].sort((a, b) => {
    const aChanged = changedFormatFiles.has(a);
    const bChanged = changedFormatFiles.has(b);
    if (aChanged !== bChanged) {
      return aChanged ? -1 : 1;
    }
    const aName = extractFormatFileName(a);
    const bName = extractFormatFileName(b);
    return aName.localeCompare(bName, undefined, { sensitivity: "base" });
  });
}

function collectAllFormatFiles(
  bankPath: string,
  remoteFormatFiles: string[],
  draftPaths: Iterable<string>,
  changedFormatFiles: Set<string>
): string[] {
  const remoteFiles = new Set(remoteFormatFiles);
  const draftFiles = new Set<string>();
  for (const path of draftPaths) {
    if (path.startsWith(`${bankPath}/formats/`) && path.endsWith(".txt")) {
      draftFiles.add(path);
    }
  }
  return sortFormatPaths(
    Array.from(new Set([...remoteFiles, ...draftFiles])),
    changedFormatFiles
  );
}

function extractFormatFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function extractExamplesForSearch(content: string, filePath: string): string {
  return parseFormatFile(content, filePath).examples.join("\n");
}

function shouldStartExampleIndexing(
  query: string,
  formatTab: "all" | "recent"
): boolean {
  if (formatTab !== "all") {
    return false;
  }
  return query.trim().length >= SEARCH_EXAMPLE_MIN_QUERY_LENGTH;
}

function upsertRemoteSearchDoc(
  prev: Map<string, FormatSearchDoc>,
  path: string,
  exampleText: string
): Map<string, FormatSearchDoc> {
  const next = new Map(prev);
  const previous = next.get(path);
  next.set(path, {
    path,
    name: previous?.name ?? extractFormatFileName(path),
    exampleText,
    isLoaded: true,
    source: "remote",
  });
  return next;
}

function upsertRemoteErrorDoc(
  prev: Map<string, FormatSearchDoc>,
  path: string
): Map<string, FormatSearchDoc> {
  const next = new Map(prev);
  const previous = next.get(path);
  next.set(path, {
    path,
    name: previous?.name ?? extractFormatFileName(path),
    exampleText: previous?.exampleText ?? "",
    isLoaded: true,
    source: "remote-error",
  });
  return next;
}

function syncSearchDocs(params: {
  previousDocs: Map<string, FormatSearchDoc>;
  formatPaths: string[];
  draftStore: {
    getDraft: (
      filePath: string
    ) => { content: string; remoteContent: string } | undefined;
  };
}): Map<string, FormatSearchDoc> {
  const { previousDocs, formatPaths, draftStore } = params;
  const next = new Map<string, FormatSearchDoc>();
  for (const path of formatPaths) {
    const draft = draftStore.getDraft(path);
    if (draft) {
      next.set(path, {
        path,
        name: extractFormatFileName(path),
        exampleText: extractExamplesForSearch(draft.content, path),
        isLoaded: true,
        source: "draft",
      });
      continue;
    }

    const previous = previousDocs.get(path);
    if (previous) {
      next.set(path, {
        ...previous,
        path,
        name: extractFormatFileName(path),
      });
      continue;
    }

    next.set(path, {
      path,
      name: extractFormatFileName(path),
      exampleText: "",
      isLoaded: false,
      source: "none",
    });
  }
  return next;
}

interface SearchDraftStore {
  drafts: Map<string, { content: string; remoteContent: string }>;
  getDraft: (
    filePath: string
  ) => { content: string; remoteContent: string } | undefined;
}

function useBankFormatSearch(params: {
  allFormatFiles: string[];
  changedFormatFiles: Set<string>;
  draftStore: SearchDraftStore;
  formatSearch: string;
  formatTab: "all" | "recent";
  bankPath: string;
  repository: { owner: string; repo: string };
  sourceRefNameForContent: string | undefined;
}) {
  const {
    allFormatFiles,
    changedFormatFiles,
    draftStore,
    formatSearch,
    formatTab,
    bankPath,
    repository,
    sourceRefNameForContent,
  } = params;
  const [searchDocsByPath, setSearchDocsByPath] = useState<
    Map<string, FormatSearchDoc>
  >(new Map());
  const [indexingInFlight, setIndexingInFlight] = useState(0);
  const [indexingErrors, setIndexingErrors] = useState(0);
  const indexingSessionRef = useRef("");
  const inFlightSearchPathsRef = useRef(new Set<string>());

  useEffect(() => {
    setSearchDocsByPath((prev) =>
      syncSearchDocs({
        previousDocs: prev,
        formatPaths: allFormatFiles,
        draftStore,
      })
    );
  }, [allFormatFiles, draftStore, draftStore.drafts]);

  const activeSearchScope = allFormatFiles;
  const shouldIndexExamples = shouldStartExampleIndexing(
    formatSearch,
    formatTab
  );
  const searchSessionId = `${repository.owner}/${repository.repo}:${sourceRefNameForContent ?? ""}:${bankPath}`;

  useEffect(() => {
    indexingSessionRef.current = searchSessionId;
    inFlightSearchPathsRef.current.clear();
    setIndexingInFlight(0);
    setIndexingErrors(0);
  }, [searchSessionId]);

  const loadRemoteSearchDoc = useCallback(
    async (path: string, sessionId: string) => {
      if (!sourceRefNameForContent) {
        return;
      }
      try {
        const remoteContent = await fetchFileContent(
          path,
          sourceRefNameForContent,
          repository
        );
        if (indexingSessionRef.current !== sessionId) {
          return;
        }
        const exampleText = extractExamplesForSearch(remoteContent, path);
        setSearchDocsByPath((prev) =>
          upsertRemoteSearchDoc(prev, path, exampleText)
        );
      } catch {
        if (indexingSessionRef.current !== sessionId) {
          return;
        }
        setSearchDocsByPath((prev) => upsertRemoteErrorDoc(prev, path));
        setIndexingErrors((prev) => prev + 1);
      } finally {
        inFlightSearchPathsRef.current.delete(path);
        if (indexingSessionRef.current === sessionId) {
          setIndexingInFlight((prev) => Math.max(prev - 1, 0));
        }
      }
    },
    [repository, sourceRefNameForContent]
  );

  useEffect(() => {
    if (!(shouldIndexExamples && sourceRefNameForContent)) {
      return;
    }

    const availableSlots =
      SEARCH_INDEX_PARALLELISM - inFlightSearchPathsRef.current.size;
    if (availableSlots <= 0) {
      return;
    }

    const pendingPaths = activeSearchScope.filter((path) => {
      if (inFlightSearchPathsRef.current.has(path)) {
        return false;
      }
      if (draftStore.getDraft(path)) {
        return false;
      }
      const doc = searchDocsByPath.get(path);
      return !doc?.isLoaded;
    });
    if (pendingPaths.length === 0) {
      return;
    }

    const sessionId = indexingSessionRef.current;
    const batch = pendingPaths.slice(0, availableSlots);
    for (const path of batch) {
      inFlightSearchPathsRef.current.add(path);
      setIndexingInFlight((prev) => prev + 1);
      void loadRemoteSearchDoc(path, sessionId);
    }
  }, [
    activeSearchScope,
    draftStore,
    draftStore.drafts,
    loadRemoteSearchDoc,
    searchDocsByPath,
    shouldIndexExamples,
    sourceRefNameForContent,
  ]);

  const indexedScopeSummary = useMemo(() => {
    let loadedCount = 0;
    for (const path of activeSearchScope) {
      const draft = draftStore.getDraft(path);
      if (draft) {
        loadedCount += 1;
        continue;
      }
      if (searchDocsByPath.get(path)?.isLoaded) {
        loadedCount += 1;
      }
    }
    return {
      loadedCount,
      total: activeSearchScope.length,
    };
  }, [activeSearchScope, draftStore, draftStore.drafts, searchDocsByPath]);

  const filteredFormatFiles = useMemo(
    () =>
      searchFormatPaths({
        formatPaths: allFormatFiles,
        query: formatSearch,
        docsByPath: searchDocsByPath,
        changedFormatFiles,
      }),
    [allFormatFiles, changedFormatFiles, formatSearch, searchDocsByPath]
  );

  return {
    filteredFormatFiles,
    shouldIndexExamples,
    indexedScopeSummary,
    indexingInFlight,
    indexingErrors,
  };
}

function useAutoSelectFormat(params: {
  requestedFile: string | null;
  allFormatFiles: string[];
  selectedFile: string | null;
  showSenders: boolean;
  setSelectedFile: (filePath: string | null) => void;
  setShowSenders: (value: boolean) => void;
}) {
  const {
    requestedFile,
    allFormatFiles,
    selectedFile,
    showSenders,
    setSelectedFile,
    setShowSenders,
  } = params;
  const appliedRequestedFileRef = useRef<string | null>(null);

  useEffect(() => {
    if (!requestedFile) {
      appliedRequestedFileRef.current = null;
      return;
    }
    if (!allFormatFiles.includes(requestedFile)) {
      return;
    }
    if (appliedRequestedFileRef.current === requestedFile) {
      return;
    }

    setSelectedFile(requestedFile);
    setShowSenders(false);
    appliedRequestedFileRef.current = requestedFile;
  }, [requestedFile, allFormatFiles, setSelectedFile, setShowSenders]);

  useEffect(() => {
    if (!(showSenders || selectedFile || allFormatFiles.length === 0)) {
      setSelectedFile(allFormatFiles[0]!);
    }
  }, [allFormatFiles, selectedFile, setSelectedFile, showSenders]);
}

function resolveVisibleFormats(params: {
  formatTab: "all" | "recent";
  recentFormats: string[];
  filteredFormatFiles: string[];
}): string[] {
  const { formatTab, recentFormats, filteredFormatFiles } = params;
  if (formatTab === "recent") {
    return recentFormats;
  }
  return filteredFormatFiles;
}

function renderWorkspaceContent(params: {
  showSenders: boolean;
  bankPath: string;
  selectedFile: string | null;
  allFormatFiles: string[];
  handleRenameFile: (fromPath: string, toPath: string) => boolean;
  onOpenValidation: () => void;
  t: (key: string) => string;
}): ReactNode {
  const {
    showSenders,
    bankPath,
    selectedFile,
    allFormatFiles,
    handleRenameFile,
    onOpenValidation,
    t,
  } = params;
  if (showSenders) {
    return <SendersEditor bankPath={bankPath} />;
  }
  if (selectedFile) {
    return (
      <FormatEditor
        allFormatFiles={allFormatFiles}
        filePath={selectedFile}
        key={selectedFile}
        onOpenValidation={onOpenValidation}
        onRenameFile={handleRenameFile}
      />
    );
  }
  return (
    <div className="flex h-full items-center justify-center text-muted">
      {t("bank.formats")}: {t("bank.noResults")}
    </div>
  );
}

function FormatsPanel(params: {
  t: (key: string) => string;
  totalFormatsCount: number;
  formatTab: "all" | "recent";
  setFormatTab: (value: "all" | "recent") => void;
  setShowCreateFormat: (value: boolean) => void;
  formatSearch: string;
  setFormatSearch: (value: string) => void;
  showSearchIndexStatus: boolean;
  searchIndexingLabel: string;
  visibleFormats: string[];
  changedFormatFiles: Set<string>;
  selectedFile: string | null;
  handleSelectFile: (path: string) => void;
  repository: { owner: string; repo: string };
  refName: string;
}): ReactNode {
  const {
    t,
    totalFormatsCount,
    formatTab,
    setFormatTab,
    setShowCreateFormat,
    formatSearch,
    setFormatSearch,
    showSearchIndexStatus,
    searchIndexingLabel,
    visibleFormats,
    changedFormatFiles,
    selectedFile,
    handleSelectFile,
    repository,
    refName,
  } = params;

  return (
    <div className="panel formats-panel">
      <div className="panel__header">
        <span>
          {t("bank.formats")}{" "}
          <span className="text-muted text-sm">({totalFormatsCount})</span>
        </span>
        <button
          aria-label={t("bank.createFormat")}
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
          {t("bank.allFormats")}
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
            aria-label={t("bank.searchFormat")}
            className="input"
            onChange={(e) => setFormatSearch(e.target.value)}
            placeholder={t("bank.searchFormat")}
            style={{ fontSize: 12, padding: "4px 8px" }}
            value={formatSearch}
          />
          {showSearchIndexStatus && (
            <div className="text-muted text-sm" style={{ marginTop: 6 }}>
              {searchIndexingLabel}
            </div>
          )}
        </div>
      )}
      <div className="formats-panel__list">
        {visibleFormats.map((f) => {
          const name = extractFormatFileName(f);
          const isModified = changedFormatFiles.has(f);
          const isSelected = selectedFile === f;
          const encodedPath = f.split("/").map(encodeURIComponent).join("/");
          const repoUrl = `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;
          return (
            <div
              className={`autocomplete__item ${isSelected ? "autocomplete__item--active" : ""}`}
              key={f}
              onClick={() => handleSelectFile(f)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  handleSelectFile(f);
                }
              }}
              role="button"
              tabIndex={0}
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
          <div className="p-md text-muted text-sm">{t("bank.noResults")}</div>
        )}
      </div>
    </div>
  );
}

function renameDraftFormat(params: {
  fromPath: string;
  toPath: string;
  bankPath: string;
  allFormatFiles: string[];
  draftStore: {
    getDraft: (
      filePath: string
    ) => { content: string; remoteContent: string } | undefined;
    renameDraft: (oldFilePath: string, newFilePath: string) => void;
  };
  setBanks: (banks: BankInfo[]) => void;
  currentSelectedFile: string | null;
  setSelectedFile: (filePath: string | null) => void;
}): boolean {
  const {
    fromPath,
    toPath,
    bankPath,
    allFormatFiles,
    draftStore,
    setBanks,
    currentSelectedFile,
    setSelectedFile,
  } = params;
  if (fromPath === toPath) {
    return true;
  }
  if (!(toPath.startsWith(`${bankPath}/formats/`) && toPath.endsWith(".txt"))) {
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

  if (currentSelectedFile === fromPath) {
    setSelectedFile(toPath);
  }
  return true;
}

export function BankWorkspace() {
  const { t } = useTranslation();
  const { bankPath: encodedBankPath } = useParams();
  const [searchParams] = useSearchParams();
  const bankPath = decodeURIComponent(encodedBankPath ?? "");
  const requestedFile = useMemo(
    () => decodeRequestedFileValue(searchParams),
    [searchParams]
  );

  const banks = useSourceStore((s) => s.banks);
  const setBanks = useSourceStore((s) => s.setBanks);
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const sourceChangedFiles = useSourceStore((s) => s.sourceChangedFiles);
  const repository = useSourceStore((s) => s.repository);

  const bank = useMemo(
    () => banks.find((b) => b.folderPath === bankPath),
    [banks, bankPath]
  );

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showSenders, setShowSenders] = useState(false);
  const [showCreateFormat, setShowCreateFormat] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showQuickCheck, setShowQuickCheck] = useState(false);
  const [formatSearch, setFormatSearch] = useState("");
  const [formatTab, setFormatTab] = useState<"all" | "recent">("all");

  // Get all format files including draft-only (new) files
  const draftStore = useDraftStore();
  const localChangedFiles = useMemo(
    () => draftStore.getChangedFiles().map((item) => item.filePath),
    [draftStore, draftStore.drafts]
  );
  const changedFilesInBank = useMemo(
    () =>
      collectChangedFilesInBank(
        bankPath,
        sourceChangedFiles,
        localChangedFiles
      ),
    [bankPath, localChangedFiles, sourceChangedFiles]
  );
  const changedFormatFiles = useMemo(
    () => collectChangedFormatFiles(bankPath, changedFilesInBank),
    [bankPath, changedFilesInBank]
  );

  const allFormatFiles = useMemo(() => {
    return collectAllFormatFiles(
      bankPath,
      bank?.formatFiles ?? [],
      draftStore.drafts.keys(),
      changedFormatFiles
    );
  }, [bank, bankPath, changedFormatFiles, draftStore.drafts]);

  const sourceRefNameForContent = sourceRef?.sha ?? sourceRef?.name;
  const {
    filteredFormatFiles,
    shouldIndexExamples,
    indexedScopeSummary,
    indexingInFlight,
    indexingErrors,
  } = useBankFormatSearch({
    allFormatFiles,
    changedFormatFiles,
    draftStore,
    formatSearch,
    formatTab,
    bankPath,
    repository,
    sourceRefNameForContent,
  });

  // Recent formats
  const recentFormats = useMemo(() => {
    const recent = getRecentFormats(bankPath);
    return recent.filter((f) => allFormatFiles.includes(f));
  }, [bankPath, allFormatFiles]);

  useAutoSelectFormat({
    requestedFile,
    allFormatFiles,
    selectedFile,
    showSenders,
    setSelectedFile,
    setShowSenders,
  });

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
      return renameDraftFormat({
        fromPath,
        toPath,
        bankPath,
        allFormatFiles,
        draftStore,
        setBanks,
        currentSelectedFile: selectedFile,
        setSelectedFile,
      });
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
  const refName = sourceRef?.sha ?? sourceRef?.name ?? config.defaultBranch;
  const encodedBankPathSegments = bankPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const bankRepoUrl = `https://github.com/${repository.owner}/${repository.repo}/tree/${encodeURIComponent(refName)}/${encodedBankPathSegments}`;
  const visibleFormats = resolveVisibleFormats({
    formatTab,
    recentFormats,
    filteredFormatFiles,
  });
  const sendersChanged = changedFilesInBank.has(sendersPath);
  const showSearchIndexStatus =
    shouldIndexExamples &&
    indexedScopeSummary.total > 0 &&
    (indexingInFlight > 0 ||
      indexedScopeSummary.loadedCount < indexedScopeSummary.total ||
      indexingErrors > 0);
  const searchIndexingLabel =
    indexingErrors > 0
      ? t("bank.searchIndexingWithErrors", {
          loaded: indexedScopeSummary.loadedCount,
          total: indexedScopeSummary.total,
          errors: indexingErrors,
        })
      : t("bank.searchIndexing", {
          loaded: indexedScopeSummary.loadedCount,
          total: indexedScopeSummary.total,
        });

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
        <div className="bank-actions flex-col">
          <button
            className="btn btn--primary bank-actions__btn w-full"
            onClick={() => setShowPublish(true)}
          >
            {t("publish.createPR")}
          </button>
          <button
            className="btn bank-actions__btn w-full"
            onClick={() => setShowQuickCheck(true)}
          >
            {t("quickCheck.open")}
          </button>
          <RefreshButton bankPath={bankPath} />
          <button
            className={`btn bank-actions__btn w-full ${showSenders ? "btn--primary" : ""}`}
            onClick={() => {
              setShowSenders(true);
              setSelectedFile(null);
            }}
          >
            {t("bank.senders")}
            {sendersChanged && (
              <span className="badge badge--modified" style={{ marginLeft: 8 }}>
                ●
              </span>
            )}
            {bank && !bank.hasSenders && !draftStore.getDraft(sendersPath) && (
              <span className="badge badge--warning" style={{ marginLeft: 8 }}>
                !
              </span>
            )}
          </button>
        </div>

        <FormatsPanel
          changedFormatFiles={changedFormatFiles}
          formatSearch={formatSearch}
          formatTab={formatTab}
          handleSelectFile={handleSelectFile}
          refName={refName}
          repository={repository}
          searchIndexingLabel={searchIndexingLabel}
          selectedFile={selectedFile}
          setFormatSearch={setFormatSearch}
          setFormatTab={setFormatTab}
          setShowCreateFormat={setShowCreateFormat}
          showSearchIndexStatus={showSearchIndexStatus}
          t={t}
          totalFormatsCount={allFormatFiles.length}
          visibleFormats={visibleFormats}
        />
      </div>

      {/* ─── Main content ─── */}
      <div className="bank-workspace__content flex-col gap-md">
        {renderWorkspaceContent({
          showSenders,
          bankPath,
          selectedFile,
          allFormatFiles,
          handleRenameFile,
          onOpenValidation: () => setShowValidation(true),
          t,
        })}
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
      {showQuickCheck && (
        <QuickCheckPanel
          bankName={displayName}
          bankPath={bankPath}
          formatPaths={allFormatFiles}
          onClose={() => setShowQuickCheck(false)}
        />
      )}
    </div>
  );
}
