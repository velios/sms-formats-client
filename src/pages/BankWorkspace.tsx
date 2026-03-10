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
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { config } from "@/config";
import {
  type BankRouteSource,
  isRouteSourceMatched,
  type ParsedBankRouteParams,
  parseBankRouteParams,
  resolveRouteRepository,
} from "@/domain/bank-route";
import {
  calculateFormatIntersectionStats,
  parseFormatFile,
  type FormatIntersectionStat,
} from "@/domain/format";
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
  type CachedFormatEntry,
  prepareFormatEntries,
} from "@/features/quick-check/format-entries";
import {
  type QuickCheckActiveFormatContext,
  type QuickCheckMode,
  QuickCheckPanel,
} from "@/features/quick-check/QuickCheckPanel";
import { SendersEditor } from "@/features/senders-editor/SendersEditor";
import { ValidationPanel } from "@/features/validation/ValidationPanel";
import { useSwitchRepository, useSwitchSource } from "@/hooks/useGitHub";
import { cn } from "@/lib/utils";
import { useDraftStore, useSourceStore } from "@/store";

const RECENT_FILES_KEY = "sms-formats-recent-formats";
const MAX_RECENT_FILES = 10;
const SEARCH_EXAMPLE_MIN_QUERY_LENGTH = 2;
const SEARCH_INDEX_PARALLELISM = 4;

interface ActiveFormatSearchContext {
  filePath: string;
  regex: string;
  examples: string[];
  activeExampleIndex: number;
}

function getActiveExampleText(
  context: ActiveFormatSearchContext | null
): string {
  if (!context) {
    return "";
  }
  return context.examples[context.activeExampleIndex] ?? "";
}

function buildQuickCheckContextFromEntry(
  entry: CachedFormatEntry
): QuickCheckActiveFormatContext {
  return {
    filePath: entry.filePath,
    regex: entry.regex,
    activeExampleIndex: 0,
    activeSmsText: entry.examples[0] ?? "",
  };
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

function buildSelectionSearch(
  searchParams: URLSearchParams,
  filePath: string | null
): string {
  const nextSearchParams = new URLSearchParams(searchParams);
  if (filePath) {
    nextSearchParams.set("file", filePath);
  } else {
    nextSearchParams.delete("file");
  }
  const search = nextSearchParams.toString();
  return search ? `?${search}` : "";
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
  onSelectFile: (filePath: string | null, replace?: boolean) => void;
}) {
  const {
    requestedFile,
    allFormatFiles,
    sendersPath,
    preferredFormatFile,
    selectionReady,
    onSelectFile,
  } = params;

  useEffect(() => {
    if (!selectionReady) {
      return;
    }
    if (requestedFile === sendersPath) {
      return;
    }
    if (requestedFile && allFormatFiles.includes(requestedFile)) {
      return;
    }
    if (!preferredFormatFile) {
      if (requestedFile) {
        onSelectFile(null, true);
      }
      return;
    }
    if (requestedFile !== preferredFormatFile) {
      onSelectFile(preferredFormatFile, true);
    }
  }, [
    allFormatFiles,
    onSelectFile,
    preferredFormatFile,
    requestedFile,
    selectionReady,
    sendersPath,
  ]);
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

const workspacePanelHeaderClassName =
  "flex items-center justify-between border-b border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-4 py-2 text-[13px] font-semibold tracking-[0.5px] text-[color:var(--c-text-muted)] uppercase";

const workspaceTabsClassName =
  "flex gap-0 border-b border-[color:var(--c-border)]";

const workspaceTabClassName = (isActive: boolean) =>
  cn(
    "cursor-pointer border-x-0 border-t-0 border-b-2 border-solid px-4 py-2 font-sans text-[13px] font-medium transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)] focus-visible:ring-offset-[-2px]",
    isActive
      ? "border-b-[color:var(--c-accent)] bg-[color:var(--c-bg-surface)] text-[color:var(--c-accent)] shadow-[inset_0_-1px_0_var(--c-accent-soft)]"
      : "border-b-transparent text-[color:var(--c-text-muted)] hover:border-b-[color:var(--c-accent-soft)] hover:bg-[color:var(--c-bg-surface)] hover:text-[color:var(--c-accent)]"
  );

const workspaceFileRowClassName = (params: {
  isDeleted: boolean;
  isSelected: boolean;
}) =>
  cn(
    "flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px]",
    params.isSelected
      ? "bg-[color:var(--c-bg-hover)] text-[color:var(--c-accent)]"
      : "hover:bg-[color:var(--c-bg-hover)]",
    params.isDeleted &&
      "line-through decoration-1 decoration-current opacity-80"
  );

const workspaceExternalLinkClassName =
  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-[color:var(--c-text-dim)] no-underline hover:bg-[color:var(--c-accent-soft)] hover:text-[color:var(--c-accent)] hover:no-underline";

const workspaceActionButtonClassName =
  "min-h-[38px] w-full justify-start whitespace-normal px-3 py-1.5 text-left text-[13px] leading-[1.3]";

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
    <div className="flex h-full items-center justify-center text-[color:var(--c-text-muted)]">
      {t("bank.files")}: {t("bank.noResults")}
    </div>
  );
}

function BankActionsPanel(params: {
  onApprovePullRequest: () => void;
  onCalculateIntersections: () => void;
  onOpenValidation: () => void;
  onPublish: () => void;
  onResetToSource: () => void;
  onOpenSmsByTemplate: () => void;
  onOpenTemplateBySms: () => void;
  approvePullRequestError: string | null;
  approvePullRequestLabel: string;
  calculateIntersectionsError: string | null;
  calculateIntersectionsWarning: string | null;
  canResetToSource: boolean;
  publishError: string | null;
  publishActionLabel: string;
  isCalculatingIntersections: boolean;
  isPublishing: boolean;
  isApprovingPullRequest: boolean;
  isPullRequestApproved: boolean;
  showApprovePullRequestButton: boolean;
  t: (key: string) => string;
}): ReactNode {
  const {
    onApprovePullRequest,
    onCalculateIntersections,
    onOpenValidation,
    onPublish,
    onResetToSource,
    onOpenSmsByTemplate,
    onOpenTemplateBySms,
    approvePullRequestError,
    approvePullRequestLabel,
    calculateIntersectionsError,
    calculateIntersectionsWarning,
    canResetToSource,
    publishError,
    publishActionLabel,
    isCalculatingIntersections,
    isPublishing,
    isApprovingPullRequest,
    isPullRequestApproved,
    showApprovePullRequestButton,
    t,
  } = params;

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        className={workspaceActionButtonClassName}
        disabled={isPublishing}
        onClick={onPublish}
        type="button"
        variant="primary"
      >
        {isPublishing ? <Spinner /> : null}
        {publishActionLabel}
      </Button>
      {publishError && (
        <StatusBadge variant="error">{publishError}</StatusBadge>
      )}
      {showApprovePullRequestButton && (
        <Button
          className={workspaceActionButtonClassName}
          disabled={isApprovingPullRequest || isPullRequestApproved}
          onClick={onApprovePullRequest}
          type="button"
          variant={isPullRequestApproved ? "success" : "default"}
        >
          {approvePullRequestLabel}
        </Button>
      )}
      {approvePullRequestError && (
        <StatusBadge variant="error">{approvePullRequestError}</StatusBadge>
      )}
      <Button
        className={workspaceActionButtonClassName}
        onClick={onOpenValidation}
        type="button"
        variant="default"
      >
        {t("editor.validation")}
      </Button>
      <Button
        className={workspaceActionButtonClassName}
        onClick={onOpenTemplateBySms}
        type="button"
        variant="default"
      >
        {t("quickCheck.openTemplateBySms")}
      </Button>
      <Button
        className={workspaceActionButtonClassName}
        onClick={onOpenSmsByTemplate}
        type="button"
        variant="default"
      >
        {t("quickCheck.openSmsByTemplate")}
      </Button>
      <Button
        className={workspaceActionButtonClassName}
        disabled={isCalculatingIntersections}
        onClick={onCalculateIntersections}
        type="button"
        variant="default"
      >
        {isCalculatingIntersections ? <Spinner /> : null}
        {t(
          isCalculatingIntersections
            ? "quickCheck.calculatingIntersections"
            : "quickCheck.calculateIntersections"
        )}
      </Button>
      {calculateIntersectionsError && (
        <StatusBadge variant="error">{calculateIntersectionsError}</StatusBadge>
      )}
      {calculateIntersectionsWarning && (
        <StatusBadge variant="warning">
          {calculateIntersectionsWarning}
        </StatusBadge>
      )}
      <Button
        className={workspaceActionButtonClassName}
        disabled={!canResetToSource}
        onClick={onResetToSource}
        type="button"
        variant="default"
      >
        {t("bank.resetToSource")}
      </Button>
    </div>
  );
}

export function FormatsPanel(params: {
  t: (key: string) => string;
  tTemplate: (key: string, options?: Record<string, unknown>) => string;
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
  deletedFormatFiles: Set<string>;
  localChangedFormatFiles: Set<string>;
  sourceChangedFormatFiles: Set<string>;
  formatIntersectionStats: Map<string, FormatIntersectionStat>;
  selectedFile: string | null;
  showSenders: boolean;
  handleSelectSenders: () => void;
  handleSelectFile: (path: string) => void;
  onOpenSmsByTemplateForIntersection: (filePath: string) => void;
  repository: { owner: string; repo: string };
  refName: string;
  sendersPath: string;
  sendersMissing: boolean;
  localSendersChanged: boolean;
  sourceSendersChanged: boolean;
}): ReactNode {
  const {
    t,
    tTemplate,
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
    deletedFormatFiles,
    localChangedFormatFiles,
    sourceChangedFormatFiles,
    formatIntersectionStats,
    selectedFile,
    showSenders,
    handleSelectSenders,
    handleSelectFile,
    onOpenSmsByTemplateForIntersection,
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)]">
      <div className={workspacePanelHeaderClassName}>
        <span>
          {t("bank.files")}{" "}
          <span className="text-[color:var(--c-text-muted)] text-xs">
            ({totalFilesCount})
          </span>
        </span>
        <Button
          aria-label={t("bank.createFormat")}
          onClick={() => setShowCreateFormat(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          +
        </Button>
      </div>
      <div className={workspaceTabsClassName}>
        <button
          className={workspaceTabClassName(formatTab === "all")}
          onClick={() => setFormatTab("all")}
        >
          {t("bank.allFiles")}
        </button>
        <button
          className={workspaceTabClassName(formatTab === "recent")}
          onClick={() => setFormatTab("recent")}
        >
          {t("bank.recentFiles")}
        </button>
      </div>
      <div className="border-[color:var(--c-border)] border-b p-2">
        <Input
          aria-label={t("bank.searchFile")}
          className="h-7 px-2 py-1 text-xs"
          onChange={(e) => setFormatSearch(e.target.value)}
          placeholder={t("bank.searchFile")}
          value={formatSearch}
        />
        {showSearchIndexStatus && (
          <div className="mt-1.5 text-[color:var(--c-text-muted)] text-xs">
            {searchIndexingLabel}
          </div>
        )}
      </div>
      <div className="min-h-0 overflow-y-auto">
        {filesForRender.map((path) => {
          const isSenders = path === sendersPath;
          const displayName = isSenders
            ? "senders.txt"
            : extractFormatFileName(path);
          const isSelected = isSenders ? showSenders : selectedFile === path;
          const isDeleted = !isSenders && deletedFormatFiles.has(path);
          const isLocalChanged = isSenders
            ? localSendersChanged
            : localChangedFormatFiles.has(path);
          const isSourceChanged = isSenders
            ? !localSendersChanged && sourceSendersChanged
            : !isLocalChanged && sourceChangedFormatFiles.has(path);
          const intersectionStats = isSenders
            ? null
            : formatIntersectionStats.get(path) ?? null;
          const ownExamplesMatch =
            intersectionStats?.totalExamples ===
            intersectionStats?.ownMatchedExamples;
          const ownExamplesClassName = ownExamplesMatch
            ? "text-[color:var(--c-success)]"
            : "rounded px-1 text-white bg-[color:var(--c-error)]";
          const intersectionsClassName =
            intersectionStats?.intersectingOtherFormats === 0
              ? "text-[color:var(--c-success)]"
              : "rounded px-1 text-white bg-[color:var(--c-error)]";
          const hasIntersectingFormats =
            (intersectionStats?.intersectingOtherFormats ?? 0) > 0;
          const encodedPath = path.split("/").map(encodeURIComponent).join("/");
          const repoUrl = `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;
          return (
            <div
              className={workspaceFileRowClassName({
                isDeleted,
                isSelected,
              })}
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
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-mono text-sm">{displayName}</span>
                {intersectionStats && (
                  <span className="shrink-0 rounded border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-1.5 py-0.5 font-mono text-[11px] leading-none tabular-nums text-[color:var(--c-text-muted)]">
                    <span className={ownExamplesClassName}>
                      {intersectionStats.totalExamples}
                    </span>{" "}
                    /{" "}
                    <span className={ownExamplesClassName}>
                      {intersectionStats.ownMatchedExamples}
                    </span>{" "}
                    /{" "}
                    {hasIntersectingFormats ? (
                      <button
                        aria-label={tTemplate(
                          "quickCheck.openIntersectingSmsByTemplate",
                          {
                            count: intersectionStats.intersectingOtherFormats,
                            file: displayName,
                          }
                        )}
                        className={cn(
                          intersectionsClassName,
                          "cursor-pointer appearance-none border-0 [font:inherit] transition-[color,background-color,opacity,box-shadow] duration-150 hover:bg-[color:var(--c-error-soft)] hover:text-[color:var(--c-error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)]"
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenSmsByTemplateForIntersection(path);
                        }}
                        type="button"
                      >
                        {intersectionStats.intersectingOtherFormats}
                      </button>
                    ) : (
                      <span className={intersectionsClassName}>
                        {intersectionStats.intersectingOtherFormats}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {isLocalChanged && (
                <StatusBadge className="text-xs" variant="modified">
                  ●
                </StatusBadge>
              )}
              {isSourceChanged && (
                <StatusBadge className="text-xs" variant="warning">
                  ●
                </StatusBadge>
              )}
              {isSenders && sendersMissing && (
                <StatusBadge variant="warning">!</StatusBadge>
              )}
              <a
                aria-label={`${t("bank.openFormatInRepo")}: ${displayName}`}
                className={cn(workspaceExternalLinkClassName, "ml-auto")}
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
          <div className="p-4 text-[color:var(--c-text-muted)] text-xs">
            {t("bank.noResults")}
          </div>
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
  currentRequestedFile: string | null;
  replaceRequestedFile: (filePath: string | null) => void;
}): boolean {
  const {
    fromPath,
    toPath,
    bankPath,
    allFormatFiles,
    draftStore,
    setBanks,
    currentRequestedFile,
    replaceRequestedFile,
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

  if (currentRequestedFile === fromPath) {
    replaceRequestedFile(toPath);
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
  changedFiles: Array<{
    filePath: string;
    content: string;
    isDeleted: boolean;
  }>;
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
          content: file.isDeleted ? undefined : file.content,
          delete: file.isDeleted,
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
  changedFiles: Array<{
    filePath: string;
    content: string;
    isDeleted: boolean;
  }>;
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
    return `repo:${repoKey}|source:pr:${parsedRoute.source.prNumber}:${parsedRoute.source.sha ?? ""}`;
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
      currentSource.prNumber === targetSource.prNumber &&
      (!targetSource.sha || currentSource.sha === targetSource.sha);
    if (!alreadySelected) {
      await switchSource(
        "pr",
        config.defaultBranch,
        targetSource.prNumber,
        targetSource.sha
      );
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
    () => resolveRouteRepository(parsedRoute.repoSlug),
    [parsedRoute.repoSlug]
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
  const location = useLocation();
  const navigate = useNavigate();
  const routeParams = useParams();
  const [searchParams] = useSearchParams();
  const parsedRoute = useMemo(
    () =>
      parseBankRouteParams({
        bankKey: routeParams.bankKey,
        repoSlug: routeParams.repoSlug,
        branchOrPr: routeParams.branchOrPr,
        commit: searchParams.get("commit"),
      }),
    [
      routeParams.bankKey,
      routeParams.repoSlug,
      routeParams.branchOrPr,
      searchParams,
    ]
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
  const tree = useSourceStore((s) => s.tree);
  const [showCreateFormat, setShowCreateFormat] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showQuickCheck, setShowQuickCheck] = useState(false);
  const [quickCheckAutoRunOnOpen, setQuickCheckAutoRunOnOpen] = useState(false);
  const [quickCheckMode, setQuickCheckMode] =
    useState<QuickCheckMode>("template-by-sms");
  const [formatIntersectionStats, setFormatIntersectionStats] = useState<
    Map<string, FormatIntersectionStat>
  >(new Map());
  const [intersectionFormatEntries, setIntersectionFormatEntries] = useState<
    Map<string, CachedFormatEntry>
  >(new Map());
  const [hasCalculatedIntersections, setHasCalculatedIntersections] =
    useState(false);
  const [intersectionLoadErrorsCount, setIntersectionLoadErrorsCount] =
    useState(0);
  const [calculateIntersectionsError, setCalculateIntersectionsError] =
    useState<string | null>(null);
  const [isCalculatingIntersections, setIsCalculatingIntersections] =
    useState(false);
  const intersectionRunIdRef = useRef(0);
  const [activeFormatSearchContext, setActiveFormatSearchContext] =
    useState<ActiveFormatSearchContext | null>(null);
  const [quickCheckActiveFormatContextOverride, setQuickCheckActiveFormatContextOverride] =
    useState<QuickCheckActiveFormatContext | null>(null);
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
          isDeleted: entry.isDeleted,
          baseSha: entry.baseSha,
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
  const localDeletedFormatFiles = useMemo(
    () =>
      new Set(
        draftStore
          .getDeletedFiles()
          .filter(
            (entry) =>
              entry.filePath.startsWith(`${bankPath}/formats/`) &&
              entry.filePath.endsWith(".txt")
          )
          .map((entry) => entry.filePath)
      ),
    [bankPath, draftStore, draftStore.drafts]
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
  const quickCheckFormatPaths = useMemo(
    () =>
      allFormatFiles.filter(
        (filePath) => !localDeletedFormatFiles.has(filePath)
      ),
    [allFormatFiles, localDeletedFormatFiles]
  );

  const sourceRefNameForContent = sourceRef?.sha ?? sourceRef?.name;

  useEffect(() => {
    intersectionRunIdRef.current += 1;
    setFormatIntersectionStats(new Map());
    setIntersectionFormatEntries(new Map());
    setHasCalculatedIntersections(false);
    setIntersectionLoadErrorsCount(0);
    setCalculateIntersectionsError(null);
    setIsCalculatingIntersections(false);
  }, [
    bankPath,
    draftStore.drafts,
    quickCheckFormatPaths,
    repository.owner,
    repository.repo,
    sourceRefNameForContent,
  ]);

  const navigateToRequestedFile = useCallback(
    (filePath: string | null, replace = false) => {
      const search = buildSelectionSearch(searchParams, filePath);
      const nextPath = `${location.pathname}${search}`;
      navigate(nextPath, { replace });
    },
    [location.pathname, navigate, searchParams]
  );

  const showSenders = requestedFile === sendersPath;
  const selectedFile = useMemo(
    () =>
      requestedFile && requestedFile !== sendersPath && allFormatFiles.includes(requestedFile)
        ? requestedFile
        : null,
    [allFormatFiles, requestedFile, sendersPath]
  );

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
      if (requestedFile !== f) {
        navigateToRequestedFile(f);
      }
      addRecentFile(bankPath, f);
    },
    [bankPath, navigateToRequestedFile, requestedFile]
  );

  const handleSelectSenders = useCallback(() => {
    if (requestedFile !== sendersPath) {
      navigateToRequestedFile(sendersPath);
    }
    addRecentFile(bankPath, sendersPath);
  }, [bankPath, navigateToRequestedFile, requestedFile, sendersPath]);

  const handleCalculateIntersections = useCallback(async () => {
    if (
      hasCalculatedIntersections &&
      !window.confirm(t("quickCheck.recalculateIntersectionsConfirm"))
    ) {
      return;
    }

    const runId = intersectionRunIdRef.current + 1;
    intersectionRunIdRef.current = runId;

    if (!sourceRefNameForContent) {
      setCalculateIntersectionsError(t("quickCheck.noSource"));
      setFormatIntersectionStats(new Map());
      setIntersectionLoadErrorsCount(0);
      setIsCalculatingIntersections(false);
      return;
    }

    setIsCalculatingIntersections(true);
    setCalculateIntersectionsError(null);
    setIntersectionLoadErrorsCount(0);

    try {
      const prepared = await prepareFormatEntries({
        filePaths: quickCheckFormatPaths,
        draftStore,
        sourceRefName: sourceRefNameForContent,
        repository,
      });
      if (intersectionRunIdRef.current !== runId) {
        return;
      }

      setFormatIntersectionStats(
        calculateFormatIntersectionStats(prepared.entries)
      );
      setIntersectionFormatEntries(
        new Map(prepared.entries.map((entry) => [entry.filePath, entry]))
      );
      setHasCalculatedIntersections(true);
      setIntersectionLoadErrorsCount(prepared.loadErrorsCount);
    } catch {
      if (intersectionRunIdRef.current !== runId) {
        return;
      }
      setFormatIntersectionStats(new Map());
      setIntersectionFormatEntries(new Map());
      setHasCalculatedIntersections(true);
      setIntersectionLoadErrorsCount(0);
      setCalculateIntersectionsError(
        t("quickCheck.intersectionsUnexpectedError")
      );
    } finally {
      if (intersectionRunIdRef.current === runId) {
        setIsCalculatingIntersections(false);
      }
    }
  }, [
    draftStore,
    hasCalculatedIntersections,
    quickCheckFormatPaths,
    repository,
    sourceRefNameForContent,
    t,
  ]);

  const handleOpenSmsByTemplateForIntersection = useCallback(
    (filePath: string) => {
      const entry = intersectionFormatEntries.get(filePath);
      if (!entry || !entry.regex.trim()) {
        return;
      }

      setQuickCheckActiveFormatContextOverride(
        buildQuickCheckContextFromEntry(entry)
      );
      setQuickCheckAutoRunOnOpen(true);
      setQuickCheckMode("sms-by-template");
      setShowQuickCheck(true);
    },
    [intersectionFormatEntries]
  );

  const quickCheckActiveFormatContext =
    quickCheckActiveFormatContextOverride ??
    (activeFormatSearchContext
      ? {
          filePath: activeFormatSearchContext.filePath,
          regex: activeFormatSearchContext.regex,
          activeExampleIndex: activeFormatSearchContext.activeExampleIndex,
          activeSmsText: getActiveExampleText(activeFormatSearchContext),
        }
      : null);

  const handleRenameFile = useCallback(
    (fromPath: string, toPath: string): boolean => {
      return renameDraftFormat({
        fromPath,
        toPath,
        bankPath,
        allFormatFiles,
        draftStore,
        setBanks,
        currentRequestedFile: requestedFile,
        replaceRequestedFile: (filePath) => navigateToRequestedFile(filePath, true),
      });
    },
    [
      allFormatFiles,
      bankPath,
      draftStore,
      navigateToRequestedFile,
      requestedFile,
      setBanks,
    ]
  );

  const localSendersChanged = localChangedFilesInBank.has(sendersPath);
  const sourceSendersChanged =
    !localSendersChanged && sourceChangedFilesInBank.has(sendersPath);
  const sendersMissing =
    !!bank && !bank.hasSenders && !draftStore.getDraft(sendersPath);
  const canResetToSource = localChangedFilesInBank.size > 0;
  const handleResetToSource = useCallback(() => {
    draftStore.resetBankToRemote(bankPath);

    const hasRemoteBank = tree.some(
      (entry) =>
        entry.path === bankPath || entry.path.startsWith(`${bankPath}/`)
    );
    if (!hasRemoteBank) {
      const hasRemainingDrafts = Array.from(
        useDraftStore.getState().drafts.keys()
      ).some((path) => path.startsWith(`${bankPath}/`));
      if (!hasRemainingDrafts) {
        setBanks(
          useSourceStore
            .getState()
            .banks.filter((item) => item.folderPath !== bankPath)
        );
        if (requestedFile) {
          navigateToRequestedFile(null, true);
        }
      }
    }
  }, [bankPath, draftStore, navigateToRequestedFile, requestedFile, setBanks, tree]);
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
    onSelectFile: navigateToRequestedFile,
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
      <div className="flex items-center gap-2">
        <Spinner />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  if (!bank && allFormatFiles.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-[color:var(--c-text-muted)]">
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
    <div className="grid h-full min-h-0 grid-cols-[320px_1fr] gap-6">
      {/* ─── Sidebar ─── */}
      <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
        <div className="flex items-center gap-2">
          <h2 className="truncate font-semibold" style={{ fontSize: 16 }}>
            {displayName}
          </h2>
          <a
            aria-label={t("bank.openBankFolderInRepo")}
            className={workspaceExternalLinkClassName}
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
          calculateIntersectionsError={calculateIntersectionsError}
          calculateIntersectionsWarning={
            intersectionLoadErrorsCount > 0
              ? t("quickCheck.summaryLoadErrors", {
                  count: intersectionLoadErrorsCount,
                })
              : null
          }
          canResetToSource={canResetToSource}
          isCalculatingIntersections={isCalculatingIntersections}
          isApprovingPullRequest={isApprovingPullRequest}
          isPublishing={isPublishingQuickUpdate}
          isPullRequestApproved={isPullRequestApproved}
          onApprovePullRequest={() => {
            void handleApprovePullRequest();
          }}
          onCalculateIntersections={() => {
            void handleCalculateIntersections();
          }}
          onOpenSmsByTemplate={() => {
            setQuickCheckActiveFormatContextOverride(null);
            setQuickCheckAutoRunOnOpen(false);
            setQuickCheckMode("sms-by-template");
            setShowQuickCheck(true);
          }}
          onOpenTemplateBySms={() => {
            setQuickCheckActiveFormatContextOverride(null);
            setQuickCheckAutoRunOnOpen(false);
            setQuickCheckMode("template-by-sms");
            setShowQuickCheck(true);
          }}
          onOpenValidation={() => setShowValidation(true)}
          onPublish={handlePublishAction}
          onResetToSource={handleResetToSource}
          publishActionLabel={publishActionLabel}
          publishError={publishError}
          showApprovePullRequestButton={showApprovePullRequestButton}
          t={t}
        />

        <FormatsPanel
          deletedFormatFiles={localDeletedFormatFiles}
          formatIntersectionStats={formatIntersectionStats}
          formatSearch={formatSearch}
          formatTab={formatTab}
          handleSelectFile={handleSelectFile}
          handleSelectSenders={handleSelectSenders}
          localChangedFormatFiles={localChangedFormatFiles}
          localSendersChanged={localSendersChanged}
          onOpenSmsByTemplateForIntersection={
            handleOpenSmsByTemplateForIntersection
          }
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
          tTemplate={t}
          totalFilesCount={allFormatFiles.length + 1}
          visibleFormats={filteredFormatFiles}
        />
      </div>

      {/* ─── Main content ─── */}
      <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
        {renderWorkspaceContent({
          showSenders,
          bankPath,
          selectedFile,
          allFormatFiles,
          handleRenameFile,
          onFormatSearchContextChange: setActiveFormatSearchContext,
          onOpenSmsByTemplate: () => {
            setQuickCheckActiveFormatContextOverride(null);
            setQuickCheckAutoRunOnOpen(false);
            setQuickCheckMode("sms-by-template");
            setShowQuickCheck(true);
          },
          onOpenTemplateBySms: () => {
            setQuickCheckActiveFormatContextOverride(null);
            setQuickCheckAutoRunOnOpen(false);
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
          activeFormatContext={quickCheckActiveFormatContext}
          autoRunOnOpen={quickCheckAutoRunOnOpen}
          bankName={displayName}
          formatPaths={quickCheckFormatPaths}
          initialMode={quickCheckMode}
          onClose={() => {
            setQuickCheckAutoRunOnOpen(false);
            setShowQuickCheck(false);
          }}
          onOpenFileInApp={handleSelectFile}
        />
      )}
    </div>
  );
}
