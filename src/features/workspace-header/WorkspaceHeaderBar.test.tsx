import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

const mocks = (() => ({
  draftStore: {
    canRedo: mock(() => false),
    canUndo: mock(() => false),
    getDraft: mock((_filePath?: string) => undefined as unknown),
    markDeleted: mock(),
    redo: mock(),
    resetFileToRemote: mock(),
    undo: mock(),
  },
  useWorkspaceFileContent: mock((_params?: unknown) => ({
    data: "BASE CONTENT",
    isLoading: false,
    error: null,
  })),
}))();

mock.module("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

mock.module("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    asChild?: boolean;
  }) => {
    if (asChild) {
      return children;
    }
    return <button {...props}>{children}</button>;
  },
}));

mock.module("@/components/ui/status-badge", () => ({
  StatusBadge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

mock.module("@/hooks/useWorkspaceFileContent", () => ({
  useWorkspaceFileContent: (params: unknown) =>
    mocks.useWorkspaceFileContent(params),
}));

mock.module("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

mock.module("@/store", () => ({
  useDraftStore: () => mocks.draftStore,
  useSourceStore: (selector: (state: unknown) => unknown) =>
    selector({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      sourceRef: {
        type: "pr",
        name: "pr-123",
        sha: "head-sha",
        prNumber: 123,
      },
    }),
}));

const { WorkspaceHeaderBar } = await import("./WorkspaceHeaderBar");

function renderHeaderBar(
  overrides: Partial<Parameters<typeof WorkspaceHeaderBar>[0]> = {}
) {
  return render(
    <WorkspaceHeaderBar
      allFormatFiles={[]}
      bankName="TBank"
      bankRepoUrl="https://github.com/zenmoney/sms-formats/tree/head-sha/src/TBank_123"
      mode="structured"
      onModeChange={() => undefined}
      onRenameFile={() => false}
      readOnly={false}
      selectedFile="src/TBank_123/formats/current.txt"
      sendersPath="src/TBank_123/senders.txt"
      showSenders={false}
      {...overrides}
    />
  );
}

describe("WorkspaceHeaderBar", () => {
  beforeEach(() => {
    mocks.draftStore.canRedo.mockReset();
    mocks.draftStore.canRedo.mockReturnValue(false);
    mocks.draftStore.canUndo.mockReset();
    mocks.draftStore.canUndo.mockReturnValue(false);
    mocks.draftStore.getDraft.mockReset();
    mocks.draftStore.getDraft.mockReturnValue(undefined);
    mocks.draftStore.markDeleted.mockReset();
    mocks.draftStore.redo.mockReset();
    mocks.draftStore.resetFileToRemote.mockReset();
    mocks.draftStore.undo.mockReset();
    mocks.useWorkspaceFileContent.mockReset();
    mocks.useWorkspaceFileContent.mockReturnValue({
      data: "BASE CONTENT",
      isLoading: false,
      error: null,
    });
  });

  it("allows deleting an existing empty file but renames only a local new file", () => {
    mocks.draftStore.getDraft.mockReturnValue({
      content: "",
      headContent: "",
      baselineHeadSha: "head-sha",
    });
    const view = renderHeaderBar();
    expect(
      screen.getByRole("button", { name: "editor.deleteFormat" })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "editor.renameFormat" })
    ).toBeDisabled();
    view.unmount();
    mocks.draftStore.getDraft.mockReturnValue({
      content: "new",
      headContent: null,
      baselineHeadSha: "head-sha",
    });
    const prompt = spyOn(window, "prompt").mockReturnValue("renamed.txt");
    const onRenameFile = mock(() => true);
    renderHeaderBar({ onRenameFile });
    fireEvent.click(
      screen.getByRole("button", { name: "editor.renameFormat" })
    );
    expect(onRenameFile).toHaveBeenCalledWith(
      "src/TBank_123/formats/current.txt",
      "src/TBank_123/formats/renamed.txt"
    );
    prompt.mockRestore();
  });

  it("shows the mode toggle for a format file", () => {
    renderHeaderBar();

    expect(
      screen.getByRole("button", { name: "editor.structured" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "editor.raw" })
    ).toBeInTheDocument();
  });

  it("hides the mode toggle and format-only actions for senders.txt", () => {
    mocks.draftStore.getDraft.mockReturnValue({
      content: "A\nB",
      headContent: "A",
      baseSha: "head-sha",
      isDeleted: false,
    });

    renderHeaderBar({ showSenders: true });

    expect(screen.getByText("senders.txt")).toBeInTheDocument();
    expect(screen.getByText("editor.modified")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "editor.structured" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "editor.raw" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "editor.renameFormat" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "editor.deleteFormat" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "editor.resetFileToSource" })
    ).toBeInTheDocument();
  });
});
