import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import type { FormatIntersectionStat } from "@/domain/format";
import type { BankFileRecord } from "@/features/bank-inventory/core";
import { FormatEditor } from "@/features/format-editor/FormatEditor";
import { SendersEditor } from "@/features/senders-editor/SendersEditor";
import {
  type ActiveFormatSearchContext,
  FormatIntersectionMetric,
  type IntersectionExampleItem,
} from "@/features/workspace/format-metrics";
import { extractFormatFileName } from "@/features/workspace/use-bank-search";
import type { WorkspaceEditorMode } from "@/features/workspace-header/WorkspaceHeaderBar";
import { cn } from "@/lib/utils";
import { NormalizeBankExamplesButton } from "./NormalizeBankExamplesButton";

const workspaceFileRowClassName = (params: {
  isDeleted: boolean;
  isSelected: boolean;
}) =>
  cn(
    "ui-list-row",
    params.isSelected ? "bg-accent text-primary" : "hover:bg-accent",
    params.isDeleted &&
      "line-through decoration-1 decoration-current opacity-80"
  );

const workspaceExternalLinkClassName =
  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-muted-foreground no-underline hover:bg-primary-soft hover:text-primary hover:no-underline";

const workspaceActionButtonClassName =
  "w-full justify-start whitespace-normal text-left leading-[1.3]";

const workspaceActionsDividerClassName =
  "mx-0.5 my-2 h-px shrink-0 bg-[color:var(--border)]";

export function renderWorkspaceContent(params: {
  anchorReady?: boolean;
  sourceComparison?: Parameters<typeof FormatEditor>[0]["sourceComparison"];
  showSenders: boolean;
  bankPath: string;
  readOnly: boolean;
  selectedFile: string | null;
  selectedFileIntersectionExamples: IntersectionExampleItem[];
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
        anchorReady={params.anchorReady}
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
        sourceComparison={params.sourceComparison}
      />
    );
  }
  return (
    <div className="ui-panel ui-panel-body flex h-full items-center justify-center text-muted-foreground">
      {t("bank.files")}: {t("bank.noResults")}
    </div>
  );
}

export function BankActionsPanel(params: {
  normalization: Parameters<typeof NormalizeBankExamplesButton>[0];
  onApprovePullRequest: () => void;
  onCalculateIntersections: () => void;
  onOpenPromptPackage: () => void;
  onOpenImportAnswer: () => void;
  canImportAnswer: boolean;
  revisionReady: boolean;
  hasGitHubUserToken: boolean;
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
    onOpenPromptPackage,
    onOpenImportAnswer,
    canImportAnswer,
    revisionReady,
    hasGitHubUserToken,
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
    <div className="ui-panel flex shrink-0 flex-col gap-0.5 p-2">
      <Button
        className="w-full justify-center whitespace-normal text-center font-semibold leading-[1.3]"
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
      <div className={workspaceActionsDividerClassName} />
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
          variant={isPullRequestApproved ? "success" : "ghost"}
        >
          {approvePullRequestLabel}
        </Button>
      )}
      {approvePullRequestError && (
        <StatusBadge variant="error">{approvePullRequestError}</StatusBadge>
      )}
      <Button
        className={workspaceActionButtonClassName}
        disabled={!revisionReady}
        onClick={onOpenValidation}
        type="button"
        variant="ghost"
      >
        {t("editor.validation")}
      </Button>
      <Button
        className={workspaceActionButtonClassName}
        disabled={!revisionReady}
        onClick={onOpenTemplateBySms}
        type="button"
        variant="ghost"
      >
        {t("quickCheck.openTemplateBySms")}
      </Button>
      <Button
        className={workspaceActionButtonClassName}
        disabled={!revisionReady}
        onClick={onOpenSmsByTemplate}
        type="button"
        variant="ghost"
      >
        {t("quickCheck.openSmsByTemplate")}
      </Button>
      <Button
        className={workspaceActionButtonClassName}
        disabled={!revisionReady || isCalculatingIntersections}
        onClick={onCalculateIntersections}
        type="button"
        variant="ghost"
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
      <span
        className="w-full"
        title={
          hasGitHubUserToken ? undefined : t("promptPackage.tokenRequired")
        }
      >
        <Button
          className={workspaceActionButtonClassName}
          disabled={!(revisionReady && hasGitHubUserToken)}
          onClick={onOpenPromptPackage}
          type="button"
          variant="ghost"
        >
          {t("promptPackage.openAction")}
        </Button>
      </span>
      <span
        className="w-full"
        title={canImportAnswer ? undefined : t("importAnswer.readOnly")}
      >
        <Button
          className={workspaceActionButtonClassName}
          disabled={!canImportAnswer}
          onClick={onOpenImportAnswer}
          type="button"
          variant="ghost"
        >
          {t("importAnswer.openAction")}
        </Button>
      </span>
      <NormalizeBankExamplesButton {...params.normalization} />
      <div className={workspaceActionsDividerClassName} />
      <Button
        className={cn(
          workspaceActionButtonClassName,
          "text-destructive hover:bg-destructive-soft hover:text-destructive"
        )}
        disabled={!canResetToSource}
        onClick={onResetToSource}
        type="button"
        variant="ghost"
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
    <div className="ui-panel flex min-h-0 flex-1 flex-col">
      <div className="ui-panel-heading">
        <span>
          {t("bank.files")}{" "}
          <span className="text-muted-foreground text-xs">
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
      <div className="ui-tabs">
        <button
          className="ui-tab"
          data-active={formatTab === "all"}
          onClick={() => setFormatTab("all")}
        >
          {t("bank.allFiles")}
        </button>
        <button
          className="ui-tab"
          data-active={formatTab === "recent"}
          onClick={() => setFormatTab("recent")}
        >
          {t("bank.recentFiles")}
        </button>
        {intersectionScopeFiles && (
          <button
            className="ui-tab"
            data-active={formatTab === "intersections"}
            onClick={() => setFormatTab("intersections")}
          >
            {t("bank.intersectionsTab")}
          </button>
        )}
      </div>
      <div className="ui-panel-inset border-border border-b py-2">
        <Input
          aria-label={t("bank.searchFile")}
          onChange={(e) => setFormatSearch(e.target.value)}
          placeholder={t("bank.searchFile")}
          value={formatSearch}
        />
        {showSearchIndexStatus && (
          <div className="mt-1.5 text-muted-foreground text-xs">
            {searchIndexingLabel}
          </div>
        )}
      </div>
      <div className="min-h-0 overflow-y-auto">
        {/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: File row presentation. */}
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
          const isLocalCreated = !isSenders && localStatus === "created";
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
                  "cursor-default text-destructive hover:bg-transparent"
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
                <span className="truncate font-mono text-xs">
                  {displayName}
                </span>
                {intersectionStats && (
                  <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs tabular-nums leading-none">
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
          <div className="ui-panel-body text-muted-foreground text-xs">
            {t("bank.noResults")}
          </div>
        )}
      </div>
    </div>
  );
}
