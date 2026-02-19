import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  RegexExplanation,
  RegexMatchResult,
  RegexPatternToken,
} from "@/domain/format";
import {
  buildRegex101Url,
  buildTokenToCaptureGroupMap,
  convertTemplateToRegex,
  countCaptureGroups,
  explainRegex,
  testRegex,
} from "@/domain/format";
import { ALLOWED_COLUMNS, ALLOWED_COLUMNS_SORTED } from "@/domain/types";
import { QuickReference } from "@/features/quick-reference/QuickReference";
import { UnifiedRegexEditor } from "./UnifiedRegexEditor";

interface Props {
  regex: string;
  onRegexChange: (v: string) => void;
  examples: string[];
  activeExampleIndex: number;
  onActiveExampleChange: (i: number) => void;
  onExampleChange: (index: number, value: string) => void;
  onAddExample: () => void;
  onRemoveExample: (index: number) => void;
  columns: string[];
  onColumnsChange: (columns: string[]) => void;
}

interface PatternSelection {
  start: number;
  end: number;
}

type RightPaneTab = "explanation" | "quickref";

export function RegexLab({
  regex,
  onRegexChange,
  examples,
  activeExampleIndex,
  onActiveExampleChange,
  onExampleChange,
  onAddExample,
  onRemoveExample,
  columns,
  onColumnsChange,
}: Props) {
  const { t, i18n } = useTranslation();
  const activeExample = examples[activeExampleIndex] ?? "";
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
  const [activeCaptureGroup, setActiveCaptureGroup] = useState<number | null>(
    null
  );
  const [columnPickerGroupIndex, setColumnPickerGroupIndex] = useState<
    number | null
  >(null);
  const columnPickerTitleId = useId();

  const matchResult = useMemo(
    () => testRegex(regex, activeExample),
    [regex, activeExample]
  );
  const exampleMatchStates = useMemo(
    () => examples.map((example) => testRegex(regex, example ?? "")),
    [regex, examples]
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
    if (
      selectedPatternTokenIndex != null &&
      selectedPatternTokenIndex >= explanation.patternTokens.length
    ) {
      setSelectedPatternTokenIndex(null);
    }
  }, [explanation.patternTokens.length, selectedPatternTokenIndex]);

  // Clear token-driven capture highlight when regex or example changes
  useEffect(() => {
    setActiveCaptureGroup(null);
  }, [regex, activeExampleIndex]);

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
      // Resolve the capture group for this token from precomputed map
      const group = tokenCaptureGroupMap[tokenIndex] ?? null;
      setActiveCaptureGroup(group);
    },
    [explanation.patternTokens, tokenCaptureGroupMap]
  );

  const handleConvertTemplate = useCallback(
    (precision: "rough" | "accurate") => {
      if (!regex.trim()) {
        return;
      }
      const converted = convertTemplateToRegex(regex, precision);
      onRegexChange(converted);
    },
    [onRegexChange, regex]
  );

  return (
    <div className="regex-lab">
      {/* REGULAR EXPRESSION — unified regex editor */}
      <div className="panel">
        <div className="panel__header">
          <span>{t("editor.regex")}</span>
          <div className="regex-input-stack__actions">
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => handleConvertTemplate("rough")}
              title={t("editor.convertTemplateRough")}
              type="button"
            >
              {t("editor.convertTemplateRough")}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => handleConvertTemplate("accurate")}
              title={t("editor.convertTemplateAccurate")}
              type="button"
            >
              {t("editor.convertTemplateAccurate")}
            </button>
          </div>
        </div>
        <div className="panel__body">
          <UnifiedRegexEditor
            activeTokenIndex={activePatternTokenIndex}
            canHighlight={explanation.canHighlightPattern}
            onRegexChange={onRegexChange}
            onSelectionChange={handlePatternSelectionChange}
            onTokenClick={handlePatternTokenActivate}
            regex={regex}
            tokens={explanation.patternTokens}
          />
          {matchResult.error && (
            <div
              className="issue-item issue-item--error"
              style={{ marginTop: 8 }}
            >
              {matchResult.error}
            </div>
          )}
        </div>
      </div>

      <div className="regex-workspace">
        <div className="panel regex-workspace__test">
          <div className="panel__header">
            <div className="flex items-center gap-sm">
              {t("editor.testString")}
              <button
                aria-label={t("editor.addExample")}
                className="btn btn--ghost btn--sm"
                onClick={onAddExample}
                type="button"
              >
                +
              </button>
            </div>
            <a
              className="btn btn--ghost btn--sm"
              href={regex101Url}
              rel="noopener noreferrer"
              target="_blank"
            >
              {t("editor.openInRegex101")}
            </a>
          </div>
          <div className="tabs">
            {examples.map((_, i) => (
              <div className="flex items-center" key={i}>
                <button
                  className={`tab ${i === activeExampleIndex ? "tab--active" : ""}`}
                  onClick={() => onActiveExampleChange(i)}
                >
                  #{i + 1}
                  {regex && (
                    <span
                      style={{
                        marginLeft: 4,
                        color: exampleMatchStates[i]?.matched
                          ? "var(--c-success)"
                          : "var(--c-error)",
                      }}
                    >
                      {exampleMatchStates[i]?.matched ? "✓" : "✗"}
                    </span>
                  )}
                </button>
                {examples.length > 1 && (
                  <button
                    aria-label={t("editor.removeExample")}
                    className="btn btn--ghost btn--sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveExample(i);
                    }}
                    style={{
                      padding: "2px 4px",
                      fontSize: 11,
                      color: "var(--c-text-dim)",
                    }}
                    title={t("editor.removeExample")}
                    type="button"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="panel__body">
            <MatchOverlayTextarea
              activeCaptureGroup={activeCaptureGroup}
              hoveredGroup={hoveredGroup}
              onTextChange={(value) =>
                onExampleChange(activeExampleIndex, value)
              }
              result={matchResult}
              text={activeExample}
            />
          </div>
        </div>

        <div className="regex-workspace__details">
          <div className="panel regex-workspace__details-panel">
            <div className="panel__header">
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
              result={matchResult}
            />
          </div>

          <div className="panel regex-workspace__details-panel">
            <div className="panel__header regex-workspace__tab-header">
              <div className="tabs regex-workspace__tab-switcher">
                <button
                  className={`tab ${rightPaneTab === "explanation" ? "tab--active" : ""}`}
                  onClick={() => setRightPaneTab("explanation")}
                >
                  {t("editor.explanation").toUpperCase()}
                </button>
                <button
                  className={`tab ${rightPaneTab === "quickref" ? "tab--active" : ""}`}
                  onClick={() => setRightPaneTab("quickref")}
                >
                  QUICK REF
                </button>
              </div>
            </div>
            {rightPaneTab === "explanation" ? (
              <ExplanationPanel
                activePatternTokenIndex={activePatternTokenIndex}
                explanation={explanation}
                hasError={!!matchResult.error}
                onPatternTokenActivate={handlePatternTokenActivate}
                onPatternTokenHover={setHoveredPatternTokenIndex}
              />
            ) : (
              <div className="regex-workspace__quickref">
                <QuickReference />
              </div>
            )}
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
  activeCaptureGroup,
  onTextChange,
}: {
  text: string;
  result: RegexMatchResult;
  hoveredGroup: number | null;
  activeCaptureGroup: number | null;
  onTextChange: (value: string) => void;
}) {
  const highlightsRef = useRef<HTMLDivElement>(null);
  const segments = useMemo(
    () => buildMatchSegments(text, result, hoveredGroup, activeCaptureGroup),
    [text, result, hoveredGroup, activeCaptureGroup]
  );

  const handleScroll = useCallback((top: number, left: number) => {
    if (highlightsRef.current) {
      highlightsRef.current.scrollTop = top;
      highlightsRef.current.scrollLeft = left;
    }
  }, []);

  return (
    <div className="overlay-textarea">
      <div
        aria-hidden="true"
        className="overlay-textarea__highlights"
        ref={highlightsRef}
      >
        {renderHighlightedText(segments)}
      </div>
      <textarea
        className="overlay-textarea__input"
        onChange={(e) => onTextChange(e.target.value)}
        onScroll={(e) =>
          handleScroll(e.currentTarget.scrollTop, e.currentTarget.scrollLeft)
        }
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
    ? "match-highlight match-highlight--hovered"
    : "match-highlight";
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
  activeCaptureGroup: number | null
): HighlightSegment[] {
  if (!text) {
    return [{ text: "\u200b" }];
  }

  const bounds = resolveMatchBounds(text, result);
  if (!bounds) {
    return [{ text }];
  }

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
      segments.push({
        text: text.slice(cursor, groupStart),
        className: buildMatchClass(hoveredGroup),
      });
    }

    segments.push({
      text: text.slice(groupStart, groupEnd),
      className:
        `${getGroupClass(group.index)} ${hoveredGroup === group.index ? "match-highlight--group-hovered" : ""} ${activeCaptureGroup === group.index ? "match-highlight--group-active" : ""}`.trim(),
      title: `Group ${group.index}`,
    });
    cursor = groupEnd;
  }

  if (cursor < boundedFullMatchEnd) {
    segments.push({
      text: text.slice(cursor, boundedFullMatchEnd),
      className: buildMatchClass(hoveredGroup),
    });
  }

  if (boundedFullMatchEnd < text.length) {
    segments.push({ text: text.slice(boundedFullMatchEnd) });
  }

  return segments.length > 0 ? segments : [{ text }];
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
  const idx = ((groupIndex - 1) % 5) + 1;
  return `match-highlight--group-${idx}`;
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
}) {
  const { t } = useTranslation();

  return (
    <div className="panel__body">
      {result.error ? (
        <div className="issue-item issue-item--error">
          {t("editor.invalidRegex")}
        </div>
      ) : (
        <div className="flex-col gap-sm">
          {result.matched ? (
            <div
              className={`group-row flex items-center gap-sm ${hoveredGroup === 0 ? "group-row--hovered" : ""}`}
              onMouseEnter={() => onGroupHover(0)}
              onMouseLeave={() => onGroupHover(null)}
            >
              <span
                className="group-color-dot"
                style={{ background: "var(--c-group-border-0)" }}
              />
              <span className="text-muted text-sm">
                {t("editor.fullMatch")}:
              </span>
              <span
                className="text-mono text-sm"
                style={{
                  background: "var(--c-bg-input)",
                  padding: "2px 6px",
                  borderRadius: 3,
                }}
              >
                {result.fullMatch}
              </span>
            </div>
          ) : (
            <div className="text-muted text-sm">{t("editor.noMatch")}</div>
          )}
          {captureGroups.length > 0 && (
            <>
              {hasMissingColumnMappings && (
                <div className="issue-item issue-item--error">
                  {t("columns.missingMappings")}
                </div>
              )}
              <div
                className="font-medium text-muted text-sm"
                style={{ marginTop: 4 }}
              >
                {t("editor.groups")}:
              </div>
              <table
                style={{
                  width: "100%",
                  fontSize: 12,
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--c-text-dim)" }}>
                    <th style={{ padding: "3px 6px" }} />
                    <th style={{ padding: "3px 6px" }}>#</th>
                    <th style={{ padding: "3px 6px" }}>Value</th>
                    <th style={{ padding: "3px 6px" }}>
                      {t("editor.columns")}
                    </th>
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
                        className={`group-row ${hoveredGroup === g.index ? "group-row--hovered" : ""} ${activeCaptureGroup === g.index ? "group-row--active" : ""}`}
                        key={g.index}
                        onMouseEnter={() => onGroupHover(g.index)}
                        onMouseLeave={() => onGroupHover(null)}
                      >
                        <td style={{ padding: "3px 6px" }}>
                          <span
                            className="group-color-dot"
                            style={{ background: getGroupColor(g.index) }}
                          />
                        </td>
                        <td
                          className="text-muted"
                          style={{ padding: "3px 6px" }}
                        >
                          {g.index}
                        </td>
                        <td
                          className="text-mono"
                          style={{ padding: "3px 6px" }}
                        >
                          {g.match?.value ?? "—"}
                        </td>
                        <td style={{ padding: "3px 6px" }}>
                          <div className="match-columns-cell">
                            <button
                              className={`btn btn--sm ${currentValue ? "" : "btn--danger"}`.trim()}
                              onClick={() => onOpenColumnPicker(g.index)}
                            >
                              {currentValue || t("columns.select")}
                            </button>
                            {currentValue && (
                              <button
                                aria-label={t("app.close")}
                                className="btn btn--ghost btn--sm"
                                onClick={() => onClearColumn(g.index)}
                                title={t("app.close")}
                                type="button"
                              >
                                ×
                              </button>
                            )}
                            {columnDef?.parameterized && (
                              <input
                                className="input input--mono match-columns-param-input"
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
  hasError,
  activePatternTokenIndex,
  onPatternTokenActivate,
  onPatternTokenHover,
}: {
  explanation: RegexExplanation;
  hasError: boolean;
  activePatternTokenIndex: number | null;
  onPatternTokenActivate: (tokenIndex: number) => void;
  onPatternTokenHover: (tokenIndex: number | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="panel__body">
      {hasError ? (
        <div className="issue-item issue-item--error">
          {t("editor.invalidRegex")}
        </div>
      ) : explanation.patternTokens.length === 0 ? (
        <div className="text-muted text-sm">—</div>
      ) : (
        <div className="flex-col gap-xs">
          <div className="font-medium text-muted text-sm">
            {t("editor.patternParts")}
          </div>
          {explanation.patternTokens.map((token, index) => (
            <div
              className={`pattern-block ${getPatternBlockToneClass(token.type)} ${index === activePatternTokenIndex ? "pattern-block--active" : ""}`.trim()}
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
              role="button"
              tabIndex={0}
            >
              <code
                className={`text-mono ${getRegexTokenClass(token.type)}`.trim()}
              >
                {token.raw}
              </code>
              <span className="pattern-block__desc text-sm">
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
    <div className="modal-overlay" onClick={onClose}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal regex-column-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="modal__title" id={titleId}>
          {t("columns.selectForGroup", { index: groupIndex })}
        </div>
        <input
          autoFocus
          className="input"
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("columns.search")}
          value={search}
        />
        <div className="regex-column-modal__list">
          {filteredColumns.map((column) => {
            const isUsedByOtherGroup = usedBaseNames.has(column.name);
            const isCurrent = currentBaseName === column.name;
            const isDisabled = isUsedByOtherGroup && !isCurrent;
            return (
              <button
                className={`regex-column-modal__item ${isCurrent ? "regex-column-modal__item--selected" : ""}`.trim()}
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
                <span className="font-medium text-mono">{column.name}</span>
                <span className="text-muted text-sm">
                  {column.description[lang] ?? column.description.en}
                </span>
                {column.parameterized && (
                  <span className="badge badge--info text-sm">
                    {t("columns.param")}
                  </span>
                )}
                {isDisabled && (
                  <span className="badge badge--warning text-sm">
                    {t("columns.alreadyUsed")}
                  </span>
                )}
              </button>
            );
          })}
          {filteredColumns.length === 0 && (
            <div className="p-md text-muted text-sm">—</div>
          )}
        </div>
        <div className="modal__actions">
          <button className="btn" onClick={onClose}>
            {t("app.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

function getRegexTokenClass(type: string): string {
  const map: Record<string, string> = {
    anchor: "regex-token regex-token--anchor",
    group: "regex-token regex-token--group",
    quantifier: "regex-token regex-token--quantifier",
    alternation: "regex-token regex-token--alternation",
    escape: "regex-token regex-token--escape",
    charclass: "regex-token regex-token--charclass",
    meta: "regex-token regex-token--meta",
    literal: "regex-token regex-token--literal",
  };
  return map[type] ?? "regex-token regex-token--literal";
}

function getPatternBlockToneClass(type: string): string {
  const map: Record<string, string> = {
    anchor: "pattern-block--tone-anchor",
    group: "pattern-block--tone-group",
    quantifier: "pattern-block--tone-quantifier",
    alternation: "pattern-block--tone-alternation",
    escape: "pattern-block--tone-escape",
    charclass: "pattern-block--tone-charclass",
    meta: "pattern-block--tone-meta",
    literal: "pattern-block--tone-literal",
  };
  return map[type] ?? "pattern-block--tone-literal";
}
