import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { parseFormatFile, serializeFormat, tryCompile } from "@/domain/format";
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
  const draft = useDraftStore((state) => state.drafts.get(filePath));
  const {
    data: headContent,
    isLoading,
    error: headContentError,
  } = useWorkspaceFileContent({
    filePath,
    contentRefName: sourceDeletedBaseSha ?? undefined,
    enabled: draft?.headContent !== null || Boolean(sourceDeletedBaseSha),
  });
  const currentContent = draft?.content ?? headContent ?? "";
  const baseSha = draft?.baselineHeadSha ?? sourceRef?.sha ?? "";
  const remoteBaseline = draft
    ? draft.headContent
    : sourceDeletedBaseSha
      ? null
      : (headContent ?? null);
  const isDeleted = draft?.isDeleted ?? Boolean(sourceDeletedBaseSha);
  const isMutationBlocked = readOnly || isDeleted;
  const parsed = useMemo(
    () => parseFormatFile(currentContent, filePath),
    [currentContent, filePath]
  );
  const { regex, columns } = parsed;
  const examples = useMemo(
    () => (parsed.examples.length ? parsed.examples : [""]),
    [parsed.examples]
  );
  const structuralIssues = parsed.parseIssues.map((issue) =>
    t(`validation.issue.${issue.code}`, issue.params)
  );
  const parseErrors = [
    ...structuralIssues,
    ...(regex && !tryCompile(regex).regex ? [t("editor.invalidRegex")] : []),
  ];
  const canEditStructured = !parsed.parseIssues.some(
    (issue) =>
      issue.code === "MISSING_COLUMNS" || issue.code === "MISSING_EXAMPLE"
  );
  const [activeExampleIndex, setActiveExampleIndex] = useState(0);
  const hasPendingRegexBlurRef = useRef(false);

  useEffect(() => {
    setActiveExampleIndex(0);
    hasPendingRegexBlurRef.current = false;
  }, [filePath]);
  useEffect(() => {
    setActiveExampleIndex((index) => Math.min(index, examples.length - 1));
  }, [examples.length]);
  useEffect(() => {
    if (!readOnly && headContent !== undefined && !sourceDeletedBaseSha) {
      useDraftStore
        .getState()
        .ensureDraft(filePath, headContent, baseSha, headContent);
    }
  }, [baseSha, filePath, readOnly, headContent, sourceDeletedBaseSha]);

  const writeDocument = (content: string) => {
    if (isMutationBlocked) {
      return;
    }
    useDraftStore
      .getState()
      .applyUserEdit(filePath, content, baseSha, remoteBaseline);
  };
  const syncStructuredDraft = (
    nextRegex: string,
    nextColumns: string[],
    nextExamples: string[]
  ) => writeDocument(serializeFormat(nextRegex, nextColumns, nextExamples));
  const handleRawChange = (value: string) => writeDocument(value);
  const handleRegexChange = (value: string) => {
    hasPendingRegexBlurRef.current = true;
    syncStructuredDraft(value, columns, examples);
  };
  const handleRegexBlur = () => {
    if (!hasPendingRegexBlurRef.current) {
      return;
    }
    hasPendingRegexBlurRef.current = false;
    const latest = parseFormatFile(
      useDraftStore.getState().getDraft(filePath)?.content ?? currentContent,
      filePath
    );
    onRegexBlurAfterEdit?.({
      filePath,
      regex: latest.regex,
      examples: latest.examples,
    });
  };
  const handleColumnsChange = (value: string[]) =>
    syncStructuredDraft(regex, value, examples);
  const handleExampleChange = (index: number, value: string) =>
    syncStructuredDraft(
      regex,
      columns,
      examples.map((example, i) => (i === index ? value : example))
    );
  const handleAddExample = () => {
    syncStructuredDraft(regex, columns, [...examples, ""]);
    setActiveExampleIndex(examples.length);
  };
  const handleRemoveExample = (index: number) => {
    if (examples.length > 1) {
      syncStructuredDraft(
        regex,
        columns,
        examples.filter((_, i) => i !== index)
      );
    }
  };
  const undo = () => {
    if (!isMutationBlocked) {
      useDraftStore.getState().undo(filePath);
    }
  };
  const redo = () => {
    if (!isMutationBlocked) {
      useDraftStore.getState().redo(filePath);
    }
  };

  useEffect(() => {
    onSearchContextChange?.({ filePath, regex, examples, activeExampleIndex });
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
      {headContentError && (
        <StatusBadge variant="error">{headContentError}</StatusBadge>
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

      {mode === "structured" && canEditStructured && (
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
          onRedo={redo}
          onRegexBlur={handleRegexBlur}
          onRegexChange={handleRegexChange}
          onRemoveExample={handleRemoveExample}
          onUndo={undo}
          readOnly={readOnly || isDeleted}
          regex={regex}
          structuralIssues={structuralIssues}
        />
      )}

      {mode === "structured" && !canEditStructured && (
        <StatusBadge variant="warning">
          {t("editor.structuredUnavailable")}
        </StatusBadge>
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
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key.toLowerCase() === "z"
                ) {
                  event.preventDefault();
                  if (event.shiftKey) {
                    redo();
                  } else {
                    undo();
                  }
                }
              }}
              readOnly={readOnly || isDeleted}
              rows={20}
              spellCheck={false}
              value={currentContent}
            />
          </div>
        </div>
      )}
    </div>
  );
}
