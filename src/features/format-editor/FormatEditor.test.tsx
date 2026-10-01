import { beforeEach, describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { setTestGlobal } from "@/test-globals";

const fixture = (() => {
  const values = new Map<string, string>();
  setTestGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return {
    content: "",
    sourceContent: undefined as string | undefined,
    sourceError: null as string | null,
    props: null as null | {
      changeMarkers: import("./change-markers").FormatChangeMarkers;
      regex: string;
      columns: string[];
      examples: string[];
      onRegexChange: (regex: string) => void;
      onExampleChange: (index: number, text: string) => void;
      onColumnsChange: (columns: string[]) => void;
      onUndo: () => void;
      onRedo: () => void;
      onActiveExampleChange: (index: number) => void;
      onAddExample: () => void;
    },
  };
})();
mock.module("idb-keyval", () => ({ get: mock(), set: mock(), del: mock() }));
mock.module("@/hooks/useWorkspaceFileContent", () => ({
  useWorkspaceFileContent: (params: { contentRefName?: string }) => ({
    data: params.contentRefName ? fixture.sourceContent : fixture.content,
    isLoading: false,
    error: params.contentRefName ? fixture.sourceError : null,
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

const { encodeSmsPayload, serializeFormat } = await import("@/domain/format");
const { useDraftStore, useSourceStore, waitForDraftStoreHydration } =
  await import("@/store");
const { FormatEditor } = await import("./FormatEditor");
const path = "src/Bank/formats/a.txt";
function editRaw(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
  inserted: string,
  inputType = "insertFromPaste"
) {
  const value = textarea.value;
  textarea.setSelectionRange(start, end);
  fireEvent(
    textarea,
    new textarea.ownerDocument.defaultView!.InputEvent("beforeinput", {
      bubbles: true,
      inputType,
      data: inserted,
    })
  );
  fireEvent.change(textarea, {
    target: { value: value.slice(0, start) + inserted + value.slice(end) },
  });
}

describe("one document across editor views", () => {
  beforeEach(async () => {
    await waitForDraftStoreHydration();
    useDraftStore.getState().discardAll();
    useDraftStore.getState().activateScope("editor-test", false);
    useSourceStore
      .getState()
      .setSource({ type: "pr", name: "pr-1", prNumber: 1, sha: "head" });
    fixture.sourceContent = undefined;
    fixture.sourceError = null;
    fixture.content = serializeFormat("^(A)$", ["comment"], ["A"]);
  });
  it("updates section markers through edits, undo and main navigation", () => {
    fixture.sourceContent = serializeFormat("^(.*)$", ["comment"], ["A"]);
    const comparison = { baseSha: "base", status: "changed" as const };
    const view = render(
      <FormatEditor
        filePath={path}
        mode="structured"
        sourceComparison={comparison}
      />
    );
    expect(fixture.props?.changeMarkers).toEqual({
      regex: "source",
      columns: null,
      examples: [null],
    });
    act(() => fixture.props?.onExampleChange(0, "edited"));
    expect(fixture.props?.changeMarkers.examples).toEqual(["local"]);
    act(() => fixture.props?.onUndo());
    expect(fixture.props?.changeMarkers.examples).toEqual([null]);
    act(() => fixture.props?.onRegexChange("^(.+)$"));
    expect(fixture.props?.changeMarkers.regex).toBe("local");
    act(() => fixture.props?.onUndo());
    expect(fixture.props?.changeMarkers.regex).toBe("source");
    act(() =>
      useSourceStore
        .getState()
        .setSource({ type: "main", name: "main", sha: "head" })
    );
    view.rerender(
      <FormatEditor
        filePath={path}
        mode="structured"
        sourceComparison={comparison}
      />
    );
    expect(fixture.props?.changeMarkers).toEqual({
      regex: null,
      columns: null,
      examples: [null],
    });
  });
  it("keeps unknown PR bases unmarked and reports comparison failures", () => {
    fixture.sourceError = "network unavailable";
    render(
      <FormatEditor
        filePath={path}
        mode="structured"
        sourceComparison={{ baseSha: "base", status: "changed" }}
      />
    );
    expect(fixture.props?.changeMarkers).toEqual({
      regex: null,
      columns: null,
      examples: [null],
    });
    expect(screen.getByText(/editor.changeComparisonFailed/)).toBeTruthy();
  });
  it.each([1, 2])(
    "preserves raw original positions with native duplicate insertion at boundary %s",
    (boundary) => {
      fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B", "C"]);
      render(<FormatEditor filePath={path} mode="raw" />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      const markers = Array.from(
        textarea.value.matchAll(/^-----EXAMPLE-----$/gm),
        (match) => match.index
      );
      editRaw(
        textarea,
        markers[boundary]!,
        markers[boundary]!,
        "-----EXAMPLE-----\nB\n\n"
      );
      const expected = boundary === 1 ? [1, null, 2, 3] : [1, 2, null, 3];
      expect(useDraftStore.getState().getDraft(path)?.examplePositions).toEqual(
        expected
      );
      act(() => useDraftStore.getState().undo(path));
      expect(useDraftStore.getState().getDraft(path)?.examplePositions).toEqual(
        [1, 2, 3]
      );
      act(() => useDraftStore.getState().redo(path));
      expect(useDraftStore.getState().getDraft(path)?.examplePositions).toEqual(
        expected
      );
    }
  );
  it.each([1, 2])(
    "uses native selected deletion to distinguish duplicate section %s",
    (removed) => {
      fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B", "C"]);
      render(<FormatEditor filePath={path} mode="raw" />);
      act(() =>
        useDraftStore
          .getState()
          .applyUserEdit(
            path,
            serializeFormat("^(.*)$", ["comment"], ["A", "B", "B", "C"]),
            "head",
            fixture.content,
            [1, 2, null, 3]
          )
      );
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      const markers = Array.from(
        textarea.value.matchAll(/^-----EXAMPLE-----$/gm),
        (match) => match.index
      );
      editRaw(
        textarea,
        markers[removed]!,
        markers[removed + 1]!,
        "",
        "deleteContentBackward"
      );
      expect(useDraftStore.getState().getDraft(path)?.examplePositions).toEqual(
        removed === 1 ? [1, null, 3] : [1, 2, 3]
      );
    }
  );
  it.each(["\r\n", "\r"])(
    "preserves untouched original %j line endings when raw regex changes",
    (newline) => {
      fixture.content = serializeFormat(
        "^(.*)$",
        ["comment"],
        ["SMS\rA", "SMS B"]
      ).replaceAll("\n", newline === "\r" ? "\n" : newline);
      render(<FormatEditor filePath={path} mode="raw" />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      editRaw(textarea, 0, 6, "^(.+)$", "insertText");
      expect(useDraftStore.getState().getDraft(path)?.content).toBe(
        `^(.+)$${fixture.content.slice(6)}`
      );
      expect(useDraftStore.getState().getDraft(path)?.examplePositions).toEqual(
        [1, 2]
      );
    }
  );
  it("preserves raw text edits becoming duplicates and native collapsed deletion", () => {
    fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B", "C"]);
    render(<FormatEditor filePath={path} mode="raw" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    const offset = textarea.value.indexOf("\nB\n") + 1;
    editRaw(textarea, offset, offset + 1, "A", "insertText");
    expect(useDraftStore.getState().getDraft(path)?.examplePositions).toEqual([
      1, 2, 3,
    ]);
    textarea.setSelectionRange(offset + 1, offset + 1);
    fireEvent(
      textarea,
      new textarea.ownerDocument.defaultView!.InputEvent("beforeinput", {
        bubbles: true,
        inputType: "deleteContentBackward",
      })
    );
    fireEvent.change(textarea, {
      target: {
        value:
          textarea.value.slice(0, offset) + textarea.value.slice(offset + 1),
      },
    });
    expect(useDraftStore.getState().getDraft(path)?.examplePositions).toEqual([
      1, 2, 3,
    ]);
  });
  it("maps raw edits after CRLF and standalone CR without changing untouched SMS", () => {
    fixture.content = serializeFormat(
      "^(.*)$",
      ["comment"],
      ["SMS\rA", "SMS B"]
    ).replaceAll("\n", "\r\n");
    render(<FormatEditor filePath={path} mode="raw" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    const offset = textarea.value.indexOf("SMS B") + 4;
    editRaw(textarea, offset, offset + 1, "A", "insertText");
    expect(useDraftStore.getState().getDraft(path)?.content).toBe(
      fixture.content.replace("SMS B", "SMS A")
    );
    expect(useDraftStore.getState().getDraft(path)?.examplePositions).toEqual([
      1, 2,
    ]);
  });
  it("does not apply a pending native edit after switching the document context", () => {
    const view = render(<FormatEditor filePath={path} mode="raw" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 1);
    fireEvent(
      textarea,
      new textarea.ownerDocument.defaultView!.InputEvent("beforeinput", {
        bubbles: true,
        inputType: "insertText",
        data: "X",
      })
    );
    fixture.content = serializeFormat("NEXT", ["comment"], ["new document"]);
    const nextPath = "src/Bank/formats/next.txt";
    view.rerender(<FormatEditor filePath={nextPath} mode="raw" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "obsolete document" },
    });
    expect(useDraftStore.getState().getDraft(nextPath)?.content).toBe(
      fixture.content
    );
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
  const view = render(
    <FormatEditor
      filePath={path}
      mode="structured"
      navigation={{ key: "first", hash: "#show-example=2" }}
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
      navigation={{ key: "deleted", hash: "#show-example=2" }}
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
  const props = (key: string) => ({
    filePath: path,
    mode: "structured" as const,
    navigation: { key, hash: `#show-example=1&add-sms=${payload}` },
  });
  const view = render(<FormatEditor {...props("first")} />);
  expect(fixture.props?.examples).toEqual(["A", "B", sms]);
  expect(fixture.props).toMatchObject({ activeExampleIndex: 2 });
  const documentBeforeReopening = useDraftStore.getState().getDraft(path);
  view.rerender(<FormatEditor {...props("again")} />);
  expect(fixture.props?.examples).toEqual(["A", "B", sms]);
  expect(fixture.props).toMatchObject({ activeExampleIndex: 2 });
  expect(screen.getByText("editor.smsAlreadyExists")).toBeInTheDocument();
  expect(useDraftStore.getState().getDraft(path)).toBe(documentBeforeReopening);
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
  const view = render(
    <FormatEditor
      filePath={path}
      mode="structured"
      navigation={{
        key: "invalid",
        hash: "#show-example=2&add-sms=_w",
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
        navigation={{ key: value, hash: `#show-example=${value}` }}
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
      navigation={{ key: "empty", hash: "" }}
    />
  );
  expect(fixture.props?.examples).toEqual([]);
  expect(fixture.props).toMatchObject({ activeExampleIndex: -1 });
});

it("waits for the target file and protects an existing PR document from imports", () => {
  fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B"]);
  useDraftStore.getState().discardAll();
  useDraftStore.getState().activateScope("protected-test", false);
  const view = render(
    <FormatEditor
      filePath={path}
      mode="structured"
      navigation={{
        key: "late",
        hash: "#add-sms=TkVX",
        targetFile: "other.txt",
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
  const navigation = { key: "ready", hash: "#add-sms=TkVX" };
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
        navigation={{ key: "first", hash: "#add-sms=TkVX" }}
      />
    </StrictMode>
  );
  expect(fixture.props?.examples).toEqual(["A", "B", "C", "NEW"]);
  expect(fixture.props).toMatchObject({ activeExampleIndex: 3 });
});

it("rejects reserved SMS lines without changing restored document, positions or history", () => {
  fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B"]);
  useDraftStore.getState().discardAll();
  useDraftStore.getState().activateScope("reserved-import-test", false);
  useDraftStore
    .getState()
    .applyUserEdit(
      path,
      serializeFormat("^(.*)$", ["comment"], ["A", "local", "edited B"]),
      "head",
      fixture.content,
      [1, null, 2]
    );
  const before = useDraftStore.getState().getDraft(path);
  const sms = "hello\r\n \t-----EXAMPLE----- \t\r\nworld";
  const navigation = {
    key: "first",
    hash: `#add-sms=${encodeSmsPayload(sms)}&show-example=2`,
  };
  const view = render(
    <FormatEditor filePath={path} mode="structured" navigation={navigation} />
  );
  expect(screen.getByText("editor.reservedSmsDelimiter")).toBeInTheDocument();
  expect(fixture.props).toMatchObject({ activeExampleIndex: 2 });
  expect(useDraftStore.getState().getDraft(path)).toBe(before);
  view.unmount();
  render(
    <FormatEditor
      filePath={path}
      mode="structured"
      navigation={{ ...navigation, key: "reopened" }}
    />
  );
  expect(fixture.props?.examples).toEqual(["A", "local", "edited B"]);
  expect(useDraftStore.getState().getDraft(path)).toBe(before);
  act(() => fixture.props?.onUndo());
  expect(fixture.props?.examples).toEqual(["A", "B"]);
});

function EditorLocation() {
  const location = useLocation();
  return <output data-testid="location">{location.hash}</output>;
}

it.each(["", "#show-example=2"])(
  "keeps URL %s unchanged when selecting or adding an Example",
  (hash) => {
    fixture.content = serializeFormat("^(.*)$", ["comment"], ["A", "B"]);
    useDraftStore.getState().discardAll();
    useDraftStore.getState().activateScope("selection-only", false);
    render(
      <MemoryRouter
        initialEntries={[`/format?file=${encodeURIComponent(path)}${hash}`]}
      >
        <FormatEditor filePath={path} mode="structured" />
        <EditorLocation />
      </MemoryRouter>
    );
    expect(fixture.props).toMatchObject({ activeExampleIndex: hash ? 1 : 0 });
    expect(
      screen.queryByRole("button", { name: "editor.copyLink" })
    ).toBeNull();
    act(() => fixture.props?.onActiveExampleChange(hash ? 0 : 1));
    expect(fixture.props).toMatchObject({ activeExampleIndex: hash ? 0 : 1 });
    expect(screen.getByTestId("location").textContent).toBe(hash);
    act(() => fixture.props?.onAddExample());
    expect(fixture.props).toMatchObject({ activeExampleIndex: 2 });
    expect(fixture.props?.examples).toEqual(["A", "B", ""]);
    expect(screen.getByTestId("location").textContent).toBe(hash);
  }
);
