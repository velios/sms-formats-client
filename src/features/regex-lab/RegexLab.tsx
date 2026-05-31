import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ModalDialog } from "@/components/ModalDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  RecognitionProgress,
  RegexExplanation,
  RegexMatchResult,
  RegexPatternToken,
} from "@/domain/format";
import {
  buildPatternHighlightPlan,
  buildRegex101Url,
  buildTokenToCaptureGroupMap,
  countCaptureGroups,
  explainRegex,
  recognitionProgress,
  resolveTokenMatchRange,
  testRegex,
} from "@/domain/format";
import { ALLOWED_COLUMNS, ALLOWED_COLUMNS_SORTED } from "@/domain/types";
import { QuickReference } from "@/features/quick-reference/QuickReference";
import { CookbookModal } from "@/features/snippet-library/CookbookModal";
import { SnippetLibraryModal } from "@/features/snippet-library/SnippetLibraryModal";
import { SnippetsPanel } from "@/features/snippet-library/SnippetsPanel";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";
import {
  UnifiedRegexEditor,
  type UnifiedRegexEditorHandle,
} from "./UnifiedRegexEditor";

interface Props {
  regex: string;
  structuralIssues?: string[];
  readOnly?: boolean;
  onRegexChange: (v: string) => void;
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

type RightPaneTab = "explanation" | "quickref" | "snippets";
type ExampleSourceMode = "examples" | "intersections";

const regexLabPanelClassName =
  "overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)]";
const regexLabPanelHeaderClassName =
  "flex items-center justify-between border-b border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-4 py-2 text-[13px] font-semibold uppercase tracking-[0.5px] text-[color:var(--c-text-muted)]";
const regexLabHeaderActionsClassName = "flex flex-wrap items-center gap-2";
const regexLabPanelBodyClassName = "p-4";
const regexLabTabListClassName =
  "flex gap-0 border-b border-[color:var(--c-border)]";
const regexLabHeaderButtonClassName =
  "border-[color:transparent] text-[color:var(--c-text-muted)] shadow-none transition-[color,background-color,border-color,box-shadow] duration-150 hover:border-[color:var(--c-accent-soft)] hover:bg-[color:var(--c-bg-surface)] hover:text-[color:var(--c-accent)] focus-visible:ring-[color:var(--c-border-focus)]";
const regexLabTabClassName = (isActive: boolean) =>
  cn(
    "cursor-pointer border-x-0 border-t-0 border-b-2 border-solid px-4 py-2 font-medium text-[13px] transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)] focus-visible:ring-offset-[-2px]",
    isActive
      ? "border-b-[color:var(--c-accent)] bg-[color:var(--c-bg-surface)] text-[color:var(--c-accent)] shadow-[inset_0_-1px_0_var(--c-accent-soft)]"
      : "border-b-transparent text-[color:var(--c-text-muted)] hover:border-b-[color:var(--c-accent-soft)] hover:bg-[color:var(--c-bg-surface)] hover:text-[color:var(--c-accent)]"
  );
const highlightModeSegmentClassName = (isActive: boolean) =>
  cn(
    "cursor-pointer border-none px-2.5 py-1 font-medium text-[12px] normal-case tracking-normal transition-[color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--c-border-focus)] focus-visible:ring-offset-[-2px]",
    isActive
      ? "bg-[color:var(--c-accent)] text-[color:var(--c-bg-surface)]"
      : "bg-[color:var(--c-bg-surface)] text-[color:var(--c-text-muted)] hover:bg-[color:var(--c-bg-hover)] hover:text-[color:var(--c-accent)]"
  );
const regexTokenToneClassMap: Record<string, string> = {
  anchor:
    "rounded-[2px] border border-[#d9ab54] bg-[#ffd78a] px-[1px] font-semibold text-[#5f3b00]",
  group:
    "rounded-[2px] border border-[#77c790] bg-[#b9f0c8] px-[1px] font-semibold text-[#0f4c2a]",
  quantifier:
    "rounded-[2px] border border-[#7fb2ea] bg-[#bcdcff] px-[1px] font-semibold text-[#1b4b78]",
  alternation:
    "rounded-[2px] border border-[#e28d8d] bg-[#ffc7c7] px-[1px] font-semibold text-[#7d1d1d]",
  escape:
    "rounded-[2px] border border-[#ac8fe8] bg-[#dbcaff] px-[1px] font-semibold text-[#3f2a82]",
  charclass:
    "rounded-[2px] border border-[#8dbce8] bg-[#c8e5ff] px-[1px] font-semibold text-[#1b4f86]",
  meta: "rounded-[2px] border border-[#97bde8] bg-[#cfe3ff] px-[1px] font-semibold text-[#1f4f80]",
  literal:
    "rounded-[2px] border border-[#bdc8d3] bg-[#e9eff6] px-[1px] font-semibold text-[#2a3e54]",
};
const patternBlockToneClassMap: Record<string, string> = {
  anchor: "border-[#ecd39b] bg-[#fff4d6] text-[#5f3b00]",
  group: "border-[#bde0c7] bg-[#e7faec] text-[#0f4c2a]",
  quantifier: "border-[#b8d5f3] bg-[#e6f3ff] text-[#1b4b78]",
  alternation: "border-[#efc0c0] bg-[#ffeaea] text-[#7d1d1d]",
  escape: "border-[#cdbcf1] bg-[#f1eaff] text-[#3f2a82]",
  charclass: "border-[#c1daf1] bg-[#e9f4ff] text-[#1b4f86]",
  meta: "border-[#c6daf1] bg-[#ebf4ff] text-[#1f4f80]",
  literal: "border-[#d2dbe5] bg-[#f3f6fa] text-[#2a3e54]",
};

const matchHighlightBaseClass =
  "rounded-[2px] bg-[color:var(--c-group-0)] shadow-[inset_0_-2px_0_var(--c-group-border-0)] transition-colors";
const matchHighlightHoverClass = "bg-[color:var(--c-accent-soft)]";
const matchHighlightRangeActiveClass =
  "outline outline-2 outline-[color:var(--c-accent)] outline-offset-[-1px]";
const matchHighlightGroupClassMap = [
  "bg-[color:var(--c-group-1)] shadow-[inset_0_-2px_0_var(--c-group-border-1)]",
  "bg-[color:var(--c-group-2)] shadow-[inset_0_-2px_0_var(--c-group-border-2)]",
  "bg-[color:var(--c-group-3)] shadow-[inset_0_-2px_0_var(--c-group-border-3)]",
  "bg-[color:var(--c-group-4)] shadow-[inset_0_-2px_0_var(--c-group-border-4)]",
  "bg-[color:var(--c-group-5)] shadow-[inset_0_-2px_0_var(--c-group-border-5)]",
];

// Recognition Progress (ADR-0007): provisional, deliberately distinct from a
// finished full match. B uses a dashed accent outline (not the solid match
// fill); B's capture groups keep their hue but with muted dashed borders; C is
// the alarming wavy-underlined tail; the marker is the "waiting for more" caret.
const progressPrefixClass =
  "rounded-[2px] border border-dashed border-[color:var(--c-accent)] bg-[color:var(--c-accent-soft)]";
const progressGroupClassMap = [
  "rounded-[2px] border border-dashed border-[color:var(--c-group-border-1)] bg-[color:var(--c-group-1)]",
  "rounded-[2px] border border-dashed border-[color:var(--c-group-border-2)] bg-[color:var(--c-group-2)]",
  "rounded-[2px] border border-dashed border-[color:var(--c-group-border-3)] bg-[color:var(--c-group-3)]",
  "rounded-[2px] border border-dashed border-[color:var(--c-group-border-4)] bg-[color:var(--c-group-4)]",
  "rounded-[2px] border border-dashed border-[color:var(--c-group-border-5)] bg-[color:var(--c-group-5)]",
];
const progressTailClass =
  "rounded-[2px] bg-[color:var(--c-error-soft)] text-[color:var(--c-error)] underline decoration-wavy decoration-[color:var(--c-error)] underline-offset-2";
const progressWaitingClass =
  "ml-[1px] animate-pulse font-bold text-[color:var(--c-warning)]";
const PROGRESS_WAITING_GLYPH = "▏";

export function RegexLab({
  regex,
  structuralIssues = [],
  readOnly = false,
  onRegexChange,
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
  const [rightPaneTab, setRightPaneTab] = useState<RightPaneTab>("explanation");
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
  const columnPickerTitleId = useId();
  const [isSnippetLibraryOpen, setIsSnippetLibraryOpen] = useState(false);
  const [isCookbookOpen, setIsCookbookOpen] = useState(false);
  const regexEditorRef = useRef<UnifiedRegexEditorHandle>(null);

  const handleInsertSnippet = useCallback((pattern: string) => {
    regexEditorRef.current?.insertAtCursor(pattern);
  }, []);

  const matchResult = useMemo(
    () => testRegex(regex, activeExample),
    [regex, activeExample]
  );
  // Recognition Progress only kicks in when the full pattern does not match;
  // a successful match keeps today's full-match highlighting.
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
    () => explainRegex(regex, explanationLocale),
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
    hoveredPatternTokenIndex ??
    resolvedPatternTokenIndexFromSelection ??
    selectedPatternTokenIndex;
  const exampleTabRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Derived reactively from activePatternTokenIndex so hover also syncs
  const activeCaptureGroup = useMemo(() => {
    if (activePatternTokenIndex == null) {
      return null;
    }
    return tokenCaptureGroupMap[activePatternTokenIndex] ?? null;
  }, [activePatternTokenIndex, tokenCaptureGroupMap]);
  const activeMatchRange = useMemo(() => {
    if (activePatternTokenIndex == null) {
      return null;
    }
    return resolveTokenMatchRange(
      activePatternTokenIndex,
      tokenCaptureGroupMap,
      matchResult
    );
  }, [activePatternTokenIndex, tokenCaptureGroupMap, matchResult]);

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

  // Clear selected token when regex or example changes
  useEffect(() => {
    setSelectedPatternTokenIndex(null);
  }, [activeExample, regex]);

  // The snippets tab is editor-only; drop back to explanation in read-only mode.
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

  const setColumnsForGroupCount = useCallback(
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
      const newColumns = setColumnsForGroupCount(captureGroupCount);
      newColumns[groupIndex - 1] = columnName;
      onColumnsChange(newColumns);
      setColumnPickerGroupIndex(null);
    },
    [captureGroupCount, onColumnsChange, setColumnsForGroupCount]
  );

  const handleClearColumn = useCallback(
    (groupIndex: number) => {
      const newColumns = setColumnsForGroupCount(captureGroupCount);
      newColumns[groupIndex - 1] = "";
      onColumnsChange(newColumns);
    },
    [captureGroupCount, onColumnsChange, setColumnsForGroupCount]
  );

  const handleColumnParamChange = useCallback(
    (groupIndex: number, param: string) => {
      const newColumns = setColumnsForGroupCount(captureGroupCount);
      const current = newColumns[groupIndex - 1] ?? "";
      const base = current.split("#")[0];
      if (!base) {
        return;
      }
      newColumns[groupIndex - 1] = param ? `${base}#${param}` : base;
      onColumnsChange(newColumns);
    },
    [captureGroupCount, onColumnsChange, setColumnsForGroupCount]
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      {/* REGULAR EXPRESSION — unified regex editor */}
      <div className={regexLabPanelClassName}>
        <div className={regexLabPanelHeaderClassName}>
          <div className="flex items-center gap-3">
            <span>{t("editor.regex")}</span>
            <div
              aria-label={t("editor.highlightModeLabel")}
              className="flex items-center overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--c-border)]"
              role="group"
            >
              <button
                aria-pressed={highlightMode === "parts"}
                className={highlightModeSegmentClassName(
                  highlightMode === "parts"
                )}
                onClick={() => setHighlightMode("parts")}
                title={t("editor.highlightModePartsHint")}
                type="button"
              >
                {t("editor.highlightModeParts")}
              </button>
              <button
                aria-pressed={highlightMode === "groups"}
                className={highlightModeSegmentClassName(
                  highlightMode === "groups"
                )}
                onClick={() => setHighlightMode("groups")}
                title={t("editor.highlightModeGroupsHint")}
                type="button"
              >
                {t("editor.highlightModeGroups")}
              </button>
            </div>
          </div>
          <div className={regexLabHeaderActionsClassName}>
            {!readOnly && (
              <Button
                className={regexLabHeaderButtonClassName}
                onClick={() => setIsSnippetLibraryOpen(true)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("snippets.open")}
              </Button>
            )}
            <Button
              className={regexLabHeaderButtonClassName}
              onClick={() => setIsCookbookOpen(true)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("cookbook.open")}
            </Button>
            <Button
              className={regexLabHeaderButtonClassName}
              onClick={onOpenSmsByTemplate}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("quickCheck.openSmsByTemplate")}
            </Button>
          </div>
        </div>
        <div className="p-4">
          <UnifiedRegexEditor
            activeTokenIndex={activePatternTokenIndex}
            canHighlight={explanation.canHighlightPattern}
            highlightMode={highlightMode}
            highlightPlan={patternHighlightPlan}
            key={readOnly ? "readonly" : "editable"}
            onBlur={onRegexBlur}
            onRegexChange={onRegexChange}
            onSelectionChange={handlePatternSelectionChange}
            onTokenClick={handlePatternTokenActivate}
            onTokenHover={setHoveredPatternTokenIndex}
            readOnly={readOnly}
            ref={regexEditorRef}
            regex={regex}
            tokens={explanation.patternTokens}
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 [grid-template-rows:auto_minmax(0,1fr)]">
        <div className={cn(regexLabPanelClassName, "flex flex-col")}>
          <div className={regexLabPanelHeaderClassName}>
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
            <div className={regexLabHeaderActionsClassName}>
              {hasIntersectionExamples && (
                <Button
                  className={regexLabHeaderButtonClassName}
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
                className={regexLabHeaderButtonClassName}
                onClick={onOpenTemplateBySms}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("quickCheck.openTemplateBySms")}
              </Button>
              <Button
                asChild
                className={regexLabHeaderButtonClassName}
                size="sm"
                variant="ghost"
              >
                <a href={regex101Url} rel="noopener noreferrer" target="_blank">
                  {t("editor.openInRegex101")}
                </a>
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap border-[color:var(--c-border)] border-b">
            {visibleExampleTexts.map((_, i) => (
              <div className="flex items-center" key={i}>
                <button
                  className={regexLabTabClassName(
                    i === visibleActiveExampleIndex
                  )}
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
                          ? "text-[color:var(--c-success)]"
                          : "text-[color:var(--c-error)]"
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
                      className="px-1 py-0.5 text-[11px] text-[color:var(--c-text-dim)]"
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
                      className="px-1 py-0.5 text-[11px] text-[color:var(--c-text-dim)]"
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

          <div className={regexLabPanelBodyClassName}>
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

        <div className="grid min-h-0 gap-4 [grid-template-columns:minmax(320px,1fr)_minmax(320px,1fr)]">
          <div className={cn(regexLabPanelClassName, "flex min-h-0 flex-col")}>
            <div className={regexLabPanelHeaderClassName}>
              {t("editor.matchInfo").toUpperCase()}
            </div>
            <MatchInfoPanel
              activeCaptureGroup={activeCaptureGroup}
              captureGroups={captureGroups}
              columns={columns}
              hasMissingColumnMappings={hasMissingColumnMappings}
              hoveredGroup={hoveredGroup}
              onClearColumn={handleClearColumn}
              onColumnParamChange={handleColumnParamChange}
              onGroupHover={handleGroupHover}
              onOpenColumnPicker={setColumnPickerGroupIndex}
              readOnly={readOnly}
              result={matchResult}
              structuralIssues={structuralIssues}
            />
          </div>

          <div className={cn(regexLabPanelClassName, "flex min-h-0 flex-col")}>
            <div
              className={cn(
                regexLabPanelHeaderClassName,
                "justify-start px-0 py-0"
              )}
            >
              <div
                className={cn(regexLabTabListClassName, "w-full border-b-0")}
              >
                <button
                  className={regexLabTabClassName(
                    rightPaneTab === "explanation"
                  )}
                  onClick={() => setRightPaneTab("explanation")}
                  type="button"
                >
                  {t("editor.explanation").toUpperCase()}
                </button>
                <button
                  className={regexLabTabClassName(rightPaneTab === "quickref")}
                  onClick={() => setRightPaneTab("quickref")}
                  type="button"
                >
                  QUICK REF
                </button>
                {!readOnly && (
                  <button
                    className={regexLabTabClassName(
                      rightPaneTab === "snippets"
                    )}
                    onClick={() => setRightPaneTab("snippets")}
                    type="button"
                  >
                    {t("snippets.open").toUpperCase()}
                  </button>
                )}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {rightPaneTab === "explanation" && (
                <ExplanationPanel
                  activePatternTokenIndex={activePatternTokenIndex}
                  errorMessage={matchResult.error}
                  explanation={explanation}
                  onPatternTokenActivate={handlePatternTokenActivate}
                  onPatternTokenHover={setHoveredPatternTokenIndex}
                />
              )}
              {rightPaneTab === "quickref" && <QuickReference />}
              {rightPaneTab === "snippets" && !readOnly && (
                <SnippetsPanel onInsert={handleInsertSnippet} />
              )}
            </div>
          </div>
        </div>
      </div>

      {columnPickerGroupIndex !== null && (
        <ColumnPickerModal
          currentValue={columns[columnPickerGroupIndex - 1] ?? ""}
          groupIndex={columnPickerGroupIndex}
          onClose={() => setColumnPickerGroupIndex(null)}
          onSelectColumn={(columnName) =>
            handleSelectColumn(columnPickerGroupIndex, columnName)
          }
          selectedColumns={columns}
          titleId={columnPickerTitleId}
        />
      )}

      {isSnippetLibraryOpen && (
        <SnippetLibraryModal
          onClose={() => setIsSnippetLibraryOpen(false)}
          onInsert={handleInsertSnippet}
        />
      )}

      {isCookbookOpen && (
        <CookbookModal onClose={() => setIsCookbookOpen(false)} />
      )}
    </div>
  );
}

interface HighlightSegment {
  text: string;
  className?: string;
  title?: string;
}

function MatchOverlayTextarea({
  text,
  result,
  hoveredGroup,
  activeMatchRange,
  progress,
  onTextChange,
  readOnly = false,
}: {
  text: string;
  result: RegexMatchResult;
  hoveredGroup: number | null;
  activeMatchRange: { start: number; end: number } | null;
  progress: RecognitionProgress | null;
  onTextChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const highlightsRef = useRef<HTMLDivElement>(null);
  const waitingLabel = t("editor.recognitionProgressWaiting");
  const segments = useMemo(
    () =>
      buildMatchSegments(
        text,
        result,
        hoveredGroup,
        activeMatchRange,
        progress,
        waitingLabel
      ),
    [text, result, hoveredGroup, activeMatchRange, progress, waitingLabel]
  );

  const handleScroll = useCallback((top: number, left: number) => {
    if (highlightsRef.current) {
      highlightsRef.current.scrollTop = top;
      highlightsRef.current.scrollLeft = left;
    }
  }, []);

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-input)] focus-within:border-[color:var(--c-border-focus)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 min-h-[60px] overflow-auto px-3 py-2 text-[13px] text-[color:var(--c-text)] leading-[1.6] [font-family:var(--font-mono)] [overflow-wrap:break-word] [tab-size:4] [white-space:pre-wrap]"
        ref={highlightsRef}
      >
        {renderHighlightedText(segments)}
      </div>
      <textarea
        className="relative z-[1] min-h-[60px] w-full resize-y border-none bg-transparent px-3 py-2 text-[13px] text-transparent leading-[1.6] caret-[color:var(--c-text)] outline-none [font-family:var(--font-mono)] [overflow-wrap:break-word] [tab-size:4] [white-space:pre-wrap] selection:bg-[color:var(--c-accent-soft)]"
        onChange={(e) => onTextChange(e.target.value)}
        onScroll={(e) =>
          handleScroll(e.currentTarget.scrollTop, e.currentTarget.scrollLeft)
        }
        readOnly={readOnly}
        rows={3}
        spellCheck={false}
        value={text}
      />
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

function buildMatchClass(hoveredGroup: number | null): string {
  return hoveredGroup === 0
    ? `${matchHighlightBaseClass} ${matchHighlightHoverClass}`
    : matchHighlightBaseClass;
}

function isSegmentInActiveRange(
  segStart: number,
  segEnd: number,
  activeRange: { start: number; end: number } | null
): boolean {
  if (!activeRange) {
    return false;
  }
  return segStart < activeRange.end && segEnd > activeRange.start;
}

function resolveMatchBounds(
  text: string,
  result: RegexMatchResult
): { start: number; end: number } | null {
  if (!(result.matched && result.fullMatch)) {
    return null;
  }

  const fullMatchStart = result.matchStart ?? text.indexOf(result.fullMatch);
  const fullMatchEnd =
    result.matchEnd ?? fullMatchStart + result.fullMatch.length;
  if (fullMatchStart < 0 || fullMatchEnd < fullMatchStart) {
    return null;
  }

  const boundedStart = Math.max(0, Math.min(fullMatchStart, text.length));
  const boundedEnd = Math.max(
    boundedStart,
    Math.min(fullMatchEnd, text.length)
  );
  return { start: boundedStart, end: boundedEnd };
}

function normalizeGroupsForBounds(
  groups: RegexMatchResult["groups"],
  start: number,
  end: number
): RegexMatchResult["groups"] {
  return [...groups]
    .filter((group) => group.end > group.start)
    .map((group) => ({
      ...group,
      start: Math.max(start, Math.min(group.start, end)),
      end: Math.max(start, Math.min(group.end, end)),
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
}

function buildMatchSegments(
  text: string,
  result: RegexMatchResult,
  hoveredGroup: number | null,
  activeMatchRange: { start: number; end: number } | null,
  progress: RecognitionProgress | null,
  waitingLabel: string
): HighlightSegment[] {
  if (!text) {
    return [{ text: "\u200b" }];
  }

  const bounds = resolveMatchBounds(text, result);
  if (!bounds) {
    // No full match: show Recognition Progress when a prefix latched (region
    // B is non-empty); otherwise stay neutral, matching today's "no match".
    if (progress && progress.prefixEnd > progress.prefixStart) {
      return buildProgressSegments(text, progress, waitingLabel);
    }
    return [{ text }];
  }

  return buildFullMatchSegments(
    text,
    bounds,
    result,
    hoveredGroup,
    activeMatchRange
  );
}

function buildFullMatchSegments(
  text: string,
  bounds: { start: number; end: number },
  result: RegexMatchResult,
  hoveredGroup: number | null,
  activeMatchRange: { start: number; end: number } | null
): HighlightSegment[] {
  const boundedFullMatchStart = bounds.start;
  const boundedFullMatchEnd = bounds.end;
  const segments: HighlightSegment[] = [];
  let cursor = 0;

  if (boundedFullMatchStart > 0) {
    segments.push({ text: text.slice(0, boundedFullMatchStart) });
    cursor = boundedFullMatchStart;
  }

  const sortedGroups = normalizeGroupsForBounds(
    result.groups,
    boundedFullMatchStart,
    boundedFullMatchEnd
  );

  for (const group of sortedGroups) {
    const groupStart = Math.max(group.start, cursor);
    const groupEnd = Math.max(groupStart, group.end);
    if (groupEnd <= cursor) {
      continue;
    }

    if (groupStart > cursor) {
      const gapActive = isSegmentInActiveRange(
        cursor,
        groupStart,
        activeMatchRange
      );
      segments.push({
        text: text.slice(cursor, groupStart),
        className:
          `${buildMatchClass(hoveredGroup)} ${gapActive ? matchHighlightRangeActiveClass : ""}`.trim(),
      });
    }

    const groupActive = isSegmentInActiveRange(
      groupStart,
      groupEnd,
      activeMatchRange
    );
    segments.push({
      text: text.slice(groupStart, groupEnd),
      className:
        `${getGroupClass(group.index)} ${hoveredGroup === group.index ? "brightness-150" : ""} ${groupActive ? matchHighlightRangeActiveClass : ""}`.trim(),
      title: `Group ${group.index}`,
    });
    cursor = groupEnd;
  }

  if (cursor < boundedFullMatchEnd) {
    const tailActive = isSegmentInActiveRange(
      cursor,
      boundedFullMatchEnd,
      activeMatchRange
    );
    segments.push({
      text: text.slice(cursor, boundedFullMatchEnd),
      className:
        `${buildMatchClass(hoveredGroup)} ${tailActive ? matchHighlightRangeActiveClass : ""}`.trim(),
    });
  }

  if (boundedFullMatchEnd < text.length) {
    segments.push({ text: text.slice(boundedFullMatchEnd) });
  }

  return segments.length > 0 ? segments : [{ text }];
}

function buildProgressSegments(
  text: string,
  progress: RecognitionProgress,
  waitingLabel: string
): HighlightSegment[] {
  const prefixStart = Math.max(0, Math.min(progress.prefixStart, text.length));
  const prefixEnd = Math.max(
    prefixStart,
    Math.min(progress.prefixEnd, text.length)
  );
  const segments: HighlightSegment[] = [];

  // Region A — head before the format, neutral (like unhighlighted text).
  if (prefixStart > 0) {
    segments.push({ text: text.slice(0, prefixStart) });
  }

  // Region B — recognized prefix (provisional), with muted capture groups.
  const groups = normalizeGroupsForBounds(
    progress.groups,
    prefixStart,
    prefixEnd
  );
  let cursor = prefixStart;
  for (const group of groups) {
    const groupStart = Math.max(group.start, cursor);
    const groupEnd = Math.max(groupStart, group.end);
    if (groupEnd <= cursor) {
      continue;
    }
    if (groupStart > cursor) {
      segments.push({
        text: text.slice(cursor, groupStart),
        className: progressPrefixClass,
      });
    }
    segments.push({
      text: text.slice(groupStart, groupEnd),
      className: getProgressGroupClass(group.index),
      title: `Group ${group.index}`,
    });
    cursor = groupEnd;
  }
  if (cursor < prefixEnd) {
    segments.push({
      text: text.slice(cursor, prefixEnd),
      className: progressPrefixClass,
    });
  }

  // Region C and the "waiting for more" marker are mutually exclusive: either
  // text remains past the prefix (C), or the text was exhausted (marker).
  if (progress.textExhausted) {
    if (prefixEnd < text.length) {
      segments.push({ text: text.slice(prefixEnd) });
    }
    segments.push({
      text: PROGRESS_WAITING_GLYPH,
      className: progressWaitingClass,
      title: waitingLabel,
    });
  } else if (prefixEnd < text.length) {
    segments.push({
      text: text.slice(prefixEnd),
      className: progressTailClass,
    });
  }

  return segments;
}

function renderHighlightedText(segments: HighlightSegment[]) {
  return segments.map((segment, index) => (
    <span className={segment.className} key={index} title={segment.title}>
      {segment.text}
    </span>
  ));
}

function getGroupColor(groupIndex: number): string {
  const colors = [
    "var(--c-group-border-1)",
    "var(--c-group-border-2)",
    "var(--c-group-border-3)",
    "var(--c-group-border-4)",
    "var(--c-group-border-5)",
  ];
  return colors[(groupIndex - 1) % colors.length]!;
}

function getGroupClass(groupIndex: number): string {
  return matchHighlightGroupClassMap[(groupIndex - 1) % 5]!;
}

function getProgressGroupClass(groupIndex: number): string {
  return progressGroupClassMap[(groupIndex - 1) % 5]!;
}

function MatchInfoPanel({
  result,
  hoveredGroup,
  activeCaptureGroup,
  onGroupHover,
  captureGroups,
  columns,
  onOpenColumnPicker,
  onClearColumn,
  onColumnParamChange,
  hasMissingColumnMappings,
  structuralIssues,
  readOnly = false,
}: {
  result: RegexMatchResult;
  hoveredGroup: number | null;
  activeCaptureGroup: number | null;
  onGroupHover: (groupIndex: number | null) => void;
  captureGroups: Array<{
    index: number;
    match: { value: string; start: number; end: number } | null;
  }>;
  columns: string[];
  onOpenColumnPicker: (groupIndex: number) => void;
  onClearColumn: (groupIndex: number) => void;
  onColumnParamChange: (groupIndex: number, value: string) => void;
  hasMissingColumnMappings: boolean;
  structuralIssues: string[];
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const issues = [
    ...(result.error ? [t("editor.invalidRegex")] : []),
    ...structuralIssues,
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      {issues.length > 0 ? (
        <div className="flex flex-col gap-1">
          {issues.map((issue, i) => (
            <div
              className="rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-2 text-[color:var(--c-error)] text-xs"
              key={i}
            >
              {issue}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {result.matched ? (
            <div
              className={cn(
                "flex items-center gap-2 rounded-[var(--radius-sm)] border border-transparent px-2 py-1",
                hoveredGroup === 0 && "bg-[color:var(--c-accent-soft)]"
              )}
              onMouseEnter={() => onGroupHover(0)}
              onMouseLeave={() => onGroupHover(null)}
            >
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ background: "var(--c-group-border-0)" }}
              />
              <span className="text-[color:var(--c-text-muted)] text-sm">
                {t("editor.fullMatch")}:
              </span>
              <span className="rounded-[3px] bg-[color:var(--c-bg-input)] px-1.5 py-0.5 font-mono text-sm">
                {result.fullMatch}
              </span>
            </div>
          ) : (
            <div className="text-[color:var(--c-text-muted)] text-sm">
              {t("editor.noMatch")}
            </div>
          )}
          {captureGroups.length > 0 && (
            <>
              {hasMissingColumnMappings && (
                <div className="rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-2 text-[color:var(--c-error)] text-xs">
                  {t("columns.missingMappings")}
                </div>
              )}
              <div className="mt-1 font-medium text-[color:var(--c-text-muted)] text-sm">
                {t("editor.groups")}:
              </div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-[color:var(--c-text-dim)]">
                    <th className="px-1.5 py-[3px]" />
                    <th className="px-1.5 py-[3px]">#</th>
                    <th className="px-1.5 py-[3px]">Value</th>
                    <th className="px-1.5 py-[3px]">{t("editor.columns")}</th>
                  </tr>
                </thead>
                <tbody>
                  {captureGroups.map((g) => {
                    const currentValue = columns[g.index - 1] ?? "";
                    const baseName = currentValue.split("#")[0] ?? "";
                    const paramValue = currentValue.includes("#")
                      ? currentValue.split("#").slice(1).join("#")
                      : "";
                    const columnDef = ALLOWED_COLUMNS.find(
                      (col) => col.name === baseName
                    );

                    return (
                      <tr
                        className={cn(
                          "rounded-[var(--radius-sm)]",
                          hoveredGroup === g.index &&
                            "bg-[color:var(--c-accent-soft)]",
                          activeCaptureGroup === g.index &&
                            "outline outline-2 outline-[color:var(--c-accent)] outline-offset-[-1px]"
                        )}
                        key={g.index}
                        onMouseEnter={() => onGroupHover(g.index)}
                        onMouseLeave={() => onGroupHover(null)}
                      >
                        <td className="px-1.5 py-[3px]">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ background: getGroupColor(g.index) }}
                          />
                        </td>
                        <td className="px-1.5 py-[3px] text-[color:var(--c-text-muted)]">
                          {g.index}
                        </td>
                        <td className="px-1.5 py-[3px] font-mono">
                          {g.match?.value ?? "—"}
                        </td>
                        <td className="px-1.5 py-[3px]">
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              className="max-w-full"
                              disabled={readOnly}
                              onClick={() => onOpenColumnPicker(g.index)}
                              size="sm"
                              type="button"
                              variant={currentValue ? "default" : "destructive"}
                            >
                              {currentValue || t("columns.select")}
                            </Button>
                            {currentValue && (
                              <Button
                                aria-label={t("app.close")}
                                disabled={readOnly}
                                onClick={() => onClearColumn(g.index)}
                                size="sm"
                                title={t("app.close")}
                                type="button"
                                variant="ghost"
                              >
                                ×
                              </Button>
                            )}
                            {columnDef?.parameterized && (
                              <Input
                                className="h-8 w-[150px] font-mono text-xs"
                                disabled={readOnly}
                                onChange={(e) =>
                                  onColumnParamChange(g.index, e.target.value)
                                }
                                placeholder={
                                  columnDef.paramHint ?? t("columns.param")
                                }
                                value={paramValue}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ExplanationPanel({
  explanation,
  errorMessage,
  activePatternTokenIndex,
  onPatternTokenActivate,
  onPatternTokenHover,
}: {
  explanation: RegexExplanation;
  errorMessage: string | null;
  activePatternTokenIndex: number | null;
  onPatternTokenActivate: (tokenIndex: number) => void;
  onPatternTokenHover: (tokenIndex: number | null) => void;
}) {
  const { t } = useTranslation();
  const tokenRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Auto-scroll the active token into view within the explanation panel
  useEffect(() => {
    if (activePatternTokenIndex == null) {
      return;
    }
    const el = tokenRefs.current.get(activePatternTokenIndex);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activePatternTokenIndex]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      {errorMessage ? (
        <div className="rounded-[var(--radius-sm)] bg-[color:var(--c-error-soft)] px-3 py-2 text-[color:var(--c-error)] text-xs">
          {cleanRegexErrorReason(errorMessage)}
        </div>
      ) : explanation.patternTokens.length === 0 ? (
        <div className="text-[color:var(--c-text-muted)] text-sm">—</div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="font-medium text-[color:var(--c-text-muted)] text-sm">
            {t("editor.patternParts")}
          </div>
          {explanation.patternTokens.map((token, index) => (
            <div
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2 transition-colors",
                getPatternBlockToneClass(token.type),
                index === activePatternTokenIndex &&
                  "outline outline-2 outline-[color:var(--c-accent)] outline-offset-[-1px]"
              )}
              key={`${token.start}-${token.end}-${index}`}
              onBlur={() => onPatternTokenHover(null)}
              onClick={() => onPatternTokenActivate(index)}
              onFocus={() => onPatternTokenActivate(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPatternTokenActivate(index);
                }
              }}
              onMouseEnter={() => onPatternTokenHover(index)}
              onMouseLeave={() => onPatternTokenHover(null)}
              onMouseUp={() => onPatternTokenActivate(index)}
              ref={(el) => {
                if (el) {
                  tokenRefs.current.set(index, el);
                } else {
                  tokenRefs.current.delete(index);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <code className={cn("font-mono", getRegexTokenClass(token.type))}>
                {token.raw}
              </code>
              <span className="min-w-0 flex-1 text-sm">
                {token.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnPickerModal({
  groupIndex,
  selectedColumns,
  currentValue,
  onClose,
  onSelectColumn,
  titleId,
}: {
  groupIndex: number;
  selectedColumns: string[];
  currentValue: string;
  onClose: () => void;
  onSelectColumn: (columnName: string) => void;
  titleId: string;
}) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const lang = i18n.resolvedLanguage?.startsWith("ru") ? "ru" : "en";
  const currentBaseName = currentValue.split("#")[0] ?? "";
  const usedBaseNames = useMemo(() => {
    const names = new Set<string>();
    selectedColumns.forEach((column, index) => {
      if (index === groupIndex - 1) {
        return;
      }
      const base = column.split("#")[0];
      if (base) {
        names.add(base);
      }
    });
    return names;
  }, [groupIndex, selectedColumns]);
  const filteredColumns = useMemo(() => {
    if (!search.trim()) {
      return ALLOWED_COLUMNS_SORTED;
    }
    const query = search.toLowerCase();
    return ALLOWED_COLUMNS_SORTED.filter((column) => {
      const description =
        column.description[lang]?.toLowerCase() ??
        column.description.en.toLowerCase();
      return (
        column.name.toLowerCase().includes(query) || description.includes(query)
      );
    });
  }, [lang, search]);

  return (
    <ModalDialog
      className="flex max-h-[calc(100vh-40px)] flex-col sm:max-w-[760px]"
      onClose={onClose}
      title={t("columns.selectForGroup", { index: groupIndex })}
      titleId={titleId}
    >
      <Input
        autoFocus
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("columns.search")}
        value={search}
      />
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-sm)] border border-[color:var(--c-border)]">
        {filteredColumns.map((column) => {
          const isUsedByOtherGroup = usedBaseNames.has(column.name);
          const isCurrent = currentBaseName === column.name;
          const isDisabled = isUsedByOtherGroup && !isCurrent;
          return (
            <button
              className={cn(
                "flex w-full items-center gap-2 border-[color:var(--c-border)] border-b bg-[color:var(--c-bg-surface)] px-3 py-2 text-left last:border-b-0",
                isCurrent && "bg-[color:var(--c-accent-soft)]",
                !isDisabled && "hover:bg-[color:var(--c-bg-hover)]",
                isDisabled && "cursor-not-allowed opacity-55"
              )}
              disabled={isDisabled}
              key={column.name}
              onClick={() =>
                onSelectColumn(
                  column.parameterized
                    ? `${column.name}#${column.paramHint ?? ""}`
                    : column.name
                )
              }
              type="button"
            >
              <span className="font-medium font-mono">{column.name}</span>
              <span className="text-[color:var(--c-text-muted)] text-sm">
                {column.description[lang] ?? column.description.en}
              </span>
              {column.parameterized && (
                <StatusBadge className="text-xs" variant="info">
                  {t("columns.param")}
                </StatusBadge>
              )}
              {isDisabled && (
                <StatusBadge className="text-xs" variant="warning">
                  {t("columns.alreadyUsed")}
                </StatusBadge>
              )}
            </button>
          );
        })}
        {filteredColumns.length === 0 && (
          <div className="p-4 text-[color:var(--c-text-muted)] text-sm">—</div>
        )}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onClose} type="button">
          {t("app.cancel")}
        </Button>
      </div>
    </ModalDialog>
  );
}

// Native engine message is "Invalid regular expression: /<pattern>/: <reason>".
// The pattern is already on screen above, so keep only the trailing reason.
function cleanRegexErrorReason(message: string): string {
  const marker = message.lastIndexOf(": ");
  return marker === -1 ? message : message.slice(marker + 2);
}

function getRegexTokenClass(type: string): string {
  return regexTokenToneClassMap[type] ?? regexTokenToneClassMap.literal!;
}

function getPatternBlockToneClass(type: string): string {
  return patternBlockToneClassMap[type] ?? patternBlockToneClassMap.literal!;
}
