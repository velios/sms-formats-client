import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { config } from "@/config";
import { useWorkspaceFileContent } from "@/hooks/useWorkspaceFileContent";
import { useDraftStore, useSourceStore } from "@/store";

export type WorkspaceEditorMode = "structured" | "raw";

interface Props {
  localOnly?: boolean;
  bankName: string;
  bankRepoUrl: string;
  showSenders: boolean;
  selectedFile: string | null;
  sendersPath: string;
  mode: WorkspaceEditorMode;
  onModeChange: (mode: WorkspaceEditorMode) => void;
  readOnly: boolean;
  allFormatFiles: string[];
  onRenameFile: (fromPath: string, toPath: string) => boolean;
}

const headerExternalLinkClassName =
  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-muted-foreground no-underline hover:bg-primary-soft hover:text-primary hover:no-underline";

const headerActionButtonClassName = "gap-1 whitespace-nowrap";

const headerDividerClassName = "h-5 w-px shrink-0 bg-border";

export function WorkspaceHeaderBar({
  localOnly = false,
  bankName,
  bankRepoUrl,
  showSenders,
  selectedFile,
  sendersPath,
  mode,
  onModeChange,
  readOnly,
  allFormatFiles,
  onRenameFile,
}: Props) {
  const { t } = useTranslation();
  const filePath = showSenders ? sendersPath : selectedFile;
  const showModeToggle = !showSenders && Boolean(selectedFile);

  return (
    <div className="ui-panel ui-panel-inset flex h-11 shrink-0 items-center">
      <div className="flex w-[calc(clamp(264px,19vw,340px)+2px)] min-w-0 shrink-0 items-center gap-2 pr-4">
        <h2 className="m-0 truncate font-semibold text-base">{bankName}</h2>
        <a
          aria-label={t("bank.openBankFolderInRepo")}
          className={headerExternalLinkClassName}
          href={bankRepoUrl}
          rel="noreferrer"
          target="_blank"
          title={t("bank.openBankFolderInRepo")}
        >
          ↗
        </a>
      </div>
      {showModeToggle && (
        <div className="ui-segmented" role="group">
          <button
            aria-pressed={mode === "structured"}
            className="ui-segment"
            onClick={() => onModeChange("structured")}
            type="button"
          >
            {t("editor.structured")}
          </button>
          <button
            aria-pressed={mode === "raw"}
            className="ui-segment"
            onClick={() => onModeChange("raw")}
            type="button"
          >
            {t("editor.raw")}
          </button>
        </div>
      )}
      {filePath && (
        <WorkspaceFileControls
          allFormatFiles={allFormatFiles}
          filePath={filePath}
          isSenders={showSenders}
          localOnly={localOnly}
          onRenameFile={onRenameFile}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

function buildRenameTargetPath(params: {
  input: string;
  filePath: string;
  allFormatFiles: string[];
  t: (key: string) => string;
}): { targetPath: string } | { error: string | null } {
  const { input, filePath, allFormatFiles, t } = params;
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
    return { error: t("editor.renameErrorInvalid") };
  }
  const targetFileName = /\.txt$/i.test(trimmed) ? trimmed : `${trimmed}.txt`;
  const fileDirPath = filePath.split("/").slice(0, -1).join("/");
  const targetPath = `${fileDirPath}/${targetFileName}`;
  if (targetPath === filePath) {
    return { error: null };
  }
  if (allFormatFiles.includes(targetPath)) {
    return { error: t("editor.renameErrorExists") };
  }
  return { targetPath };
}

function resolveFileActionGating(params: {
  isSenders: boolean;
  readOnly: boolean;
  isDeleted: boolean;
  isModified: boolean;
  hasExamplePositionChanges: boolean;
  remoteBaseline: string | null;
  hasDocument: boolean;
}): { canReset: boolean; canDelete: boolean; canRename: boolean } {
  const {
    isSenders,
    readOnly,
    isDeleted,
    isModified,
    hasExamplePositionChanges,
    remoteBaseline,
    hasDocument,
  } = params;
  return {
    canReset:
      !readOnly && (isModified || isDeleted || hasExamplePositionChanges),
    canDelete: !(isSenders || readOnly || isDeleted) && hasDocument,
    canRename:
      !(isSenders || readOnly || isDeleted) &&
      remoteBaseline === null &&
      hasDocument,
  };
}

function WorkspaceFileControls({
  filePath,
  localOnly = false,
  isSenders,
  readOnly,
  allFormatFiles,
  onRenameFile,
}: {
  filePath: string;
  localOnly?: boolean;
  isSenders: boolean;
  readOnly: boolean;
  allFormatFiles: string[];
  onRenameFile: (fromPath: string, toPath: string) => boolean;
}) {
  const { t } = useTranslation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);
  const draftStore = useDraftStore();
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    setRenameError(null);
  }, [filePath]);

  const draft = draftStore.getDraft(filePath);
  const { data: headContent } = useWorkspaceFileContent({
    filePath,
    enabled: !localOnly && draft?.headContent !== null,
  });

  const remoteBaseline = draft ? draft.headContent : (headContent ?? null);
  const isDeleted = draft?.isDeleted ?? false;
  const isModified = draft ? draft.content !== draft.headContent : false;
  // Replacing an original with an identical local Example only changes identity.
  const hasExamplePositionChanges = Boolean(
    !isSenders &&
      draft?.examplePositions?.some((position, index) => position !== index + 1)
  );
  const canUndo = draftStore.canUndo(filePath);
  const canRedo = draftStore.canRedo(filePath);
  const {
    canReset: canResetFile,
    canDelete: canDeleteFile,
    canRename: canRenameFile,
  } = resolveFileActionGating({
    isSenders,
    readOnly,
    isDeleted,
    isModified,
    hasExamplePositionChanges,
    remoteBaseline,
    hasDocument: Boolean(draft) || headContent !== undefined,
  });

  const fileName = filePath.split("/").pop() ?? filePath;
  const refName = sourceRef?.sha ?? sourceRef?.name ?? config.defaultBranch;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const fileRepoUrl = `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;

  const handleRename = () => {
    if (readOnly) {
      return;
    }
    const currentDraft = draftStore.getDraft(filePath);
    if (!currentDraft || currentDraft.headContent !== null) {
      setRenameError(t("editor.renameOnlyDraft"));
      return;
    }
    const input = window.prompt(t("editor.renamePrompt"), fileName);
    if (input == null) {
      return;
    }
    const resolved = buildRenameTargetPath({
      input,
      filePath,
      allFormatFiles,
      t,
    });
    if (!("targetPath" in resolved)) {
      setRenameError(resolved.error);
      return;
    }
    setRenameError(
      onRenameFile(filePath, resolved.targetPath)
        ? null
        : t("editor.renameErrorFailed")
    );
  };

  const handleDelete = () => {
    if (
      isModified &&
      !window.confirm(t("editor.deleteFormatConfirmModified"))
    ) {
      return;
    }
    draftStore.markDeleted(filePath);
  };

  const handleReset = () => {
    draftStore.resetFileToRemote(filePath);
  };

  return (
    <div className="ml-4 flex min-w-0 flex-1 items-center gap-2">
      <div className={headerDividerClassName} />
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span className="truncate font-medium font-mono text-sm">
          {fileName}
        </span>
        <a
          aria-label={t("bank.openFormatInRepo")}
          className={headerExternalLinkClassName}
          href={fileRepoUrl}
          rel="noreferrer"
          target="_blank"
          title={t("bank.openFormatInRepo")}
        >
          ↗
        </a>
        {isModified && (
          <StatusBadge className="shrink-0" variant="modified">
            {t("editor.modified")}
          </StatusBadge>
        )}
        {isDeleted && (
          <StatusBadge className="shrink-0" variant="modified">
            {t("editor.deleted")}
          </StatusBadge>
        )}
        {renameError && (
          <StatusBadge className="shrink-0" variant="warning">
            {renameError}
          </StatusBadge>
        )}
      </div>
      <div className={headerDividerClassName} />
      <div className="flex shrink-0 items-center gap-0.5">
        {!(isSenders || localOnly) && (
          <Button
            aria-label={t("editor.renameFormat")}
            className={headerActionButtonClassName}
            disabled={!canRenameFile}
            onClick={handleRename}
            size="sm"
            type="button"
            variant="ghost"
          >
            <span aria-hidden="true">✎</span>
            {t("editor.renameFormat")}
          </Button>
        )}
        <Button
          aria-label={t("editor.undo")}
          className={headerActionButtonClassName}
          disabled={readOnly || !canUndo}
          onClick={() => draftStore.undo(filePath)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true">↶</span>
          {t("editor.undo")}
        </Button>
        <Button
          aria-label={t("editor.redo")}
          className={headerActionButtonClassName}
          disabled={readOnly || !canRedo}
          onClick={() => draftStore.redo(filePath)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true">↷</span>
          {t("editor.redo")}
        </Button>
        <div className="mx-1.5 h-[18px] w-px shrink-0 bg-border" />
        {!(isSenders || localOnly) && (
          <Button
            aria-label={t("editor.deleteFormat")}
            className={headerActionButtonClassName}
            disabled={!canDeleteFile}
            onClick={handleDelete}
            size="sm"
            type="button"
            variant="ghost"
          >
            <span aria-hidden="true">✕</span>
            {t("editor.delete")}
          </Button>
        )}
        <Button
          aria-label={t("editor.resetFileToSource")}
          className={headerActionButtonClassName}
          disabled={!canResetFile}
          onClick={handleReset}
          size="sm"
          title={t("editor.resetFileToSource")}
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true">⟲</span>
          {t("editor.reset")}
        </Button>
      </div>
    </div>
  );
}
