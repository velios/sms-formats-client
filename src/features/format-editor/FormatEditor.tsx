import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { parseFormatFile, serializeFormat } from "@/domain/format";
import { RegexLab } from "@/features/regex-lab/RegexLab";
import { useWorkspaceFileContent } from "@/hooks/useWorkspaceFileContent";
import { useDraftStore, useSourceStore } from "@/store";

type EditorMode = "structured" | "raw";

interface Props {
  filePath: string;
  mode: EditorMode;
  intersectionExamples?: Array<{
    text: string;
    filePath: string;
    fileName: string;
  }>;
  readOnly?: boolean;
  sourceDeletedBaseSha?: string | null;
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

export function FormatEditor({
  filePath,
  mode,
  intersectionExamples = [],
  readOnly = false,
  sourceDeletedBaseSha = null,
  onOpenTemplateBySms,
  onOpenSmsByTemplate,
  onOpenIntersectionFileInApp,
  onRegexBlurAfterEdit,
  onSearchContextChange,
}: Props) {
  const { t } = useTranslation();
  const sourceRef = useSourceStore((s) => s.sourceRef);
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
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [structuralIssues, setStructuralIssues] = useState<string[]>([]);
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

      {/* Parse errors */}
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)]">
          <div className="flex min-h-10 shrink-0 items-center border-[color:var(--c-border)] border-b bg-[color:var(--c-bg-elevated)] px-4 py-1 font-semibold text-[12px] text-[color:var(--c-text-muted)] uppercase tracking-[0.5px]">
            {t("editor.raw")}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
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
