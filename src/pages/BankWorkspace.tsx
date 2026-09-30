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
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { config } from "@/config";
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
} from "@/features/workspace/use-pull-request-approval";
import { useWorkspaceSession } from "@/features/workspace/use-workspace-session";
import {
  BankActionsPanel,
  FormatsPanel,
  renderWorkspaceContent,
} from "@/features/workspace/WorkspacePanels";
import { WorkspaceSessionNotice } from "@/features/workspace/WorkspaceSessionNotice";
import {
  type WorkspaceEditorMode,
  WorkspaceHeaderBar,
} from "@/features/workspace-header/WorkspaceHeaderBar";
import {
  getGitHubAuthChangeVersion,
  getGitHubUserToken,
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
  const bankPath = routeInitState.session?.bankPath ?? "";
  const banks = useSourceStore((s) => s.banks);
  const setBanks = useSourceStore((s) => s.setBanks);
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);

  const bank = useMemo(
    () => banks.find((b) => b.folderPath === bankPath),
    [banks, bankPath]
  );
  const activeSession = routeInitState.session;
  const workspaceReadOnly =
    !activeSession?.writable ||
    routeInitState.block !== null ||
    routeInitState.operation === "opening";
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
  useEffect(() => {
    setPendingFocusedFilePath(null);
  }, [bankPath, repository.owner, repository.repo, sourceRefNameForContent]);

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
      inventory.formatFiles.includes(requestedFile) &&
      (bankPathsAtHeadRef.has(requestedFile) ||
        Boolean(draftStore.getDraft(requestedFile)))
        ? requestedFile
        : null,
    [
      inventory.formatFiles,
      requestedFile,
      sendersPath,
      bankPathsAtHeadRef,
      draftStore,
    ]
  );
  const selectedFileRemoved = Boolean(
    requestedFile &&
      !selectedFile &&
      requestedFile !== sendersPath &&
      inventory.recordsByPath.get(requestedFile)?.source === "deleted"
  );
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
  const canResetToSource =
    !workspaceReadOnly && inventory.hasLocalChangesInBank;
  const handleResetToSource = useCallback(() => {
    if (workspaceReadOnly) {
      return;
    }
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
    workspaceReadOnly,
  ]);
  const canApprovePullRequest = usePullRequestApprovalPermission({
    repository,
    sourceRef: sourceRef?.type === "pr" ? sourceRef : null,
  });
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
    sourceRef: sourceRef?.type === "pr" ? sourceRef : null,
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
  } = useBankPublishAction({ bank, controller: routeInit.controller, t });

  useAutoSelectFormat({
    workspaceReady: Boolean(activeSession),
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

  if (!activeSession) {
    return routeInitState.operation === "opening" ? (
      <div className="ui-panel ui-panel-body ui-state">
        <Spinner />
        <span>{t("app.loading")}</span>
      </div>
    ) : (
      <WorkspaceSessionNotice
        controller={routeInit.controller}
        state={routeInitState}
      />
    );
  }

  if (!bank && inventory.formatFiles.length === 0) {
    return (
      <div className="ui-panel ui-panel-body">
        <div className="text-muted-foreground">
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
    <div className="ui-panel-stack h-full">
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
      />

      <WorkspaceSessionNotice
        controller={routeInit.controller}
        state={routeInitState}
      />

      {selectedFileRemoved && (
        <StatusBadge variant="warning">
          {t("workspace.selectedFileRemoved", { path: requestedFile })}
        </StatusBadge>
      )}

      <ResizablePanels side="left">
        <div className="ui-panel-stack overflow-hidden">
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
              workspaceReadOnly ||
              routeInitState.operation !== null ||
              changedFilesForPublish.length === 0
            }
            publishError={publishError}
            revisionReady={routeInitState.block !== "sync-pending"}
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

        <div className="ui-panel-stack min-w-0 overflow-hidden">
          {renderWorkspaceContent({
            showSenders,
            bankPath,
            readOnly: workspaceReadOnly,
            selectedFile,
            selectedFileIntersectionExamples,
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
      {showValidation && routeInitState.block !== "sync-pending" && (
        <ValidationPanel
          bank={bank ?? null}
          bankPath={bankPath}
          onClose={() => setShowValidation(false)}
        />
      )}
      {showImportAnswer && !workspaceReadOnly && (
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
      {showPromptPackage && routeInitState.block !== "sync-pending" && (
        <Suspense fallback={<Spinner />}>
          <PromptPackageModal
            bankName={displayName}
            bankPath={bankPath}
            baseSha={activeSession?.baseSha}
            draftStore={draftStore}
            headSha={sourceRefNameForContent}
            inventory={inventory}
            onClose={() => setShowPromptPackage(false)}
            prNumber={
              sourceRef?.type === "pr" ? (sourceRef.prNumber ?? null) : null
            }
            repository={repository}
          />
        </Suspense>
      )}
      {showQuickCheck && routeInitState.block !== "sync-pending" && (
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
