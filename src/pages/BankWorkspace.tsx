import { useQueryClient } from "@tanstack/react-query";
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
  getLegacyRouteRedirectPath,
  parsePullRequestRouteParams,
} from "@/domain/bank-route";
import {
  type FormatIntersectionStat,
  isBankFormatFilePath,
  parseFormatFile,
  testRegex,
} from "@/domain/format";
import {
  approvePullRequest,
  fetchFileContent,
  fetchOpenPRs,
  fetchPullRequestApprovalByCurrentUser,
  fetchPullRequestFiles,
  fetchRepoTree,
  getCachedPullRequestApprovalPermission,
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
  indexBanksFromTree,
  type PullRequestChangedFile,
  refreshPullRequestApprovalPermission,
  resolvePullRequestWorkspace,
  subscribeGitHubAuthChange,
  updatePullRequestHead,
} from "@/domain/github";
import { type FormatSearchDoc, searchFormatPaths } from "@/domain/search";
import type { BankInfo, RepoRef, SourceRef } from "@/domain/types";
import { validateBankLevel } from "@/domain/validation";
import type {
  BankFileRecord,
  SourceChangeRecord,
} from "@/features/bank-inventory/core";
import { useBankInventory } from "@/features/bank-inventory/use-bank-inventory";
import { CreateFormatModal } from "@/features/create-entity/CreateFormatModal";
import { FormatEditor } from "@/features/format-editor/FormatEditor";
import { normalizeIntersectionExample } from "@/features/intersections/core";
import { useIntersections } from "@/features/intersections/use-intersections";
import { resolvePublishPreflightState } from "@/features/publish-panel/PublishPanel";
import {
  type CommitMessageInput,
  UpdatePullRequestDialog,
} from "@/features/publish-panel/UpdatePullRequestDialog";
import type { CachedFormatEntry } from "@/features/quick-check/format-entries";
import {
  type QuickCheckMode,
  QuickCheckPanel,
} from "@/features/quick-check/QuickCheckPanel";
import { SendersEditor } from "@/features/senders-editor/SendersEditor";
import { ValidationPanel } from "@/features/validation/ValidationPanel";
import {
  type WorkspaceEditorMode,
  WorkspaceHeaderBar,
} from "@/features/workspace-header/WorkspaceHeaderBar";
import { openPrsQueryKey } from "@/hooks/useGitHub";
import { cn } from "@/lib/utils";
import {
  useDraftStore,
  useSourceStore,
  waitForDraftStoreHydration,
} from "@/store";
import { makeDraftSourceKey } from "@/store/draft-scope";
import { useFileContentStore } from "@/store/file-content-store";
import {
  clearWorkspaceSession,
  loadWorkspaceSession,
  saveWorkspaceSession,
} from "@/store/workspace-session";

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

interface IntersectionExampleItem {
  text: string;
  filePath: string;
  fileName: string;
}

function getActiveExampleText(
  context: ActiveFormatSearchContext | null
): string {
  if (!context) {
    return "";
  }
  return context.examples[context.activeExampleIndex] ?? "";
}

function collectIntersectingExamples(params: {
  activeFilePath: string | null;
  activeRegex: string;
  entries: CachedFormatEntry[];
}): IntersectionExampleItem[] {
  const { activeFilePath, activeRegex, entries } = params;
  if (!(activeFilePath && activeRegex.trim())) {
    return [];
  }

  const seenExamples = new Set<string>();
  const result: IntersectionExampleItem[] = [];

  for (const entry of entries) {
    if (entry.filePath === activeFilePath) {
      continue;
    }

    for (const example of entry.examples) {
      const normalizedExample = normalizeIntersectionExample(example);
      const dedupeKey = `${entry.filePath}\u0000${normalizedExample}`;
      if (!normalizedExample || seenExamples.has(dedupeKey)) {
        continue;
      }

      if (!testRegex(activeRegex, normalizedExample).matched) {
        continue;
      }

      seenExamples.add(dedupeKey);
      result.push({
        text: normalizedExample,
        filePath: entry.filePath,
        fileName: entry.fileName,
      });
    }
  }

  return result;
}

const formatIntersectionMetricClassName =
  "inline-flex h-4 shrink-0 items-center justify-center rounded px-1 align-middle leading-none";

function FormatIntersectionMetric(params: {
  value: number;
  tone: "success" | "error";
  ariaLabel?: string;
  onClick?: () => void;
}): ReactNode {
  const { value, tone, ariaLabel, onClick } = params;
  const className = cn(
    formatIntersectionMetricClassName,
    tone === "success"
      ? "text-[color:var(--c-success)]"
      : "bg-[color:var(--c-error)] text-white",
    onClick &&
      "cursor-pointer appearance-none border-0 transition-[color,background-color,opacity,box-shadow] duration-150 [font:inherit] hover:bg-[color:var(--c-error-soft)] hover:text-[color:var(--c-error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)]"
  );

  if (onClick) {
    return (
      <button
        aria-label={ariaLabel}
        className={className}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        type="button"
      >
        {value}
      </button>
    );
  }

  return <span className={className}>{value}</span>;
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

function extractFormatFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function extractExamplesForSearch(content: string, filePath: string): string {
  return parseFormatFile(content, filePath).examples.join("\n");
}

function shouldStartExampleIndexing(
  query: string,
  formatTab: "all" | "recent" | "intersections"
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
  formatTab: "all" | "recent" | "intersections";
  bankPath: string;
  prNumber: number | null;
  repository: { owner: string; repo: string };
  sourceHeadSha: string | null;
}) {
  const {
    allFormatFiles,
    changedFormatFiles,
    draftStore,
    formatSearch,
    formatTab,
    bankPath,
    prNumber,
    repository,
    sourceHeadSha,
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
  const searchSessionId = `${repository.owner}/${repository.repo}:${sourceHeadSha ?? ""}:${bankPath}`;

  useEffect(() => {
    indexingSessionRef.current = searchSessionId;
    inFlightSearchPathsRef.current.clear();
    setIndexingInFlight(0);
    setIndexingErrors(0);
  }, [searchSessionId]);

  const loadRemoteSearchDoc = useCallback(
    async (path: string, sessionId: string) => {
      if (!(prNumber && sourceHeadSha)) {
        return;
      }
      try {
        await useFileContentStore.getState().primeFileContent({
          repository,
          prNumber,
          filePath: path,
          refName: sourceHeadSha,
          headSha: sourceHeadSha,
          loadedFrom: "search-index",
        });
        if (indexingSessionRef.current !== sessionId) {
          return;
        }
        const remoteContent = useFileContentStore
          .getState()
          .getCachedFileContent({
            repository,
            prNumber,
            filePath: path,
            headSha: sourceHeadSha,
          });
        if (typeof remoteContent !== "string") {
          throw new Error("missing-file-cache-entry");
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
    [prNumber, repository, sourceHeadSha]
  );

  useEffect(() => {
    if (!(shouldIndexExamples && prNumber && sourceHeadSha)) {
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
    prNumber,
    sourceHeadSha,
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
  workspaceReady: boolean;
  requestedFile: string | null;
  allFormatFiles: string[];
  sendersPath: string;
  preferredFormatFile: string | null;
  selectionReady: boolean;
  onSelectFile: (filePath: string | null, replace?: boolean) => void;
}) {
  const {
    workspaceReady,
    requestedFile,
    allFormatFiles,
    sendersPath,
    preferredFormatFile,
    selectionReady,
    onSelectFile,
  } = params;

  useEffect(() => {
    const nextSelection = resolveAutoSelectFile({
      workspaceReady,
      selectionReady,
      requestedFile,
      allFormatFiles,
      sendersPath,
      preferredFormatFile,
    });
    if (typeof nextSelection === "undefined") {
      return;
    }
    onSelectFile(nextSelection, true);
  }, [
    allFormatFiles,
    onSelectFile,
    preferredFormatFile,
    requestedFile,
    selectionReady,
    sendersPath,
    workspaceReady,
  ]);
}

export function resolveAutoSelectFile(params: {
  workspaceReady: boolean;
  selectionReady: boolean;
  requestedFile: string | null;
  allFormatFiles: string[];
  sendersPath: string;
  preferredFormatFile: string | null;
}): string | null | undefined {
  const {
    workspaceReady,
    selectionReady,
    requestedFile,
    allFormatFiles,
    sendersPath,
    preferredFormatFile,
  } = params;
  if (!(workspaceReady && selectionReady)) {
    return undefined;
  }
  if (requestedFile === sendersPath) {
    return undefined;
  }
  if (requestedFile && allFormatFiles.includes(requestedFile)) {
    return undefined;
  }
  if (!preferredFormatFile) {
    return requestedFile ? null : undefined;
  }
  return requestedFile !== preferredFormatFile
    ? preferredFormatFile
    : undefined;
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
  "flex min-h-10 items-center justify-between border-b border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-4 py-1 text-[12px] font-semibold tracking-[0.5px] text-[color:var(--c-text-muted)] uppercase";

const workspaceTabsClassName =
  "flex gap-0 border-b border-[color:var(--c-border)]";

const workspaceTabClassName = (isActive: boolean) =>
  cn(
    "cursor-pointer border-x-0 border-t-0 border-b-2 border-solid px-4 py-2 font-medium font-sans text-[13px] transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)] focus-visible:ring-offset-[-2px]",
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
  readOnly: boolean;
  selectedFile: string | null;
  selectedFileIntersectionExamples: IntersectionExampleItem[];
  selectedFileSourceDeletedBaseSha: string | null;
  editorMode: WorkspaceEditorMode;
  onFormatSearchContextChange: (context: ActiveFormatSearchContext) => void;
  onFormatRegexBlurAfterEdit: (context: {
    filePath: string;
    regex: string;
    examples: string[];
  }) => void;
  onOpenIntersectionFileInApp: (filePath: string) => void;
  onOpenTemplateBySms: () => void;
  onOpenSmsByTemplate: () => void;
  t: (key: string) => string;
}): ReactNode {
  const {
    showSenders,
    bankPath,
    readOnly,
    selectedFile,
    selectedFileIntersectionExamples,
    selectedFileSourceDeletedBaseSha,
    editorMode,
    onFormatSearchContextChange,
    onFormatRegexBlurAfterEdit,
    onOpenIntersectionFileInApp,
    onOpenTemplateBySms,
    onOpenSmsByTemplate,
    t,
  } = params;
  if (showSenders) {
    return <SendersEditor bankPath={bankPath} readOnly={readOnly} />;
  }
  if (selectedFile) {
    return (
      <FormatEditor
        filePath={selectedFile}
        intersectionExamples={selectedFileIntersectionExamples}
        key={selectedFile}
        mode={editorMode}
        onOpenIntersectionFileInApp={onOpenIntersectionFileInApp}
        onOpenSmsByTemplate={onOpenSmsByTemplate}
        onOpenTemplateBySms={onOpenTemplateBySms}
        onRegexBlurAfterEdit={onFormatRegexBlurAfterEdit}
        onSearchContextChange={onFormatSearchContextChange}
        readOnly={readOnly}
        sourceDeletedBaseSha={selectedFileSourceDeletedBaseSha}
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
  publishDisabled: boolean;
  isCheckingPullRequestApproval: boolean;
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
    publishDisabled,
    isCheckingPullRequestApproval,
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
        disabled={publishDisabled || isPublishing}
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
          disabled={
            isCheckingPullRequestApproval ||
            isApprovingPullRequest ||
            isPullRequestApproved
          }
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
  formatTab: "all" | "recent" | "intersections";
  setFormatTab: (value: "all" | "recent" | "intersections") => void;
  recentFiles: string[];
  createFormatDisabled: boolean;
  setShowCreateFormat: (value: boolean) => void;
  formatSearch: string;
  setFormatSearch: (value: string) => void;
  showSearchIndexStatus: boolean;
  searchIndexingLabel: string;
  visibleFormats: string[];
  unsupportedSourceFiles: string[];
  fileRecords: Map<string, BankFileRecord>;
  formatIntersectionStats: Map<string, FormatIntersectionStat>;
  pendingFocusedFilePath: string | null;
  onFocusedFilePathHandled: (filePath: string) => void;
  selectedFile: string | null;
  showSenders: boolean;
  handleSelectSenders: () => void;
  handleSelectFile: (path: string) => void;
  onScopeIntersections: (filePath: string) => void;
  intersectionScopeFiles: string[] | null;
  repository: { owner: string; repo: string };
  refName: string;
  sendersPath: string;
  sendersMissing: boolean;
}): ReactNode {
  const {
    t,
    tTemplate,
    totalFilesCount,
    formatTab,
    setFormatTab,
    recentFiles,
    createFormatDisabled,
    setShowCreateFormat,
    formatSearch,
    setFormatSearch,
    showSearchIndexStatus,
    searchIndexingLabel,
    visibleFormats,
    unsupportedSourceFiles,
    fileRecords,
    formatIntersectionStats,
    pendingFocusedFilePath,
    onFocusedFilePathHandled,
    selectedFile,
    showSenders,
    handleSelectSenders,
    handleSelectFile,
    onScopeIntersections,
    intersectionScopeFiles,
    repository,
    refName,
    sendersPath,
    sendersMissing,
  } = params;
  const fileRowRefs = useRef(new Map<string, HTMLDivElement>());
  const normalizedSearch = formatSearch.trim().toLowerCase();
  const visibleFormatSet = new Set(visibleFormats);
  const visibleUnsupportedSourceFiles = unsupportedSourceFiles.filter(
    (path) => {
      if (normalizedSearch.length === 0) {
        return true;
      }
      return (
        extractFormatFileName(path).toLowerCase().includes(normalizedSearch) ||
        path.toLowerCase().includes(normalizedSearch)
      );
    }
  );
  const sendersMatchesSearch =
    normalizedSearch.length === 0 ||
    "senders.txt".includes(normalizedSearch) ||
    t("bank.senders").toLowerCase().includes(normalizedSearch);
  const allFiles = sendersMatchesSearch
    ? [...visibleUnsupportedSourceFiles, sendersPath, ...visibleFormats]
    : [...visibleUnsupportedSourceFiles, ...visibleFormats];
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
  const intersectionScopeVisible = (intersectionScopeFiles ?? []).filter(
    (path) => {
      if (normalizedSearch.length === 0) {
        return true;
      }
      return (
        extractFormatFileName(path).toLowerCase().includes(normalizedSearch) ||
        path.toLowerCase().includes(normalizedSearch)
      );
    }
  );
  const filesForRender =
    formatTab === "recent"
      ? recentFilesVisible
      : formatTab === "intersections"
        ? intersectionScopeVisible
        : allFiles;
  const showNoResults = filesForRender.length === 0;

  useEffect(() => {
    if (!pendingFocusedFilePath) {
      return;
    }

    const isTargetSelected =
      pendingFocusedFilePath === sendersPath
        ? showSenders
        : selectedFile === pendingFocusedFilePath;
    if (!isTargetSelected) {
      return;
    }

    const row = fileRowRefs.current.get(pendingFocusedFilePath);
    if (!row) {
      return;
    }

    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    onFocusedFilePathHandled(pendingFocusedFilePath);
  }, [
    onFocusedFilePathHandled,
    pendingFocusedFilePath,
    selectedFile,
    sendersPath,
    showSenders,
    filesForRender,
  ]);

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
          disabled={createFormatDisabled}
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
        {intersectionScopeFiles && (
          <button
            className={workspaceTabClassName(formatTab === "intersections")}
            onClick={() => setFormatTab("intersections")}
          >
            {t("bank.intersectionsTab")}
          </button>
        )}
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
        {/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeping list rendering inline avoids a broader panel refactor. */}
        {filesForRender.map((path) => {
          const record = fileRecords.get(path);
          const isSenders = path === sendersPath;
          const isUnsupportedSourceFile = record?.fileClass === "unsupported";
          const localStatus = record?.local ?? "unchanged";
          const sourceStatus = record?.source ?? "unchanged";
          const displayName = isSenders
            ? "senders.txt"
            : extractFormatFileName(path);
          const isInteractive = !isUnsupportedSourceFile;
          const isSelected =
            isInteractive && (isSenders ? showSenders : selectedFile === path);
          const isDeleted = record?.isVisibleDeleted ?? false;
          const isLocalChanged = localStatus !== "unchanged";
          // Green is reserved for files the user created locally (absent from
          // head-ref). A file added in the PR lives in head-ref and is just
          // another head-ref↔origin/main difference — it stays yellow.
          const isLocalCreated = !isSenders && localStatus === "created";
          // The local change muting the source marker is this panel's
          // rendering policy over the record's two dimensions (ADR-0014).
          const sourceIndicatorVariant = isLocalChanged
            ? null
            : isUnsupportedSourceFile
              ? "error"
              : sourceStatus !== "unchanged"
                ? "warning"
                : null;
          const intersectionStats =
            isSenders || isDeleted || isUnsupportedSourceFile
              ? null
              : (formatIntersectionStats.get(path) ?? null);
          const ownExamplesMatch =
            intersectionStats?.totalExamples ===
            intersectionStats?.ownMatchedExamples;
          const ownExamplesTone = ownExamplesMatch ? "success" : "error";
          const intersectionsTone =
            intersectionStats?.intersectingOtherFormats === 0
              ? "success"
              : "error";
          const hasIntersectingFormats =
            (intersectionStats?.intersectingOtherFormats ?? 0) > 0;
          const encodedPath = path.split("/").map(encodeURIComponent).join("/");
          const repoUrl = `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;
          return (
            <div
              className={cn(
                workspaceFileRowClassName({
                  isDeleted,
                  isSelected,
                }),
                !isInteractive &&
                  "cursor-default text-[color:var(--c-error)] hover:bg-transparent"
              )}
              data-file-path={path}
              key={path}
              onClick={
                isInteractive
                  ? () => {
                      if (isSenders) {
                        handleSelectSenders();
                        return;
                      }
                      handleSelectFile(path);
                    }
                  : undefined
              }
              onKeyDown={
                isInteractive
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (isSenders) {
                          handleSelectSenders();
                          return;
                        }
                        handleSelectFile(path);
                      }
                    }
                  : undefined
              }
              ref={(element) => {
                if (element) {
                  fileRowRefs.current.set(path, element);
                } else {
                  fileRowRefs.current.delete(path);
                }
              }}
              role={isInteractive ? "button" : undefined}
              tabIndex={isInteractive ? 0 : undefined}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-mono text-sm">
                  {displayName}
                </span>
                {intersectionStats && (
                  <span className="shrink-0 rounded border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-1.5 py-0.5 font-mono text-[11px] text-[color:var(--c-text-muted)] tabular-nums leading-none">
                    <FormatIntersectionMetric
                      tone={ownExamplesTone}
                      value={intersectionStats.totalExamples}
                    />{" "}
                    /{" "}
                    <FormatIntersectionMetric
                      tone={ownExamplesTone}
                      value={intersectionStats.ownMatchedExamples}
                    />{" "}
                    /{" "}
                    {hasIntersectingFormats ? (
                      <FormatIntersectionMetric
                        ariaLabel={tTemplate("bank.scopeIntersections", {
                          count: intersectionStats.intersectingOtherFormats,
                          file: displayName,
                        })}
                        onClick={() => {
                          onScopeIntersections(path);
                        }}
                        tone={intersectionsTone}
                        value={intersectionStats.intersectingOtherFormats}
                      />
                    ) : (
                      <FormatIntersectionMetric
                        tone={intersectionsTone}
                        value={intersectionStats.intersectingOtherFormats}
                      />
                    )}
                  </span>
                )}
              </div>
              {isLocalCreated && (
                <StatusBadge className="text-xs" variant="success">
                  ●
                </StatusBadge>
              )}
              {!isLocalCreated && isLocalChanged && (
                <StatusBadge className="text-xs" variant="modified">
                  ●
                </StatusBadge>
              )}
              {!isLocalChanged && sourceIndicatorVariant && (
                <StatusBadge
                  className="text-xs"
                  variant={sourceIndicatorVariant}
                >
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
  if (!isBankFormatFilePath(toPath, bankPath)) {
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

// The single fallback chain for "where do source changes come from":
// session (records with kind) → store → fetched PR files (paths only). The
// inventory receives the already-chosen records; readiness gates auto-select
// until the chosen provider has answered (ADR-0014).
export function resolveSourceChangeFacts(params: {
  sourceRefType: "branch" | "pr" | undefined;
  sessionChangedFiles: PullRequestChangedFile[];
  storeChangedFilePaths: string[];
  fetchedPrChangedFilePaths: string[];
  isPrChangedFilesReady: boolean;
}): { records: SourceChangeRecord[]; isSelectionReady: boolean } {
  const {
    sourceRefType,
    sessionChangedFiles,
    storeChangedFilePaths,
    fetchedPrChangedFilePaths,
    isPrChangedFilesReady,
  } = params;
  if (sessionChangedFiles.length > 0) {
    return {
      records: sessionChangedFiles.map((file) => ({
        path: file.path,
        kind: file.kind,
      })),
      isSelectionReady: true,
    };
  }
  if (storeChangedFilePaths.length > 0) {
    return {
      records: storeChangedFilePaths.map((path) => ({ path })),
      isSelectionReady: true,
    };
  }
  return {
    records: fetchedPrChangedFilePaths.map((path) => ({ path })),
    isSelectionReady: sourceRefType !== "pr" || isPrChangedFilesReady,
  };
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
    // When the store already knows the changed files the fetch is skipped;
    // choosing between session, store and fetched paths happens in one place —
    // resolveSourceChangeFacts (ADR-0014).
    if (
      !(sourceRef?.type === "pr" && sourceRef.prNumber) ||
      sourceChangedFiles.length > 0
    ) {
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
  const [isCheckingPullRequestApproval, setIsCheckingPullRequestApproval] =
    useState(false);
  const [isApprovingPullRequest, setIsApprovingPullRequest] = useState(false);
  const [isPullRequestApproved, setIsPullRequestApproved] = useState(false);
  const [approvePullRequestError, setApprovePullRequestError] = useState<
    string | null
  >(null);

  useEffect(() => {
    setIsCheckingPullRequestApproval(false);
    setIsApprovingPullRequest(false);
    setIsPullRequestApproved(false);
    setApprovePullRequestError(null);
  }, [repository.owner, repository.repo, sourceRef?.prNumber, sourceRef?.type]);

  useEffect(() => {
    let cancelled = false;
    if (
      !(sourceRef?.type === "pr" && sourceRef.prNumber && canApprovePullRequest)
    ) {
      setIsCheckingPullRequestApproval(false);
      setIsPullRequestApproved(false);
      return;
    }

    setIsCheckingPullRequestApproval(true);
    void fetchPullRequestApprovalByCurrentUser(sourceRef.prNumber, repository)
      .then((isApproved) => {
        if (!cancelled) {
          setIsPullRequestApproved(isApproved);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsPullRequestApproved(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingPullRequestApproval(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    canApprovePullRequest,
    repository.owner,
    repository.repo,
    sourceRef?.prNumber,
    sourceRef?.type,
  ]);

  const handleApprovePullRequest = useCallback(async () => {
    if (
      !(sourceRef?.type === "pr" && sourceRef.prNumber) ||
      isPullRequestApproved
    ) {
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
  }, [
    isPullRequestApproved,
    repository,
    sourceRef?.prNumber,
    sourceRef?.type,
    t,
  ]);

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
    isCheckingPullRequestApproval,
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

function saveActiveRouteSession(
  repository: RepoRef,
  session: ActiveRouteSession
): void {
  saveWorkspaceSession({
    repository,
    prNumber: session.prNumber,
    headSha: session.headSha,
    baseSha: session.baseSha,
    bankPath: session.bankPath,
    writable: session.writable,
    readOnlyReason: session.readOnlyReason,
    changedFiles: session.changedFiles,
  } as Parameters<typeof saveWorkspaceSession>[0]);
}

function countBlockingPublishValidationIssues(params: {
  bank: BankInfo | undefined;
  bankPath: string;
  formatContentsForValidation: Map<string, string>;
  draftStore: ReturnType<typeof useDraftStore.getState>;
}): number {
  const { bank, bankPath, formatContentsForValidation, draftStore } = params;
  if (!bank) {
    return 0;
  }

  const sendersDraft = draftStore.getDraft(`${bankPath}/senders.txt`);
  const bankForValidation: BankInfo = {
    ...bank,
    hasSenders: bank.hasSenders || !!sendersDraft,
  };
  const issues = validateBankLevel(
    bankForValidation,
    formatContentsForValidation
  );
  return issues.filter((issue) => issue.level === "error").length;
}

function buildCommitMessage(
  commit: CommitMessageInput | null
): string | undefined {
  if (!commit) {
    return undefined;
  }
  const title = commit.title.trim();
  if (!title) {
    return undefined;
  }
  const description = commit.description.trim();
  return description ? `${title}\n\n${description}` : title;
}

function useQuickPullRequestUpdate(params: {
  bank: BankInfo | undefined;
  bankPath: string;
  allChangedFiles: Array<{
    filePath: string;
    content: string;
    isDeleted: boolean;
  }>;
  writable: boolean;
  changedFiles: Array<{
    filePath: string;
    content: string;
    isDeleted: boolean;
  }>;
  formatContentsForValidation: Map<string, string>;
  draftStore: ReturnType<typeof useDraftStore.getState>;
  onWorkspaceReadOnly: (session: ActiveRouteSession) => void;
  onWorkspaceStale: (session: ActiveRouteSession) => void;
  onWorkspaceSynced: (session: ActiveRouteSession) => Promise<void>;
  repository: { owner: string; repo: string };
  sourceRef: { type: "branch" | "pr"; prNumber?: number; sha: string } | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const {
    bank,
    bankPath,
    allChangedFiles,
    writable,
    changedFiles,
    formatContentsForValidation,
    draftStore,
    onWorkspaceReadOnly,
    onWorkspaceStale,
    onWorkspaceSynced,
    repository,
    sourceRef,
    t,
  } = params;
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [isUpdateDialogOpen, setIsUpdateDialogOpen] = useState(false);

  useEffect(() => {
    setIsPublishing(false);
    setPublishError(null);
    setIsUpdateDialogOpen(false);
  }, [repository.owner, repository.repo, sourceRef?.prNumber, sourceRef?.type]);

  const runPreflight = useCallback(async (): Promise<
    { ok: true; token: string; prNumber: number } | { ok: false }
  > => {
    if (!(writable && sourceRef?.type === "pr" && sourceRef.prNumber)) {
      setPublishError("no-write-access");
      return { ok: false };
    }
    const token = getGitHubUserToken()?.trim() ?? "";
    if (!token) {
      setPublishError(t("githubAuth.emptyToken"));
      return { ok: false };
    }
    const resolution = await resolvePullRequestWorkspace(
      sourceRef.prNumber,
      repository
    );
    if (resolution.status !== "supported") {
      setPublishError(t("publish.updateError"));
      return { ok: false };
    }
    const validationErrorsCount = countBlockingPublishValidationIssues({
      bank,
      bankPath,
      formatContentsForValidation,
      draftStore,
    });
    const publishPreflightState = resolvePublishPreflightState({
      resolverHeadSha: resolution.headSha,
      sessionHeadSha: sourceRef.sha,
      writable: resolution.writable,
      localChangesCount: changedFiles.length,
      hasInvalidScopeChanges: allChangedFiles.some(
        (file) => !file.filePath.startsWith(`${bankPath}/`)
      ),
      validationErrorsCount,
    });
    if (publishPreflightState === "stale") {
      onWorkspaceStale(resolution);
      setPublishError(t("publish.outdatedBase"));
      return { ok: false };
    }
    if (publishPreflightState === "read-only") {
      onWorkspaceReadOnly(resolution);
      setPublishError(
        t("publish.readOnly", {
          defaultValue: "This pull request is read-only.",
        })
      );
      return { ok: false };
    }
    if (publishPreflightState === "no-changes") {
      setPublishError(t("publish.noChanges"));
      return { ok: false };
    }
    if (publishPreflightState === "invalid-scope") {
      setPublishError(t("validation.multiBankPublish"));
      return { ok: false };
    }
    if (publishPreflightState === "validation-failed") {
      setPublishError(t("validation.errors", { count: validationErrorsCount }));
      return { ok: false };
    }
    return { ok: true, token, prNumber: sourceRef.prNumber };
  }, [
    allChangedFiles,
    bank,
    bankPath,
    changedFiles,
    formatContentsForValidation,
    draftStore,
    onWorkspaceReadOnly,
    onWorkspaceStale,
    repository,
    sourceRef?.prNumber,
    sourceRef?.type,
    sourceRef?.sha,
    t,
    writable,
  ]);

  const pushAndSync = useCallback(
    async (
      token: string,
      prNumber: number,
      commitMessage?: string
    ): Promise<boolean> => {
      const { headSha: newHeadSha } = await updatePullRequestHead(
        token,
        prNumber,
        changedFiles.map((file) => ({
          path: file.filePath,
          content: file.isDeleted ? undefined : file.content,
          delete: file.isDeleted,
        })),
        repository,
        commitMessage
      );
      const syncedResolution = await resolvePullRequestWorkspace(
        prNumber,
        repository,
        { forceFresh: true, headShaOverride: newHeadSha }
      );
      if (syncedResolution.status !== "supported") {
        setPublishError(t("publish.updateError"));
        return false;
      }
      await onWorkspaceSynced(syncedResolution);
      return true;
    },
    [changedFiles, onWorkspaceSynced, repository, t]
  );

  const beginUpdate = useCallback(async () => {
    setPublishError(null);
    setIsPublishing(true);
    try {
      const pre = await runPreflight();
      if (pre.ok) {
        setIsUpdateDialogOpen(true);
      }
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : t("publish.updateError")
      );
    } finally {
      setIsPublishing(false);
    }
  }, [runPreflight, t]);

  const submitUpdate = useCallback(
    async (commit: CommitMessageInput | null): Promise<void> => {
      setIsPublishing(true);
      setPublishError(null);
      try {
        const pre = await runPreflight();
        if (!pre.ok) {
          setIsUpdateDialogOpen(false);
          return;
        }
        await pushAndSync(pre.token, pre.prNumber, buildCommitMessage(commit));
        setIsUpdateDialogOpen(false);
      } catch (error) {
        setPublishError(
          error instanceof Error ? error.message : t("publish.updateError")
        );
        setIsUpdateDialogOpen(false);
      } finally {
        setIsPublishing(false);
      }
    },
    [pushAndSync, runPreflight, t]
  );

  const closeUpdateDialog = useCallback(() => {
    setIsUpdateDialogOpen(false);
  }, []);

  return {
    isPublishing,
    publishError,
    isUpdateDialogOpen,
    beginUpdate,
    submitUpdate,
    closeUpdateDialog,
  };
}

function useBankPublishAction(params: {
  bank: BankInfo | undefined;
  bankPath: string;
  changedFiles: Array<{
    filePath: string;
    content: string;
    isDeleted: boolean;
  }>;
  allChangedFiles: Array<{
    filePath: string;
    content: string;
    isDeleted: boolean;
  }>;
  formatContentsForValidation: Map<string, string>;
  draftStore: ReturnType<typeof useDraftStore.getState>;
  onWorkspaceReadOnly: (session: ActiveRouteSession) => void;
  onWorkspaceStale: (session: ActiveRouteSession) => void;
  onWorkspaceSynced: (session: ActiveRouteSession) => Promise<void>;
  repository: { owner: string; repo: string };
  sourceRef: {
    type: "branch" | "pr";
    name: string;
    prNumber?: number;
    sha: string;
  } | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  writable: boolean;
}) {
  const {
    bank,
    bankPath,
    changedFiles,
    allChangedFiles,
    formatContentsForValidation,
    draftStore,
    onWorkspaceReadOnly,
    onWorkspaceStale,
    onWorkspaceSynced,
    repository,
    sourceRef,
    t,
    writable,
  } = params;
  const canUpdateCurrentPullRequest = Boolean(
    sourceRef?.type === "pr" && sourceRef.prNumber && writable
  );
  const {
    isPublishing,
    publishError,
    isUpdateDialogOpen,
    beginUpdate,
    submitUpdate,
    closeUpdateDialog,
  } = useQuickPullRequestUpdate({
    bank,
    bankPath,
    allChangedFiles,
    writable: canUpdateCurrentPullRequest,
    changedFiles,
    formatContentsForValidation,
    draftStore,
    onWorkspaceReadOnly,
    onWorkspaceStale,
    onWorkspaceSynced,
    repository,
    sourceRef,
    t,
  });
  const publishActionLabel = isPublishing
    ? t("publish.publishing")
    : t("publish.updatePR");
  const onPublish = useCallback(() => {
    void beginUpdate();
  }, [beginUpdate]);

  return {
    canUpdateCurrentPullRequest,
    isPublishing,
    onPublish,
    publishActionLabel,
    publishError,
    isUpdateDialogOpen,
    submitUpdate,
    closeUpdateDialog,
  };
}

type ActiveRouteSession = Extract<
  Awaited<ReturnType<typeof resolvePullRequestWorkspace>>,
  { status: "supported" }
>;

type RouteInitState =
  | { status: "loading" }
  | {
      status: "ready";
      session: ActiveRouteSession;
      mode: "clean" | "draft" | "read-only";
    }
  | { status: "stale"; session: ActiveRouteSession }
  | { status: "transient-error"; reason: string };

export function resolveWorkspaceEntryMode(params: {
  headSha: string;
  persistedDrafts: Array<{ baseHeadSha?: string }>;
  writable: boolean;
}): "stale" | "read-only" | "draft" | "clean" {
  const { headSha, persistedDrafts, writable } = params;
  if (
    persistedDrafts.some(
      (draft) => Boolean(draft.baseHeadSha) && draft.baseHeadSha !== headSha
    )
  ) {
    return "stale";
  }
  if (!writable) {
    return "read-only";
  }
  return persistedDrafts.length > 0 ? "draft" : "clean";
}

function isSameRepository(left: RepoRef, right: RepoRef): boolean {
  return left.owner === right.owner && left.repo === right.repo;
}

function resolveReusableRouteInitState(params: {
  parsedRoute: { repository: RepoRef; prNumber: number } | null;
  legacyRedirectTarget: string | null;
  currentRepository: RepoRef;
  currentSourceRef: SourceRef | null;
  currentSourceChangedFiles: string[];
  hasTree: boolean;
  hasBanks: boolean;
}) {
  const {
    parsedRoute,
    legacyRedirectTarget,
    currentRepository,
    currentSourceRef,
    currentSourceChangedFiles,
    hasTree,
    hasBanks,
  } = params;
  if (legacyRedirectTarget || !parsedRoute) {
    return null;
  }

  const persistedSession = loadWorkspaceSession();
  if (!persistedSession) {
    return null;
  }
  const extendedPersistedSession =
    persistedSession as typeof persistedSession & {
      baseSha?: string;
      changedFiles?: PullRequestChangedFile[];
    };

  if (
    !(
      isSameRepository(
        parsedRoute.repository,
        extendedPersistedSession.repository
      ) &&
      isSameRepository(parsedRoute.repository, currentRepository) &&
      currentSourceRef?.type === "pr" &&
      currentSourceRef.prNumber === parsedRoute.prNumber &&
      extendedPersistedSession.prNumber === parsedRoute.prNumber &&
      currentSourceRef.sha === extendedPersistedSession.headSha &&
      hasTree &&
      hasBanks
    )
  ) {
    return null;
  }

  return {
    status: "ready" as const,
    session: {
      status: "supported" as const,
      repository: extendedPersistedSession.repository,
      prNumber: extendedPersistedSession.prNumber,
      headSha: extendedPersistedSession.headSha,
      baseSha:
        extendedPersistedSession.baseSha ?? extendedPersistedSession.headSha,
      bankPath: extendedPersistedSession.bankPath,
      writable: extendedPersistedSession.writable,
      readOnlyReason: extendedPersistedSession.readOnlyReason,
      changedFiles:
        extendedPersistedSession.changedFiles ??
        currentSourceChangedFiles.map((path) => ({
          kind: "modify" as const,
          path,
        })),
    },
    mode: (extendedPersistedSession.writable ? "clean" : "read-only") as
      | "clean"
      | "read-only",
  };
}

function usePullRequestRouteInit(params: {
  locationPathname: string;
  locationSearch: string;
  navigate: ReturnType<typeof useNavigate>;
  routeParams: Readonly<Record<string, string | undefined>>;
}) {
  const { locationPathname, locationSearch, navigate, routeParams } = params;
  const setRepository = useSourceStore((state) => state.setRepository);
  const setSource = useSourceStore((state) => state.setSource);
  const setSourceChangedFiles = useSourceStore(
    (state) => state.setSourceChangedFiles
  );
  const setTree = useSourceStore((state) => state.setTree);
  const setBanks = useSourceStore((state) => state.setBanks);
  const setLoading = useSourceStore((state) => state.setLoading);
  const setError = useSourceStore((state) => state.setError);
  const showStaleSession = useCallback((session: ActiveRouteSession) => {
    setState({
      status: "stale",
      session,
    });
  }, []);
  const showReadOnlySession = useCallback((session: ActiveRouteSession) => {
    setState({
      status: "ready",
      session,
      mode: "read-only",
    });
  }, []);
  const showReadySession = useCallback(
    (session: ActiveRouteSession, mode: "clean" | "draft" | "read-only") => {
      setState({
        status: "ready",
        session,
        mode,
      });
    },
    []
  );
  const parsedRoute = useMemo(
    () =>
      parsePullRequestRouteParams({
        owner: routeParams.owner,
        repo: routeParams.repo,
        prNumber: routeParams.prNumber,
      }),
    [routeParams.owner, routeParams.prNumber, routeParams.repo]
  );
  const legacyRedirectTarget = useMemo(
    () => getLegacyRouteRedirectPath(locationPathname, locationSearch),
    [locationPathname, locationSearch]
  );
  const reusableState = useMemo(() => {
    const sourceState = useSourceStore.getState();
    return resolveReusableRouteInitState({
      parsedRoute,
      legacyRedirectTarget,
      currentRepository: sourceState.repository,
      currentSourceRef: sourceState.sourceRef,
      currentSourceChangedFiles: sourceState.sourceChangedFiles,
      hasTree: sourceState.tree.length > 0,
      hasBanks: sourceState.banks.length > 0,
    });
  }, [legacyRedirectTarget, parsedRoute]);
  const [state, setState] = useState<RouteInitState>(
    () => reusableState ?? { status: "loading" }
  );

  useEffect(() => {
    if (legacyRedirectTarget) {
      clearWorkspaceSession();
      navigate(legacyRedirectTarget, { replace: true });
      return;
    }
    if (!parsedRoute) {
      clearWorkspaceSession();
      navigate("/", { replace: true });
    }
  }, [legacyRedirectTarget, navigate, parsedRoute]);

  useEffect(() => {
    if (legacyRedirectTarget || !parsedRoute) {
      return;
    }

    let cancelled = false;
    if (reusableState) {
      setLoading(false);
    } else {
      setState({ status: "loading" });
      setLoading(true);
    }
    setError(null);

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: route init intentionally handles all PR-only entry branches in one place.
    const loadWorkspace = async () => {
      const sourceState = useSourceStore.getState();
      try {
        const resolution = await resolvePullRequestWorkspace(
          parsedRoute.prNumber,
          parsedRoute.repository
        );
        if (cancelled) {
          return;
        }

        if (resolution.status === "transient-error") {
          setState({
            status: "transient-error",
            reason: resolution.reason,
          });
          return;
        }

        if (resolution.status !== "supported") {
          clearWorkspaceSession();
          navigate("/", { replace: true });
          return;
        }

        const canReuseCurrentWorkspaceData =
          reusableState?.status === "ready" &&
          reusableState.session.headSha === resolution.headSha &&
          sourceState.tree.length > 0 &&
          sourceState.banks.length > 0;
        const tree = canReuseCurrentWorkspaceData
          ? sourceState.tree
          : await fetchRepoTree(resolution.headSha, parsedRoute.repository);
        if (cancelled) {
          return;
        }

        const sourceRef: SourceRef = {
          type: "pr",
          name: `pr-${resolution.prNumber}`,
          sha: resolution.headSha,
          prNumber: resolution.prNumber,
        };
        const draftScopeKey = makeDraftSourceKey(
          {
            type: "pr",
            prNumber: resolution.prNumber,
            name: sourceRef.name,
          },
          parsedRoute.repository
        );
        await waitForDraftStoreHydration();
        if (cancelled) {
          return;
        }
        const persistedDrafts = useDraftStore
          .getState()
          .getStoredDraftsForScope(draftScopeKey);

        setRepository(parsedRoute.repository);
        setSource(sourceRef);
        setSourceChangedFiles(resolution.changedFiles.map((file) => file.path));
        if (!canReuseCurrentWorkspaceData) {
          setTree(tree);
          setBanks(indexBanksFromTree(tree));
        }
        saveActiveRouteSession(parsedRoute.repository, resolution);
        const entryMode = resolveWorkspaceEntryMode({
          headSha: resolution.headSha,
          persistedDrafts,
          writable: resolution.writable,
        });
        if (entryMode === "stale") {
          useDraftStore.getState().activateScope(draftScopeKey, false);
          showStaleSession(resolution);
          return;
        }
        if (entryMode === "read-only") {
          useDraftStore.getState().activateScope(draftScopeKey, false);
          showReadOnlySession(resolution);
          return;
        }

        useDraftStore
          .getState()
          .activateScope(draftScopeKey, entryMode === "draft");

        showReadySession(resolution, entryMode);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          status: "transient-error",
          reason:
            error instanceof Error && error.message ? error.message : "unknown",
        });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadWorkspace();

    return () => {
      cancelled = true;
    };
  }, [
    locationPathname,
    navigate,
    parsedRoute,
    reusableState,
    setBanks,
    setError,
    setLoading,
    setRepository,
    setSource,
    setSourceChangedFiles,
    setTree,
    showReadOnlySession,
    showReadySession,
    showStaleSession,
  ]);

  return {
    state,
    showReadOnlySession,
    showReadySession,
    showStaleSession,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeping the existing workspace container intact avoids a large unrelated split.
export function BankWorkspace() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const routeParams = useParams();
  const [searchParams] = useSearchParams();
  const requestedFile = useMemo(
    () => decodeRequestedFileValue(searchParams),
    [searchParams]
  );
  const routeInit = usePullRequestRouteInit({
    locationPathname: location.pathname,
    locationSearch: location.search,
    navigate,
    routeParams,
  });
  const routeInitState = routeInit.state;
  const bankPath =
    routeInitState.status === "ready" ? routeInitState.session.bankPath : "";
  const banks = useSourceStore((s) => s.banks);
  const setBanks = useSourceStore((s) => s.setBanks);
  const setRepository = useSourceStore((s) => s.setRepository);
  const setSource = useSourceStore((s) => s.setSource);
  const setSourceChangedFiles = useSourceStore((s) => s.setSourceChangedFiles);
  const setTree = useSourceStore((s) => s.setTree);
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const sourceChangedFiles = useSourceStore((s) => s.sourceChangedFiles);
  const repository = useSourceStore((s) => s.repository);
  const queryClient = useQueryClient();

  const bank = useMemo(
    () => banks.find((b) => b.folderPath === bankPath),
    [banks, bankPath]
  );
  const activeSession =
    routeInitState.status === "ready" ? routeInitState.session : null;
  const [staleWorkspaceSession, setStaleWorkspaceSession] =
    useState<ActiveRouteSession | null>(null);
  const tree = useSourceStore((s) => s.tree);
  const [showCreateFormat, setShowCreateFormat] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showQuickCheck, setShowQuickCheck] = useState(false);
  const [quickCheckMode, setQuickCheckMode] =
    useState<QuickCheckMode>("template-by-sms");
  const [activeFormatSearchContext, setActiveFormatSearchContext] =
    useState<ActiveFormatSearchContext | null>(null);
  const [pendingFocusedFilePath, setPendingFocusedFilePath] = useState<
    string | null
  >(null);
  const [formatSearch, setFormatSearch] = useState("");
  const [formatTab, setFormatTab] = useState<
    "all" | "recent" | "intersections"
  >("all");
  const [editorMode, setEditorMode] =
    useState<WorkspaceEditorMode>("structured");
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
  const allChangedFilesForPublish = useMemo(
    () =>
      draftStore.getChangedFiles().map((entry) => ({
        filePath: entry.filePath,
        content: entry.content,
        isDeleted: entry.isDeleted,
      })),
    [draftStore, draftStore.drafts]
  );
  const sourceChangeFacts = useMemo(
    () =>
      resolveSourceChangeFacts({
        sourceRefType: sourceRef?.type,
        sessionChangedFiles: activeSession?.changedFiles ?? [],
        storeChangedFilePaths: sourceChangedFiles,
        fetchedPrChangedFilePaths: prChangedFiles,
        isPrChangedFilesReady,
      }),
    [
      activeSession,
      isPrChangedFilesReady,
      prChangedFiles,
      sourceChangedFiles,
      sourceRef?.type,
    ]
  );
  // What files the bank has and what is going on with each one — records and
  // named selections of the bank inventory (ADR-0014).
  const inventory = useBankInventory({
    bankPath,
    sendersPath,
    remoteFormatFiles: bank?.formatFiles,
    sourceChanges: sourceChangeFacts.records,
  });
  const sourceHeadSha = sourceRef?.sha ?? null;
  const sourceRefNameForContent = sourceRef?.sha ?? sourceRef?.name;

  // The intersections tool owns its snapshot, badges and scope; the tab stays
  // here, mapped from the scope signal in this one visible line (ADR-0013).
  const intersections = useIntersections({
    bankPath,
    repository,
    sourceRefName: sourceRefNameForContent,
    prNumber: sourceRef?.type === "pr" ? (sourceRef.prNumber ?? null) : null,
    formatPaths: inventory.liveFormatPaths,
    draftStore,
    allFormatFiles: inventory.formatFiles,
    deletedFormatFiles: inventory.visibleDeletedFormatFiles,
    onScopeSignal: (signal) =>
      setFormatTab((current) =>
        signal === "raised"
          ? "intersections"
          : current === "intersections"
            ? "all"
            : current
      ),
  });
  const calculateIntersectionsError =
    intersections.error === null
      ? null
      : t(
          intersections.error === "no-source"
            ? "quickCheck.noSource"
            : "quickCheck.intersectionsUnexpectedError"
        );
  const updateSourceFromSession = useCallback(
    (session: ActiveRouteSession) => {
      setRepository(repository);
      setSource({
        type: "pr",
        name: `pr-${session.prNumber}`,
        sha: session.headSha,
        prNumber: session.prNumber,
      });
      setSourceChangedFiles(session.changedFiles.map((file) => file.path));
      saveActiveRouteSession(repository, session);
    },
    [repository, setRepository, setSource, setSourceChangedFiles]
  );
  const handleWorkspaceStale = useCallback(
    (session: ActiveRouteSession) => {
      setStaleWorkspaceSession(null);
      updateSourceFromSession(session);
      routeInit.showStaleSession(session);
    },
    [routeInit, updateSourceFromSession]
  );
  const handleWorkspaceReadOnly = useCallback(
    (session: ActiveRouteSession) => {
      setStaleWorkspaceSession(null);
      updateSourceFromSession(session);
      routeInit.showReadOnlySession(session);
    },
    [routeInit, updateSourceFromSession]
  );
  const handleWorkspaceSynced = useCallback(
    async (session: ActiveRouteSession) => {
      // Resolve every async dependency (tree, open PRs, and the content of the
      // file currently on screen) BEFORE touching any visible state. The writes
      // below then run in one synchronous block, so React commits the new
      // head-ref in a single pass instead of flickering through half-updated
      // frames (old sha + cleared content, new sha + loading, …).
      const tree = await fetchRepoTree(session.headSha, repository);
      const freshOpenPrs = await fetchOpenPRs(repository, { forceFresh: true });
      const shownFilePath = requestedFile;
      const primedContent =
        shownFilePath == null
          ? null
          : await fetchFileContent(
              shownFilePath,
              session.headSha,
              repository
            ).catch(() => null);

      const fileContentStore = useFileContentStore.getState();
      fileContentStore.invalidatePullRequestFileContents({
        repository,
        prNumber: session.prNumber,
      });
      if (shownFilePath != null && primedContent != null) {
        fileContentStore.setFileContentEntry({
          repository,
          prNumber: session.prNumber,
          filePath: shownFilePath,
          content: primedContent,
          lastResolvedHeadSha: session.headSha,
          loadedFrom: "prefetch",
          status: "ready",
        });
      }
      setStaleWorkspaceSession(null);
      updateSourceFromSession(session);
      setTree(tree);
      setBanks(indexBanksFromTree(tree));
      useDraftStore.getState().discardAll();
      queryClient.setQueryData(openPrsQueryKey(repository), freshOpenPrs);
      routeInit.showReadySession(
        session,
        session.writable ? "clean" : "read-only"
      );
    },
    [
      queryClient,
      repository,
      requestedFile,
      routeInit,
      setBanks,
      setTree,
      updateSourceFromSession,
    ]
  );

  useEffect(() => {
    if (routeInitState.status !== "ready") {
      setStaleWorkspaceSession(null);
    }
  }, [routeInitState.status]);

  useEffect(() => {
    setPendingFocusedFilePath(null);
  }, [bankPath, repository.owner, repository.repo, sourceRefNameForContent]);

  useEffect(() => {
    if (routeInitState.status !== "ready") {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const recheckWorkspace = async () => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      try {
        const resolution = await resolvePullRequestWorkspace(
          routeInitState.session.prNumber,
          repository
        );
        if (cancelled || resolution.status !== "supported") {
          return;
        }
        if (resolution.headSha !== routeInitState.session.headSha) {
          if (useDraftStore.getState().getChangedFiles().length > 0) {
            setStaleWorkspaceSession(resolution);
            return;
          }
          await handleWorkspaceSynced(resolution);
          return;
        }
        setStaleWorkspaceSession(null);
        if (!resolution.writable && routeInitState.session.writable) {
          handleWorkspaceReadOnly(resolution);
        }
      } finally {
        inFlight = false;
      }
    };

    const handleWindowFocus = () => {
      void recheckWorkspace();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void recheckWorkspace();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    handleWorkspaceSynced,
    handleWorkspaceReadOnly,
    repository,
    routeInitState,
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
      requestedFile &&
      requestedFile !== sendersPath &&
      inventory.formatFiles.includes(requestedFile)
        ? requestedFile
        : null,
    [inventory.formatFiles, requestedFile, sendersPath]
  );
  const selectedFileSourceDeletedBaseSha = useMemo(() => {
    const record = selectedFile
      ? inventory.recordsByPath.get(selectedFile)
      : undefined;
    if (!(record?.source === "deleted" && record.local === "unchanged")) {
      return null;
    }
    return activeSession?.baseSha ?? null;
  }, [activeSession?.baseSha, inventory.recordsByPath, selectedFile]);
  const selectedFileIntersectionExamples = useMemo(() => {
    const activeRegex =
      selectedFile && activeFormatSearchContext?.filePath === selectedFile
        ? activeFormatSearchContext.regex
        : selectedFile
          ? (intersections.entries.get(selectedFile)?.regex ?? "")
          : "";

    return collectIntersectingExamples({
      activeFilePath: selectedFile,
      activeRegex,
      entries: intersections.visibleEntries,
    });
  }, [
    activeFormatSearchContext?.filePath,
    activeFormatSearchContext?.regex,
    intersections.entries,
    selectedFile,
    intersections.visibleEntries,
  ]);

  const {
    filteredFormatFiles,
    shouldIndexExamples,
    indexedScopeSummary,
    indexingInFlight,
    indexingErrors,
  } = useBankFormatSearch({
    allFormatFiles: inventory.formatFiles,
    changedFormatFiles: inventory.changedFormatFiles,
    draftStore,
    formatSearch,
    formatTab,
    bankPath,
    prNumber: sourceRef?.type === "pr" ? (sourceRef.prNumber ?? null) : null,
    repository,
    sourceHeadSha,
  });

  const recentFiles = useMemo(() => {
    const recent = getRecentFiles(bankPath);
    return recent.filter(
      (path) => path === sendersPath || inventory.formatFiles.includes(path)
    );
  }, [inventory.formatFiles, bankPath, sendersPath]);

  const handleSelectFile = useCallback(
    (f: string) => {
      if (requestedFile !== f) {
        navigateToRequestedFile(f);
      }
      addRecentFile(bankPath, f);
    },
    [bankPath, navigateToRequestedFile, requestedFile]
  );

  const handleOpenFileInApp = useCallback(
    (filePath: string) => {
      setFormatTab("all");
      setFormatSearch("");
      setPendingFocusedFilePath(filePath);
      handleSelectFile(filePath);
    },
    [handleSelectFile]
  );

  const handleSelectSenders = useCallback(() => {
    if (requestedFile !== sendersPath) {
      navigateToRequestedFile(sendersPath);
    }
    addRecentFile(bankPath, sendersPath);
  }, [bankPath, navigateToRequestedFile, requestedFile, sendersPath]);

  const handleCalculateIntersections = useCallback(async () => {
    // Confirming a recalculation is page-level UX policy, not an
    // intersections invariant (ADR-0013), so it stays here.
    if (
      intersections.hasCalculated &&
      !window.confirm(t("quickCheck.recalculateIntersectionsConfirm"))
    ) {
      return;
    }
    await intersections.calculate();
  }, [intersections.hasCalculated, intersections.calculate, t]);

  const quickCheckActiveFormatContext = activeFormatSearchContext
    ? {
        filePath: activeFormatSearchContext.filePath,
        regex: activeFormatSearchContext.regex,
        activeExampleIndex: activeFormatSearchContext.activeExampleIndex,
        activeSmsText: getActiveExampleText(activeFormatSearchContext),
      }
    : null;

  const handleRenameFile = useCallback(
    (fromPath: string, toPath: string): boolean => {
      return renameDraftFormat({
        fromPath,
        toPath,
        bankPath,
        allFormatFiles: inventory.formatFiles,
        draftStore,
        setBanks,
        currentRequestedFile: requestedFile,
        replaceRequestedFile: (filePath) =>
          navigateToRequestedFile(filePath, true),
      });
    },
    [
      inventory.formatFiles,
      bankPath,
      draftStore,
      navigateToRequestedFile,
      requestedFile,
      setBanks,
    ]
  );

  const sendersMissing =
    !!bank && !bank.hasSenders && !draftStore.getDraft(sendersPath);
  const canResetToSource = inventory.hasLocalChangesInBank;
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
  }, [
    bankPath,
    draftStore,
    navigateToRequestedFile,
    requestedFile,
    setBanks,
    tree,
  ]);
  const canApprovePullRequest = usePullRequestApprovalPermission({
    repository,
    sourceRef,
  });
  const workspaceReadOnly =
    activeSession?.writable === false || staleWorkspaceSession !== null;
  const {
    showApprovePullRequestButton,
    isCheckingPullRequestApproval,
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
    publishActionLabel,
    isUpdateDialogOpen,
    submitUpdate,
    closeUpdateDialog,
  } = useBankPublishAction({
    bank,
    bankPath,
    changedFiles: changedFilesForPublish,
    allChangedFiles: allChangedFilesForPublish,
    formatContentsForValidation: inventory.formatContentsForValidation,
    draftStore,
    onWorkspaceReadOnly: handleWorkspaceReadOnly,
    onWorkspaceStale: handleWorkspaceStale,
    onWorkspaceSynced: handleWorkspaceSynced,
    repository,
    sourceRef: sourceRef?.sha
      ? (sourceRef as typeof sourceRef & { sha: string })
      : null,
    t,
    writable: (activeSession?.writable ?? false) && !workspaceReadOnly,
  });
  const handleDiscardLocalChangesAndRefresh = useCallback(() => {
    if (!staleWorkspaceSession) {
      return;
    }
    useDraftStore.getState().discardAll();
    useFileContentStore.getState().invalidatePullRequestFileContents({
      repository,
      prNumber: staleWorkspaceSession.prNumber,
    });
    void handleWorkspaceSynced(staleWorkspaceSession);
  }, [handleWorkspaceSynced, repository, staleWorkspaceSession]);

  useAutoSelectFormat({
    workspaceReady: routeInitState.status === "ready",
    requestedFile,
    allFormatFiles: inventory.formatFiles,
    sendersPath,
    preferredFormatFile: inventory.formatFiles[0] ?? null,
    selectionReady: sourceChangeFacts.isSelectionReady,
    onSelectFile: navigateToRequestedFile,
  });

  // The raw/structured toggle is per-file UI state; opening another file
  // starts in the structured editor (same as the old per-editor state).
  useEffect(() => {
    setEditorMode("structured");
  }, [selectedFile]);

  useEffect(() => {
    if (showSenders || !selectedFile) {
      setActiveFormatSearchContext(null);
      return;
    }
    setActiveFormatSearchContext((prev) =>
      prev?.filePath === selectedFile ? prev : null
    );
  }, [selectedFile, showSenders]);

  if (routeInitState.status === "loading") {
    return (
      <div className="flex items-center gap-2">
        <Spinner />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  if (routeInitState.status === "transient-error") {
    return (
      <div className="flex flex-col gap-4">
        <StatusBadge variant="error">
          {t("app.error")}: {routeInitState.reason}
        </StatusBadge>
        <div>
          <Button onClick={() => window.location.reload()} type="button">
            {t("app.retry", { defaultValue: "Retry" })}
          </Button>
        </div>
      </div>
    );
  }

  if (routeInitState.status === "stale") {
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <StatusBadge variant="warning">
          {t("publish.outdatedBase", {
            defaultValue: "Local draft is stale for the current PR head.",
          })}
        </StatusBadge>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              useDraftStore.getState().discardAll();
              window.location.reload();
            }}
            type="button"
          >
            {t("draft.discardAndOpenLatest", {
              defaultValue: "Discard stale draft and open latest PR",
            })}
          </Button>
          <Button onClick={() => navigate("/")} type="button" variant="ghost">
            {t("app.back", { defaultValue: "Back to Dashboard" })}
          </Button>
        </div>
      </div>
    );
  }

  if (!bank && inventory.formatFiles.length === 0) {
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
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* ─── Workspace header bar ─── */}
      <WorkspaceHeaderBar
        allFormatFiles={inventory.formatFiles}
        bankName={displayName}
        bankRepoUrl={bankRepoUrl}
        mode={editorMode}
        onModeChange={setEditorMode}
        onRenameFile={handleRenameFile}
        readOnly={workspaceReadOnly}
        selectedFile={selectedFile}
        sendersPath={sendersPath}
        showSenders={showSenders}
        sourceDeletedBaseSha={selectedFileSourceDeletedBaseSha}
      />

      {staleWorkspaceSession && (
        <div className="flex shrink-0 items-start justify-between gap-3 rounded-md border border-[color:var(--c-warning)] bg-[color:var(--c-warning-soft)] px-4 py-3 text-[color:var(--c-warning)] text-sm">
          <span>
            {t("workspace.cachedStaleNotice", {
              defaultValue:
                "PR changed since your last local edits. You're viewing the cached previous version. Discard local changes and refresh the PR to continue.",
            })}
          </span>
          <Button
            onClick={handleDiscardLocalChangesAndRefresh}
            type="button"
            variant="ghost"
          >
            {t("workspace.discardAndRefresh", {
              defaultValue: "Discard local changes and refresh PR",
            })}
          </Button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[clamp(264px,19vw,340px)_minmax(0,1fr)] gap-4">
        {/* ─── Sidebar ─── */}
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
          {/* Action bar */}
          <BankActionsPanel
            approvePullRequestError={approvePullRequestError}
            approvePullRequestLabel={approvePullRequestLabel}
            calculateIntersectionsError={calculateIntersectionsError}
            calculateIntersectionsWarning={
              intersections.loadErrorsCount > 0
                ? t("quickCheck.summaryLoadErrors", {
                    count: intersections.loadErrorsCount,
                  })
                : null
            }
            canResetToSource={canResetToSource}
            isApprovingPullRequest={isApprovingPullRequest}
            isCalculatingIntersections={intersections.isCalculating}
            isCheckingPullRequestApproval={isCheckingPullRequestApproval}
            isPublishing={isPublishingQuickUpdate}
            isPullRequestApproved={isPullRequestApproved}
            onApprovePullRequest={() => {
              void handleApprovePullRequest();
            }}
            onCalculateIntersections={() => {
              void handleCalculateIntersections();
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
            onResetToSource={handleResetToSource}
            publishActionLabel={publishActionLabel}
            publishDisabled={
              workspaceReadOnly || changedFilesForPublish.length === 0
            }
            publishError={publishError}
            showApprovePullRequestButton={showApprovePullRequestButton}
            t={t}
          />

          <FormatsPanel
            createFormatDisabled={workspaceReadOnly}
            fileRecords={inventory.recordsByPath}
            formatIntersectionStats={intersections.stats}
            formatSearch={formatSearch}
            formatTab={formatTab}
            handleSelectFile={handleSelectFile}
            handleSelectSenders={handleSelectSenders}
            intersectionScopeFiles={intersections.scopeFiles}
            onFocusedFilePathHandled={(filePath) =>
              setPendingFocusedFilePath((current) =>
                current === filePath ? null : current
              )
            }
            onScopeIntersections={intersections.scopeTo}
            pendingFocusedFilePath={pendingFocusedFilePath}
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
            t={t}
            totalFilesCount={
              formatTab === "intersections" && intersections.scopeFiles
                ? intersections.scopeFiles.length
                : inventory.recordsByPath.size
            }
            tTemplate={t}
            unsupportedSourceFiles={inventory.unsupportedFiles}
            visibleFormats={filteredFormatFiles}
          />
        </div>

        {/* ─── Main content ─── */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
          {renderWorkspaceContent({
            showSenders,
            bankPath,
            readOnly: workspaceReadOnly,
            selectedFile,
            selectedFileIntersectionExamples,
            selectedFileSourceDeletedBaseSha,
            editorMode,
            onFormatSearchContextChange: setActiveFormatSearchContext,
            onFormatRegexBlurAfterEdit: intersections.mergeLiveEdit,
            onOpenIntersectionFileInApp: handleOpenFileInApp,
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
      </div>

      {/* Modals */}
      {isUpdateDialogOpen && (
        <UpdatePullRequestDialog
          isBusy={isPublishingQuickUpdate}
          onClose={closeUpdateDialog}
          onSubmit={submitUpdate}
        />
      )}
      {showCreateFormat && (
        <CreateFormatModal
          bankPath={bankPath}
          onClose={() => setShowCreateFormat(false)}
          onCreated={(path) => {
            handleSelectFile(path);
            setShowCreateFormat(false);
          }}
          readOnly={workspaceReadOnly}
        />
      )}
      {false}
      {showValidation && (
        <ValidationPanel
          bank={bank ?? null}
          bankPath={bankPath}
          changedFormatPaths={inventory.changedFormatPaths}
          onClose={() => setShowValidation(false)}
        />
      )}
      {showQuickCheck && (
        <QuickCheckPanel
          activeFormatContext={quickCheckActiveFormatContext}
          bankName={displayName}
          formatPaths={inventory.liveFormatPaths}
          initialMode={quickCheckMode}
          onClose={() => setShowQuickCheck(false)}
          onOpenFileInApp={handleOpenFileInApp}
        />
      )}
    </div>
  );
}
