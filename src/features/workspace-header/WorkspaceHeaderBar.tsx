import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { config } from "@/config";
import { useWorkspaceFileContent } from "@/hooks/useWorkspaceFileContent";
import { cn } from "@/lib/utils";
import { useDraftStore, useSourceStore } from "@/store";

export type WorkspaceEditorMode = "structured" | "raw";

interface Props {
  bankName: string;
  bankRepoUrl: string;
  showSenders: boolean;
  selectedFile: string | null;
  sendersPath: string;
  mode: WorkspaceEditorMode;
  onModeChange: (mode: WorkspaceEditorMode) => void;
  readOnly: boolean;
  sourceDeletedBaseSha: string | null;
  allFormatFiles: string[];
  onRenameFile: (fromPath: string, toPath: string) => boolean;
}

const headerExternalLinkClassName =
  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs text-[color:var(--c-text-dim)] no-underline hover:bg-[color:var(--c-accent-soft)] hover:text-[color:var(--c-accent)] hover:no-underline";

const headerModeTabClassName = (isActive: boolean) =>
  cn(
    "inline-flex h-[26px] cursor-pointer items-center whitespace-nowrap rounded-[5px] border px-3 font-medium text-[12.5px] transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)]",
    isActive
      ? "border-[color:var(--c-accent)] bg-[color:var(--c-bg-surface)] text-[color:var(--c-accent)] shadow-[inset_0_-2px_0_var(--c-accent)]"
      : "border-transparent bg-transparent text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-bg-surface)] hover:text-[color:var(--c-accent)]"
  );

const headerActionButtonClassName =
  "h-[28px] gap-1.5 whitespace-nowrap px-2 text-[12.5px]";

const headerDividerClassName = "h-5 w-px shrink-0 bg-[color:var(--c-border)]";

// The single workspace header bar above all three columns: bank zone (sized to
// the sidebar column), the Editor/Final-file toggle (aligned with the work
// column), the file name (the only shrinkable element) and the file actions.
export function WorkspaceHeaderBar({
  bankName,
  bankRepoUrl,
  showSenders,
  selectedFile,
  sendersPath,
  mode,
  onModeChange,
  readOnly,
  sourceDeletedBaseSha,
  allFormatFiles,
  onRenameFile,
}: Props) {
  const { t } = useTranslation();
  const filePath = showSenders ? sendersPath : selectedFile;
  // The raw/structured split does not exist for senders.txt, so the toggle is
  // gated out (grilling-session decision; the mockup leaves it ungated).
  const showModeToggle = !showSenders && Boolean(selectedFile);

  return (
    <div className="flex h-11 shrink-0 items-center rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)] px-[14px]">
      {/* Bank zone — its trailing divider lands on the sidebar/work column boundary. */}
      <div className="flex w-[calc(clamp(264px,19vw,340px)-15px)] min-w-0 shrink-0 items-center gap-2 pr-4">
        <h2 className="m-0 truncate font-semibold text-[15px]">{bankName}</h2>
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
      <div className={headerDividerClassName} />
      {showModeToggle && (
        <div className="ml-[15px] flex shrink-0 gap-[3px] rounded-[7px] border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] p-[3px]">
          <button
            className={headerModeTabClassName(mode === "structured")}
            onClick={() => onModeChange("structured")}
            type="button"
          >
            {t("editor.structured")}
          </button>
          <button
            className={headerModeTabClassName(mode === "raw")}
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
          onRenameFile={onRenameFile}
          readOnly={readOnly}
          sourceDeletedBaseSha={showSenders ? null : sourceDeletedBaseSha}
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

// Gating is identical to the pre-header toolbar: rename only succeeds for
// locally created files, undo/redo follow draft history, delete is
// unavailable for created files, reset is active while there is anything to
// roll back. Senders never expose rename/delete.
function resolveFileActionGating(params: {
  isSenders: boolean;
  readOnly: boolean;
  isDeleted: boolean;
  isModified: boolean;
  remoteBaseline: string;
}): { canReset: boolean; canDelete: boolean; canRename: boolean } {
  const { isSenders, readOnly, isDeleted, isModified, remoteBaseline } = params;
  return {
    canReset: !readOnly && (isModified || isDeleted),
    canDelete: !(isSenders || readOnly) && remoteBaseline !== "" && !isDeleted,
    canRename: !(isSenders || readOnly || isDeleted),
  };
}

// File name, repo link, change badges and the file action buttons.
function WorkspaceFileControls({
  filePath,
  isSenders,
  readOnly,
  sourceDeletedBaseSha,
  allFormatFiles,
  onRenameFile,
}: {
  filePath: string;
  isSenders: boolean;
  readOnly: boolean;
  sourceDeletedBaseSha: string | null;
  allFormatFiles: string[];
  onRenameFile: (fromPath: string, toPath: string) => boolean;
}) {
  const { t } = useTranslation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);
  const draftStore = useDraftStore();
  const [renameError, setRenameError] = useState<string | null>(null);

  // The old toolbar lived inside a per-file-keyed editor; the header persists
  // across file switches, so the rename error resets explicitly.
  useEffect(() => {
    setRenameError(null);
  }, [filePath]);

  const { data: remoteContent } = useWorkspaceFileContent({
    filePath,
    loadedFrom: "editor",
    contentRefName: sourceDeletedBaseSha ?? undefined,
  });

  const draft = draftStore.getDraft(filePath);
  const hasSourceDeletedPreview = Boolean(sourceDeletedBaseSha);
  const baseSha = draft?.baseSha ?? sourceRef?.sha ?? "";
  const remoteBaseline =
    draft?.remoteContent ??
    (hasSourceDeletedPreview ? "" : (remoteContent ?? ""));
  const isDeleted = draft?.isDeleted ?? hasSourceDeletedPreview;
  const isModified = draft ? draft.content !== draft.remoteContent : false;
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
    remoteBaseline,
  });

  const fileName = filePath.split("/").pop() ?? filePath;
  const refName =
    sourceDeletedBaseSha ??
    sourceRef?.sha ??
    sourceRef?.name ??
    config.defaultBranch;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const fileRepoUrl = `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;

  const handleRename = () => {
    if (readOnly) {
      return;
    }
    const currentDraft = draftStore.getDraft(filePath);
    if (!currentDraft || currentDraft.remoteContent !== "") {
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
    if (sourceDeletedBaseSha) {
      draftStore.setDraft(filePath, remoteContent ?? "", baseSha, "");
      return;
    }
    draftStore.resetFileToRemote(filePath);
  };

  return (
    <div className="ml-4 flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span className="truncate font-medium font-mono text-[13px]">
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
        {!isSenders && (
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
        <div className="mx-1.5 h-[18px] w-px shrink-0 bg-[color:var(--c-border)]" />
        {!isSenders && (
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
