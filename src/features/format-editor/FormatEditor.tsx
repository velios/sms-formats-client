import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { config } from "@/config";
import { parseFormatFile, serializeFormat } from "@/domain/format";
import { RegexLab } from "@/features/regex-lab/RegexLab";
import { useFileContent } from "@/hooks/useGitHub";
import { useDraftStore, useSourceStore } from "@/store";

type EditorMode = "structured" | "raw";

interface Props {
  filePath: string;
  allFormatFiles: string[];
  onRenameFile: (fromPath: string, toPath: string) => boolean;
  onOpenTemplateBySms?: () => void;
  onOpenSmsByTemplate?: () => void;
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

export function FormatEditor({
  filePath,
  allFormatFiles,
  onRenameFile,
  onOpenTemplateBySms,
  onOpenSmsByTemplate,
  onSearchContextChange,
}: Props) {
  const { t } = useTranslation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const repository = useSourceStore((s) => s.repository);
  const draftStore = useDraftStore();

  // Load remote content
  const { data: remoteContent, isLoading } = useFileContent(
    filePath,
    sourceRef?.sha ?? sourceRef?.name
  );

  const draft = draftStore.getDraft(filePath);
  const currentContent = draft?.content ?? remoteContent ?? "";
  const baseSha = draft?.baseSha ?? sourceRef?.sha ?? "";
  const remoteBaseline = remoteContent ?? draft?.remoteContent ?? "";
  const isDeleted = draft?.isDeleted ?? false;
  const hasLoadedInitial = draft != null || remoteContent !== undefined;

  // Structured state
  const [regex, setRegex] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [examples, setExamples] = useState<string[]>([]);
  const [activeExampleIndex, setActiveExampleIndex] = useState(0);
  const [rawContent, setRawContent] = useState("");
  const [mode, setMode] = useState<EditorMode>("structured");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [renameError, setRenameError] = useState<string | null>(null);
  const lastAppliedContentRef = useRef<string | null>(null);

  const parseRawToStructured = useCallback(
    (raw: string, preserveActiveIndex: boolean) => {
      const parsed = parseFormatFile(raw, filePath);
      const issues = parsed.parseIssues.map((issue) => issue.message);
      if (parsed.regex && !isRegexValid(parsed.regex)) {
        issues.push(t("editor.invalidRegex"));
      }
      setParseErrors(issues);

      const canSync = !!parsed.regex && parsed.examples.length > 0;

      if (!canSync) {
        return false;
      }

      const nextExamples = parsed.examples.length > 0 ? parsed.examples : [""];
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
      if (isDeleted) {
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
      lastAppliedContentRef.current = syncedRaw;
      draftStore.applyUserEdit(filePath, syncedRaw, baseSha, remoteBaseline);
    },
    [baseSha, draftStore, filePath, isDeleted, remoteBaseline, t]
  );

  useEffect(() => {
    if (!hasLoadedInitial) {
      return;
    }
    if (lastAppliedContentRef.current === currentContent) {
      return;
    }
    lastAppliedContentRef.current = currentContent;
    setRawContent(currentContent);
    parseRawToStructured(currentContent, false);
  }, [currentContent, hasLoadedInitial, parseRawToStructured]);

  useEffect(() => {
    if (remoteContent !== undefined) {
      draftStore.ensureDraft(filePath, remoteContent, baseSha, remoteContent);
    }
  }, [remoteContent, draftStore, filePath, baseSha]);

  const handleRawChange = (value: string) => {
    if (isDeleted) {
      return;
    }
    setRawContent(value);
    parseRawToStructured(value, true);
    lastAppliedContentRef.current = value;
    draftStore.applyUserEdit(filePath, value, baseSha, remoteBaseline);
  };

  const handleRegexChange = (value: string) => {
    setRegex(value);
    syncStructuredDraft(value, columns, examples);
  };

  const handleColumnsChange = (newCols: string[]) => {
    setColumns(newCols);
    syncStructuredDraft(regex, newCols, examples);
  };

  const handleExampleChange = (index: number, value: string) => {
    const newExamples = [...examples];
    newExamples[index] = value;
    setExamples(newExamples);
    syncStructuredDraft(regex, columns, newExamples);
  };

  const handleAddExample = () => {
    if (isDeleted) {
      return;
    }
    const newExamples = [...examples, ""];
    setExamples(newExamples);
    setActiveExampleIndex(newExamples.length - 1);
    syncStructuredDraft(regex, columns, newExamples);
  };

  const handleRemoveExample = (index: number) => {
    if (isDeleted) {
      return;
    }
    if (examples.length <= 1) {
      return;
    }
    const newExamples = examples.filter((_, i) => i !== index);
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
  const refName = sourceRef?.sha ?? sourceRef?.name ?? config.defaultBranch;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const formatRepoUrl = `https://github.com/${repository.owner}/${repository.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;
  const canUndo = draftStore.canUndo(filePath);
  const canRedo = draftStore.canRedo(filePath);
  const canResetFile = isModified || isDeleted;
  const canDeleteFile = remoteBaseline !== "" && !isDeleted;
  const canRenameFile = !isDeleted;

  const handleRename = () => {
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
      <div className="flex items-center gap-sm">
        <span className="spinner" />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  return (
    <div className="format-editor">
      {/* Compact header: mode tabs + file name + actions */}
      <div className="format-editor__toolbar">
        <div className="mode-tabs mode-tabs--inline">
          <button
            className={`mode-tab ${mode === "structured" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("structured")}
          >
            {t("editor.structured")}
          </button>
          <button
            className={`mode-tab ${mode === "raw" ? "mode-tab--active" : ""}`}
            onClick={() => setMode("raw")}
          >
            {t("editor.raw")}
          </button>
        </div>
        <div className="format-editor__file-info">
          <span className="font-medium text-mono">{fileName}</span>
          <button
            className="btn btn--ghost btn--sm"
            disabled={!canRenameFile}
            onClick={handleRename}
          >
            {t("editor.renameFormat")}
          </button>
          <a
            aria-label={t("bank.openFormatInRepo")}
            className="btn btn--ghost btn--sm"
            href={formatRepoUrl}
            onClick={(e) => e.stopPropagation()}
            rel="noreferrer"
            target="_blank"
            title={t("bank.openFormatInRepo")}
          >
            ↗
          </a>
          {isModified && (
            <span className="badge badge--modified">
              {t("editor.modified")}
            </span>
          )}
          {isDeleted && (
            <span className="badge badge--modified">{t("editor.deleted")}</span>
          )}
        </div>
        <div className="format-editor__history">
          <button
            aria-label={t("editor.undo")}
            className="btn btn--ghost btn--sm"
            disabled={!canUndo}
            onClick={() => draftStore.undo(filePath)}
            type="button"
          >
            ↶ {t("editor.undo")}
          </button>
          <button
            aria-label={t("editor.redo")}
            className="btn btn--ghost btn--sm"
            disabled={!canRedo}
            onClick={() => draftStore.redo(filePath)}
            type="button"
          >
            ↷ {t("editor.redo")}
          </button>
          <button
            aria-label={t("editor.deleteFormat")}
            className="btn btn--ghost btn--sm"
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
            type="button"
          >
            ✕ {t("editor.deleteFormat")}
          </button>
          <button
            aria-label={t("editor.resetFileToSource")}
            className="btn btn--ghost btn--sm"
            disabled={!canResetFile}
            onClick={() => draftStore.resetFileToRemote(filePath)}
            type="button"
          >
            ⟲ {t("editor.resetFileToSource")}
          </button>
        </div>
      </div>

      {/* Parse errors */}
      {renameError && (
        <div className="issue-item issue-item--warning">{renameError}</div>
      )}
      {parseErrors.length > 0 && (
        <div className="issue-list">
          {parseErrors.map((err, i) => (
            <div className="issue-item issue-item--warning" key={i}>
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
          onActiveExampleChange={setActiveExampleIndex}
          onAddExample={handleAddExample}
          onColumnsChange={handleColumnsChange}
          onExampleChange={handleExampleChange}
          onOpenSmsByTemplate={onOpenSmsByTemplate}
          onOpenTemplateBySms={onOpenTemplateBySms}
          onRegexChange={handleRegexChange}
          onRemoveExample={handleRemoveExample}
          readOnly={isDeleted}
          regex={regex}
        />
      )}

      {mode === "raw" && (
        <div className="panel">
          <div className="panel__header">{t("editor.raw")}</div>
          <div className="panel__body">
            <textarea
              className="textarea"
              onChange={(e) => handleRawChange(e.target.value)}
              readOnly={isDeleted}
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
