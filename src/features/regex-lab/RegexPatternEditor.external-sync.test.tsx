import { beforeAll, describe, expect, it, mock } from "bun:test";
import { render } from "@testing-library/react";
import { createRef } from "react";
import {
  RegexPatternEditor,
  type RegexPatternEditorHandle,
} from "./RegexPatternEditor";

function editor(
  regex: string,
  onRegexChange: (v: string) => void,
  whitespacePlusMode: boolean
) {
  return (
    <RegexPatternEditor
      activeTokenIndex={null}
      canHighlight={false}
      highlightMode="groups"
      highlightPlan={{ lit: [], colorGroups: [] }}
      onRegexChange={onRegexChange}
      ref={createRef<RegexPatternEditorHandle>()}
      regex={regex}
      tokens={[]}
      whitespacePlusMode={whitespacePlusMode}
    />
  );
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = mock();
});

describe("внешняя синхронизация regex не считается пользовательской правкой", () => {
  it("смена пропа regex (загрузка/навигация файла) не вызывает onRegexChange", () => {
    const onRegexChange = mock();
    const { rerender } = render(editor("", onRegexChange, false));

    // Имитируем загрузку контента файла: regex приходит из распарсенного файла.
    rerender(editor("^Перевод (.*)$", onRegexChange, false));

    expect(onRegexChange).not.toHaveBeenCalled();
  });

  it("в режиме `\\s+` внешний regex вставляется дословно и не вызывает onRegexChange", () => {
    const onRegexChange = mock();
    const { rerender } = render(editor("", onRegexChange, true));

    // regex со `\s+` (как хранится) — фильтр не должен его трогать.
    rerender(editor("^Перевод\\s+(.*)$", onRegexChange, true));

    expect(onRegexChange).not.toHaveBeenCalled();
  });
});
