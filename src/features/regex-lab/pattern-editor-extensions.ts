import {
  Annotation,
  EditorState,
  type Extension,
  type Range,
  RangeSet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import type {
  HighlightMode,
  PatternHighlightPlan,
  RegexPatternToken,
} from "@/domain/format";

import { getRegexTokenClass } from "./regex-styles";

interface GroupRange {
  start: number;
  end: number;
}

interface TokenDecoState {
  tokens: RegexPatternToken[];
  activeIndex: number | null;
  mode: HighlightMode;
  plan: PatternHighlightPlan;
  selectedGroupRange: GroupRange | null;
  whitespacePlusMode: boolean;
}

const emptyPlan: PatternHighlightPlan = { lit: [], colorGroups: [] };
const emptyDecoState: TokenDecoState = {
  tokens: [],
  activeIndex: null,
  mode: "groups",
  plan: emptyPlan,
  selectedGroupRange: null,
  whitespacePlusMode: false,
};

// Replacement widgets need their own group fill: coextensive marks are omitted by CodeMirror.
class WhitespacePlusWidget extends WidgetType {
  readonly fill: string | null;
  constructor(fill: string | null) {
    super();
    this.fill = fill;
  }
  override eq(other: WhitespacePlusWidget) {
    return other.fill === this.fill;
  }
  override toDOM() {
    const span = document.createElement("span");
    span.textContent = " ";
    span.style.backgroundColor = this.fill ?? "";
    return span;
  }
  override ignoreEvent() {
    return false;
  }
}

class LiteralSpaceWidget extends WidgetType {
  readonly fill: string | null;
  constructor(fill: string | null) {
    super();
    this.fill = fill;
  }
  override eq(other: LiteralSpaceWidget) {
    return other.fill === this.fill;
  }
  override toDOM() {
    const span = document.createElement("span");
    span.textContent = "·";
    span.className = "cm-wsplus-literal";
    span.style.backgroundColor = this.fill ?? "";
    return span;
  }
  override ignoreEvent() {
    return false;
  }
}

const whitespacePlusAtomicMarker = Decoration.replace({});

function whitespacePlusPairRanges(
  tokens: RegexPatternToken[]
): { from: number; to: number; tokenIndex: number }[] {
  const ranges: { from: number; to: number; tokenIndex: number }[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i]!;
    const b = tokens[i + 1]!;
    if (
      a.type === "escape" &&
      a.raw === "\\s" &&
      b.type === "quantifier" &&
      b.raw === "+"
    ) {
      ranges.push({ from: a.start, to: b.end, tokenIndex: i });
    }
  }
  return ranges;
}

function charClassStateAt(text: string, pos: number): boolean {
  let inClass = false;
  const limit = Math.min(pos, text.length);
  for (let i = 0; i < limit; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[" && !inClass) {
      inClass = true;
    } else if (ch === "]" && inClass) {
      inClass = false;
    }
  }
  return inClass;
}

function transformInsertedSpaces(s: string, initialInClass: boolean): string {
  let inClass = initialInClass;
  let classOpenedInInsert = false;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\") {
      out += ch + (s[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "[" && !inClass) {
      inClass = true;
      classOpenedInInsert = true;
      out += ch;
      continue;
    }
    if (ch === "]" && inClass) {
      inClass = false;
      classOpenedInInsert = false;
      out += ch;
      continue;
    }
    if (ch === " ") {
      if (!inClass) {
        out += "\\s+";
      } else if (classOpenedInInsert) {
        out += " ";
      }
      continue;
    }
    out += ch;
  }
  return out;
}

const programmaticSelection = Annotation.define<boolean>();

const externalSync = Annotation.define<boolean>();

const setTokenDecoEffect = StateEffect.define<TokenDecoState>();

const tokenDecoField = StateField.define<TokenDecoState>({
  create: () => emptyDecoState,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTokenDecoEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

function buildDecorations(
  decoState: TokenDecoState,
  docLength: number,
  docText: string
): DecorationSet {
  const { tokens, activeIndex, mode, plan, selectedGroupRange } = decoState;
  if (tokens.length === 0) {
    return Decoration.none;
  }

  const isValid = (token: RegexPatternToken) =>
    token.start < token.end && token.end <= docLength;
  const decorations: Range<Decoration>[] = [];

  if (mode === "groups") {
    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i]!;
      if (!(plan.lit[i] && isValid(token))) {
        i++;
        continue;
      }
      const group = plan.colorGroups[i] ?? 0;
      let last = i;
      while (
        last + 1 < tokens.length &&
        plan.lit[last + 1] &&
        isValid(tokens[last + 1]!) &&
        (plan.colorGroups[last + 1] ?? 0) === group
      ) {
        last++;
      }
      decorations.push(
        Decoration.mark({ class: getGroupBandClass(group) }).range(
          token.start,
          tokens[last]!.end
        )
      );
      i = last + 1;
    }
  } else {
    tokens.forEach((token, index) => {
      if (!(plan.lit[index] && isValid(token))) {
        return;
      }
      decorations.push(
        Decoration.mark({ class: getRegexTokenClass(token.type) }).range(
          token.start,
          token.end
        )
      );
    });
  }

  const overlay = buildOverlayDecoration(
    tokens,
    activeIndex,
    selectedGroupRange,
    docLength
  );
  if (overlay) {
    decorations.push(overlay);
  }

  if (decoState.whitespacePlusMode) {
    pushWhitespacePlusDecorations(
      decorations,
      tokens,
      docLength,
      docText,
      mode,
      plan
    );
  }

  return Decoration.set(decorations, true);
}

function groupColorVar(group: number): string {
  if (group <= 0) {
    return "var(--c-group-0)";
  }
  return `var(--c-group-${((group - 1) % 5) + 1})`;
}

function pushWhitespacePlusDecorations(
  decorations: Range<Decoration>[],
  tokens: RegexPatternToken[],
  docLength: number,
  docText: string,
  mode: HighlightMode,
  plan: PatternHighlightPlan
): void {
  for (const r of whitespacePlusPairRanges(tokens)) {
    if (r.to <= docLength) {
      const fill =
        mode === "groups" && plan.lit[r.tokenIndex]
          ? groupColorVar(plan.colorGroups[r.tokenIndex] ?? 0)
          : null;
      decorations.push(
        Decoration.replace({ widget: new WhitespacePlusWidget(fill) }).range(
          r.from,
          r.to
        )
      );
    }
  }
  for (let p = 0; p < docText.length; p++) {
    if (docText[p] !== " ") {
      continue;
    }
    const tokenIndex = tokens.findIndex((t) => p >= t.start && p < t.end);
    const fill =
      mode === "groups" && tokenIndex >= 0 && plan.lit[tokenIndex]
        ? groupColorVar(plan.colorGroups[tokenIndex] ?? 0)
        : null;
    decorations.push(
      Decoration.replace({ widget: new LiteralSpaceWidget(fill) }).range(
        p,
        p + 1
      )
    );
  }
}

function buildOverlayDecoration(
  tokens: RegexPatternToken[],
  activeIndex: number | null,
  selectedGroupRange: GroupRange | null,
  docLength: number
): Range<Decoration> | null {
  if (
    selectedGroupRange &&
    selectedGroupRange.start < selectedGroupRange.end &&
    selectedGroupRange.end <= docLength
  ) {
    return Decoration.mark({ class: selectedGroupFontClass }).range(
      selectedGroupRange.start,
      selectedGroupRange.end
    );
  }
  if (activeIndex != null) {
    const token = tokens[activeIndex];
    if (token && token.start < token.end && token.end <= docLength) {
      return Decoration.mark({ class: activeTokenOutlineClass }).range(
        token.start,
        token.end
      );
    }
  }
  return null;
}

const tokenDecorations = EditorView.decorations.compute(
  [tokenDecoField],
  (state) =>
    buildDecorations(
      state.field(tokenDecoField),
      state.doc.length,
      state.doc.toString()
    )
);

const whitespacePlusAtomicRanges = EditorView.atomicRanges.of((view) => {
  const st = view.state.field(tokenDecoField, false);
  if (!st?.whitespacePlusMode || st.tokens.length === 0) {
    return RangeSet.empty;
  }
  const docLength = view.state.doc.length;
  const ranges = whitespacePlusPairRanges(st.tokens)
    .filter((r) => r.to <= docLength)
    .map((r) => whitespacePlusAtomicMarker.range(r.from, r.to));
  return RangeSet.of(ranges, true);
});

const groupBandClassMap = [
  "rounded-[2px] bg-[color:var(--c-group-1)] shadow-[inset_0_-2px_0_var(--c-group-border-1)] font-semibold",
  "rounded-[2px] bg-[color:var(--c-group-2)] shadow-[inset_0_-2px_0_var(--c-group-border-2)] font-semibold",
  "rounded-[2px] bg-[color:var(--c-group-3)] shadow-[inset_0_-2px_0_var(--c-group-border-3)] font-semibold",
  "rounded-[2px] bg-[color:var(--c-group-4)] shadow-[inset_0_-2px_0_var(--c-group-border-4)] font-semibold",
  "rounded-[2px] bg-[color:var(--c-group-5)] shadow-[inset_0_-2px_0_var(--c-group-border-5)] font-semibold",
];
const fullMatchBandClass =
  "rounded-[2px] bg-[color:var(--c-group-0)] shadow-[inset_0_-2px_0_var(--c-group-border-0)] font-semibold";
const activeTokenOutlineClass =
  "rounded-[2px] outline outline-2 outline-[color:var(--c-accent)] outline-offset-[-1px]";
const selectedGroupFontClass = "text-[16px]";

function getGroupBandClass(group: number): string {
  if (group <= 0) {
    return fullMatchBandClass;
  }
  return groupBandClassMap[(group - 1) % groupBandClassMap.length]!;
}

const baseTheme = EditorView.theme({
  "&": {
    fontSize: "14px",
    fontFamily: "var(--font-mono)",
    lineHeight: "1.4",
    background: "transparent",
  },
  ".cm-content": {
    padding: "8px 4px",
    caretColor: "var(--c-text)",
    color: "var(--c-text)",
    lineHeight: "1.4",
    fontFamily: "var(--font-mono)",
  },
  ".cm-line": {
    padding: "0",
    marginBottom: "2px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--c-text)",
    borderLeftWidth: "2px",
    boxShadow: "0 0 0 1px var(--c-caret-halo)",
  },
  ".cm-selectionLayer": {
    zIndex: "1 !important",
    pointerEvents: "none",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "var(--c-selection-fill) !important",
    boxShadow: "inset 0 0 0 2px var(--c-selection-frame)",
    borderRadius: "2px",
  },
  "&.has-group-selection .cm-selectionBackground": {
    background: "transparent !important",
    boxShadow: "none",
  },
  ".cm-wsplus-literal": {
    color: "var(--c-warning)",
    textDecoration: "underline dotted var(--c-warning)",
    textUnderlineOffset: "2px",
  },
});

const singleLineFilter: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) {
    return tr;
  }
  const newDoc = tr.newDoc.toString();
  if (newDoc.includes("\n")) {
    return [];
  }
  return tr;
});

const whitespacePlusInputFilter: Extension = EditorState.transactionFilter.of(
  (tr) => {
    if (!tr.docChanged || tr.annotation(externalSync)) {
      return tr;
    }
    const st = tr.startState.field(tokenDecoField, false);
    if (!st?.whitespacePlusMode) {
      return tr;
    }
    const oldDoc = tr.startState.doc.toString();
    const specs: { from: number; to: number; insert: string }[] = [];
    let touched = false;
    let lastInsertEnd: number | null = null;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const text = inserted.toString();
      if (!text.includes(" ")) {
        specs.push({ from: fromA, to: toA, insert: text });
        lastInsertEnd = fromA + text.length;
        return;
      }
      const transformed = transformInsertedSpaces(
        text,
        charClassStateAt(oldDoc, fromA)
      );
      if (transformed !== text) {
        touched = true;
      }
      specs.push({ from: fromA, to: toA, insert: transformed });
      lastInsertEnd = fromA + transformed.length;
    });
    if (!touched) {
      return tr;
    }
    return specs.length === 1 && lastInsertEnd != null
      ? { changes: specs, selection: { anchor: lastInsertEnd } }
      : { changes: specs };
  }
);

export {
  baseTheme,
  emptyPlan,
  externalSync,
  programmaticSelection,
  setTokenDecoEffect,
  singleLineFilter,
  tokenDecoField,
  tokenDecorations,
  whitespacePlusAtomicRanges,
  whitespacePlusInputFilter,
};
export type { GroupRange, TokenDecoState };
