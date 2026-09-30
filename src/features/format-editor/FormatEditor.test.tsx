import { beforeEach, describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
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

it("applies source anchors after restored raw edits, and never restores a deleted Example", () => {
  fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B", "C"]);
  useDraftStore.getState().discardAll();
  useDraftStore.getState().activateScope("anchor-test", false);
  const edited = serializeFormat(
    "^(.*)$",
    ["comment"],
    ["A", "local", "edited B", "C"]
  );
  useDraftStore
    .getState()
    .applyUserEdit(path, edited, "head", fixture.content, [1, null, 2, 3]);
  const select = mock();
  const view = render(
    <FormatEditor
      filePath={path}
      mode="structured"
      navigation={{ key: "first", hash: "#show-example=2", select }}
    />
  );
  expect(fixture.props).toMatchObject({ activeExampleIndex: 2 });
  act(() =>
    useDraftStore
      .getState()
      .applyUserEdit(
        path,
        serializeFormat("^(.*)$", ["comment"], ["A", "local", "C"]),
        "head",
        fixture.content,
        [1, null, 3]
      )
  );
  view.rerender(
    <FormatEditor
      filePath={path}
      mode="structured"
      navigation={{ key: "deleted", hash: "#show-example=2", select }}
    />
  );
  expect(fixture.props).toMatchObject({ activeExampleIndex: 0 });
  expect(screen.getByText("editor.exampleDeleted")).toBeInTheDocument();
  expect(fixture.props?.examples).toEqual(["A", "local", "C"]);
});

it("imports exact SMS once per entry, allows reimport after edits, and follows payload priority", () => {
  fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B"]);
  useDraftStore.getState().discardAll();
  useDraftStore.getState().activateScope("import-test", false);
  const sms = " \nКод 😀\r\n ";
  const payload = btoa(
    Array.from(new TextEncoder().encode(sms), (byte) =>
      String.fromCharCode(byte)
    ).join("")
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/[=]+$/, "");
  const select = mock();
  const props = (key: string) => ({
    filePath: path,
    mode: "structured" as const,
    navigation: { key, hash: `#show-example=1&add-sms=${payload}`, select },
  });
  const view = render(<FormatEditor {...props("first")} />);
  expect(fixture.props?.examples).toEqual(["A", "B", sms]);
  expect(fixture.props).toMatchObject({ activeExampleIndex: 2 });
  view.rerender(<FormatEditor {...props("again")} />);
  expect(fixture.props?.examples).toEqual(["A", "B", sms]);
  act(() => fixture.props?.onExampleChange(2, "edited SMS"));
  view.rerender(<FormatEditor {...props("reimport")} />);
  expect(fixture.props?.examples).toEqual(["A", "B", "edited SMS", sms]);
  expect(useDraftStore.getState().getDraft(path)?.examplePositions).toEqual([
    1,
    2,
    null,
    null,
  ]);
});

it("reports malformed anchors, falls back to first Example and keeps an empty list empty", () => {
  useDraftStore.getState().discardAll();
  useDraftStore.getState().activateScope("invalid-test", false);
  fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B"]);
  const select = mock();
  const view = render(
    <FormatEditor
      filePath={path}
      mode="structured"
      navigation={{
        key: "invalid",
        hash: "#show-example=2&add-sms=_w",
        select,
      }}
    />
  );
  expect(fixture.props).toMatchObject({ activeExampleIndex: 1 });
  expect(screen.getByText("editor.invalidSmsPayload")).toBeInTheDocument();
  for (const value of ["", "0", "-1", "1.5", "abc"]) {
    view.rerender(
      <FormatEditor
        filePath={path}
        mode="structured"
        navigation={{ key: value, hash: `#show-example=${value}`, select }}
      />
    );
    expect(fixture.props).toMatchObject({ activeExampleIndex: 0 });
    expect(screen.getByText("editor.invalidExampleNumber")).toBeInTheDocument();
  }
  act(() =>
    useDraftStore
      .getState()
      .setDraft(
        path,
        serializeFormat("^(.*)$", ["comment"], []),
        "head",
        fixture.content
      )
  );
  view.rerender(
    <FormatEditor
      filePath={path}
      mode="structured"
      navigation={{ key: "empty", hash: "", select }}
    />
  );
  expect(fixture.props?.examples).toEqual([]);
  expect(fixture.props).toMatchObject({ activeExampleIndex: -1 });
});

it("waits for the target file and protects an existing PR document from imports", () => {
  fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B"]);
  useDraftStore.getState().discardAll();
  useDraftStore.getState().activateScope("protected-test", false);
  const select = mock();
  const view = render(
    <FormatEditor
      filePath={path}
      mode="structured"
      navigation={{
        key: "late",
        hash: "#add-sms=TkVX",
        targetFile: "other.txt",
        select,
      }}
    />
  );
  expect(fixture.props?.examples).toEqual(["A", "B"]);
  view.rerender(
    <FormatEditor
      filePath={path}
      mode="structured"
      navigation={{
        key: "protected",
        hash: "#add-sms=TkVX",
        targetFile: path,
        select,
      }}
      readOnly
    />
  );
  expect(fixture.props?.examples).toEqual(["A", "B"]);
  expect(screen.getByText("editor.importReadOnly")).toBeInTheDocument();
});

it("waits for PR session readiness before importing into a temporarily protected document", () => {
  fixture.content = serializeFormat("^(.*)$", ["comment"], ["A"]);
  useDraftStore.getState().discardAll();
  useDraftStore.getState().activateScope("ready-test", false);
  const navigation = { key: "ready", hash: "#add-sms=TkVX", select: mock() };
  const view = render(
    <FormatEditor
      anchorReady={false}
      filePath={path}
      mode="structured"
      navigation={navigation}
      readOnly
    />
  );
  expect(fixture.props?.examples).toEqual(["A"]);
  view.rerender(
    <FormatEditor
      anchorReady
      filePath={path}
      mode="structured"
      navigation={navigation}
    />
  );
  expect(fixture.props?.examples).toEqual(["A", "NEW"]);
  expect(fixture.props).toMatchObject({ activeExampleIndex: 1 });
});

it("selects the imported Example on the first StrictMode mount without duplicating it", () => {
  fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B", "C"]);
  useDraftStore.getState().discardAll();
  useDraftStore.getState().activateScope("strict-test", false);
  render(
    <StrictMode>
      <FormatEditor
        filePath={path}
        mode="structured"
        navigation={{ key: "first", hash: "#add-sms=TkVX", select: mock() }}
      />
    </StrictMode>
  );
  expect(fixture.props?.examples).toEqual(["A", "B", "C", "NEW"]);
  expect(fixture.props).toMatchObject({ activeExampleIndex: 3 });
});
