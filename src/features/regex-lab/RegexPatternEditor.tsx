import { defaultKeymap } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
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
import { isCapturingGroupOpenerToken } from "@/domain/format";

export interface RegexPatternEditorHandle {
  insertAtCursor: (text: string, range?: { from: number; to: number }) => void;
}

import {
  baseTheme,
  emptyPlan,
  externalSync,
  type GroupRange,
  programmaticSelection,
  setTokenDecoEffect,
  singleLineFilter,
  type TokenDecoState,
  tokenDecoField,
  tokenDecorations,
  whitespacePlusAtomicRanges,
  whitespacePlusInputFilter,
} from "./pattern-editor-extensions";

interface RegexPatternEditorProps {
  regex: string;
  readOnly?: boolean;
  onBlur?: () => void;
  onRegexChange: (value: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  tokens: RegexPatternToken[];
  canHighlight: boolean;
  highlightMode: HighlightMode;
  whitespacePlusMode: boolean;
  highlightPlan: PatternHighlightPlan;
  activeTokenIndex: number | null;
  selectedGroupRange?: GroupRange | null;
  showPointerCursor?: boolean;
  onTokenClick?: (tokenIndex: number) => void;
  onTokenHover?: (tokenIndex: number | null) => void;
  onTokenMouseDown?: (tokenIndex: number | null) => void;
  onSelectionChange?: (
    selection: {
      start: number;
      end: number;
    } | null
  ) => void;
}

export const RegexPatternEditor = forwardRef<
  RegexPatternEditorHandle,
  RegexPatternEditorProps
>(function RegexPatternEditor(
  {
    regex,
    readOnly = false,
    onBlur,
    onRegexChange,
    onUndo,
    onRedo,
    tokens,
    canHighlight,
    highlightMode,
    whitespacePlusMode,
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
    onUndo,
    onRedo,
    onSelectionChange,
    onTokenClick,
    onTokenHover,
    onTokenMouseDown,
  });
  callbacksRef.current = {
    onRegexChange,
    onUndo,
    onRedo,
    onSelectionChange,
    onTokenClick,
    onTokenHover,
    onTokenMouseDown,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      const isExternalSync = update.transactions.some((tr) =>
        // Remote synchronization is not a user edit.
        tr.annotation(externalSync)
      );
      if (update.docChanged && !isExternalSync) {
        callbacksRef.current.onRegexChange(update.state.doc.toString());
      }
      const isProgrammatic = update.transactions.some((tr) =>
        tr.annotation(programmaticSelection)
      );
      if (!isProgrammatic && (update.selectionSet || update.docChanged)) {
        const sel = update.state.selection.main;
        callbacksRef.current.onSelectionChange?.({
          start: sel.from,
          end: sel.to,
        });
        const pos = sel.from;
        const currentTokens = update.state.field(tokenDecoField).tokens;
        const tokenIndex = currentTokens.findIndex(
          (t) => pos >= t.start && pos < t.end
        );
        if (tokenIndex >= 0) {
          callbacksRef.current.onTokenClick?.(tokenIndex);
        }
      }
    });

    const mouseDownHandler = EditorView.domEventHandlers({
      mousedown(event, view) {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        const toks = view.state.field(tokenDecoField).tokens;
        const idx =
          pos == null
            ? -1
            : toks.findIndex((t) => pos >= t.start && pos < t.end);
        if (idx >= 0 && view.state.field(tokenDecoField).mode === "groups") {
          const token = toks[idx]!;
          if (isCapturingGroupOpenerToken(token)) {
            view.dispatch({ selection: { anchor: token.start } });
            callbacksRef.current.onTokenMouseDown?.(null);
            return true;
          }
        }
        callbacksRef.current.onTokenMouseDown?.(idx >= 0 ? idx : null);
        return false;
      },
    });

    const state = EditorState.create({
      doc: regex,
      extensions: [
        baseTheme,
        drawSelection(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorState.allowMultipleSelections.of(false),
        keymap.of([
          {
            key: "Mod-z",
            run: () => {
              callbacksRef.current.onUndo?.();
              return true;
            },
          },
          {
            key: "Mod-Shift-z",
            run: () => {
              callbacksRef.current.onRedo?.();
              return true;
            },
          },
          {
            key: "Mod-y",
            run: () => {
              callbacksRef.current.onRedo?.();
              return true;
            },
          },
          ...defaultKeymap,
        ]),
        tokenDecoField,
        tokenDecorations,
        whitespacePlusAtomicRanges,
        updateListener,
        mouseDownHandler,
        singleLineFilter,
        whitespacePlusInputFilter,
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== regex) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: regex },
        annotations: [
          Transaction.addToHistory.of(false),
          externalSync.of(true),
        ],
      });
    }
  }, [regex]);

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
      whitespacePlusMode,
    };
    view.dispatch({
      effects: [setTokenDecoEffect.of(decoState)],
    });
    view.dom.classList.toggle(
      "has-group-selection",
      decoState.selectedGroupRange != null
    );
  }, [
    tokens,
    canHighlight,
    highlightMode,
    whitespacePlusMode,
    highlightPlan,
    activeTokenIndex,
    selectedGroupRange,
  ]);

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
      const sel = view.state.selection.main;
      view.dispatch({
        selection: { anchor: sel.from },
        annotations: programmaticSelection.of(true),
      });
    }
    prevSelectedGroupRangeRef.current = range;
  }, [selectedGroupRange]);

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
    const currentTokens = view.state.field(tokenDecoField).tokens;
    const idx = currentTokens.findIndex((t) => pos >= t.start && pos < t.end);
    callbacksRef.current.onTokenHover?.(idx >= 0 ? idx : null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    callbacksRef.current.onTokenHover?.(null);
  }, []);

  return (
    <div
      className="flex items-stretch overflow-hidden rounded-md border border-border bg-card focus-within:border-ring"
      onBlur={onBlur}
    >
      <span className="select-none px-1.5 pt-2 pb-2 font-[var(--font-mono)] text-base text-muted-foreground">
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
      <span className="select-none px-3 pt-2 pb-2 font-[var(--font-mono)] text-muted-foreground text-sm">
        /
      </span>
    </div>
  );
});
