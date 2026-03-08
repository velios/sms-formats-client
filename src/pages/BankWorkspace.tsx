import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router-dom";
import { config } from "@/config";
import {
  type BankRouteSource,
  isRouteSourceMatched,
  type ParsedBankRouteParams,
  parseBankRouteParams,
  resolveRouteRepository,
} from "@/domain/bank-route";
import { parseFormatFile } from "@/domain/format";
import {
  approvePullRequest,
  fetchFileContent,
  fetchPullRequestFiles,
  getCachedPullRequestApprovalPermission,
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
  refreshPullRequestApprovalPermission,
  subscribeGitHubAuthChange,
  updatePullRequestHead,
} from "@/domain/github";
import { type FormatSearchDoc, searchFormatPaths } from "@/domain/search";
import type { BankInfo, RepoRef, SourceRef } from "@/domain/types";
import { CreateFormatModal } from "@/features/create-entity/CreateFormatModal";
import { FormatEditor } from "@/features/format-editor/FormatEditor";
import { PublishPanel } from "@/features/publish-panel/PublishPanel";
import {
  type QuickCheckMode,
  QuickCheckPanel,
} from "@/features/quick-check/QuickCheckPanel";
import { RefreshButton } from "@/features/refresh/RefreshButton";
import { SendersEditor } from "@/features/senders-editor/SendersEditor";
import { ValidationPanel } from "@/features/validation/ValidationPanel";
import { useSwitchRepository, useSwitchSource } from "@/hooks/useGitHub";
import { useDraftStore, useSourceStore } from "@/store";

const RECENT_FILES_KEY = "sms-formats-recent-formats";
const WORKSPACE_SELECTION_HISTORY_KEY = "sms-formats-workspace-selection";
const MAX_RECENT_FILES = 10;
const SEARCH_EXAMPLE_MIN_QUERY_LENGTH = 2;
const SEARCH_INDEX_PARALLELISM = 4;

interface ActiveFormatSearchContext {
  filePath: string;
  regex: string;
  examples: string[];
  activeExampleIndex: number;
}

interface WorkspaceSelectionHistoryState {
  workspaceKey: string;
  selectedFile: string | null;
  showSenders: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readWorkspaceSelectionHistoryState(
  historyState: unknown,
  workspaceKey: string
): WorkspaceSelectionHistoryState | null {
  if (!isRecord(historyState)) {
    return null;
  }
  const candidate = historyState[WORKSPACE_SELECTION_HISTORY_KEY];
  if (!isRecord(candidate)) {
    return null;
  }
  if (candidate.workspaceKey !== workspaceKey) {
    return null;
  }
  const selectedFile =
    typeof candidate.selectedFile === "string" ? candidate.selectedFile : null;
  return {
    workspaceKey,
    selectedFile,
    showSenders: Boolean(candidate.showSenders),
  };
}

function writeWorkspaceSelectionHistoryState(params: {
  mode: "push" | "replace";
  workspaceKey: string;
  selectedFile: string | null;
  showSenders: boolean;
}) {
  if (typeof window === "undefined") {
    return;
  }
  const { mode, workspaceKey, selectedFile, showSenders } = params;
  const baseState = isRecord(window.history.state) ? window.history.state : {};
  const nextState = {
    ...baseState,
    [WORKSPACE_SELECTION_HISTORY_KEY]: {
      workspaceKey,
      selectedFile,
      showSenders,
    },
  };
  if (mode === "push") {
    window.history.pushState(nextState, "");
    return;
  }
  window.history.replaceState(nextState, "");
}

function getActiveExampleText(
  context: ActiveFormatSearchContext | null
): string {
  if (!context) {
    return "";
  }
  return context.examples[context.activeExampleIndex] ?? "";
}

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
  onFormatSearchContextChange: (context: ActiveFormatSearchContext) => void;
  onOpenTemplateBySms: () => void;
  onOpenSmsByTemplate: () => void;
  t: (key: string) => string;
}): ReactNode {
  const {
    showSenders,
    bankPath,
    selectedFile,
    allFormatFiles,
    handleRenameFile,
    onFormatSearchContextChange,
    onOpenTemplateBySms,
    onOpenSmsByTemplate,
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
        onOpenSmsByTemplate={onOpenSmsByTemplate}
        onOpenTemplateBySms={onOpenTemplateBySms}
        onRenameFile={handleRenameFile}
        onSearchContextChange={onFormatSearchContextChange}
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
  onOpenValidation: () => void;
  onPublish: () => void;
  onOpenSmsByTemplate: () => void;
  onOpenTemplateBySms: () => void;
  approvePullRequestError: string | null;
  approvePullRequestLabel: string;
  publishError: string | null;
  publishActionLabel: string;
  isPublishing: boolean;
  isApprovingPullRequest: boolean;
  isPullRequestApproved: boolean;
  showApprovePullRequestButton: boolean;
  t: (key: string) => string;
}): ReactNode {
  const {
    bankPath,
    onApprovePullRequest,
    onOpenValidation,
    onPublish,
    onOpenSmsByTemplate,
    onOpenTemplateBySms,
    approvePullRequestError,
    approvePullRequestLabel,
    publishError,
    publishActionLabel,
    isPublishing,
    isApprovingPullRequest,
    isPullRequestApproved,
    showApprovePullRequestButton,
    t,
  } = params;

  return (
    <div className="bank-actions flex-col">
      <button
        className="btn btn--primary bank-actions__btn w-full"
        disabled={isPublishing}
        onClick={onPublish}
      >
        {isPublishing ? <span className="spinner" /> : null}
        {publishActionLabel}
      </button>
      {publishError && <div className="badge badge--error">{publishError}</div>}
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
        onClick={onOpenValidation}
      >
        {t("editor.validation")}
      </button>
      <button
        className="btn bank-actions__btn w-full"
        onClick={onOpenTemplateBySms}
      >
        {t("quickCheck.openTemplateBySms")}
      </button>
      <button
        className="btn bank-actions__btn w-full"
        onClick={onOpenSmsByTemplate}
      >
        {t("quickCheck.openSmsByTemplate")}
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
  sourceChangedFiles: string[];
  sourceRef: { type: "branch" | "pr"; prNumber?: number } | null;
}) {
  const { repository, sourceChangedFiles, sourceRef } = params;
  const [prChangedFiles, setPrChangedFiles] = useState<string[]>([]);
  const [isPrChangedFilesReady, setIsPrChangedFilesReady] = useState(false);

  useEffect(() => {
    if (!(sourceRef?.type === "pr" && sourceRef.prNumber)) {
      setPrChangedFiles([]);
      setIsPrChangedFilesReady(true);
      return;
    }

    if (sourceChangedFiles.length > 0) {
      setPrChangedFiles(sourceChangedFiles);
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
  }, [repository, sourceChangedFiles, sourceRef?.prNumber, sourceRef?.type]);

  return {
    isPrChangedFilesReady,
    prChangedFiles,
  };
}

function usePullRequestApproval(params: {
  canApprovePullRequest: boolean;
  repository: { owner: string; repo: string };
  sourceRef: { type: "branch" | "pr"; prNumber?: number } | null;
  t: (key: string) => string;
}) {
  const { canApprovePullRequest, repository, sourceRef, t } = params;
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
    sourceRef?.type === "pr" && sourceRef.prNumber && canApprovePullRequest
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

function usePullRequestApprovalPermission(params: {
  repository: { owner: string; repo: string };
  sourceRef: { type: "branch" | "pr"; prNumber?: number } | null;
}) {
  const { repository, sourceRef } = params;
  const authChangeVersion = useSyncExternalStore(
    subscribeGitHubAuthChange,
    getGitHubAuthChangeVersion,
    getGitHubAuthChangeVersion
  );
  const [canApprovePullRequest, setCanApprovePullRequest] = useState(() =>
    getCachedPullRequestApprovalPermission(repository)
  );

  useEffect(() => {
    let cancelled = false;
    if (!(sourceRef?.type === "pr" && sourceRef.prNumber)) {
      setCanApprovePullRequest(false);
      return;
    }

    setCanApprovePullRequest(
      getCachedPullRequestApprovalPermission(repository)
    );
    void refreshPullRequestApprovalPermission(repository).then((canApprove) => {
      if (!cancelled) {
        setCanApprovePullRequest(canApprove);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    authChangeVersion,
    repository.owner,
    repository.repo,
    sourceRef?.prNumber,
    sourceRef?.type,
  ]);

  return canApprovePullRequest;
}

function useQuickPullRequestUpdate(params: {
  canUpdateCurrentPullRequest: boolean;
  changedFiles: Array<{ filePath: string; content: string }>;
  repository: { owner: string; repo: string };
  sourceRef: { type: "branch" | "pr"; prNumber?: number } | null;
  t: (key: string) => string;
}) {
  const {
    canUpdateCurrentPullRequest,
    changedFiles,
    repository,
    sourceRef,
    t,
  } = params;
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    setIsPublishing(false);
    setPublishError(null);
  }, [repository.owner, repository.repo, sourceRef?.prNumber, sourceRef?.type]);

  const run = useCallback(async () => {
    if (
      !(
        canUpdateCurrentPullRequest &&
        sourceRef?.type === "pr" &&
        sourceRef.prNumber
      )
    ) {
      return;
    }

    const token = getGitHubUserToken()?.trim() ?? "";
    if (!token) {
      setPublishError(t("githubAuth.emptyToken"));
      return;
    }
    if (changedFiles.length === 0) {
      setPublishError(t("publish.noChanges"));
      return;
    }

    setIsPublishing(true);
    setPublishError(null);
    try {
      await updatePullRequestHead(
        token,
        sourceRef.prNumber,
        changedFiles.map((file) => ({
          path: file.filePath,
          content: file.content,
        })),
        repository
      );
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : t("publish.updateError")
      );
    } finally {
      setIsPublishing(false);
    }
  }, [
    canUpdateCurrentPullRequest,
    changedFiles,
    repository,
    sourceRef?.prNumber,
    sourceRef?.type,
    t,
  ]);

  return {
    isPublishing,
    publishError,
    run,
  };
}

function useBankPublishAction(params: {
  canApprovePullRequest: boolean;
  changedFiles: Array<{ filePath: string; content: string }>;
  onOpenCreatePublish: () => void;
  repository: { owner: string; repo: string };
  sourceRef: { type: "branch" | "pr"; name: string; prNumber?: number } | null;
  t: (key: string) => string;
}) {
  const {
    canApprovePullRequest,
    changedFiles,
    onOpenCreatePublish,
    repository,
    sourceRef,
    t,
  } = params;
  const canUpdateCurrentPullRequest = Boolean(
    sourceRef?.type === "pr" && sourceRef.prNumber && canApprovePullRequest
  );
  const {
    isPublishing,
    publishError,
    run: runQuickPullRequestUpdate,
  } = useQuickPullRequestUpdate({
    canUpdateCurrentPullRequest,
    changedFiles,
    repository,
    sourceRef,
    t,
  });
  const publishActionLabel = canUpdateCurrentPullRequest
    ? isPublishing
      ? t("publish.publishing")
      : t("publish.updatePR")
    : t("publish.createPR");
  const onPublish = useCallback(() => {
    if (canUpdateCurrentPullRequest) {
      void runQuickPullRequestUpdate();
      return;
    }
    onOpenCreatePublish();
  }, [
    canUpdateCurrentPullRequest,
    onOpenCreatePublish,
    runQuickPullRequestUpdate,
  ]);

  return {
    canUpdateCurrentPullRequest,
    isPublishing,
    onPublish,
    publishActionLabel,
    publishError,
  };
}

type SwitchSourceHandler = (
  type: "branch" | "pr",
  name: string,
  prNumber?: number,
  shaHint?: string
) => Promise<void>;
type SwitchRepositoryHandler = (nextRepository: RepoRef) => Promise<void>;

function makeRouteSyncKey(params: {
  parsedRoute: ParsedBankRouteParams;
  routeRepository: RepoRef | null;
}): string {
  const { parsedRoute, routeRepository } = params;
  if (!parsedRoute.isStructuredRoute) {
    return "";
  }
  const repoKey = routeRepository
    ? `${routeRepository.owner}/${routeRepository.repo}`
    : "";
  if (!parsedRoute.source) {
    return `repo:${repoKey}|source:none`;
  }
  if (parsedRoute.source.type === "pr") {
    return `repo:${repoKey}|source:pr:${parsedRoute.source.prNumber}`;
  }
  return `repo:${repoKey}|source:branch:${parsedRoute.source.name}`;
}

async function syncRouteSource(params: {
  targetSource: BankRouteSource | null;
  switchSource: SwitchSourceHandler;
}) {
  const { targetSource, switchSource } = params;
  if (!targetSource) {
    return;
  }
  const currentSource = useSourceStore.getState().sourceRef;
  if (targetSource.type === "pr") {
    const alreadySelected =
      currentSource?.type === "pr" &&
      currentSource.prNumber === targetSource.prNumber;
    if (!alreadySelected) {
      await switchSource("pr", config.defaultBranch, targetSource.prNumber);
    }
    return;
  }

  const alreadySelected =
    currentSource?.type === "branch" &&
    currentSource.name === targetSource.name;
  if (!alreadySelected) {
    await switchSource("branch", targetSource.name);
  }
}

function useRouteStateSync(params: {
  parsedRoute: ParsedBankRouteParams;
  repository: RepoRef;
  sourceRef: SourceRef | null;
  switchRepository: SwitchRepositoryHandler;
  switchSource: SwitchSourceHandler;
}) {
  const { parsedRoute, repository, sourceRef, switchRepository, switchSource } =
    params;
  const [isRouteSyncInFlight, setIsRouteSyncInFlight] = useState(false);
  const [routeSyncAttemptKey, setRouteSyncAttemptKey] = useState<string | null>(
    null
  );

  const routeRepository = useMemo(
    () => resolveRouteRepository(parsedRoute.repoOwner, repository),
    [parsedRoute.repoOwner, repository]
  );
  const routeRepoMismatch = useMemo(() => {
    if (!routeRepository) {
      return false;
    }
    return (
      routeRepository.owner !== repository.owner ||
      routeRepository.repo !== repository.repo
    );
  }, [routeRepository, repository]);
  const routeSourceMismatch = useMemo(
    () => !isRouteSourceMatched(sourceRef, parsedRoute.source),
    [parsedRoute.source, sourceRef]
  );
  const routeSyncKey = useMemo(
    () => makeRouteSyncKey({ parsedRoute, routeRepository }),
    [parsedRoute, routeRepository]
  );
  const routeNeedsSync =
    parsedRoute.isStructuredRoute && (routeRepoMismatch || routeSourceMismatch);
  const waitForInitialSource = parsedRoute.isStructuredRoute && !sourceRef;
  const routeSyncPending =
    waitForInitialSource ||
    (routeNeedsSync && routeSyncAttemptKey !== routeSyncKey);

  useEffect(() => {
    setRouteSyncAttemptKey((current) =>
      current && current !== routeSyncKey ? null : current
    );
  }, [routeSyncKey]);

  useEffect(() => {
    if (!sourceRef) {
      return;
    }
    if (!routeNeedsSync) {
      return;
    }
    if (!routeSyncKey || routeSyncAttemptKey === routeSyncKey) {
      return;
    }

    let isCancelled = false;
    setRouteSyncAttemptKey(routeSyncKey);

    const runSync = async () => {
      setIsRouteSyncInFlight(true);
      try {
        if (routeRepository && routeRepoMismatch) {
          await switchRepository(routeRepository);
        }
        await syncRouteSource({
          targetSource: parsedRoute.source,
          switchSource,
        });
      } finally {
        if (!isCancelled) {
          setIsRouteSyncInFlight(false);
        }
      }
    };

    void runSync();
    return () => {
      isCancelled = true;
    };
  }, [
    parsedRoute.source,
    routeNeedsSync,
    routeRepoMismatch,
    routeRepository,
    sourceRef,
    routeSyncAttemptKey,
    routeSyncKey,
    switchRepository,
    switchSource,
  ]);

  return { isRouteSyncInFlight, routeSyncPending };
}

export function BankWorkspace() {
  const { t } = useTranslation();
  const routeParams = useParams();
  const [searchParams] = useSearchParams();
  const parsedRoute = useMemo(
    () =>
      parseBankRouteParams({
        bankKey: routeParams.bankKey,
        repoOwner: routeParams.repoOwner,
        branchOrPr: routeParams.branchOrPr,
      }),
    [routeParams.bankKey, routeParams.repoOwner, routeParams.branchOrPr]
  );
  const bankPath = parsedRoute.bankPath;
  const requestedFile = useMemo(
    () => decodeRequestedFileValue(searchParams),
    [searchParams]
  );

  const switchSource = useSwitchSource();
  const switchRepository = useSwitchRepository();
  const banks = useSourceStore((s) => s.banks);
  const setBanks = useSourceStore((s) => s.setBanks);
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const sourceChangedFiles = useSourceStore((s) => s.sourceChangedFiles);
  const repository = useSourceStore((s) => s.repository);
  const { isRouteSyncInFlight, routeSyncPending } = useRouteStateSync({
    parsedRoute,
    repository,
    sourceRef,
    switchRepository,
    switchSource,
  });

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
  const [quickCheckMode, setQuickCheckMode] =
    useState<QuickCheckMode>("template-by-sms");
  const [activeFormatSearchContext, setActiveFormatSearchContext] =
    useState<ActiveFormatSearchContext | null>(null);
  const [formatSearch, setFormatSearch] = useState("");
  const [formatTab, setFormatTab] = useState<"all" | "recent">("all");
  const sendersPath = `${bankPath}/senders.txt`;
  const { prChangedFiles, isPrChangedFilesReady } = usePullRequestChangedFiles({
    repository,
    sourceChangedFiles,
    sourceRef,
  });

  // Get all format files including draft-only (new) files
  const draftStore = useDraftStore();
  const changedFilesForPublish = useMemo(
    () =>
      draftStore
        .getChangedFiles()
        .filter((entry) => entry.filePath.startsWith(bankPath))
        .map((entry) => ({
          filePath: entry.filePath,
          content: entry.content,
        })),
    [bankPath, draftStore, draftStore.drafts]
  );
  const localChangedFiles = useMemo(
    () => draftStore.getChangedFiles().map((item) => item.filePath),
    [draftStore, draftStore.drafts]
  );
  const effectiveSourceChangedFiles = useMemo(
    () => (sourceChangedFiles.length > 0 ? sourceChangedFiles : prChangedFiles),
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
  const changedFormatPathsForValidation = useMemo(
    () => Array.from(changedFormatFiles),
    [changedFormatFiles]
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

  const applySelectionFromHistoryState = useCallback(
    (historyState: unknown): boolean => {
      const selection = readWorkspaceSelectionHistoryState(
        historyState,
        sourceSelectionKey
      );
      if (!selection) {
        return false;
      }
      if (selection.showSenders) {
        setShowSenders(true);
        setSelectedFile(null);
        return true;
      }
      if (!selection.selectedFile) {
        setShowSenders(false);
        setSelectedFile(null);
        return true;
      }
      if (!allFormatFiles.includes(selection.selectedFile)) {
        return false;
      }
      setShowSenders(false);
      setSelectedFile(selection.selectedFile);
      return true;
    },
    [allFormatFiles, sourceSelectionKey]
  );

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
      const currentSelection = readWorkspaceSelectionHistoryState(
        window.history.state,
        sourceSelectionKey
      );
      setSelectedFile(f);
      setShowSenders(false);
      if (
        !(
          currentSelection &&
          currentSelection.showSenders === false &&
          currentSelection.selectedFile === f
        )
      ) {
        writeWorkspaceSelectionHistoryState({
          mode: "push",
          workspaceKey: sourceSelectionKey,
          selectedFile: f,
          showSenders: false,
        });
      }
      addRecentFile(bankPath, f);
    },
    [bankPath, sourceSelectionKey]
  );

  const handleSelectSenders = useCallback(() => {
    const currentSelection = readWorkspaceSelectionHistoryState(
      window.history.state,
      sourceSelectionKey
    );
    setShowSenders(true);
    setSelectedFile(null);
    if (
      !(currentSelection?.showSenders && currentSelection.selectedFile === null)
    ) {
      writeWorkspaceSelectionHistoryState({
        mode: "push",
        workspaceKey: sourceSelectionKey,
        selectedFile: null,
        showSenders: true,
      });
    }
    addRecentFile(bankPath, sendersPath);
  }, [bankPath, sendersPath, sourceSelectionKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    applySelectionFromHistoryState(window.history.state);
  }, [applySelectionFromHistoryState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handlePopState = (event: PopStateEvent) => {
      applySelectionFromHistoryState(event.state);
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [applySelectionFromHistoryState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writeWorkspaceSelectionHistoryState({
      mode: "replace",
      workspaceKey: sourceSelectionKey,
      selectedFile,
      showSenders,
    });
  }, [selectedFile, showSenders, sourceSelectionKey]);

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
  const canApprovePullRequest = usePullRequestApprovalPermission({
    repository,
    sourceRef,
  });
  const {
    showApprovePullRequestButton,
    isApprovingPullRequest,
    isPullRequestApproved,
    approvePullRequestError,
    handleApprovePullRequest,
    approvePullRequestLabel,
  } = usePullRequestApproval({
    canApprovePullRequest,
    repository,
    sourceRef,
    t,
  });
  const {
    isPublishing: isPublishingQuickUpdate,
    publishError,
    onPublish: handlePublishAction,
    canUpdateCurrentPullRequest,
    publishActionLabel,
  } = useBankPublishAction({
    canApprovePullRequest,
    changedFiles: changedFilesForPublish,
    onOpenCreatePublish: () => setShowPublish(true),
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

  useEffect(() => {
    if (showSenders || !selectedFile) {
      setActiveFormatSearchContext(null);
      return;
    }
    setActiveFormatSearchContext((prev) =>
      prev?.filePath === selectedFile ? prev : null
    );
  }, [selectedFile, showSenders]);

  if (isRouteSyncInFlight || routeSyncPending) {
    return (
      <div className="flex items-center gap-sm">
        <span className="spinner" />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

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
          isPublishing={isPublishingQuickUpdate}
          isPullRequestApproved={isPullRequestApproved}
          onApprovePullRequest={() => {
            void handleApprovePullRequest();
          }}
          onOpenSmsByTemplate={() => {
            setQuickCheckMode("sms-by-template");
            setShowQuickCheck(true);
          }}
          onOpenTemplateBySms={() => {
            setQuickCheckMode("template-by-sms");
            setShowQuickCheck(true);
          }}
          onOpenValidation={() => setShowValidation(true)}
          onPublish={handlePublishAction}
          publishActionLabel={publishActionLabel}
          publishError={publishError}
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
          onFormatSearchContextChange: setActiveFormatSearchContext,
          onOpenSmsByTemplate: () => {
            setQuickCheckMode("sms-by-template");
            setShowQuickCheck(true);
          },
          onOpenTemplateBySms: () => {
            setQuickCheckMode("template-by-sms");
            setShowQuickCheck(true);
          },
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
      {showPublish && !canUpdateCurrentPullRequest && (
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
          changedFormatPaths={changedFormatPathsForValidation}
          onClose={() => setShowValidation(false)}
        />
      )}
      {showQuickCheck && (
        <QuickCheckPanel
          activeFormatContext={
            activeFormatSearchContext
              ? {
                  filePath: activeFormatSearchContext.filePath,
                  regex: activeFormatSearchContext.regex,
                  activeExampleIndex:
                    activeFormatSearchContext.activeExampleIndex,
                  activeSmsText: getActiveExampleText(
                    activeFormatSearchContext
                  ),
                }
              : null
          }
          bankName={displayName}
          formatPaths={allFormatFiles}
          initialMode={quickCheckMode}
          onClose={() => setShowQuickCheck(false)}
          onOpenFileInApp={handleSelectFile}
        />
      )}
    </div>
  );
}
