import {
  Annotation,
  EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
} from "@codemirror/view";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type {
  HighlightMode,
  PatternHighlightPlan,
  RegexPatternToken,
} from "@/domain/format";

export interface UnifiedRegexEditorHandle {
  /**
   * Insert text into the field. Without `range`: replace the live selection at
   * the caret and refocus (normal snippet insert). With `range`: replace that
   * explicit span and leave the inserted text selected without stealing focus —
   * the group-replacement path, so iterative snippet swaps target the group
   * span, not a drifted caret (ADR-0010).
   */
  insertAtCursor: (text: string, range?: { from: number; to: number }) => void;
}

/* ─── Token decoration state effect ─── */

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
}

const emptyPlan: PatternHighlightPlan = { lit: [], colorGroups: [] };
const emptyDecoState: TokenDecoState = {
  tokens: [],
  activeIndex: null,
  mode: "groups",
  plan: emptyPlan,
  selectedGroupRange: null,
};

// Marks a transaction whose selection we set programmatically (group select /
// toggle-collapse). The update listener skips token/selection resolution for it
// so it does not feed back into the group-toggle logic (see ADR-0010).
const programmaticSelection = Annotation.define<boolean>();

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
  docLength: number
): DecorationSet {
  const { tokens, activeIndex, mode, plan, selectedGroupRange } = decoState;
  if (tokens.length === 0) {
    return Decoration.none;
  }

  const isValid = (token: RegexPatternToken) =>
    token.start < token.end && token.end <= docLength;
  const decorations: Range<Decoration>[] = [];

  if (mode === "groups") {
    // Merge adjacent lit tokens sharing a color group into one solid band so
    // capture-group runs read as a single stripe (no per-token seams).
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
        Decoration.mark({ class: getTokenTypeClass(token.type) }).range(
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

  return Decoration.set(decorations, true);
}

/**
 * The single overlay on top of the band/type fills: a selected capture group's
 * +2 font bump (which also suppresses the outline), otherwise the active
 * token's outline (ADR-0010).
 */
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
  (state) => buildDecorations(state.field(tokenDecoField), state.doc.length)
);

const regexTokenDecorationClassMap: Record<string, string> = {
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

// Solid capture-group bands (match-driven), mirroring the test string's
// fills. Index 0 is the full-match hue (blue, --c-group-0); groups cycle mod 5.
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
  "rounded-[2px] outline outline-2 outline-[#125a96] outline-offset-[-1px]";
// +2 over the 14px base; only safe in this pure-CodeMirror field (ADR-0010).
const selectedGroupFontClass = "text-[16px]";

function getTokenTypeClass(type: string): string {
  return (
    regexTokenDecorationClassMap[type] ?? regexTokenDecorationClassMap.literal!
  );
}

function getGroupBandClass(group: number): string {
  if (group <= 0) {
    return fullMatchBandClass;
  }
  return groupBandClassMap[(group - 1) % groupBandClassMap.length]!;
}

/* ─── Click-on-token via Compartment ─── */

const setTokensForClickEffect = StateEffect.define<RegexPatternToken[]>();

const tokensForClickField = StateField.define<RegexPatternToken[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTokensForClickEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

/* ─── Base theme ─── */

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
  // Thicker dark core + light halo so the caret reads over light bands and over
  // dark accents (active-token outline, group borders) alike (ADR-0010).
  ".cm-cursor": {
    borderLeftColor: "var(--c-text)",
    borderLeftWidth: "2px",
    boxShadow: "0 0 0 1px var(--c-caret-halo)",
  },
  // CodeMirror paints the selection layer at z-index:-1, BEHIND the content —
  // so it sits under the opaque match-driven band fills and is invisible over
  // them. Raise it above the content (the cursor layer stays higher at 150) so
  // the frame reads on every band; pointer-events:none keeps token clicks
  // landing on the content beneath it (ADR-0010).
  ".cm-selectionLayer": {
    zIndex: "1 !important",
    pointerEvents: "none",
  },
  // Manual selection: a translucent dark fill that darkens the band beneath plus
  // a dark neutral frame; single-line field so it is always one seamless
  // rectangle (ADR-0010).
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "var(--c-selection-fill) !important",
    boxShadow: "inset 0 0 0 2px var(--c-selection-frame)",
    borderRadius: "2px",
  },
  // A selected capture group shares this layer but is marked by the +2px font
  // bump instead; suppress both fill and frame so the group gets neither
  // (ADR-0010).
  "&.has-group-selection .cm-selectionBackground": {
    background: "transparent !important",
    boxShadow: "none",
  },
});

/* ─── Single-line filter ─── */

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

/* ─── Component ─── */

interface UnifiedRegexEditorProps {
  regex: string;
  readOnly?: boolean;
  onBlur?: () => void;
  onRegexChange: (value: string) => void;
  tokens: RegexPatternToken[];
  canHighlight: boolean;
  highlightMode: HighlightMode;
  highlightPlan: PatternHighlightPlan;
  activeTokenIndex: number | null;
  /** Bracket span of the selected capture group, or null. Drives a real CM
   * selection + font bump (ADR-0010). */
  selectedGroupRange?: GroupRange | null;
  /** Show a pointer cursor over the content (hovering a group token). */
  showPointerCursor?: boolean;
  onTokenClick?: (tokenIndex: number) => void;
  onTokenHover?: (tokenIndex: number | null) => void;
  /** A real mouse press resolved to a token index (or null when off any
   * token). Distinct from caret-driven `onTokenClick`. */
  onTokenMouseDown?: (tokenIndex: number | null) => void;
  onSelectionChange?: (
    selection: {
      start: number;
      end: number;
    } | null
  ) => void;
}

export const UnifiedRegexEditor = forwardRef<
  UnifiedRegexEditorHandle,
  UnifiedRegexEditorProps
>(function UnifiedRegexEditor(
  {
    regex,
    readOnly = false,
    onBlur,
    onRegexChange,
    tokens,
    canHighlight,
    highlightMode,
    highlightPlan,
    activeTokenIndex,
    selectedGroupRange = null,
    showPointerCursor = false,
    onTokenClick,
    onTokenHover,
    onTokenMouseDown,
    onSelectionChange,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor(text: string, range?: { from: number; to: number }) {
        const view = viewRef.current;
        if (!view) {
          return;
        }
        if (range) {
          // Group replacement: target the explicit span, keep the inserted text
          // selected (it is the group's new span), tag it programmatic so the
          // caret fallback can't light a false highlight, and don't steal focus
          // (the selection stays visible via drawSelection) (ADR-0010).
          view.dispatch({
            changes: { from: range.from, to: range.to, insert: text },
            selection: { anchor: range.from, head: range.from + text.length },
            annotations: programmaticSelection.of(true),
          });
          return;
        }
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },
    }),
    []
  );
  const callbacksRef = useRef({
    onRegexChange,
    onSelectionChange,
    onTokenClick,
    onTokenHover,
    onTokenMouseDown,
  });
  callbacksRef.current = {
    onRegexChange,
    onSelectionChange,
    onTokenClick,
    onTokenHover,
    onTokenMouseDown,
  };

  // Create editor once on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        callbacksRef.current.onRegexChange(update.state.doc.toString());
      }
      // Skip our own programmatic group selection: it must not re-resolve a
      // token and feed back into the group-toggle logic (ADR-0010).
      const isProgrammatic = update.transactions.some((tr) =>
        tr.annotation(programmaticSelection)
      );
      if (!isProgrammatic && (update.selectionSet || update.docChanged)) {
        const sel = update.state.selection.main;
        callbacksRef.current.onSelectionChange?.({
          start: sel.from,
          end: sel.to,
        });
        // Resolve token under cursor for any cursor movement (keyboard or mouse)
        const pos = sel.from;
        const currentTokens = update.state.field(tokensForClickField);
        const tokenIndex = currentTokens.findIndex(
          (t) => pos >= t.start && pos < t.end
        );
        if (tokenIndex >= 0) {
          callbacksRef.current.onTokenClick?.(tokenIndex);
        }
      }
    });

    // A real mouse press drives group selection — distinct from caret-derived
    // token resolution, which also fires on keyboard navigation (ADR-0010).
    const mouseDownHandler = EditorView.domEventHandlers({
      mousedown(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const toks = view.state.field(tokensForClickField);
        const idx =
          pos == null
            ? -1
            : toks.findIndex((t) => pos >= t.start && pos < t.end);
        callbacksRef.current.onTokenMouseDown?.(idx >= 0 ? idx : null);
        return false;
      },
    });

    const state = EditorState.create({
      doc: regex,
      extensions: [
        baseTheme,
        // Renders the selection layer so a selected group stays visible even
        // when the field is not focused (ADR-0010).
        drawSelection(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorState.allowMultipleSelections.of(false),
        tokenDecoField,
        tokensForClickField,
        tokenDecorations,
        updateListener,
        mouseDownHandler,
        singleLineFilter,
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line -- mount once
  }, []);

  // Sync document when regex prop changes externally
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== regex) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: regex },
      });
    }
  }, [regex]);

  // Sync token decorations and click tokens
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const effectiveTokens = canHighlight ? tokens : [];
    const decoState: TokenDecoState = {
      tokens: effectiveTokens,
      activeIndex: canHighlight ? activeTokenIndex : null,
      mode: highlightMode,
      plan: canHighlight ? highlightPlan : emptyPlan,
      selectedGroupRange: canHighlight ? selectedGroupRange : null,
    };
    view.dispatch({
      effects: [
        setTokenDecoEffect.of(decoState),
        setTokensForClickEffect.of(effectiveTokens),
      ],
    });
    // Mirror "a group is selected" onto the root class so CSS can suppress the
    // manual-selection frame for the shared selection layer (ADR-0010).
    view.dom.classList.toggle(
      "has-group-selection",
      decoState.selectedGroupRange != null
    );
  }, [
    tokens,
    canHighlight,
    highlightMode,
    highlightPlan,
    activeTokenIndex,
    selectedGroupRange,
  ]);

  // Drive the real CM selection from the selected group range: select the
  // bracket span, or collapse to a caret when the group is deselected
  // (ADR-0010). Tagged programmatic so it does not re-trigger group toggling.
  const prevSelectedGroupRangeRef = useRef<GroupRange | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const range = selectedGroupRange;
    const docLength = view.state.doc.length;
    if (range && range.start < range.end && range.end <= docLength) {
      const sel = view.state.selection.main;
      if (sel.from !== range.start || sel.to !== range.end) {
        view.dispatch({
          selection: { anchor: range.start, head: range.end },
          annotations: programmaticSelection.of(true),
        });
      }
    } else if (prevSelectedGroupRangeRef.current) {
      // Deselected: collapse the span back to a caret at its anchor.
      const sel = view.state.selection.main;
      view.dispatch({
        selection: { anchor: sel.from },
        annotations: programmaticSelection.of(true),
      });
    }
    prevSelectedGroupRangeRef.current = range;
  }, [selectedGroupRange]);

  // Resolve token under mouse pointer on hover
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) {
      callbacksRef.current.onTokenHover?.(null);
      return;
    }
    const currentTokens = view.state.field(tokensForClickField);
    const idx = currentTokens.findIndex((t) => pos >= t.start && pos < t.end);
    callbacksRef.current.onTokenHover?.(idx >= 0 ? idx : null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    callbacksRef.current.onTokenHover?.(null);
  }, []);

  return (
    <div
      className="flex items-stretch overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--c-border)] bg-[color:var(--c-bg-input)] focus-within:border-[color:var(--c-border-focus)]"
      onBlur={onBlur}
    >
      <span className="select-none px-1.5 pt-2 pb-2 font-[var(--font-mono)] text-[15px] text-[color:var(--c-text-dim)]">
        /
      </span>
      <div className="relative min-w-0 flex-1">
        <div
          className={
            showPointerCursor
              ? "w-full [&_.cm-content]:cursor-pointer"
              : "w-full"
          }
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
          ref={containerRef}
        />
      </div>
      <span className="select-none px-3 pt-2 pb-2 font-[var(--font-mono)] text-[color:var(--c-text-dim)] text-sm">
        /
      </span>
    </div>
  );
});
