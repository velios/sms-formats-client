import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  buildFormatUrl,
  type ExamplePositions,
  initialExamplePositions,
  parseFormatFile,
  type RawEditRange,
  reconcileExamplePositions,
  serializeFormat,
  tryCompile,
} from "@/domain/format";
import { RegexLab } from "@/features/regex-lab/RegexLab";
import { useWorkspaceFileContent } from "@/hooks/useWorkspaceFileContent";
import { getGitHubAuthChangeVersion } from "@/infrastructure/github";
import { useDraftStore, useSourceStore } from "@/store";

import { resolveFormatAnchor } from "./format-anchor";

type EditorMode = "structured" | "raw";

interface Props {
  anchorReady?: boolean;
  navigation?: {
    key: string;
    hash: string;
    targetFile?: string | null;
    select: (position: number | null) => void;
  };
  filePath: string;
  mode: EditorMode;
  intersectionExamples?: Array<{
    text: string;
    filePath: string;
    fileName: string;
  }>;
  readOnly?: boolean;
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

export function FormatEditor(props: Props) {
  const routed = useInRouterContext();
  return routed ? (
    <RoutedFormatEditor {...props} />
  ) : (
    <FormatEditorCore {...props} />
  );
}

function RoutedFormatEditor(props: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <FormatEditorCore
      {...props}
      navigation={{
        key: location.key,
        hash: location.hash,
        targetFile: new URLSearchParams(location.search).get("file"),
        select: (position) =>
          navigate(
            `${location.pathname}${location.search}${position ? `#show-example=${position}` : ""}`,
            { replace: true }
          ),
      }}
    />
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Editor composition and document mutations.
function FormatEditorCore({
  anchorReady = true,
  navigation,
  filePath,
  mode,
  intersectionExamples = [],
  readOnly = false,
  onOpenTemplateBySms,
  onOpenSmsByTemplate,
  onOpenIntersectionFileInApp,
  onRegexBlurAfterEdit,
  onSearchContextChange,
}: Props) {
  const { t } = useTranslation();
  const repository = useSourceStore((s) => s.repository);
  const scopeKey = useDraftStore((s) => s.draftScopeKey);
  const sourceRef = useSourceStore((s) => s.sourceRef);
  const draft = useDraftStore((state) => state.drafts.get(filePath));
  const {
    data: headContent,
    isLoading,
    error: headContentError,
  } = useWorkspaceFileContent({
    filePath,
    enabled: draft?.headContent !== null,
  });
  const currentContent = draft?.content ?? headContent ?? "";
  const baseSha = draft?.baselineHeadSha ?? sourceRef?.sha ?? "";
  const remoteBaseline = draft ? draft.headContent : (headContent ?? null);
  const isDeleted = draft?.isDeleted ?? false;
  const isMutationBlocked = readOnly || isDeleted;
  const parsed = useMemo(
    () => parseFormatFile(currentContent, filePath),
    [currentContent, filePath]
  );
  const { regex, columns } = parsed;
  const examples = parsed.examples;
  const positions =
    draft?.examplePositions ??
    reconcileExamplePositions(
      remoteBaseline ?? "",
      currentContent,
      initialExamplePositions(remoteBaseline)
    );
  const structuralIssues = parsed.parseIssues.map((issue) =>
    t(`validation.issue.${issue.code}`, issue.params)
  );
  const parseErrors = [
    ...structuralIssues,
    ...(regex && !tryCompile(regex).regex ? [t("editor.invalidRegex")] : []),
  ];
  const canEditStructured = !parsed.parseIssues.some(
    (issue) => issue.code === "MISSING_COLUMNS"
  );
  const [activeExampleIndex, setActiveExampleIndex] = useState(0);
  const hasPendingRegexBlurRef = useRef(false);
  const rawTextarea = useRef<HTMLTextAreaElement>(null);
  const rawInput = useRef<RawInputSnapshot | null>(null);
  const rawContext = `${filePath}:${scopeKey}:${baseSha}:${getGitHubAuthChangeVersion()}`;
  useLayoutEffect(() => {
    const textarea = rawTextarea.current;
    if (!textarea) {
      return;
    }
    const capture = (event: InputEvent) => {
      rawInput.current = {
        value: textarea.value,
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
        inputType: event.inputType,
        content: currentContent,
        context: rawContext,
      };
    };
    // React's compatibility event omits native paste and deletion beforeinput.
    textarea.addEventListener("beforeinput", capture);
    return () => {
      textarea.removeEventListener("beforeinput", capture);
    };
  }, [mode, currentContent, rawContext]);

  useEffect(() => {
    if (!navigation) {
      setActiveExampleIndex(0);
    }
    hasPendingRegexBlurRef.current = false;
  }, [filePath]);
  const selectedExampleIndex = examples.length
    ? Math.max(0, Math.min(activeExampleIndex, examples.length - 1))
    : -1;
  useEffect(() => {
    if (
      !(draft || readOnly) &&
      headContent !== undefined &&
      baseSha === sourceRef?.sha
    ) {
      useDraftStore
        .getState()
        .ensureDraft(filePath, headContent, baseSha, headContent);
    }
  }, [baseSha, draft, filePath, readOnly, headContent, sourceRef?.sha]);

  const writeDocument = (content: string, nextPositions?: ExamplePositions) => {
    if (isMutationBlocked) {
      return;
    }
    useDraftStore
      .getState()
      .applyUserEdit(filePath, content, baseSha, remoteBaseline, nextPositions);
  };
  const syncStructuredDraft = (
    nextRegex: string,
    nextColumns: string[],
    nextExamples: string[],
    nextPositions = positions
  ) =>
    writeDocument(
      serializeFormat(nextRegex, nextColumns, nextExamples),
      nextPositions
    );
  const handleRawChange = (value: string) => {
    const input = rawInput.current;
    rawInput.current = null;
    if (
      input &&
      (input.context !== rawContext || input.content !== currentContent)
    ) {
      return;
    }
    const edit = input ? rawDocumentEdit(input, value) : null;
    const content = edit?.content ?? value;
    writeDocument(
      content,
      reconcileExamplePositions(currentContent, content, positions, edit?.range)
    );
  };
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
    syncStructuredDraft(
      regex,
      columns,
      [...examples, ""],
      [...positions, null]
    );
    selectExample(examples.length);
  };
  const handleRemoveExample = (index: number) => {
    syncStructuredDraft(
      regex,
      columns,
      examples.filter((_, i) => i !== index),
      positions.filter((_, i) => i !== index)
    );
    setActiveExampleIndex((active) =>
      active > index ? active - 1 : Math.min(active, examples.length - 2)
    );
  };
  const [anchorNotice, setAnchorNotice] = useState<string | null>(null);
  const appliedAnchor = useRef<string | null>(null);
  const manualSelection = useRef<{
    hash: string;
    index: number;
    context: string;
  } | null>(null);
  const selectionContext = `${filePath}:${scopeKey}`;
  const anchorKey = `${navigation?.key ?? ""}:${navigation?.hash ?? ""}:${filePath}:${scopeKey}:${getGitHubAuthChangeVersion()}`;
  useEffect(() => {
    if (
      !(navigation && anchorReady) ||
      (navigation.targetFile && navigation.targetFile !== filePath) ||
      isLoading ||
      (!draft && headContent === undefined) ||
      appliedAnchor.current === anchorKey
    ) {
      return;
    }
    appliedAnchor.current = anchorKey;
    const selected = manualSelection.current;
    manualSelection.current = null;
    if (
      selected?.hash === navigation.hash &&
      selected.context === selectionContext
    ) {
      setActiveExampleIndex(selected.index);
      setAnchorNotice(null);
      return;
    }
    const result = resolveFormatAnchor(
      navigation.hash,
      examples,
      positions,
      initialExamplePositions(remoteBaseline).length,
      isMutationBlocked
    );
    if (result.append !== undefined) {
      writeDocument(
        serializeFormat(regex, columns, [...examples, result.append]),
        [...positions, null]
      );
    }
    setActiveExampleIndex(result.index);
    setAnchorNotice(
      result.notices.length
        ? result.notices.map(({ key, number }) => t(key, { number })).join(" ")
        : null
    );
  }, [
    anchorKey,
    anchorReady,
    selectionContext,
    draft,
    headContent,
    isLoading,
    navigation,
    examples,
    positions,
    regex,
    columns,
    remoteBaseline,
    isMutationBlocked,
    t,
  ]);
  const selectExample = (index: number) => {
    setActiveExampleIndex(index);
    setAnchorNotice(null);
    // Selection replaces the current history entry; local Examples have no URL position.
    const position = positions[index] ?? null;
    manualSelection.current = {
      hash: position ? `#show-example=${position}` : "",
      index,
      context: selectionContext,
    };
    navigation?.select(position);
  };
  const shareUrl = sourceRef
    ? buildFormatUrl({
        origin: window.location.origin,
        repository,
        source: sourceRef,
        filePath,
        showExample: positions[selectedExampleIndex] ?? null,
      })
    : null;
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
    onSearchContextChange?.({
      filePath,
      regex,
      examples,
      activeExampleIndex: selectedExampleIndex,
    });
  }, [selectedExampleIndex, examples, filePath, onSearchContextChange, regex]);

  if (isLoading) {
    return (
      <div className="ui-panel ui-panel-body ui-state">
        <Spinner />
        <span>{t("app.loading")}</span>
      </div>
    );
  }

  return (
    <div className="ui-panel-stack h-full overflow-hidden">
      {anchorNotice && (
        <div className="ui-notice" data-tone="warning">
          {anchorNotice}
        </div>
      )}
      {shareUrl && navigation && (
        <div className="flex shrink-0 justify-end">
          <Button
            onClick={() => navigator.clipboard.writeText(shareUrl)}
            size="sm"
            variant="ghost"
          >
            {t("editor.copyLink")}
          </Button>
        </div>
      )}
      {headContentError && (
        <StatusBadge variant="error">{headContentError}</StatusBadge>
      )}

      {mode === "raw" && parseErrors.length > 0 && (
        <div className="flex flex-col gap-1">
          {parseErrors.map((err, i) => (
            <div className="ui-notice" data-tone="warning" key={i}>
              {err}
            </div>
          ))}
        </div>
      )}

      {mode === "structured" && canEditStructured && (
        <RegexLab
          activeExampleIndex={selectedExampleIndex}
          columns={columns}
          examples={examples}
          intersectionExamples={intersectionExamples}
          onActiveExampleChange={selectExample}
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
        <div className="ui-panel flex min-h-0 flex-1 flex-col">
          <div className="ui-panel-heading shrink-0">{t("editor.raw")}</div>
          <div className="ui-panel-body min-h-0 flex-1 overflow-auto">
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
              ref={rawTextarea}
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

interface RawInputSnapshot {
  value: string;
  start: number;
  end: number;
  inputType: string;
  content: string;
  context: string;
}

function rawOffset(content: string, domOffset: number): number {
  let raw = 0;
  for (let dom = 0; dom < domOffset && raw < content.length; dom++, raw++) {
    if (content[raw] === "\r" && content[raw + 1] === "\n") {
      raw++;
    }
  }
  return raw;
}

function rawDocumentEdit(
  input: RawInputSnapshot,
  next: string
): { content: string; range: RawEditRange } | null {
  if (input.content.replace(/\r\n?/g, "\n") !== input.value) {
    return null;
  }
  let { start, end } = input;
  if (start === end && input.inputType.startsWith("delete")) {
    const removed = input.value.length - next.length;
    if (input.inputType.endsWith("Backward")) {
      start -= removed;
    } else if (input.inputType.endsWith("Forward")) {
      end += removed;
    }
  }
  const nextEnd = end + next.length - input.value.length;
  if (
    start < 0 ||
    nextEnd < start ||
    input.value.slice(0, start) !== next.slice(0, start) ||
    input.value.slice(end) !== next.slice(nextEnd)
  ) {
    return null;
  }
  const range = {
    start: rawOffset(input.content, start),
    end: rawOffset(input.content, end),
  };
  const inserted = next.slice(start, nextEnd);
  return {
    content:
      input.content.slice(0, range.start) +
      inserted +
      input.content.slice(range.end),
    range,
  };
}
