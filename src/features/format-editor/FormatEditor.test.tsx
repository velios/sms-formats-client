import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeFormat } from "@/domain/format";
import {
  useDraftStore,
  useSourceStore,
  waitForDraftStoreHydration,
} from "@/store";
import { FormatEditor } from "./FormatEditor";

const fixture = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return {
    content: "",
    props: null as null | {
      regex: string;
      columns: string[];
      onColumnsChange: (columns: string[]) => void;
      onUndo: () => void;
      onRedo: () => void;
    },
  };
});
vi.mock("idb-keyval", () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));
vi.mock("@/hooks/useWorkspaceFileContent", () => ({
  useWorkspaceFileContent: () => ({
    data: fixture.content,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/features/regex-lab/RegexLab", () => ({
  RegexLab: (props: NonNullable<typeof fixture.props>) => {
    fixture.props = props;
    return (
      <div data-testid="structured">
        {props.regex}:{props.columns.join(";")}
      </div>
    );
  },
}));
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
});
