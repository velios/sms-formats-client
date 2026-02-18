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
import {
  approvePullRequest,
  fetchFileContent,
  fetchPullRequestFiles,
  getCachedPullRequestApprovalPermission,
} from "@/domain/github";
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

const RECENT_FILES_KEY = "sms-formats-recent-formats";
const MAX_RECENT_FILES = 10;
const SEARCH_EXAMPLE_MIN_QUERY_LENGTH = 2;
const SEARCH_INDEX_PARALLELISM = 4;

function getRecentFiles(bankPath: string): string[] {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? "{}");
    return (data[bankPath] ?? []) as string[];
  } catch {
    return [];
  }
}

function addRecentFile(bankPath: string, filePath: string) {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? "{}");
    const list: string[] = data[bankPath] ?? [];
    const filtered = list.filter((f: string) => f !== filePath);
    filtered.unshift(filePath);
    data[bankPath] = filtered.slice(0, MAX_RECENT_FILES);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function replaceRecentFile(bankPath: string, oldPath: string, newPath: string) {
  try {
    const data = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? "{}");
    const list: string[] = data[bankPath] ?? [];
    const replaced = list.map((path: string) =>
      path === oldPath ? newPath : path
    );
    const deduped = Array.from(new Set(replaced));
    data[bankPath] = deduped.slice(0, MAX_RECENT_FILES);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(data));
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
  changedFiles: string[]
): Set<string> {
  const result = new Set<string>();
  for (const filePath of changedFiles) {
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
  sendersPath: string;
  preferredFormatFile: string | null;
  selectionReady: boolean;
  selectedFile: string | null;
  showSenders: boolean;
  setSelectedFile: (filePath: string | null) => void;
  setShowSenders: (value: boolean) => void;
}) {
  const {
    requestedFile,
    allFormatFiles,
    sendersPath,
    preferredFormatFile,
    selectionReady,
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
    if (requestedFile === sendersPath) {
      if (appliedRequestedFileRef.current === requestedFile) {
        return;
      }
      setShowSenders(true);
      setSelectedFile(null);
      appliedRequestedFileRef.current = requestedFile;
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
  }, [
    requestedFile,
    allFormatFiles,
    sendersPath,
    setSelectedFile,
    setShowSenders,
  ]);

  useEffect(() => {
    if (!selectedFile) {
      return;
    }
    if (allFormatFiles.includes(selectedFile)) {
      return;
    }
    setSelectedFile(null);
  }, [allFormatFiles, selectedFile, setSelectedFile]);

  useEffect(() => {
    if (!selectionReady) {
      return;
    }
    if (showSenders || selectedFile) {
      return;
    }
    if (preferredFormatFile) {
      setSelectedFile(preferredFormatFile);
    }
  }, [
    preferredFormatFile,
    selectionReady,
    selectedFile,
    setSelectedFile,
    setShowSenders,
    showSenders,
  ]);
}

function useResetSelectionOnSourceChange(params: {
  requestedFile: string | null;
  sourceSelectionKey: string;
  setSelectedFile: (filePath: string | null) => void;
  setShowSenders: (value: boolean) => void;
}) {
  const { requestedFile, sourceSelectionKey, setSelectedFile, setShowSenders } =
    params;
  const previousSourceKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (requestedFile || previousSourceKeyRef.current === sourceSelectionKey) {
      return;
    }
    previousSourceKeyRef.current = sourceSelectionKey;
    setSelectedFile(null);
    setShowSenders(false);
  }, [requestedFile, setSelectedFile, setShowSenders, sourceSelectionKey]);
}

function buildSearchIndexingMeta(params: {
  shouldIndexExamples: boolean;
  indexedScopeSummary: { loadedCount: number; total: number };
  indexingInFlight: number;
  indexingErrors: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}): { showSearchIndexStatus: boolean; searchIndexingLabel: string } {
  const {
    shouldIndexExamples,
    indexedScopeSummary,
    indexingInFlight,
    indexingErrors,
    t,
  } = params;
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

  return {
    showSearchIndexStatus,
    searchIndexingLabel,
  };
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
      {t("bank.files")}: {t("bank.noResults")}
    </div>
  );
}

function BankActionsPanel(params: {
  bankPath: string;
  onApprovePullRequest: () => void;
  onOpenPublish: () => void;
  onOpenQuickCheck: () => void;
  approvePullRequestError: string | null;
  approvePullRequestLabel: string;
  isApprovingPullRequest: boolean;
  isPullRequestApproved: boolean;
  showApprovePullRequestButton: boolean;
  t: (key: string) => string;
}): ReactNode {
  const {
    bankPath,
    onApprovePullRequest,
    onOpenPublish,
    onOpenQuickCheck,
    approvePullRequestError,
    approvePullRequestLabel,
    isApprovingPullRequest,
    isPullRequestApproved,
    showApprovePullRequestButton,
    t,
  } = params;

  return (
    <div className="bank-actions flex-col">
      <button
        className="btn btn--primary bank-actions__btn w-full"
        onClick={onOpenPublish}
      >
        {t("publish.createPR")}
      </button>
      {showApprovePullRequestButton && (
        <button
          className={`btn bank-actions__btn w-full ${isPullRequestApproved ? "btn--success" : ""}`}
          disabled={isApprovingPullRequest || isPullRequestApproved}
          onClick={onApprovePullRequest}
        >
          {approvePullRequestLabel}
        </button>
      )}
      {approvePullRequestError && (
        <div className="badge badge--error">{approvePullRequestError}</div>
      )}
      <button
        className="btn bank-actions__btn w-full"
        onClick={onOpenQuickCheck}
      >
        {t("quickCheck.open")}
      </button>
      <RefreshButton bankPath={bankPath} />
    </div>
  );
}

function FormatsPanel(params: {
  t: (key: string) => string;
  totalFilesCount: number;
  formatTab: "all" | "recent";
  setFormatTab: (value: "all" | "recent") => void;
  recentFiles: string[];
  setShowCreateFormat: (value: boolean) => void;
  formatSearch: string;
  setFormatSearch: (value: string) => void;
  showSearchIndexStatus: boolean;
  searchIndexingLabel: string;
  visibleFormats: string[];
  localChangedFormatFiles: Set<string>;
  sourceChangedFormatFiles: Set<string>;
  selectedFile: string | null;
  showSenders: boolean;
  handleSelectSenders: () => void;
  handleSelectFile: (path: string) => void;
  repository: { owner: string; repo: string };
  refName: string;
  sendersPath: string;
  sendersMissing: boolean;
  localSendersChanged: boolean;
  sourceSendersChanged: boolean;
}): ReactNode {
  const {
    t,
    totalFilesCount,
    formatTab,
    setFormatTab,
    recentFiles,
    setShowCreateFormat,
    formatSearch,
    setFormatSearch,
    showSearchIndexStatus,
    searchIndexingLabel,
    visibleFormats,
    localChangedFormatFiles,
    sourceChangedFormatFiles,
    selectedFile,
    showSenders,
    handleSelectSenders,
    handleSelectFile,
    repository,
    refName,
    sendersPath,
    sendersMissing,
    localSendersChanged,
    sourceSendersChanged,
  } = params;
  const normalizedSearch = formatSearch.trim().toLowerCase();
  const visibleFormatSet = new Set(visibleFormats);
  const sendersMatchesSearch =
    normalizedSearch.length === 0 ||
    "senders.txt".includes(normalizedSearch) ||
    t("bank.senders").toLowerCase().includes(normalizedSearch);
  const allFiles = sendersMatchesSearch
    ? [sendersPath, ...visibleFormats]
    : visibleFormats;
  const recentFilesVisible = recentFiles.filter((path) => {
    if (path === sendersPath) {
      return sendersMatchesSearch;
    }
    if (normalizedSearch.length === 0) {
      return true;
    }
    if (visibleFormatSet.has(path)) {
      return true;
    }
    return extractFormatFileName(path).toLowerCase().includes(normalizedSearch);
  });
  const filesForRender = formatTab === "recent" ? recentFilesVisible : allFiles;
  const showNoResults = filesForRender.length === 0;

  return (
    <div className="panel formats-panel">
      <div className="panel__header">
        <span>
          {t("bank.files")}{" "}
          <span className="text-muted text-sm">({totalFilesCount})</span>
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
          {t("bank.allFiles")}
        </button>
        <button
          className={`tab ${formatTab === "recent" ? "tab--active" : ""}`}
          onClick={() => setFormatTab("recent")}
        >
          {t("bank.recentFiles")}
        </button>
      </div>
      <div
        style={{
          padding: "8px",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        <input
          aria-label={t("bank.searchFile")}
          className="input"
          onChange={(e) => setFormatSearch(e.target.value)}
          placeholder={t("bank.searchFile")}
          style={{ fontSize: 12, padding: "4px 8px" }}
          value={formatSearch}
        />
        {showSearchIndexStatus && (
          <div className="text-muted text-sm" style={{ marginTop: 6 }}>
            {searchIndexingLabel}
          </div>
        )}
      </div>
      <div className="formats-panel__list">
        {filesForRender.map((path) => {
          const isSenders = path === sendersPath;
          const displayName = isSenders
            ? "senders.txt"
            : extractFormatFileName(path);
          const isSelected = isSenders ? showSenders : selectedFile === path;
          const isLocalChanged = isSenders
            ? localSendersChanged
            : localChangedFormatFiles.has(path);
          const isSourceChanged = isSenders
            ? !localSendersChanged && sourceSendersChanged
            : !isLocalChanged && sourceChangedFormatFiles.has(path);
          const encodedPath = path.split("/").map(encodeURIComponent).join("/");
          const repoUrl = `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;
          return (
            <div
              className={`autocomplete__item ${isSelected ? "autocomplete__item--active" : ""}`}
              key={path}
              onClick={() => {
                if (isSenders) {
                  handleSelectSenders();
                  return;
                }
                handleSelectFile(path);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (isSenders) {
                    handleSelectSenders();
                    return;
                  }
                  handleSelectFile(path);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span className="truncate text-mono text-sm">{displayName}</span>
              {isLocalChanged && (
                <span className="badge badge--modified text-sm">●</span>
              )}
              {isSourceChanged && (
                <span className="badge badge--warning text-sm">●</span>
              )}
              {isSenders && sendersMissing && (
                <span className="badge badge--warning">!</span>
              )}
              <a
                aria-label={`${t("bank.openFormatInRepo")}: ${displayName}`}
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
        {showNoResults && (
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
  replaceRecentFile(bankPath, fromPath, toPath);

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

function usePullRequestChangedFiles(params: {
  repository: { owner: string; repo: string };
  sourceRef: { type: "branch" | "pr"; prNumber?: number } | null;
}) {
  const { repository, sourceRef } = params;
  const [prChangedFiles, setPrChangedFiles] = useState<string[]>([]);
  const [isPrChangedFilesReady, setIsPrChangedFilesReady] = useState(false);

  useEffect(() => {
    if (!(sourceRef?.type === "pr" && sourceRef.prNumber)) {
      setPrChangedFiles([]);
      setIsPrChangedFilesReady(true);
      return;
    }

    setIsPrChangedFilesReady(false);
    let cancelled = false;
    void fetchPullRequestFiles(sourceRef.prNumber, repository)
      .then((files) => {
        if (!cancelled) {
          setPrChangedFiles(files);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPrChangedFiles([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsPrChangedFilesReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repository, sourceRef?.prNumber, sourceRef?.type]);

  return {
    isPrChangedFilesReady,
    prChangedFiles,
  };
}

function usePullRequestApproval(params: {
  repository: { owner: string; repo: string };
  sourceRef: { type: "branch" | "pr"; prNumber?: number } | null;
  t: (key: string) => string;
}) {
  const { repository, sourceRef, t } = params;
  const [isApprovingPullRequest, setIsApprovingPullRequest] = useState(false);
  const [isPullRequestApproved, setIsPullRequestApproved] = useState(false);
  const [approvePullRequestError, setApprovePullRequestError] = useState<
    string | null
  >(null);

  useEffect(() => {
    setIsApprovingPullRequest(false);
    setIsPullRequestApproved(false);
    setApprovePullRequestError(null);
  }, [repository.owner, repository.repo, sourceRef?.prNumber, sourceRef?.type]);

  const handleApprovePullRequest = useCallback(async () => {
    if (!(sourceRef?.type === "pr" && sourceRef.prNumber)) {
      return;
    }

    setIsApprovingPullRequest(true);
    setApprovePullRequestError(null);
    try {
      await approvePullRequest(sourceRef.prNumber, repository);
      setIsPullRequestApproved(true);
    } catch (error) {
      setIsPullRequestApproved(false);
      setApprovePullRequestError(
        error instanceof Error ? error.message : t("source.approvePrError")
      );
    } finally {
      setIsApprovingPullRequest(false);
    }
  }, [repository, sourceRef?.prNumber, sourceRef?.type, t]);

  const showApprovePullRequestButton = Boolean(
    sourceRef?.type === "pr" &&
      sourceRef.prNumber &&
      getCachedPullRequestApprovalPermission(repository)
  );
  const approvePullRequestLabel = isApprovingPullRequest
    ? t("source.approvingPr")
    : isPullRequestApproved
      ? t("source.approvePrDone")
      : t("source.approvePr");

  return {
    approvePullRequestError,
    approvePullRequestLabel,
    handleApprovePullRequest,
    isApprovingPullRequest,
    isPullRequestApproved,
    showApprovePullRequestButton,
  };
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
  const sendersPath = `${bankPath}/senders.txt`;
  const { prChangedFiles, isPrChangedFilesReady } = usePullRequestChangedFiles({
    repository,
    sourceRef,
  });

  // Get all format files including draft-only (new) files
  const draftStore = useDraftStore();
  const localChangedFiles = useMemo(
    () => draftStore.getChangedFiles().map((item) => item.filePath),
    [draftStore, draftStore.drafts]
  );
  const effectiveSourceChangedFiles = useMemo(
    () => Array.from(new Set([...sourceChangedFiles, ...prChangedFiles])),
    [prChangedFiles, sourceChangedFiles]
  );
  const localChangedFilesInBank = useMemo(
    () => collectChangedFilesInBank(bankPath, localChangedFiles),
    [bankPath, localChangedFiles]
  );
  const sourceChangedFilesInBank = useMemo(
    () => collectChangedFilesInBank(bankPath, effectiveSourceChangedFiles),
    [bankPath, effectiveSourceChangedFiles]
  );
  const isSelectionReady = useMemo(() => {
    if (sourceRef?.type !== "pr") {
      return true;
    }
    if (sourceChangedFiles.length > 0) {
      return true;
    }
    return isPrChangedFilesReady;
  }, [isPrChangedFilesReady, sourceChangedFiles.length, sourceRef?.type]);
  const localChangedFormatFiles = useMemo(
    () => collectChangedFormatFiles(bankPath, localChangedFilesInBank),
    [bankPath, localChangedFilesInBank]
  );
  const sourceChangedFormatFiles = useMemo(
    () => collectChangedFormatFiles(bankPath, sourceChangedFilesInBank),
    [bankPath, sourceChangedFilesInBank]
  );
  const changedFormatFiles = useMemo(
    () =>
      new Set<string>([
        ...Array.from(localChangedFormatFiles),
        ...Array.from(sourceChangedFormatFiles),
      ]),
    [localChangedFormatFiles, sourceChangedFormatFiles]
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
  const sourceSelectionKey = `${repository.owner}/${repository.repo}:${sourceRef?.type ?? "none"}:${sourceRef?.name ?? ""}:${sourceRef?.sha ?? ""}:${sourceRef?.prNumber ?? ""}:${bankPath}`;

  useResetSelectionOnSourceChange({
    requestedFile,
    sourceSelectionKey,
    setSelectedFile,
    setShowSenders,
  });

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

  const recentFiles = useMemo(() => {
    const recent = getRecentFiles(bankPath);
    return recent.filter(
      (path) => path === sendersPath || allFormatFiles.includes(path)
    );
  }, [allFormatFiles, bankPath, sendersPath]);

  const handleSelectFile = useCallback(
    (f: string) => {
      setSelectedFile(f);
      setShowSenders(false);
      addRecentFile(bankPath, f);
    },
    [bankPath]
  );

  const handleSelectSenders = useCallback(() => {
    setShowSenders(true);
    setSelectedFile(null);
    addRecentFile(bankPath, sendersPath);
  }, [bankPath, sendersPath]);

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

  const localSendersChanged = localChangedFilesInBank.has(sendersPath);
  const sourceSendersChanged =
    !localSendersChanged && sourceChangedFilesInBank.has(sendersPath);
  const sendersMissing =
    !!bank && !bank.hasSenders && !draftStore.getDraft(sendersPath);
  const {
    showApprovePullRequestButton,
    isApprovingPullRequest,
    isPullRequestApproved,
    approvePullRequestError,
    handleApprovePullRequest,
    approvePullRequestLabel,
  } = usePullRequestApproval({
    repository,
    sourceRef,
    t,
  });

  useAutoSelectFormat({
    requestedFile,
    allFormatFiles,
    sendersPath,
    preferredFormatFile: allFormatFiles[0] ?? null,
    selectionReady: isSelectionReady,
    selectedFile,
    showSenders,
    setSelectedFile,
    setShowSenders,
  });

  if (!bank && allFormatFiles.length === 0) {
    return (
      <div className="flex-col gap-md">
        <div className="text-muted">
          {t("bank.noResults")}: {bankPath}
        </div>
      </div>
    );
  }

  const displayName = bank?.displayName ?? bankPath.replace("src/", "");
  const refName = sourceRef?.sha ?? sourceRef?.name ?? config.defaultBranch;
  const encodedBankPathSegments = bankPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const bankRepoUrl = `https://github.com/${repository.owner}/${repository.repo}/tree/${encodeURIComponent(refName)}/${encodedBankPathSegments}`;
  const { showSearchIndexStatus, searchIndexingLabel } =
    buildSearchIndexingMeta({
      shouldIndexExamples,
      indexedScopeSummary,
      indexingInFlight,
      indexingErrors,
      t,
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
        <BankActionsPanel
          approvePullRequestError={approvePullRequestError}
          approvePullRequestLabel={approvePullRequestLabel}
          bankPath={bankPath}
          isApprovingPullRequest={isApprovingPullRequest}
          isPullRequestApproved={isPullRequestApproved}
          onApprovePullRequest={() => {
            void handleApprovePullRequest();
          }}
          onOpenPublish={() => setShowPublish(true)}
          onOpenQuickCheck={() => setShowQuickCheck(true)}
          showApprovePullRequestButton={showApprovePullRequestButton}
          t={t}
        />

        <FormatsPanel
          formatSearch={formatSearch}
          formatTab={formatTab}
          handleSelectFile={handleSelectFile}
          handleSelectSenders={handleSelectSenders}
          localChangedFormatFiles={localChangedFormatFiles}
          localSendersChanged={localSendersChanged}
          recentFiles={recentFiles}
          refName={refName}
          repository={repository}
          searchIndexingLabel={searchIndexingLabel}
          selectedFile={selectedFile}
          sendersMissing={sendersMissing}
          sendersPath={sendersPath}
          setFormatSearch={setFormatSearch}
          setFormatTab={setFormatTab}
          setShowCreateFormat={setShowCreateFormat}
          showSearchIndexStatus={showSearchIndexStatus}
          showSenders={showSenders}
          sourceChangedFormatFiles={sourceChangedFormatFiles}
          sourceSendersChanged={sourceSendersChanged}
          t={t}
          totalFilesCount={allFormatFiles.length + 1}
          visibleFormats={filteredFormatFiles}
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
