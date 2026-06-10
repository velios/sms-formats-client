import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  draftStore: {
    canRedo: vi.fn(() => false),
    canUndo: vi.fn(() => false),
    getDraft: vi.fn((_filePath?: string) => undefined as unknown),
    markDeleted: vi.fn(),
    redo: vi.fn(),
    resetFileToRemote: vi.fn(),
    setDraft: vi.fn(),
    undo: vi.fn(),
  },
  useWorkspaceFileContent: vi.fn((_params?: unknown) => ({
    data: "BASE CONTENT",
    isLoading: false,
    error: null,
  })),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/components/ui/button", () => ({
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

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

vi.mock("@/hooks/useWorkspaceFileContent", () => ({
  useWorkspaceFileContent: (params: unknown) =>
    mocks.useWorkspaceFileContent(params),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

vi.mock("@/store", () => ({
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

import { WorkspaceHeaderBar } from "./WorkspaceHeaderBar";

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
      sourceDeletedBaseSha={null}
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
    mocks.draftStore.setDraft.mockReset();
    mocks.draftStore.undo.mockReset();
    mocks.useWorkspaceFileContent.mockReset();
    mocks.useWorkspaceFileContent.mockReturnValue({
      data: "BASE CONTENT",
      isLoading: false,
      error: null,
    });
  });

  it("restores a PR-deleted file into a local draft on reset", () => {
    renderHeaderBar({
      selectedFile: "src/TBank_123/formats/deleted.txt",
      sourceDeletedBaseSha: "base-sha",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "editor.resetFileToSource" })
    );

    expect(mocks.draftStore.setDraft).toHaveBeenCalledWith(
      "src/TBank_123/formats/deleted.txt",
      "BASE CONTENT",
      "head-sha",
      ""
    );
    expect(mocks.draftStore.resetFileToRemote).not.toHaveBeenCalled();
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
      remoteContent: "A",
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
