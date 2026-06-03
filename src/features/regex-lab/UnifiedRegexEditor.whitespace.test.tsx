import { cursorCharLeft, deleteCharBackward } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PatternHighlightPlan } from "@/domain/format";
import {
  buildPatternHighlightPlan,
  buildTokenToCaptureGroupMap,
  explainRegex,
  recognitionProgress,
  testRegex,
} from "@/domain/format";
import {
  UnifiedRegexEditor,
  type UnifiedRegexEditorHandle,
} from "./UnifiedRegexEditor";

// Real highlight plan (lit + colorGroups) for the given pattern against an SMS,
// mirroring src/domain/format/pattern-highlight.test.ts.
function planFor(pattern: string, sms: string): PatternHighlightPlan {
  const tokens = explainRegex(pattern, "en").patternTokens;
  const map = buildTokenToCaptureGroupMap(tokens);
  const matchResult = testRegex(pattern, sms);
  const progress = matchResult.matched
    ? null
    : recognitionProgress(pattern, sms);
  return buildPatternHighlightPlan(tokens, map, matchResult, progress);
}

function setup(
  regex: string,
  whitespacePlusMode = true,
  withTokens = false,
  plan: PatternHighlightPlan = { lit: [], colorGroups: [] }
) {
  const ref = createRef<UnifiedRegexEditorHandle>();
  const tokens = withTokens ? explainRegex(regex, "ru").patternTokens : [];
  const { container } = render(
    <UnifiedRegexEditor
      activeTokenIndex={null}
      canHighlight={withTokens}
      highlightMode="groups"
      highlightPlan={plan}
      onRegexChange={vi.fn()}
      ref={ref}
      regex={regex}
      tokens={tokens}
      whitespacePlusMode={whitespacePlusMode}
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
  return { ref, view, content };
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("режим `\\s+`: правило ввода", () => {
  it("печать пробела вставляет `\\s+` и ставит каретку после него", () => {
    const { view } = setup("ab");
    view.dispatch({
      changes: { from: 2, insert: " " },
      selection: { anchor: 3 },
    });

    expect(view.state.doc.toString()).toBe("ab\\s+");
    expect(view.state.selection.main.head).toBe(5);
  });

  it("вставка текста с пробелами конвертит каждый пробел в `\\s+`", () => {
    const { view } = setup("");
    view.dispatch({ changes: { from: 0, insert: "a b c" } });

    expect(view.state.doc.toString()).toBe("a\\s+b\\s+c");
  });

  it("пробел внутри существующего класса `[...]` блокируется", () => {
    const { view } = setup("[a]");
    view.dispatch({ changes: { from: 2, insert: " " } });

    expect(view.state.doc.toString()).toBe("[a]");
  });

  it("пробел в классе, открытом самим вставляемым текстом, сохраняется литералом", () => {
    const { view } = setup("");
    view.dispatch({ changes: { from: 0, insert: "[-. ]x y" } });

    expect(view.state.doc.toString()).toBe("[-. ]x\\s+y");
  });

  it("при выключенном режиме пробел остаётся литеральным", () => {
    const { view } = setup("ab", false);
    view.dispatch({ changes: { from: 2, insert: " " } });

    expect(view.state.doc.toString()).toBe("ab ");
  });
});

describe("режим `\\s+`: отображение", () => {
  it("`\\s+` рисуется визуальным пробелом, а не литералом `\\s+`", () => {
    const { view, content } = setup("a\\s+b", true, true);

    // Документ остаётся каноническим regex.
    expect(view.state.doc.toString()).toBe("a\\s+b");
    // А в DOM `\s+` свёрнут в один пробел.
    expect(content.textContent).toBe("a b");
  });

  it("литеральный пробел рисуется точкой `·`", () => {
    const { view, content } = setup("a b", true, true);

    expect(view.state.doc.toString()).toBe("a b");
    expect(content.textContent).toBe("a·b");
  });
});

describe("режим `\\s+`: атомарность (зависит от keymap @codemirror/commands)", () => {
  it("Backspace сносит весь `\\s+` целиком", () => {
    const { view } = setup("a\\s+", true, true);
    view.dispatch({ selection: { anchor: 4 } });

    deleteCharBackward(view);

    expect(view.state.doc.toString()).toBe("a");
  });

  it("стрелка влево перепрыгивает весь `\\s+` за один шаг", () => {
    const { view } = setup("a\\s+", true, true);
    view.dispatch({ selection: { anchor: 4 } });

    cursorCharLeft(view);

    expect(view.state.selection.main.head).toBe(1);
  });
});

describe("режим `\\s+`: заливка виджета (фикс белого шва)", () => {
  it("`\\s+`-коннектор между группами несёт плоский фон в режиме «Группы»", () => {
    const plan = planFor("(\\d+)\\s+(\\d+)", "12 34");
    const { content } = setup("(\\d+)\\s+(\\d+)", true, true, plan);

    const widget = [...content.querySelectorAll("span")].find(
      (s) => s.textContent === " " && s.style.backgroundColor !== ""
    );
    expect(widget).toBeDefined();
    expect(widget?.style.backgroundColor).toContain("--c-group-");
  });
});
