import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { RegexPatternToken } from "@/domain/format";
import {
  analyzeRegexPattern,
  buildPatternHighlightPlan,
  buildRegex101Url,
  buildTokenToCaptureGroupMap,
  countCaptureGroups,
  isCapturingGroupOpenerToken,
  recognitionProgress,
  resolveTokenMatchRange,
  testRegex,
} from "@/domain/format";
import { ResizablePanels } from "@/features/resizable-panels/ResizablePanels";
import { CookbookModal } from "@/features/snippet-library/CookbookModal";
import { FormatRulesModal } from "@/features/snippet-library/FormatRulesModal";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";
import {
  RegexPatternEditor,
  type RegexPatternEditorHandle,
} from "./RegexPatternEditor";
import { useGroupSelection } from "./use-group-selection";

interface Props {
  regex: string;
  structuralIssues?: string[];
  readOnly?: boolean;
  onRegexChange: (v: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onRegexBlur?: () => void;
  examples: string[];
  intersectionExamples?: Array<{
    text: string;
    filePath: string;
    fileName: string;
  }>;
  activeExampleIndex: number;
  onActiveExampleChange: (i: number) => void;
  onExampleChange: (index: number, value: string) => void;
  onAddExample: () => void;
  onRemoveExample: (index: number) => void;
  columns: string[];
  onColumnsChange: (columns: string[]) => void;
  onOpenTemplateBySms?: () => void;
  onOpenSmsByTemplate?: () => void;
  onOpenIntersectionFileInApp?: (filePath: string) => void;
}

interface PatternSelection {
  start: number;
  end: number;
}

type ExampleSourceMode = "examples" | "intersections";

import { ColumnPickerModal } from "./ColumnPickerModal";
import { PatternExplanationPane } from "./PatternExplanationPane";
import { MatchInfoPanel, MatchOverlayTextarea } from "./SmsMatchView";

function WhitespacePlusToggle() {
  const { t } = useTranslation();
  const whitespacePlusMode = useUIStore((state) => state.whitespacePlusMode);
  const setWhitespacePlusMode = useUIStore(
    (state) => state.setWhitespacePlusMode
  );
  return (
    <label
      className="flex cursor-pointer select-none items-center gap-1.5 rounded-md border border-border px-2 py-1 text-muted-foreground text-xs"
      title={t("editor.whitespacePlusHint")}
    >
      <input
        checked={whitespacePlusMode}
        className="accent-[color:var(--ring)]"
        onChange={(e) => setWhitespacePlusMode(e.target.checked)}
        type="checkbox"
      />
      {t("editor.whitespacePlusLabel")}
    </label>
  );
}

function shouldShowGroupPointer(
  isGroupsMode: boolean,
  hoveredTokenIndex: number | null,
  tokens: RegexPatternToken[],
  captureGroupMap: Array<number | null>
): boolean {
  if (!isGroupsMode || hoveredTokenIndex == null) {
    return false;
  }
  const token = tokens[hoveredTokenIndex];
  if (token != null && isCapturingGroupOpenerToken(token)) {
    return false;
  }
  return (captureGroupMap[hoveredTokenIndex] ?? null) != null;
}

export function RegexLab({
  regex,
  structuralIssues = [],
  readOnly = false,
  onRegexChange,
  onUndo,
  onRedo,
  onRegexBlur,
  examples,
  intersectionExamples = [],
  activeExampleIndex,
  onActiveExampleChange,
  onExampleChange,
  onAddExample,
  onRemoveExample,
  columns,
  onColumnsChange,
  onOpenTemplateBySms,
  onOpenSmsByTemplate,
  onOpenIntersectionFileInApp,
}: Props) {
  const { t, i18n } = useTranslation();
  const highlightMode = useUIStore((state) => state.highlightMode);
  const setHighlightMode = useUIStore((state) => state.setHighlightMode);
  const whitespacePlusMode = useUIStore((state) => state.whitespacePlusMode);
  const [exampleSourceMode, setExampleSourceMode] =
    useState<ExampleSourceMode>("examples");
  const [activeIntersectionExampleIndex, setActiveIntersectionExampleIndex] =
    useState(0);
  const hasIntersectionExamples = intersectionExamples.length > 0;
  const isShowingIntersectionExamples =
    hasIntersectionExamples && exampleSourceMode === "intersections";
  const visibleExampleTexts = isShowingIntersectionExamples
    ? intersectionExamples.map((item) => item.text)
    : examples;
  const visibleActiveExampleIndex = isShowingIntersectionExamples
    ? Math.min(
        activeIntersectionExampleIndex,
        Math.max(visibleExampleTexts.length - 1, 0)
      )
    : activeExampleIndex;
  const activeExample = visibleExampleTexts[visibleActiveExampleIndex] ?? "";
  const isExampleInputReadOnly = readOnly || isShowingIntersectionExamples;
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null);
  const rightPaneTab = useUIStore((state) => state.rightPaneTab);
  const setRightPaneTab = useUIStore((state) => state.setRightPaneTab);
  const [patternSelection, setPatternSelection] =
    useState<PatternSelection | null>(null);
  const [selectedPatternTokenIndex, setSelectedPatternTokenIndex] = useState<
    number | null
  >(null);
  const [hoveredPatternTokenIndex, setHoveredPatternTokenIndex] = useState<
    number | null
  >(null);
  const [columnPickerGroupIndex, setColumnPickerGroupIndex] = useState<
    number | null
  >(null);
  const [isCookbookOpen, setIsCookbookOpen] = useState(false);
  const [isFormatRulesOpen, setIsFormatRulesOpen] = useState(false);
  const regexEditorRef = useRef<RegexPatternEditorHandle>(null);

  const matchResult = useMemo(
    () => testRegex(regex, activeExample),
    [regex, activeExample]
  );
  const progress = useMemo(
    () =>
      matchResult.matched ? null : recognitionProgress(regex, activeExample),
    [matchResult.matched, regex, activeExample]
  );
  const exampleMatchStates = useMemo(
    () => visibleExampleTexts.map((example) => testRegex(regex, example ?? "")),
    [regex, visibleExampleTexts]
  );
  const explanationLocale = i18n.resolvedLanguage?.startsWith("ru")
    ? "ru"
    : "en";
  const explanation = useMemo(
    () => analyzeRegexPattern(regex, explanationLocale),
    [regex, explanationLocale]
  );
  const tokenCaptureGroupMap = useMemo(
    () => buildTokenToCaptureGroupMap(explanation.patternTokens),
    [explanation.patternTokens]
  );
  const patternHighlightPlan = useMemo(
    () =>
      buildPatternHighlightPlan(
        explanation.patternTokens,
        tokenCaptureGroupMap,
        matchResult,
        progress
      ),
    [explanation.patternTokens, tokenCaptureGroupMap, matchResult, progress]
  );
  const regex101Url = useMemo(
    () => buildRegex101Url(regex, activeExample),
    [regex, activeExample]
  );
  const resolvedPatternTokenIndexFromSelection = useMemo(
    () =>
      resolveActivePatternTokenIndex(
        explanation.patternTokens,
        patternSelection
      ),
    [explanation.patternTokens, patternSelection]
  );
  const activePatternTokenIndex =
    (highlightMode === "groups" ? null : hoveredPatternTokenIndex) ??
    resolvedPatternTokenIndexFromSelection ??
    selectedPatternTokenIndex;
  const exampleTabRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const {
    selectedIndex: selectedGroupIndex,
    range: selectedGroupRange,
    toggle: toggleGroupSelection,
    deselect: deselectGroup,
    armReplace: armGroupReplace,
  } = useGroupSelection({
    tokens: explanation.patternTokens,
    highlightMode,
    regex,
    activeExample,
  });

  const handleInsertSnippet = useCallback(
    (pattern: string) => {
      if (selectedGroupRange) {
        armGroupReplace();
        regexEditorRef.current?.insertAtCursor(pattern, {
          from: selectedGroupRange.start,
          to: selectedGroupRange.end,
        });
        return;
      }
      regexEditorRef.current?.insertAtCursor(pattern);
    },
    [selectedGroupRange, armGroupReplace]
  );

  const activeCaptureGroup = useMemo(() => {
    if (selectedGroupIndex != null) {
      return selectedGroupIndex;
    }
    if (activePatternTokenIndex == null) {
      return null;
    }
    return tokenCaptureGroupMap[activePatternTokenIndex] ?? null;
  }, [selectedGroupIndex, activePatternTokenIndex, tokenCaptureGroupMap]);
  const activeMatchRange = useMemo(() => {
    if (selectedGroupIndex != null) {
      const group = matchResult.groups.find(
        (g) => g.index === selectedGroupIndex
      );
      return group && group.start < group.end
        ? { start: group.start, end: group.end }
        : null;
    }
    if (activePatternTokenIndex == null) {
      return null;
    }
    return resolveTokenMatchRange(
      activePatternTokenIndex,
      tokenCaptureGroupMap,
      matchResult
    );
  }, [
    selectedGroupIndex,
    activePatternTokenIndex,
    tokenCaptureGroupMap,
    matchResult,
  ]);

  const editorActiveTokenIndex = useMemo(
    () => (highlightMode === "groups" ? null : activePatternTokenIndex),
    [highlightMode, activePatternTokenIndex]
  );
  const showPointerCursor = useMemo(
    () =>
      shouldShowGroupPointer(
        highlightMode === "groups",
        hoveredPatternTokenIndex,
        explanation.patternTokens,
        tokenCaptureGroupMap
      ),
    [
      highlightMode,
      hoveredPatternTokenIndex,
      tokenCaptureGroupMap,
      explanation.patternTokens,
    ]
  );

  const captureGroupCount = useMemo(
    () => countCaptureGroups(regex) ?? 0,
    [regex]
  );
  const captureGroups = useMemo(() => {
    const matchMap = new Map(
      matchResult.groups.map((group) => [group.index, group])
    );
    return Array.from({ length: captureGroupCount }, (_, index) => {
      const groupIndex = index + 1;
      return {
        index: groupIndex,
        match: matchMap.get(groupIndex) ?? null,
      };
    });
  }, [captureGroupCount, matchResult.groups]);
  const hasMissingColumnMappings = useMemo(
    () =>
      captureGroupCount > 0 &&
      captureGroups.some((group) => !columns[group.index - 1]),
    [captureGroupCount, captureGroups, columns]
  );

  useEffect(() => {
    if (hasIntersectionExamples) {
      return;
    }
    setExampleSourceMode("examples");
  }, [hasIntersectionExamples]);

  useEffect(() => {
    if (!isShowingIntersectionExamples) {
      return;
    }
    setActiveIntersectionExampleIndex((prev) =>
      Math.min(prev, Math.max(intersectionExamples.length - 1, 0))
    );
  }, [intersectionExamples.length, isShowingIntersectionExamples]);

  useEffect(() => {
    if (
      selectedPatternTokenIndex != null &&
      selectedPatternTokenIndex >= explanation.patternTokens.length
    ) {
      setSelectedPatternTokenIndex(null);
    }
  }, [explanation.patternTokens.length, selectedPatternTokenIndex]);

  useEffect(() => {
    setSelectedPatternTokenIndex(null);
  }, [activeExample, regex]);

  useEffect(() => {
    if (readOnly && rightPaneTab === "snippets") {
      setRightPaneTab("explanation");
    }
  }, [readOnly, rightPaneTab]);

  useEffect(() => {
    const activeTab = exampleTabRefs.current.get(visibleActiveExampleIndex);
    activeTab?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [visibleActiveExampleIndex, visibleExampleTexts.length]);

  const handleGroupHover = useCallback((groupIndex: number | null) => {
    setHoveredGroup(groupIndex);
  }, []);

  const buildColumnsForGroupCount = useCallback(
    (nextCount: number) => {
      const prepared = Array.from(
        { length: nextCount },
        (_, index) => columns[index] ?? ""
      );
      return prepared;
    },
    [columns]
  );

  const handleSelectColumn = useCallback(
    (groupIndex: number, columnName: string) => {
      const newColumns = buildColumnsForGroupCount(captureGroupCount);
      newColumns[groupIndex - 1] = columnName;
      onColumnsChange(newColumns);
      setColumnPickerGroupIndex(null);
    },
    [captureGroupCount, onColumnsChange, buildColumnsForGroupCount]
  );

  const handleClearColumn = useCallback(
    (groupIndex: number) => {
      const newColumns = buildColumnsForGroupCount(captureGroupCount);
      newColumns[groupIndex - 1] = "";
      onColumnsChange(newColumns);
    },
    [captureGroupCount, onColumnsChange, buildColumnsForGroupCount]
  );

  const handleColumnParamChange = useCallback(
    (groupIndex: number, param: string) => {
      const newColumns = buildColumnsForGroupCount(captureGroupCount);
      const current = newColumns[groupIndex - 1] ?? "";
      const base = current.split("#")[0];
      if (!base) {
        return;
      }
      newColumns[groupIndex - 1] = param ? `${base}#${param}` : base;
      onColumnsChange(newColumns);
    },
    [captureGroupCount, onColumnsChange, buildColumnsForGroupCount]
  );

  const handlePatternSelectionChange = useCallback(
    (selection: PatternSelection | null) => {
      setPatternSelection(selection);
      if (selection) {
        setSelectedPatternTokenIndex(null);
      }
    },
    []
  );

  const handlePatternTokenActivate = useCallback(
    (tokenIndex: number) => {
      const token = explanation.patternTokens[tokenIndex];
      if (!token) {
        return;
      }
      setSelectedPatternTokenIndex(tokenIndex);
      setPatternSelection({ start: token.start, end: token.end });
    },
    [explanation.patternTokens]
  );

  const handleEditorTokenMouseDown = useCallback(
    (tokenIndex: number | null) => {
      if (highlightMode === "groups" && tokenIndex != null) {
        const group = tokenCaptureGroupMap[tokenIndex] ?? null;
        if (group != null) {
          toggleGroupSelection(group);
          return;
        }
      }
      deselectGroup();
    },
    [highlightMode, tokenCaptureGroupMap, toggleGroupSelection, deselectGroup]
  );

  const handleExplanationTokenActivate = useCallback(
    (tokenIndex: number) => {
      deselectGroup();
      handlePatternTokenActivate(tokenIndex);
    },
    [handlePatternTokenActivate, deselectGroup]
  );

  const handleSelectGroupFromTable = useCallback(
    (groupIndex: number) => {
      if (highlightMode !== "groups") {
        return;
      }
      toggleGroupSelection(groupIndex);
    },
    [highlightMode, toggleGroupSelection]
  );

  const handleToggleExampleSource = useCallback(() => {
    if (!hasIntersectionExamples) {
      return;
    }
    setExampleSourceMode((prev) => {
      if (prev === "examples") {
        setActiveIntersectionExampleIndex(0);
        return "intersections";
      }
      return "examples";
    });
  }, [hasIntersectionExamples]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ResizablePanels side="right">
        <div className="ui-panel-stack min-w-0 overflow-hidden">
          <div className={cn("ui-panel", "shrink-0")}>
            <div className="ui-panel-heading">
              <div className="flex items-center gap-3">
                <span>{t("editor.regex")}</span>
                <div
                  aria-label={t("editor.highlightModeLabel")}
                  className="ui-segmented"
                  role="group"
                >
                  <button
                    aria-pressed={highlightMode === "groups"}
                    className="ui-segment"
                    onClick={() => {
                      setHighlightMode("groups");
                      setRightPaneTab("snippets");
                    }}
                    title={t("editor.highlightModeGroupsHint")}
                    type="button"
                  >
                    {t("editor.highlightModeGroups")}
                  </button>
                  <button
                    aria-pressed={highlightMode === "parts"}
                    className="ui-segment"
                    onClick={() => {
                      setHighlightMode("parts");
                      setRightPaneTab("explanation");
                    }}
                    title={t("editor.highlightModePartsHint")}
                    type="button"
                  >
                    {t("editor.highlightModeParts")}
                  </button>
                </div>
                <WhitespacePlusToggle />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => setIsCookbookOpen(true)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("cookbook.open")}
                </Button>
                <Button
                  onClick={() => setIsFormatRulesOpen(true)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("formatRules.open")}
                </Button>
                <Button
                  onClick={onOpenSmsByTemplate}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("quickCheck.openSmsByTemplate")}
                </Button>
              </div>
            </div>
            <div className="ui-panel-body">
              <RegexPatternEditor
                activeTokenIndex={editorActiveTokenIndex}
                canHighlight={explanation.canHighlightPattern}
                highlightMode={highlightMode}
                highlightPlan={patternHighlightPlan}
                key={readOnly ? "readonly" : "editable"}
                onBlur={onRegexBlur}
                onRedo={onRedo}
                onRegexChange={onRegexChange}
                onSelectionChange={handlePatternSelectionChange}
                onTokenClick={handlePatternTokenActivate}
                onTokenHover={setHoveredPatternTokenIndex}
                onTokenMouseDown={handleEditorTokenMouseDown}
                onUndo={onUndo}
                readOnly={readOnly}
                ref={regexEditorRef}
                regex={regex}
                selectedGroupRange={selectedGroupRange}
                showPointerCursor={showPointerCursor}
                tokens={explanation.patternTokens}
                whitespacePlusMode={whitespacePlusMode}
              />
            </div>
          </div>

          <div className={cn("ui-panel", "flex shrink-0 flex-col")}>
            <div className="ui-panel-heading">
              <div className="flex items-center gap-2">
                {t("editor.testString")}
                {!isShowingIntersectionExamples && (
                  <Button
                    aria-label={t("editor.addExample")}
                    disabled={readOnly}
                    onClick={onAddExample}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    +
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {hasIntersectionExamples && (
                  <Button
                    onClick={handleToggleExampleSource}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {isShowingIntersectionExamples
                      ? t("editor.showExamples")
                      : t("editor.showIntersections")}
                  </Button>
                )}
                <Button
                  onClick={onOpenTemplateBySms}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("quickCheck.openTemplateBySms")}
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <a
                    href={regex101Url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {t("editor.openInRegex101")}
                  </a>
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap border-border border-b">
              {visibleExampleTexts.map((_, i) => (
                <div className="flex items-center" key={i}>
                  <button
                    className="ui-tab"
                    data-active={i === visibleActiveExampleIndex}
                    onClick={() => {
                      if (isShowingIntersectionExamples) {
                        setActiveIntersectionExampleIndex(i);
                        return;
                      }
                      onActiveExampleChange(i);
                    }}
                    ref={(el) => {
                      if (el) {
                        exampleTabRefs.current.set(i, el);
                      } else {
                        exampleTabRefs.current.delete(i);
                      }
                    }}
                    type="button"
                  >
                    #{i + 1}
                    {!isShowingIntersectionExamples && regex && (
                      <span
                        className={cn(
                          "ml-1",
                          exampleMatchStates[i]?.matched
                            ? "text-success"
                            : "text-destructive"
                        )}
                      >
                        {exampleMatchStates[i]?.matched ? "✓" : "✗"}
                      </span>
                    )}
                  </button>
                  {isShowingIntersectionExamples &&
                    intersectionExamples[i]?.filePath &&
                    onOpenIntersectionFileInApp && (
                      <Button
                        aria-label={`${t("quickCheck.openInApp")}: ${intersectionExamples[i]!.fileName}`}
                        className="px-1 py-0.5 text-muted-foreground text-xs"
                        onClick={() =>
                          onOpenIntersectionFileInApp(
                            intersectionExamples[i]!.filePath
                          )
                        }
                        size="sm"
                        title={`${t("quickCheck.openInApp")}: ${intersectionExamples[i]!.fileName}`}
                        type="button"
                        variant="ghost"
                      >
                        ↗
                      </Button>
                    )}
                  {!isShowingIntersectionExamples &&
                    visibleExampleTexts.length > 1 && (
                      <Button
                        aria-label={t("editor.removeExample")}
                        className="px-1 py-0.5 text-muted-foreground text-xs"
                        disabled={readOnly}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveExample(i);
                        }}
                        size="sm"
                        title={t("editor.removeExample")}
                        type="button"
                        variant="ghost"
                      >
                        ×
                      </Button>
                    )}
                </div>
              ))}
            </div>

            <div className="ui-panel-body">
              <MatchOverlayTextarea
                activeMatchRange={activeMatchRange}
                hoveredGroup={hoveredGroup}
                onTextChange={(value) =>
                  onExampleChange(activeExampleIndex, value)
                }
                progress={progress}
                readOnly={isExampleInputReadOnly}
                result={matchResult}
                text={activeExample}
              />
            </div>
          </div>

          <div className={cn("ui-panel", "flex min-h-0 flex-1 flex-col")}>
            <div className="ui-panel-heading">
              {t("editor.matchInfo").toUpperCase()}
            </div>
            <MatchInfoPanel
              activeCaptureGroup={activeCaptureGroup}
              captureGroups={captureGroups}
              columns={columns}
              groupSelectionEnabled={highlightMode === "groups"}
              hasMissingColumnMappings={hasMissingColumnMappings}
              hoveredGroup={hoveredGroup}
              onClearColumn={handleClearColumn}
              onColumnParamChange={handleColumnParamChange}
              onGroupHover={handleGroupHover}
              onOpenColumnPicker={setColumnPickerGroupIndex}
              onSelectGroup={handleSelectGroupFromTable}
              readOnly={readOnly}
              result={matchResult}
              selectedGroupIndex={selectedGroupIndex}
              structuralIssues={structuralIssues}
            />
          </div>
        </div>

        <PatternExplanationPane
          activePatternTokenIndex={activePatternTokenIndex}
          errorMessage={matchResult.error}
          explanation={explanation}
          onInsertSnippet={handleInsertSnippet}
          onPatternTokenActivate={handleExplanationTokenActivate}
          onPatternTokenHover={setHoveredPatternTokenIndex}
          readOnly={readOnly}
        />
      </ResizablePanels>

      {columnPickerGroupIndex !== null && (
        <ColumnPickerModal
          currentValue={columns[columnPickerGroupIndex - 1] ?? ""}
          groupIndex={columnPickerGroupIndex}
          onClose={() => setColumnPickerGroupIndex(null)}
          onSelectColumn={(columnName) =>
            handleSelectColumn(columnPickerGroupIndex, columnName)
          }
          selectedColumns={columns}
        />
      )}

      {isCookbookOpen && (
        <CookbookModal onClose={() => setIsCookbookOpen(false)} />
      )}

      {isFormatRulesOpen && (
        <FormatRulesModal onClose={() => setIsFormatRulesOpen(false)} />
      )}
    </div>
  );
}

function resolveActivePatternTokenIndex(
  tokens: RegexPatternToken[],
  selection: PatternSelection | null
): number | null {
  if (tokens.length === 0 || !selection) {
    return null;
  }

  const caret = selection.start;
  if (selection.start === selection.end) {
    const tokenIndex = tokens.findIndex(
      (token) => caret >= token.start && caret < token.end
    );
    return tokenIndex >= 0 ? tokenIndex : null;
  }

  const tokenIndex = tokens.findIndex(
    (token) => selection.start < token.end && selection.end > token.start
  );
  return tokenIndex >= 0 ? tokenIndex : null;
}
