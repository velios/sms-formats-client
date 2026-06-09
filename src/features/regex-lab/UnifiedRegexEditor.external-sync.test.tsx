import { render } from "@testing-library/react";
import { createRef } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  UnifiedRegexEditor,
  type UnifiedRegexEditorHandle,
} from "./UnifiedRegexEditor";

function editor(
  regex: string,
  onRegexChange: (v: string) => void,
  whitespacePlusMode: boolean
) {
  return (
    <UnifiedRegexEditor
      activeTokenIndex={null}
      canHighlight={false}
      highlightMode="groups"
      highlightPlan={{ lit: [], colorGroups: [] }}
      onRegexChange={onRegexChange}
      ref={createRef<UnifiedRegexEditorHandle>()}
      regex={regex}
      tokens={[]}
      whitespacePlusMode={whitespacePlusMode}
    />
  );
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("внешняя синхронизация regex не считается пользовательской правкой", () => {
  it("смена пропа regex (загрузка/навигация файла) не вызывает onRegexChange", () => {
    const onRegexChange = vi.fn();
    const { rerender } = render(editor("", onRegexChange, false));

    // Имитируем загрузку контента файла: regex приходит из распарсенного файла.
    rerender(editor("^Перевод (.*)$", onRegexChange, false));

    expect(onRegexChange).not.toHaveBeenCalled();
  });

  it("в режиме `\\s+` внешний regex вставляется дословно и не вызывает onRegexChange", () => {
    const onRegexChange = vi.fn();
    const { rerender } = render(editor("", onRegexChange, true));

    // regex со `\s+` (как хранится) — фильтр не должен его трогать.
    rerender(editor("^Перевод\\s+(.*)$", onRegexChange, true));

    expect(onRegexChange).not.toHaveBeenCalled();
  });
});
