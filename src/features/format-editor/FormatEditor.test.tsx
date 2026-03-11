import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  draftStore: {
    applyUserEdit: vi.fn(),
    canRedo: vi.fn(() => false),
    canUndo: vi.fn(() => false),
    ensureDraft: vi.fn(),
    getDraft: vi.fn(() => undefined),
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

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => <span>spinner</span>,
}));

vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
}));

vi.mock("@/features/regex-lab/RegexLab", () => ({
  RegexLab: () => <div data-testid="regex-lab" />,
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

vi.mock("@/domain/format", () => ({
  parseFormatFile: vi.fn(() => ({
    regex: ".*",
    columns: [],
    examples: ["example"],
    parseIssues: [],
  })),
  serializeFormat: vi.fn(() => ""),
}));

import { FormatEditor } from "./FormatEditor";

describe("FormatEditor", () => {
  beforeEach(() => {
    mocks.draftStore.applyUserEdit.mockReset();
    mocks.draftStore.canRedo.mockReset();
    mocks.draftStore.canRedo.mockReturnValue(false);
    mocks.draftStore.canUndo.mockReset();
    mocks.draftStore.canUndo.mockReturnValue(false);
    mocks.draftStore.ensureDraft.mockReset();
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
    render(
      <FormatEditor
        allFormatFiles={[]}
        filePath="src/TBank_123/formats/deleted.txt"
        onRenameFile={() => false}
        sourceDeletedBaseSha="base-sha"
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "editor.resetFileToSource" })
    );

    expect(mocks.draftStore.setDraft).toHaveBeenCalledWith(
      "src/TBank_123/formats/deleted.txt",
      "BASE CONTENT",
      "head-sha",
      ""
    );
    expect(mocks.draftStore.ensureDraft).not.toHaveBeenCalled();
    expect(mocks.draftStore.resetFileToRemote).not.toHaveBeenCalled();
  });
});
