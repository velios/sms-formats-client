import { beforeEach, describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { setTestGlobal } from "@/test-globals";

const fixture = (() => {
  const values = new Map<string, string>();
  setTestGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return {
    content: "",
    props: null as null | {
      regex: string;
      columns: string[];
      examples: string[];
      onRegexChange: (regex: string) => void;
      onExampleChange: (index: number, text: string) => void;
      onColumnsChange: (columns: string[]) => void;
      onUndo: () => void;
      onRedo: () => void;
    },
  };
})();
mock.module("idb-keyval", () => ({ get: mock(), set: mock(), del: mock() }));
mock.module("@/hooks/useWorkspaceFileContent", () => ({
  useWorkspaceFileContent: () => ({
    data: fixture.content,
    isLoading: false,
    error: null,
  }),
}));
mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
mock.module("@/features/regex-lab/RegexLab", () => ({
  RegexLab: (props: NonNullable<typeof fixture.props>) => {
    fixture.props = props;
    return (
      <div data-testid="structured">
        {props.regex}:{props.columns.join(";")}
      </div>
    );
  },
}));

const { serializeFormat } = await import("@/domain/format");
const { useDraftStore, useSourceStore, waitForDraftStoreHydration } =
  await import("@/store");
const { FormatEditor } = await import("./FormatEditor");
const path = "src/Bank/formats/a.txt";
describe("one document across editor views", () => {
  beforeEach(async () => {
    await waitForDraftStoreHydration();
    useDraftStore.getState().discardAll();
    useDraftStore.getState().activateScope("editor-test", false);
    useSourceStore
      .getState()
      .setSource({ type: "pr", name: "pr-1", prNumber: 1, sha: "head" });
    fixture.content = serializeFormat("^(A)$", ["comment"], ["A"]);
  });
  it("accepts the inline execution flag without rewriting the document", () => {
    fixture.content = serializeFormat("(?i)^(код)$", ["comment"], ["КОД"]);
    render(<FormatEditor filePath={path} mode="structured" />);
    expect(screen.queryByText("editor.invalidRegex")).not.toBeInTheDocument();
    expect(fixture.props?.regex).toBe("(?i)^(код)$");
    expect(
      useDraftStore.getState().getDraft(path)?.content ?? fixture.content
    ).toBe(fixture.content);
  });
  it("shares raw and structured edits in one undo/redo history", () => {
    const view = render(<FormatEditor filePath={path} mode="raw" />);
    const rawEdit = serializeFormat("^(B)$", ["comment"], ["B"]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: rawEdit },
    });
    view.rerender(<FormatEditor filePath={path} mode="structured" />);
    expect(screen.getByTestId("structured")).toHaveTextContent("^(B)$:comment");
    act(() => fixture.props?.onColumnsChange(["payee"]));
    act(() => fixture.props?.onUndo());
    expect(fixture.props?.columns).toEqual(["comment"]);
    act(() => fixture.props?.onUndo());
    expect(fixture.props?.regex).toBe("^(A)$");
    act(() => fixture.props?.onRedo());
    view.rerender(<FormatEditor filePath={path} mode="raw" />);
    expect(screen.getByRole("textbox")).toHaveValue(rawEdit);
  });
  it("does not show stale structured fields after a malformed raw edit", () => {
    const view = render(<FormatEditor filePath={path} mode="raw" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "unfinished" },
    });
    view.rerender(<FormatEditor filePath={path} mode="structured" />);
    expect(screen.queryByTestId("structured")).not.toBeInTheDocument();
    expect(
      screen.getByText("editor.structuredUnavailable")
    ).toBeInTheDocument();
    expect(useDraftStore.getState().getDraft(path)?.content).toBe("unfinished");
  });
  it("preserves sequential multiline example input and regex whitespace", () => {
    render(<FormatEditor filePath={path} mode="structured" />);
    act(() => fixture.props?.onExampleChange(0, "A\n"));
    expect(fixture.props?.examples).toEqual(["A\n"]);
    act(() => fixture.props?.onExampleChange(0, "A\nB"));
    act(() => fixture.props?.onRegexChange("A "));
    expect(fixture.props?.regex).toBe("A ");
    expect(fixture.props?.examples).toEqual(["A\nB"]);
  });

  it.each([false, true])(
    "blocks raw history shortcuts when read-only (redo=%s)",
    (redo) => {
      const view = render(<FormatEditor filePath={path} mode="raw" />);
      const edited = serializeFormat("B", ["comment"], ["B"]);
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: edited },
      });
      if (redo) {
        act(() => useDraftStore.getState().undo(path));
      }
      const before = useDraftStore.getState().getDraft(path)?.content;
      view.rerender(<FormatEditor filePath={path} mode="raw" readOnly />);
      fireEvent.keyDown(screen.getByRole("textbox"), {
        key: "z",
        ctrlKey: true,
        shiftKey: redo,
      });
      expect(useDraftStore.getState().getDraft(path)?.content).toBe(before);
      view.rerender(
        <FormatEditor filePath={path} mode="structured" readOnly />
      );
      act(() => (redo ? fixture.props?.onRedo() : fixture.props?.onUndo()));
      expect(useDraftStore.getState().getDraft(path)?.content).toBe(before);
    }
  );
  it("preserves the published baseline when a late draft is rerendered against the old source", () => {
    const committed = serializeFormat(
      "^(COMMITTED)$",
      ["comment"],
      ["COMMITTED"]
    );
    const later = serializeFormat("^(LATER)$", ["comment"], ["LATER"]);
    const view = render(<FormatEditor filePath={path} mode="raw" />);
    act(() =>
      useDraftStore.getState().setDraft(path, later, "published", committed)
    );
    view.rerender(<FormatEditor filePath={path} mode="raw" readOnly />);
    expect(useDraftStore.getState().getDraft(path)).toMatchObject({
      content: later,
      baselineHeadSha: "published",
      headContent: committed,
    });
    expect(screen.getByRole("textbox")).toHaveValue(later);
  });
});
