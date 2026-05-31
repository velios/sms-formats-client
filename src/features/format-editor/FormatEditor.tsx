import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { config } from "@/config";
import { parseFormatFile, serializeFormat } from "@/domain/format";
import { RegexLab } from "@/features/regex-lab/RegexLab";
import { useWorkspaceFileContent } from "@/hooks/useWorkspaceFileContent";
import { cn } from "@/lib/utils";
import { useDraftStore, useSourceStore } from "@/store";

type EditorMode = "structured" | "raw";

interface Props {
  filePath: string;
  allFormatFiles: string[];
  intersectionExamples?: Array<{
    text: string;
    filePath: string;
    fileName: string;
  }>;
  readOnly?: boolean;
  sourceDeletedBaseSha?: string | null;
  onRenameFile: (fromPath: string, toPath: string) => boolean;
  onOpenTemplateBySms?: () => void;
  onOpenSmsByTemplate?: () => void;
  onOpenIntersectionFileInApp?: (filePath: string) => void;
  onRegexBlurAfterEdit?: (context: {
    filePath: string;
    regex: string;
    examples: string[];
  }) => void;
  onSearchContextChange?: (context: {
    filePath: string;
    regex: string;
    examples: string[];
    activeExampleIndex: number;
  }) => void;
}

function isRegexValid(value: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

function serializeStructuredDraft(
  regex: string,
  columns: string[],
  examples: string[]
): string {
  return serializeFormat(regex, columns, examples);
}

const formatEditorModeTabClassName = (isActive: boolean) =>
  cn(
    "rounded-[5px] border px-3 py-1.5 font-medium text-[13px] transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)]",
    isActive
      ? "border-[color:var(--c-accent)] bg-[color:var(--c-bg-surface)] text-[color:var(--c-accent)] shadow-[inset_0_-2px_0_var(--c-accent)]"
      : "border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] text-[color:var(--c-text-muted)] hover:border-[color:var(--c-accent-soft)] hover:bg-[color:var(--c-bg-surface)] hover:text-[color:var(--c-accent)]"
  );

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeping the existing editor shape avoids a much larger unrelated refactor.
export function FormatEditor({
  filePath,
  allFormatFiles,
  intersectionExamples = [],
  readOnly = false,
  sourceDeletedBaseSha = null,
  onRenameFile,
  onOpenTemplateBySms,
  onOpenSmsByTemplate,
  onOpenIntersectionFileInApp,
  onRegexBlurAfterEdit,
  onSearchContextChange,
}: Props) {
  const { t } = useTranslation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);
  const draftStore = useDraftStore();

  const {
    data: remoteContent,
    isLoading,
    error: remoteContentError,
  } = useWorkspaceFileContent({
    filePath,
    loadedFrom: "editor",
    contentRefName: sourceDeletedBaseSha ?? undefined,
  });

  const draft = draftStore.getDraft(filePath);
  const hasSourceDeletedPreview = Boolean(sourceDeletedBaseSha);
  const currentContent = draft?.content ?? remoteContent ?? "";
  const baseSha = draft?.baseSha ?? sourceRef?.sha ?? "";
  const remoteBaseline =
    draft?.remoteContent ??
    (hasSourceDeletedPreview ? "" : (remoteContent ?? ""));
  const isDeleted = draft?.isDeleted ?? Boolean(sourceDeletedBaseSha);
  const isMutationBlocked = readOnly || isDeleted;
  const hasLoadedInitial = draft != null || remoteContent !== undefined;

  // Structured state
  const [regex, setRegex] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [examples, setExamples] = useState<string[]>([]);
  const [activeExampleIndex, setActiveExampleIndex] = useState(0);
  const [rawContent, setRawContent] = useState("");
  const [mode, setMode] = useState<EditorMode>("structured");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [structuralIssues, setStructuralIssues] = useState<string[]>([]);
  const [renameError, setRenameError] = useState<string | null>(null);
  const lastAppliedContentRef = useRef<string | null>(null);
  const hasPendingRegexBlurRef = useRef(false);
  const latestRegexRef = useRef("");
  const latestExamplesRef = useRef<string[]>([]);

  const parseRawToStructured = useCallback(
    (raw: string, preserveActiveIndex: boolean) => {
      const parsed = parseFormatFile(raw, filePath);
      const structural = parsed.parseIssues.map((issue) => issue.message);
      const issues = [...structural];
      if (parsed.regex && !isRegexValid(parsed.regex)) {
        issues.push(t("editor.invalidRegex"));
      }
      setParseErrors(issues);
      setStructuralIssues(structural);

      const canSync = !!parsed.regex && parsed.examples.length > 0;

      if (!canSync) {
        return false;
      }

      const nextExamples = parsed.examples.length > 0 ? parsed.examples : [""];
      latestRegexRef.current = parsed.regex;
      latestExamplesRef.current = nextExamples;
      setRegex(parsed.regex);
      setColumns(parsed.columns);
      setExamples(nextExamples);
      setActiveExampleIndex((prev) =>
        preserveActiveIndex
          ? Math.min(prev, Math.max(nextExamples.length - 1, 0))
          : 0
      );
      return true;
    },
    [filePath, t]
  );

  const syncStructuredDraft = useCallback(
    (nextRegex: string, nextColumns: string[], nextExamples: string[]) => {
      if (isMutationBlocked) {
        return;
      }
      const syncedRaw = serializeStructuredDraft(
        nextRegex,
        nextColumns,
        nextExamples
      );
      setRawContent(syncedRaw);
      setParseErrors(
        nextRegex.trim() && !isRegexValid(nextRegex)
          ? [t("editor.invalidRegex")]
          : []
      );
      // A serialized structured draft is always well-formed, so any prior
      // structural parse issue (missing section/marker) is gone after a sync.
      setStructuralIssues([]);
      lastAppliedContentRef.current = syncedRaw;
      draftStore.applyUserEdit(filePath, syncedRaw, baseSha, remoteBaseline);
    },
    [baseSha, draftStore, filePath, isMutationBlocked, remoteBaseline, t]
  );

  useEffect(() => {
    if (!hasLoadedInitial) {
      return;
    }
    if (lastAppliedContentRef.current === currentContent) {
      return;
    }
    lastAppliedContentRef.current = currentContent;
    hasPendingRegexBlurRef.current = false;
    setRawContent(currentContent);
    parseRawToStructured(currentContent, false);
  }, [currentContent, hasLoadedInitial, parseRawToStructured]);

  useEffect(() => {
    if (!readOnly && remoteContent !== undefined && !hasSourceDeletedPreview) {
      draftStore.ensureDraft(filePath, remoteContent, baseSha, remoteContent);
    }
  }, [
    baseSha,
    draftStore,
    filePath,
    hasSourceDeletedPreview,
    readOnly,
    remoteContent,
  ]);

  const handleRawChange = (value: string) => {
    if (isMutationBlocked) {
      return;
    }
    setRawContent(value);
    parseRawToStructured(value, true);
    lastAppliedContentRef.current = value;
    draftStore.applyUserEdit(filePath, value, baseSha, remoteBaseline);
  };

  const handleRegexChange = (value: string) => {
    hasPendingRegexBlurRef.current = true;
    latestRegexRef.current = value;
    setRegex(value);
    syncStructuredDraft(value, columns, examples);
  };

  const handleRegexBlur = () => {
    if (!hasPendingRegexBlurRef.current) {
      return;
    }

    hasPendingRegexBlurRef.current = false;
    onRegexBlurAfterEdit?.({
      filePath,
      regex: latestRegexRef.current,
      examples: latestExamplesRef.current,
    });
  };

  const handleColumnsChange = (newCols: string[]) => {
    setColumns(newCols);
    syncStructuredDraft(regex, newCols, examples);
  };

  const handleExampleChange = (index: number, value: string) => {
    const newExamples = [...examples];
    newExamples[index] = value;
    latestExamplesRef.current = newExamples;
    setExamples(newExamples);
    syncStructuredDraft(regex, columns, newExamples);
  };

  const handleAddExample = () => {
    if (isMutationBlocked) {
      return;
    }
    const newExamples = [...examples, ""];
    latestExamplesRef.current = newExamples;
    setExamples(newExamples);
    setActiveExampleIndex(newExamples.length - 1);
    syncStructuredDraft(regex, columns, newExamples);
  };

  const handleRemoveExample = (index: number) => {
    if (isMutationBlocked) {
      return;
    }
    if (examples.length <= 1) {
      return;
    }
    const newExamples = examples.filter((_, i) => i !== index);
    latestExamplesRef.current = newExamples;
    setExamples(newExamples);
    syncStructuredDraft(regex, columns, newExamples);
    if (activeExampleIndex >= newExamples.length) {
      setActiveExampleIndex(newExamples.length - 1);
    }
  };

  useEffect(() => {
    onSearchContextChange?.({
      filePath,
      regex,
      examples,
      activeExampleIndex,
    });
  }, [activeExampleIndex, examples, filePath, onSearchContextChange, regex]);

  const isModified = draft ? draft.content !== draft.remoteContent : false;
  const fileName = filePath.split("/").pop() ?? filePath;
  const fileDirPath = filePath.split("/").slice(0, -1).join("/");
  const refName =
    sourceDeletedBaseSha ??
    sourceRef?.sha ??
    sourceRef?.name ??
    config.defaultBranch;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const formatRepoUrl = `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;
  const canUndo = draftStore.canUndo(filePath);
  const canRedo = draftStore.canRedo(filePath);
  const canResetFile = !readOnly && (isModified || isDeleted);
  const canDeleteFile = !readOnly && remoteBaseline !== "" && !isDeleted;
  const canRenameFile = !(readOnly || isDeleted);

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

    const trimmed = input.trim();
    if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
      setRenameError(t("editor.renameErrorInvalid"));
      return;
    }

    const targetFileName = /\.txt$/i.test(trimmed) ? trimmed : `${trimmed}.txt`;
    const targetPath = `${fileDirPath}/${targetFileName}`;
    if (targetPath === filePath) {
      setRenameError(null);
      return;
    }

    if (allFormatFiles.includes(targetPath)) {
      setRenameError(t("editor.renameErrorExists"));
      return;
    }

    const renamed = onRenameFile(filePath, targetPath);
    if (!renamed) {
      setRenameError(t("editor.renameErrorFailed"));
      return;
    }

    setRenameError(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Spinner />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      {remoteContentError && (
        <StatusBadge variant="error">{remoteContentError}</StatusBadge>
      )}
      {/* Compact header: mode tabs + file name + actions */}
      <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-2">
        <div className="shrink-0 rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] p-1">
          <button
            className={formatEditorModeTabClassName(mode === "structured")}
            onClick={() => setMode("structured")}
            type="button"
          >
            {t("editor.structured")}
          </button>
          <button
            className={formatEditorModeTabClassName(mode === "raw")}
            onClick={() => setMode("raw")}
            type="button"
          >
            {t("editor.raw")}
          </button>
        </div>
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">
          <span className="font-medium font-mono">{fileName}</span>
          <Button
            disabled={!canRenameFile}
            onClick={handleRename}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("editor.renameFormat")}
          </Button>
          <Button
            aria-label={t("bank.openFormatInRepo")}
            asChild
            size="sm"
            title={t("bank.openFormatInRepo")}
            variant="ghost"
          >
            <a
              href={formatRepoUrl}
              onClick={(e) => e.stopPropagation()}
              rel="noreferrer"
              target="_blank"
            >
              ↗
            </a>
          </Button>
          {isModified && (
            <StatusBadge variant="modified">{t("editor.modified")}</StatusBadge>
          )}
          {isDeleted && (
            <StatusBadge variant="modified">{t("editor.deleted")}</StatusBadge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label={t("editor.undo")}
            disabled={readOnly || !canUndo}
            onClick={() => draftStore.undo(filePath)}
            size="sm"
            type="button"
            variant="ghost"
          >
            ↶ {t("editor.undo")}
          </Button>
          <Button
            aria-label={t("editor.redo")}
            disabled={readOnly || !canRedo}
            onClick={() => draftStore.redo(filePath)}
            size="sm"
            type="button"
            variant="ghost"
          >
            ↷ {t("editor.redo")}
          </Button>
          <Button
            aria-label={t("editor.deleteFormat")}
            disabled={!canDeleteFile}
            onClick={() => {
              if (
                isModified &&
                !window.confirm(t("editor.deleteFormatConfirmModified"))
              ) {
                return;
              }
              draftStore.markDeleted(filePath);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            ✕ {t("editor.deleteFormat")}
          </Button>
          <Button
            aria-label={t("editor.resetFileToSource")}
            disabled={!canResetFile}
            onClick={() => {
              if (sourceDeletedBaseSha) {
                draftStore.setDraft(filePath, remoteContent ?? "", baseSha, "");
                return;
              }
              draftStore.resetFileToRemote(filePath);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            ⟲ {t("editor.resetFileToSource")}
          </Button>
        </div>
      </div>

      {/* Parse errors */}
      {renameError && (
        <div className="rounded-[var(--radius-sm)] bg-[color:var(--c-warning-soft)] px-3 py-2 text-[color:var(--c-warning)] text-xs">
          {renameError}
        </div>
      )}
      {mode === "raw" && parseErrors.length > 0 && (
        <div className="flex flex-col gap-1">
          {parseErrors.map((err, i) => (
            <div
              className="rounded-[var(--radius-sm)] bg-[color:var(--c-warning-soft)] px-3 py-2 text-[color:var(--c-warning)] text-xs"
              key={i}
            >
              {err}
            </div>
          ))}
        </div>
      )}

      {/* Content based on mode */}
      {mode === "structured" && (
        <RegexLab
          activeExampleIndex={activeExampleIndex}
          columns={columns}
          examples={examples}
          intersectionExamples={intersectionExamples}
          onActiveExampleChange={setActiveExampleIndex}
          onAddExample={handleAddExample}
          onColumnsChange={handleColumnsChange}
          onExampleChange={handleExampleChange}
          onOpenIntersectionFileInApp={onOpenIntersectionFileInApp}
          onOpenSmsByTemplate={onOpenSmsByTemplate}
          onOpenTemplateBySms={onOpenTemplateBySms}
          onRegexBlur={handleRegexBlur}
          onRegexChange={handleRegexChange}
          onRemoveExample={handleRemoveExample}
          readOnly={readOnly || isDeleted}
          regex={regex}
          structuralIssues={structuralIssues}
        />
      )}

      {mode === "raw" && (
        <div className="overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)]">
          <div className="border-[color:var(--c-border)] border-b bg-[color:var(--c-bg-elevated)] px-4 py-2 font-semibold text-[13px] text-[color:var(--c-text-muted)] uppercase tracking-[0.5px]">
            {t("editor.raw")}
          </div>
          <div className="p-4">
            <Textarea
              className="min-h-[20rem] font-mono"
              onChange={(e) => handleRawChange(e.target.value)}
              readOnly={readOnly || isDeleted}
              rows={20}
              spellCheck={false}
              value={rawContent}
            />
          </div>
        </div>
      )}
    </div>
  );
}
