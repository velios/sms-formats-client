import {
  EditorState,
  type Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { RegexPatternToken } from "@/domain/format";

export interface UnifiedRegexEditorHandle {
  /** Insert text at the current caret, replacing any selection, then refocus. */
  insertAtCursor: (text: string) => void;
}

/* ─── Token decoration state effect ─── */

interface TokenDecoState {
  tokens: RegexPatternToken[];
  activeIndex: number | null;
}

const emptyDecoState: TokenDecoState = { tokens: [], activeIndex: null };

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
  const { tokens, activeIndex } = decoState;
  if (tokens.length === 0) {
    return Decoration.none;
  }
  const decorations = tokens
    .filter((token) => token.start < token.end && token.end <= docLength)
    .map((token, index) => {
      const cls = getTokenDecoClass(token.type, index === activeIndex);
      return Decoration.mark({ class: cls }).range(token.start, token.end);
    });
  return Decoration.set(decorations, true);
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

function getTokenDecoClass(type: string, active: boolean): string {
  const base =
    regexTokenDecorationClassMap[type] ?? regexTokenDecorationClassMap.literal!;
  return active
    ? `${base} outline outline-2 outline-[#125a96] outline-offset-[-1px]`
    : base;
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
  ".cm-cursor": {
    borderLeftColor: "var(--c-text)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "var(--c-accent-soft) !important",
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
  activeTokenIndex: number | null;
  onTokenClick?: (tokenIndex: number) => void;
  onTokenHover?: (tokenIndex: number | null) => void;
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
    activeTokenIndex,
    onTokenClick,
    onTokenHover,
    onSelectionChange,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor(text: string) {
        const view = viewRef.current;
        if (!view) {
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
  });
  callbacksRef.current = {
    onRegexChange,
    onSelectionChange,
    onTokenClick,
    onTokenHover,
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
      if (update.selectionSet || update.docChanged) {
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

    const state = EditorState.create({
      doc: regex,
      extensions: [
        baseTheme,
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorState.allowMultipleSelections.of(false),
        tokenDecoField,
        tokensForClickField,
        tokenDecorations,
        updateListener,
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
    };
    view.dispatch({
      effects: [
        setTokenDecoEffect.of(decoState),
        setTokensForClickEffect.of(effectiveTokens),
      ],
    });
  }, [tokens, canHighlight, activeTokenIndex]);

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
          className="w-full"
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
