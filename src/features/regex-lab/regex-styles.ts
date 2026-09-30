import { cn } from "@/lib/utils";

const regexLabPanelClassName =
  "overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-bg-surface)]";
const regexLabPanelHeaderClassName =
  "flex min-h-10 items-center justify-between border-b border-[color:var(--c-border)] bg-[color:var(--c-bg-elevated)] px-4 py-1 text-[12px] font-semibold uppercase tracking-[0.5px] text-[color:var(--c-text-muted)]";
const regexLabHeaderActionsClassName = "flex flex-wrap items-center gap-2";
const regexLabPanelBodyClassName = "p-4";
const regexLabTabListClassName =
  "flex gap-0 border-b border-[color:var(--c-border)]";
const regexLabHeaderButtonClassName =
  "h-[26px] px-2.5 border-[color:transparent] text-[color:var(--c-text-muted)] shadow-none transition-[color,background-color,border-color,box-shadow] duration-150 hover:border-[color:var(--c-accent-soft)] hover:bg-[color:var(--c-bg-surface)] hover:text-[color:var(--c-accent)] focus-visible:ring-[color:var(--c-border-focus)]";
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
    "rounded-[2px] border border-[color:var(--c-tone-anchor-border)] bg-[color:var(--c-tone-anchor-bg)] px-[1px] font-semibold text-[color:var(--c-tone-anchor-text)]",
  group:
    "rounded-[2px] border border-[color:var(--c-tone-group-border)] bg-[color:var(--c-tone-group-bg)] px-[1px] font-semibold text-[color:var(--c-tone-group-text)]",
  quantifier:
    "rounded-[2px] border border-[color:var(--c-tone-quantifier-border)] bg-[color:var(--c-tone-quantifier-bg)] px-[1px] font-semibold text-[color:var(--c-tone-quantifier-text)]",
  alternation:
    "rounded-[2px] border border-[color:var(--c-tone-alternation-border)] bg-[color:var(--c-tone-alternation-bg)] px-[1px] font-semibold text-[color:var(--c-tone-alternation-text)]",
  escape:
    "rounded-[2px] border border-[color:var(--c-tone-escape-border)] bg-[color:var(--c-tone-escape-bg)] px-[1px] font-semibold text-[color:var(--c-tone-escape-text)]",
  charclass:
    "rounded-[2px] border border-[color:var(--c-tone-charclass-border)] bg-[color:var(--c-tone-charclass-bg)] px-[1px] font-semibold text-[color:var(--c-tone-charclass-text)]",
  meta: "rounded-[2px] border border-[color:var(--c-tone-meta-border)] bg-[color:var(--c-tone-meta-bg)] px-[1px] font-semibold text-[color:var(--c-tone-meta-text)]",
  literal:
    "rounded-[2px] border border-[color:var(--c-tone-literal-border)] bg-[color:var(--c-tone-literal-bg)] px-[1px] font-semibold text-[color:var(--c-tone-literal-text)]",
};
const patternBlockToneClassMap: Record<string, string> = {
  anchor:
    "border-[color:var(--c-tone-anchor-soft-border)] bg-[color:var(--c-tone-anchor-soft-bg)] text-[color:var(--c-tone-anchor-text)]",
  group:
    "border-[color:var(--c-tone-group-soft-border)] bg-[color:var(--c-tone-group-soft-bg)] text-[color:var(--c-tone-group-text)]",
  quantifier:
    "border-[color:var(--c-tone-quantifier-soft-border)] bg-[color:var(--c-tone-quantifier-soft-bg)] text-[color:var(--c-tone-quantifier-text)]",
  alternation:
    "border-[color:var(--c-tone-alternation-soft-border)] bg-[color:var(--c-tone-alternation-soft-bg)] text-[color:var(--c-tone-alternation-text)]",
  escape:
    "border-[color:var(--c-tone-escape-soft-border)] bg-[color:var(--c-tone-escape-soft-bg)] text-[color:var(--c-tone-escape-text)]",
  charclass:
    "border-[color:var(--c-tone-charclass-soft-border)] bg-[color:var(--c-tone-charclass-soft-bg)] text-[color:var(--c-tone-charclass-text)]",
  meta: "border-[color:var(--c-tone-meta-soft-border)] bg-[color:var(--c-tone-meta-soft-bg)] text-[color:var(--c-tone-meta-text)]",
  literal:
    "border-[color:var(--c-tone-literal-soft-border)] bg-[color:var(--c-tone-literal-soft-bg)] text-[color:var(--c-tone-literal-text)]",
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

function getRegexTokenClass(type: string): string {
  return regexTokenToneClassMap[type] ?? regexTokenToneClassMap.literal!;
}

function getPatternBlockToneClass(type: string): string {
  return patternBlockToneClassMap[type] ?? patternBlockToneClassMap.literal!;
}

export {
  getPatternBlockToneClass,
  getRegexTokenClass,
  highlightModeSegmentClassName,
  matchHighlightBaseClass,
  matchHighlightGroupClassMap,
  matchHighlightHoverClass,
  matchHighlightRangeActiveClass,
  PROGRESS_WAITING_GLYPH,
  patternBlockToneClassMap,
  progressGroupClassMap,
  progressPrefixClass,
  progressTailClass,
  progressWaitingClass,
  regexLabHeaderActionsClassName,
  regexLabHeaderButtonClassName,
  regexLabPanelBodyClassName,
  regexLabPanelClassName,
  regexLabPanelHeaderClassName,
  regexLabTabClassName,
  regexLabTabListClassName,
  regexTokenToneClassMap,
};
