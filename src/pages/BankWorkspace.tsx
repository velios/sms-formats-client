import { useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
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
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { config } from "@/config";
import { indexBanksFromTree } from "@/domain/bank-index";
import type { PullRequestChangedFile } from "@/domain/pull-request-workspace";
import { useBankInventory } from "@/features/bank-inventory/use-bank-inventory";
import { CreateFormatModal } from "@/features/create-entity/CreateFormatModal";
import { useIntersections } from "@/features/intersections/use-intersections";
import { UpdatePullRequestDialog } from "@/features/publish-panel/UpdatePullRequestDialog";
import {
  type QuickCheckMode,
  QuickCheckPanel,
} from "@/features/quick-check/QuickCheckPanel";
import { ResizablePanels } from "@/features/resizable-panels/ResizablePanels";
import { ValidationPanel } from "@/features/validation/ValidationPanel";
import {
  buildSearchIndexingMeta,
  useAutoSelectFormat,
} from "@/features/workspace/auto-select";
import {
  buildSelectionSearch,
  decodeRequestedFileValue,
} from "@/features/workspace/file-selection";
import {
  type ActiveFormatSearchContext,
  collectIntersectingExamples,
  getActiveExampleText,
} from "@/features/workspace/format-metrics";
import { renameDraftFormat } from "@/features/workspace/format-operations";
import {
  addRecentFile,
  getRecentFiles,
} from "@/features/workspace/recent-files";
import { useBankFormatSearch } from "@/features/workspace/use-bank-search";
import { useBankPublishAction } from "@/features/workspace/use-publish";
import {
  usePullRequestApproval,
  usePullRequestApprovalPermission,
} from "@/features/workspace/use-pull-request-rights";
import {
  type ActiveRouteSession,
  resolveWorkspaceRefresh,
  saveActiveRouteSession,
  useWorkspaceSession,
} from "@/features/workspace/use-workspace-session";
import {
  BankActionsPanel,
  FormatsPanel,
  renderWorkspaceContent,
} from "@/features/workspace/WorkspacePanels";
import {
  type WorkspaceEditorMode,
  WorkspaceHeaderBar,
} from "@/features/workspace-header/WorkspaceHeaderBar";
import { openPrsQueryKey } from "@/hooks/useGitHub";
import { cacheFileContent } from "@/infrastructure/file-content";
import {
  fetchFileContent,
  fetchOpenPRs,
  fetchRepoTree,
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
  resolvePullRequestWorkspace,
  subscribeGitHubAuthChange,
} from "@/infrastructure/github";
import { useDraftStore, useSourceStore } from "@/store";

const ImportAnswerModal = lazy(() =>
  import("@/features/import-answer/ImportAnswerModal").then((module) => ({
    default: module.ImportAnswerModal,
  }))
);
const PromptPackageModal = lazy(() =>
  import("@/features/prompt-package/PromptPackageModal").then((module) => ({
    default: module.PromptPackageModal,
  }))
);
const NO_PULL_REQUEST_CHANGES: PullRequestChangedFile[] = [];

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Workspace composition.
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
  const routeInit = useWorkspaceSession({
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
  const setTree = useSourceStore((s) => s.setTree);
  const setError = useSourceStore((s) => s.setError);
  const sourceRef = useSourceStore((s) => s.sourceRef);
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
  const [showPromptPackage, setShowPromptPackage] = useState(false);
  const [showImportAnswer, setShowImportAnswer] = useState(false);
  const bankPathsAtHeadRef = useMemo(
    () =>
      new Set(
        tree
          .filter(
            (entry) =>
              entry.type === "blob" && entry.path.startsWith(`${bankPath}/`)
          )
          .map((entry) => entry.path)
      ),
    [bankPath, tree]
  );
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
          baseSha: entry.baselineHeadSha,
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
  const inventory = useBankInventory({
    bankPath,
    sendersPath,
    remoteFormatFiles: bank?.formatFiles,
    sourceChanges: activeSession?.changedFiles ?? NO_PULL_REQUEST_CHANGES,
  });
  const sourceHeadSha = sourceRef?.sha ?? null;
  const sourceRefNameForContent = sourceRef?.sha ?? sourceRef?.name;
  useSyncExternalStore(
    subscribeGitHubAuthChange,
    getGitHubAuthChangeVersion,
    getGitHubAuthChangeVersion
  );
  const hasGitHubUserToken = Boolean(getGitHubUserToken()?.trim());

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
      saveActiveRouteSession(repository, session);
    },
    [repository, setRepository, setSource]
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
    async (session: ActiveRouteSession, preserveDrafts = false) => {
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

      const active = useSourceStore.getState();
      if (
        active.repository.owner !== repository.owner ||
        active.repository.repo !== repository.repo ||
        active.sourceRef?.prNumber !== session.prNumber
      ) {
        return;
      }
      if (
        !preserveDrafts &&
        useDraftStore.getState().getChangedFiles().length > 0
      ) {
        setStaleWorkspaceSession(session);
        return;
      }
      if (shownFilePath != null && primedContent != null) {
        cacheFileContent({
          repository,
          filePath: shownFilePath,
          content: primedContent,
          refName: session.headSha,
        });
      }
      setStaleWorkspaceSession(null);
      updateSourceFromSession(session);
      setTree(tree);
      setBanks(indexBanksFromTree(tree));
      if (!preserveDrafts) {
        useDraftStore.getState().discardAll();
      }
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
        const action = resolveWorkspaceRefresh(
          routeInitState.session,
          resolution,
          useDraftStore.getState().getChangedFiles().length > 0
        );
        switch (action) {
          case "stale":
            setStaleWorkspaceSession(resolution);
            break;
          case "refresh":
            await handleWorkspaceSynced(resolution);
            break;
          case "read-only":
            setStaleWorkspaceSession(null);
            handleWorkspaceReadOnly(resolution);
            break;
          case "ready":
            setStaleWorkspaceSession(null);
            break;
          default:
            break;
        }
      } catch (error) {
        if (!cancelled) {
          setError(String(error));
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

    void handleWorkspaceSynced(staleWorkspaceSession);
  }, [handleWorkspaceSynced, repository, staleWorkspaceSession]);

  useAutoSelectFormat({
    workspaceReady: routeInitState.status === "ready",
    requestedFile,
    allFormatFiles: inventory.formatFiles,
    sendersPath,
    preferredFormatFile: inventory.formatFiles[0] ?? null,
    selectionReady: Boolean(activeSession),
    onSelectFile: navigateToRequestedFile,
  });

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

      <ResizablePanels side="left">
        <div className="flex min-h-0 flex-col gap-4 overflow-hidden">
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
            canImportAnswer={!workspaceReadOnly}
            canResetToSource={canResetToSource}
            hasGitHubUserToken={hasGitHubUserToken}
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
            onOpenImportAnswer={() => setShowImportAnswer(true)}
            onOpenPromptPackage={() => setShowPromptPackage(true)}
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
      </ResizablePanels>

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
          formatPaths={inventory.liveFormatPaths}
          onClose={() => setShowValidation(false)}
        />
      )}
      {showImportAnswer && (
        <Suspense fallback={<Spinner />}>
          <ImportAnswerModal
            bankName={displayName}
            bankPath={bankPath}
            calculateIntersections={intersections.calculate}
            draftStore={draftStore}
            existingPaths={bankPathsAtHeadRef}
            headSha={sourceRef?.sha}
            onClose={() => setShowImportAnswer(false)}
            prNumber={
              sourceRef?.type === "pr" ? (sourceRef.prNumber ?? null) : null
            }
            repository={repository}
            sourceRefName={sourceRefNameForContent}
          />
        </Suspense>
      )}
      {showPromptPackage && (
        <Suspense fallback={<Spinner />}>
          <PromptPackageModal
            bankName={displayName}
            bankPath={bankPath}
            draftStore={draftStore}
            inventory={inventory}
            mainRefName={activeSession?.baseSha}
            onClose={() => setShowPromptPackage(false)}
            prNumber={
              sourceRef?.type === "pr" ? (sourceRef.prNumber ?? null) : null
            }
            repository={repository}
            sourceRefName={sourceRefNameForContent}
          />
        </Suspense>
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
