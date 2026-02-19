import {
  EditorState,
  type Extension,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { RegexPatternToken } from "@/domain/format";

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

function getTokenDecoClass(type: string, active: boolean): string {
  const base = `regex-token regex-token--${type}`;
  return active ? `${base} regex-token--active` : base;
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
  onRegexChange: (value: string) => void;
  tokens: RegexPatternToken[];
  canHighlight: boolean;
  activeTokenIndex: number | null;
  onTokenClick?: (tokenIndex: number) => void;
  onSelectionChange?: (
    selection: {
      start: number;
      end: number;
    } | null
  ) => void;
}

export function UnifiedRegexEditor({
  regex,
  onRegexChange,
  tokens,
  canHighlight,
  activeTokenIndex,
  onTokenClick,
  onSelectionChange,
}: UnifiedRegexEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacksRef = useRef({
    onRegexChange,
    onSelectionChange,
    onTokenClick,
  });
  callbacksRef.current = { onRegexChange, onSelectionChange, onTokenClick };

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

  return (
    <div className="regex-input-wrap">
      <span className="regex-input-wrap__slash">/</span>
      <div className="regex-input-wrap__editor">
        <div className="unified-regex-cm" ref={containerRef} />
      </div>
      <span className="regex-input-wrap__flags">/</span>
    </div>
  );
}
