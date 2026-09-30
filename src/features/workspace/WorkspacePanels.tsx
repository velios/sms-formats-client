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
  "min-h-8 w-full justify-start whitespace-normal px-2.5 py-1.5 text-left text-[13px] leading-[1.3]";

const workspaceActionsDividerClassName =
  "mx-0.5 my-2 h-px shrink-0 bg-[color:var(--c-border-soft,var(--c-border))]";

export function renderWorkspaceContent(params: {
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
      />
    );
  }
  return (
    <div className="flex h-full items-center justify-center text-[color:var(--c-text-muted)]">
      {t("bank.files")}: {t("bank.noResults")}
    </div>
  );
}

export function BankActionsPanel(params: {
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
    <div className="flex shrink-0 flex-col gap-0.5 rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)] p-2.5">
      <Button
        className="min-h-9 w-full justify-center whitespace-normal px-3 py-1.5 text-center font-semibold text-[13px] leading-[1.3]"
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
      <div className={workspaceActionsDividerClassName} />
      <Button
        className={cn(
          workspaceActionButtonClassName,
          "text-[color:var(--c-error)] hover:bg-[color:var(--c-error-soft)] hover:text-[color:var(--c-error)]"
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
