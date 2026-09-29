import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecognitionProgress, RegexMatchResult } from "@/domain/format";
import { ALLOWED_COLUMNS } from "@/domain/types";
import { cn } from "@/lib/utils";

import {
  matchHighlightBaseClass,
  matchHighlightGroupClassMap,
  matchHighlightHoverClass,
  matchHighlightRangeActiveClass,
  PROGRESS_WAITING_GLYPH,
  progressGroupClassMap,
  progressPrefixClass,
  progressTailClass,
  progressWaitingClass,
} from "./regex-styles";

interface HighlightSegment {
  text: string;
  className?: string;
  title?: string;
}

export function MatchOverlayTextarea({
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

  if (prefixStart > 0) {
    segments.push({ text: text.slice(0, prefixStart) });
  }

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

export function MatchInfoPanel({
  result,
  hoveredGroup,
  activeCaptureGroup,
  onGroupHover,
  captureGroups,
  columns,
  onOpenColumnPicker,
  onClearColumn,
  onColumnParamChange,
  onSelectGroup,
  selectedGroupIndex,
  groupSelectionEnabled,
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
  onSelectGroup: (groupIndex: number) => void;
  selectedGroupIndex: number | null;
  groupSelectionEnabled: boolean;
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
                    <th className="px-1.5 py-[3px]">
                      {t("regex.captureValue")}
                    </th>
                    <th className="px-1.5 py-[3px]">{t("editor.columns")}</th>
                    <th className="px-1.5 py-[3px]" />
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
                        <td className="px-1.5 py-[3px] text-right">
                          <Button
                            aria-label={t("editor.selectGroup")}
                            aria-pressed={selectedGroupIndex === g.index}
                            className={cn(
                              "px-1.5 py-0.5 text-[13px]",
                              selectedGroupIndex === g.index &&
                                "text-[color:var(--c-accent)]"
                            )}
                            disabled={!groupSelectionEnabled}
                            onClick={() => onSelectGroup(g.index)}
                            size="sm"
                            title={
                              groupSelectionEnabled
                                ? t("editor.selectGroupHint")
                                : t("editor.selectGroupDisabledHint")
                            }
                            type="button"
                            variant="ghost"
                          >
                            ⌖
                          </Button>
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
