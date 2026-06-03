import { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  UnifiedRegexEditor,
  type UnifiedRegexEditorHandle,
} from "./UnifiedRegexEditor";

function setup(regex: string, onRegexChange = vi.fn()) {
  const ref = createRef<UnifiedRegexEditorHandle>();
  const { container } = render(
    <UnifiedRegexEditor
      activeTokenIndex={null}
      canHighlight={false}
      highlightMode="groups"
      highlightPlan={{ lit: [], colorGroups: [] }}
      onRegexChange={onRegexChange}
      ref={ref}
      regex={regex}
      tokens={[]}
      whitespacePlusMode={false}
    />
  );
  const content = container.querySelector(".cm-content");
  if (!content) {
    throw new Error("CodeMirror content DOM not found");
  }
  const view = EditorView.findFromDOM(content as HTMLElement);
  if (!view) {
    throw new Error("EditorView not found");
  }
  return { ref, view, onRegexChange };
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("UnifiedRegexEditor.insertAtCursor", () => {
  it("inserts at the caret position", () => {
    const { ref, view, onRegexChange } = setup("ab");
    view.dispatch({ selection: { anchor: 1 } });

    ref.current?.insertAtCursor("X");

    expect(view.state.doc.toString()).toBe("aXb");
    expect(view.state.selection.main.head).toBe(2);
    expect(onRegexChange).toHaveBeenLastCalledWith("aXb");
  });

  it("replaces the current selection", () => {
    const { ref, view } = setup("ab");
    view.dispatch({ selection: { anchor: 0, head: 2 } });

    ref.current?.insertAtCursor("(\\d+)");

    expect(view.state.doc.toString()).toBe("(\\d+)");
  });

  it("inserts at the remembered caret even after the editor loses focus", () => {
    const { ref, view } = setup("ab");
    view.dispatch({ selection: { anchor: 1 } });
    view.contentDOM.blur();

    ref.current?.insertAtCursor("X");

    expect(view.state.doc.toString()).toBe("aXb");
  });
});
