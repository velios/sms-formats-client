import { useCallback, useEffect, useMemo, useState } from "react";
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

function buildRawFromStructured(
  regex: string,
  columns: string[],
  examples: string[]
): string | null {
  const normalizedRegex = regex.trim();
  if (!(normalizedRegex && isRegexValid(normalizedRegex))) {
    return null;
  }

  const normalizedColumns = columns.map((c) => c.trim());
  if (normalizedColumns.length === 0 || normalizedColumns.some((c) => !c)) {
    return null;
  }

  const normalizedExamples = examples.map((e) => e.trimEnd());
  if (
    normalizedExamples.length === 0 ||
    normalizedExamples.some((e) => !e.trim())
  ) {
    return null;
  }

  return serializeFormat(regex, normalizedColumns, normalizedExamples);
}

export function FormatEditor({
  filePath,
  allFormatFiles,
  onRenameFile,
}: Props) {
  const { t } = useTranslation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const draftStore = useDraftStore();

  // Load remote content
  const { data: remoteContent, isLoading } = useFileContent(
    filePath,
    sourceRef?.name
  );

  const draft = draftStore.getDraft(filePath);
  const currentContent = draft?.content ?? remoteContent ?? "";
  const baseSha = draft?.baseSha ?? sourceRef?.sha ?? "";
  const hasLoadedInitial = draft != null || remoteContent !== undefined;

  // Structured state
  const [regex, setRegex] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [examples, setExamples] = useState<string[]>([]);
  const [activeExampleIndex, setActiveExampleIndex] = useState(0);
  const [rawContent, setRawContent] = useState("");
  const [mode, setMode] = useState<EditorMode>("structured");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [initialContent, setInitialContent] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const parseRawToStructured = useCallback(
    (raw: string, preserveActiveIndex: boolean) => {
      const parsed = parseFormatFile(raw, filePath);
      const issues = parsed.parseIssues.map((issue) => issue.message);
      if (parsed.regex && !isRegexValid(parsed.regex)) {
        issues.push(t("editor.invalidRegex"));
      }
      setParseErrors(issues);

      const canSync =
        !!parsed.regex &&
        parsed.columns.length > 0 &&
        parsed.examples.length > 0;

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

  const saveDraft = useCallback(
    (content: string) => {
      draftStore.setDraft(filePath, content, baseSha, remoteContent ?? "");
    },
    [draftStore, filePath, baseSha, remoteContent]
  );

  const syncRawFromStructured = useCallback(
    (nextRegex: string, nextColumns: string[], nextExamples: string[]) => {
      const syncedRaw = buildRawFromStructured(
        nextRegex,
        nextColumns,
        nextExamples
      );
      if (!syncedRaw) {
        return;
      }
      setRawContent(syncedRaw);
      setParseErrors([]);
    },
    []
  );

  const structuredRawCandidate = useMemo(
    () => buildRawFromStructured(regex, columns, examples),
    [regex, columns, examples]
  );

  // Initialize editor state once per opened file.
  useEffect(() => {
    if (!hasLoadedInitial || initialContent !== null) {
      return;
    }
    setInitialContent(currentContent);
    setRawContent(currentContent);
    parseRawToStructured(currentContent, false);
  }, [hasLoadedInitial, initialContent, currentContent, parseRawToStructured]);

  // Seed draft store from remote on first load for existing files.
  useEffect(() => {
    if (remoteContent !== undefined && !draft) {
      draftStore.setDraft(filePath, remoteContent, baseSha, remoteContent);
    }
  }, [remoteContent, draft, draftStore, filePath, baseSha]);

  const handleSaveRaw = () => {
    saveDraft(rawContent);
    parseRawToStructured(rawContent, true);
  };

  const handleSaveStructured = () => {
    if (!structuredRawCandidate) {
      return;
    }
    setRawContent(structuredRawCandidate);
    saveDraft(structuredRawCandidate);
    setParseErrors([]);
  };

  const handleReset = () => {
    if (initialContent == null) {
      return;
    }
    setRawContent(initialContent);
    saveDraft(initialContent);
    parseRawToStructured(initialContent, false);
  };

  const handleRawChange = (value: string) => {
    setRawContent(value);
    parseRawToStructured(value, true);
  };

  const handleRegexChange = (value: string) => {
    setRegex(value);
    syncRawFromStructured(value, columns, examples);
  };

  const handleColumnsChange = (newCols: string[]) => {
    setColumns(newCols);
    syncRawFromStructured(regex, newCols, examples);
  };

  const handleExampleChange = (index: number, value: string) => {
    const newExamples = [...examples];
    newExamples[index] = value;
    setExamples(newExamples);
    syncRawFromStructured(regex, columns, newExamples);
  };

  const handleAddExample = () => {
    const newExamples = [...examples, ""];
    setExamples(newExamples);
    setActiveExampleIndex(newExamples.length - 1);
  };

  const handleRemoveExample = (index: number) => {
    if (examples.length <= 1) {
      return;
    }
    const newExamples = examples.filter((_, i) => i !== index);
    setExamples(newExamples);
    syncRawFromStructured(regex, columns, newExamples);
    if (activeExampleIndex >= newExamples.length) {
      setActiveExampleIndex(newExamples.length - 1);
    }
  };

  const isModified = draft ? draft.content !== draft.remoteContent : false;
  const fileName = filePath.split("/").pop() ?? filePath;
  const fileDirPath = filePath.split("/").slice(0, -1).join("/");
  const refName = sourceRef?.name ?? config.defaultBranch;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const formatRepoUrl = `https://github.com/${config.owner}/${config.repo}/blob/${encodeURIComponent(refName)}/${encodedPath}`;
  const saveLabel =
    mode === "structured" ? t("editor.saveStructured") : t("editor.saveRaw");
  const resetLabel =
    mode === "structured" ? t("editor.resetStructured") : t("editor.resetRaw");
  const handleSave =
    mode === "structured" ? handleSaveStructured : handleSaveRaw;
  const saveDisabled = mode === "structured" ? !structuredRawCandidate : false;

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <span className="font-medium text-mono">{fileName}</span>
          <button className="btn btn--ghost btn--sm" onClick={handleRename}>
            {t("editor.renameFormat")}
          </button>
          <a
            aria-label={t("bank.openFormatInRepo")}
            className="format-row-link"
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
        </div>
        <div className="flex gap-sm">
          <button
            className="btn btn--primary btn--sm"
            disabled={saveDisabled}
            onClick={handleSave}
          >
            {saveLabel}
          </button>
          <button
            className="btn btn--sm"
            disabled={initialContent == null}
            onClick={handleReset}
          >
            {resetLabel}
          </button>
        </div>
      </div>

      {/* 3-block mode tabs */}
      <div className="mode-tabs">
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
          onRegexChange={handleRegexChange}
          onRemoveExample={handleRemoveExample}
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
