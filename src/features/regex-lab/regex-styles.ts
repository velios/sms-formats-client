import { cn } from "@/lib/utils";

const regexTokenToneClassMap: Record<string, string> = {
  anchor:
    "border-[color:var(--c-tone-anchor-border)] bg-[color:var(--c-tone-anchor-bg)] text-[color:var(--c-tone-anchor-text)]",
  group:
    "border-[color:var(--c-tone-group-border)] bg-[color:var(--c-tone-group-bg)] text-[color:var(--c-tone-group-text)]",
  quantifier:
    "border-[color:var(--c-tone-quantifier-border)] bg-[color:var(--c-tone-quantifier-bg)] text-[color:var(--c-tone-quantifier-text)]",
  alternation:
    "border-[color:var(--c-tone-alternation-border)] bg-[color:var(--c-tone-alternation-bg)] text-[color:var(--c-tone-alternation-text)]",
  escape:
    "border-[color:var(--c-tone-escape-border)] bg-[color:var(--c-tone-escape-bg)] text-[color:var(--c-tone-escape-text)]",
  charclass:
    "border-[color:var(--c-tone-charclass-border)] bg-[color:var(--c-tone-charclass-bg)] text-[color:var(--c-tone-charclass-text)]",
  meta: "border-[color:var(--c-tone-meta-border)] bg-[color:var(--c-tone-meta-bg)] text-[color:var(--c-tone-meta-text)]",
  literal:
    "border-[color:var(--c-tone-literal-border)] bg-[color:var(--c-tone-literal-bg)] text-[color:var(--c-tone-literal-text)]",
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
const matchHighlightHoverClass = "bg-primary-soft";
const matchHighlightRangeActiveClass =
  "outline outline-2 outline-primary outline-offset-[-1px]";
const matchHighlightGroupClassMap = [
  "bg-[color:var(--c-group-1)] shadow-[inset_0_-2px_0_var(--c-group-border-1)]",
  "bg-[color:var(--c-group-2)] shadow-[inset_0_-2px_0_var(--c-group-border-2)]",
  "bg-[color:var(--c-group-3)] shadow-[inset_0_-2px_0_var(--c-group-border-3)]",
  "bg-[color:var(--c-group-4)] shadow-[inset_0_-2px_0_var(--c-group-border-4)]",
  "bg-[color:var(--c-group-5)] shadow-[inset_0_-2px_0_var(--c-group-border-5)]",
];

const progressPrefixClass =
  "rounded-[2px] border border-dashed border-primary bg-primary-soft";
const progressGroupClassMap = [
  "rounded-[2px] border border-dashed border-[color:var(--c-group-border-1)] bg-[color:var(--c-group-1)]",
  "rounded-[2px] border border-dashed border-[color:var(--c-group-border-2)] bg-[color:var(--c-group-2)]",
  "rounded-[2px] border border-dashed border-[color:var(--c-group-border-3)] bg-[color:var(--c-group-3)]",
  "rounded-[2px] border border-dashed border-[color:var(--c-group-border-4)] bg-[color:var(--c-group-4)]",
  "rounded-[2px] border border-dashed border-[color:var(--c-group-border-5)] bg-[color:var(--c-group-5)]",
];
const progressTailClass =
  "rounded-[2px] bg-destructive-soft text-destructive underline decoration-wavy decoration-destructive underline-offset-2";
const progressWaitingClass = "ml-[1px] animate-pulse font-bold text-warning";
const PROGRESS_WAITING_GLYPH = "▏";

function getRegexTokenClass(type: string): string {
  return cn(
    "regex-token",
    regexTokenToneClassMap[type] ?? regexTokenToneClassMap.literal!
  );
}

function getPatternBlockToneClass(type: string): string {
  return patternBlockToneClassMap[type] ?? patternBlockToneClassMap.literal!;
}

export {
  getPatternBlockToneClass,
  getRegexTokenClass,
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
  regexTokenToneClassMap,
};
