import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { RegexPatternAnalysis } from "@/domain/format";
import { QuickReference } from "@/features/quick-reference/QuickReference";
import { SnippetsPanel } from "@/features/snippet-library/SnippetsPanel";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";

import { getPatternBlockToneClass, getRegexTokenClass } from "./regex-styles";
export function PatternExplanationPane({
  activePatternTokenIndex,
  errorMessage,
  explanation,
  onInsertSnippet,
  onPatternTokenActivate,
  onPatternTokenHover,
  readOnly,
}: {
  activePatternTokenIndex: number | null;
  errorMessage: string | null;
  explanation: RegexPatternAnalysis;
  onInsertSnippet: (pattern: string) => void;
  onPatternTokenActivate: (tokenIndex: number) => void;
  onPatternTokenHover: (tokenIndex: number | null) => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const rightPaneTab = useUIStore((state) => state.rightPaneTab);
  const setRightPaneTab = useUIStore((state) => state.setRightPaneTab);

  return (
    <div className={cn("ui-panel", "flex min-h-0 flex-col")}>
      <div className={cn("ui-panel-heading", "justify-start px-0 py-0")}>
        <div className={cn("ui-tabs", "w-full border-b-0")}>
          {!readOnly && (
            <button
              className="ui-tab"
              data-active={rightPaneTab === "snippets"}
              onClick={() => setRightPaneTab("snippets")}
              type="button"
            >
              {t("snippets.open").toUpperCase()}
            </button>
          )}
          <button
            className="ui-tab"
            data-active={rightPaneTab === "explanation"}
            onClick={() => setRightPaneTab("explanation")}
            type="button"
          >
            {t("editor.explanation").toUpperCase()}
          </button>
          <button
            className="ui-tab"
            data-active={rightPaneTab === "quickref"}
            onClick={() => setRightPaneTab("quickref")}
            type="button"
          >
            QUICK REF
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {rightPaneTab === "explanation" && (
          <ExplanationPanel
            activePatternTokenIndex={activePatternTokenIndex}
            errorMessage={errorMessage}
            explanation={explanation}
            onPatternTokenActivate={onPatternTokenActivate}
            onPatternTokenHover={onPatternTokenHover}
          />
        )}
        {rightPaneTab === "quickref" && <QuickReference />}
        {rightPaneTab === "snippets" && !readOnly && (
          <SnippetsPanel onInsert={onInsertSnippet} />
        )}
      </div>
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
  explanation: RegexPatternAnalysis;
  errorMessage: string | null;
  activePatternTokenIndex: number | null;
  onPatternTokenActivate: (tokenIndex: number) => void;
  onPatternTokenHover: (tokenIndex: number | null) => void;
}) {
  const { t } = useTranslation();
  const tokenRefs = useRef<Map<number, HTMLDivElement>>(new Map());

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
    <div className="ui-panel-body flex h-full min-h-0 flex-col overflow-y-auto text-xs leading-[18px]">
      {errorMessage ? (
        <div className="rounded-md bg-destructive-soft px-3 py-2 text-destructive text-xs">
          {cleanRegexErrorReason(errorMessage)}
        </div>
      ) : explanation.patternTokens.length === 0 ? (
        <div className="text-muted-foreground text-xs">—</div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="font-medium text-muted-foreground text-xs">
            {t("editor.patternParts")}
          </div>
          {explanation.patternTokens.map((token, index) => (
            <div
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md border p-2 transition-colors",
                getPatternBlockToneClass(token.type),
                index === activePatternTokenIndex &&
                  "outline outline-2 outline-primary outline-offset-[-1px]"
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
              <span className="min-w-0 flex-1 text-xs">
                {token.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function cleanRegexErrorReason(message: string): string {
  const marker = message.lastIndexOf(": ");
  return marker === -1 ? message : message.slice(marker + 2);
}
