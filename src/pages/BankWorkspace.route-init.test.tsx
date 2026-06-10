import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactElement, type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const routeState = {
    location: {
      pathname: "/repo/zenmoney/sms-formats/pr/123",
      search: "?file=src/TBank_123/formats/current.txt",
    },
    params: {
      owner: "zenmoney",
      repo: "sms-formats",
      prNumber: "123",
    },
    navigate: vi.fn(),
  };

  const tree = [
    { path: "src/TBank_123", sha: "tree-sha", type: "tree" as const },
    {
      path: "src/TBank_123/formats/current.txt",
      sha: "current-sha",
      type: "blob" as const,
    },
    {
      path: "src/TBank_123/formats/another.txt",
      sha: "another-sha",
      type: "blob" as const,
    },
    {
      path: "src/TBank_123/senders.txt",
      sha: "senders-sha",
      type: "blob" as const,
    },
  ];

  const banks = [
    {
      displayName: "TBank",
      folderPath: "src/TBank_123",
      bankId: "123",
      formatFiles: [
        "src/TBank_123/formats/current.txt",
        "src/TBank_123/formats/another.txt",
      ],
      hasSenders: true,
    },
  ];

  const sourceState = {
    repository: { owner: "zenmoney", repo: "sms-formats" },
    sourceRef: null as {
      type: "pr";
      name: string;
      sha: string;
      prNumber: number;
    } | null,
    sourceChangedFiles: [] as string[],
    tree: [] as typeof tree,
    banks: [] as typeof banks,
    loading: false,
    error: null as string | null,
    setRepository: vi.fn((repository: { owner: string; repo: string }) => {
      sourceState.repository = repository;
    }),
    setSource: vi.fn(
      (
        sourceRef: {
          type: "pr";
          name: string;
          sha: string;
          prNumber: number;
        } | null
      ) => {
        sourceState.sourceRef = sourceRef;
      }
    ),
    setSourceChangedFiles: vi.fn((files: string[]) => {
      sourceState.sourceChangedFiles = files;
    }),
    setTree: vi.fn((nextTree: typeof tree) => {
      sourceState.tree = nextTree;
    }),
    setBanks: vi.fn((nextBanks: typeof banks) => {
      sourceState.banks = nextBanks;
    }),
    setLoading: vi.fn((loading: boolean) => {
      sourceState.loading = loading;
    }),
    setError: vi.fn((error: string | null) => {
      sourceState.error = error;
    }),
  };

  const useSourceStore = (<T,>(selector: (state: typeof sourceState) => T) =>
    selector(sourceState)) as ((
    selector: (state: typeof sourceState) => unknown
  ) => unknown) & { getState: () => typeof sourceState };
  useSourceStore.getState = () => sourceState;

  const draftState = {
    drafts: new Map<string, unknown>(),
    hasHydrated: true,
    getStoredDraftsForScope: vi.fn(() => []),
    activateScope: vi.fn(),
    getChangedFiles: vi.fn<
      () => Array<{
        filePath: string;
        content: string;
        isDeleted: boolean;
        baseSha: string;
      }>
    >(() => []),
    getDeletedFiles: vi.fn(() => []),
    getDraft: vi.fn(() => undefined),
    resetBankToRemote: vi.fn(),
    discardAll: vi.fn(),
    clearAll: vi.fn(),
    renameDraft: vi.fn(),
  };

  const useDraftStore = (() => draftState) as (() => typeof draftState) & {
    getState: () => typeof draftState;
  };
  useDraftStore.getState = () => draftState;

  return {
    fetchPullRequestApprovalByCurrentUser: vi.fn(() => Promise.resolve(false)),
    banks,
    clearWorkspaceSession: vi.fn(),
    draftState,
    fetchPullRequestFiles: vi.fn(() => Promise.resolve([])),
    fetchRepoTree: vi.fn(() => Promise.resolve(tree)),
    fileContentStore: {
      getCachedFileContent: vi.fn(() => undefined),
      invalidatePullRequestFileContents: vi.fn(),
      primeFileContent: vi.fn(() => Promise.resolve(null)),
      setFileContentEntry: vi.fn(),
    },
    getCachedPullRequestApprovalPermission: vi.fn(() => false),
    getGitHubAuthChangeVersion: vi.fn(() => 0),
    indexBanksFromTree: vi.fn(() => banks),
    loadWorkspaceSession: vi.fn<() => unknown>(() => null),
    resolvePullRequestWorkspace: vi.fn(() =>
      Promise.resolve({
        status: "supported" as const,
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        headSha: "head-sha",
        bankPath: "src/TBank_123",
        writable: true,
        readOnlyReason: null,
        changedFiles: [
          {
            kind: "modify" as const,
            path: "src/TBank_123/formats/current.txt",
          },
          {
            kind: "modify" as const,
            path: "src/TBank_123/formats/another.txt",
          },
        ],
      })
    ),
    refreshPullRequestApprovalPermission: vi.fn(() => Promise.resolve(false)),
    routeState,
    saveWorkspaceSession: vi.fn(),
    sourceState,
    subscribeGitHubAuthChange: vi.fn(() => () => undefined),
    tree,
    updatePullRequestHead: vi.fn(),
    useDraftStore,
    useSourceStore,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => mocks.routeState.location,
  useNavigate: () => mocks.routeState.navigate,
  useParams: () => mocks.routeState.params,
  useSearchParams: () => [
    new URLSearchParams(mocks.routeState.location.search),
  ],
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
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

vi.mock("@/features/format-editor/FormatEditor", () => ({
  FormatEditor: ({
    filePath,
    sourceDeletedBaseSha,
  }: {
    filePath: string;
    sourceDeletedBaseSha?: string | null;
  }) => (
    <div
      data-source-deleted-base-sha={sourceDeletedBaseSha ?? ""}
      data-testid="format-editor"
    >
      {filePath}
    </div>
  ),
}));

vi.mock("@/features/senders-editor/SendersEditor", () => ({
  SendersEditor: () => <div data-testid="senders-editor" />,
}));

vi.mock("@/features/workspace-header/WorkspaceHeaderBar", () => ({
  WorkspaceHeaderBar: () => <div data-testid="workspace-header-bar" />,
}));

vi.mock("@/features/create-entity/CreateFormatModal", () => ({
  CreateFormatModal: () => null,
}));

vi.mock("@/features/quick-check/QuickCheckPanel", () => ({
  QuickCheckPanel: () => null,
}));

vi.mock("@/features/validation/ValidationPanel", () => ({
  ValidationPanel: () => null,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

vi.mock("@/store", () => ({
  useDraftStore: mocks.useDraftStore,
  useSourceStore: mocks.useSourceStore,
  waitForDraftStoreHydration: () => Promise.resolve(),
}));

vi.mock("@/store/workspace-session", () => ({
  clearWorkspaceSession: mocks.clearWorkspaceSession,
  loadWorkspaceSession: mocks.loadWorkspaceSession,
  saveWorkspaceSession: mocks.saveWorkspaceSession,
}));

vi.mock("@/store/file-content-store", () => ({
  useFileContentStore: {
    getState: () => mocks.fileContentStore,
  },
}));

vi.mock("@/domain/github", async () => {
  const actual =
    await vi.importActual<typeof import("@/domain/github")>("@/domain/github");
  return {
    ...actual,
    approvePullRequest: vi.fn(),
    fetchFileContent: vi.fn(() => Promise.resolve("")),
    fetchOpenPRs: vi.fn(() => Promise.resolve([])),
    fetchPullRequestApprovalByCurrentUser:
      mocks.fetchPullRequestApprovalByCurrentUser,
    fetchPullRequestFiles: mocks.fetchPullRequestFiles,
    fetchRepoTree: mocks.fetchRepoTree,
    getCachedPullRequestApprovalPermission:
      mocks.getCachedPullRequestApprovalPermission,
    getGitHubAuthChangeVersion: mocks.getGitHubAuthChangeVersion,
    getGitHubUserToken: vi.fn(() => ""),
    indexBanksFromTree: mocks.indexBanksFromTree,
    refreshPullRequestApprovalPermission:
      mocks.refreshPullRequestApprovalPermission,
    resolvePullRequestWorkspace: mocks.resolvePullRequestWorkspace,
    subscribeGitHubAuthChange: mocks.subscribeGitHubAuthChange,
    updatePullRequestHead: mocks.updatePullRequestHead,
  };
});

import {
  fetchFileContent,
  fetchOpenPRs,
  getGitHubUserToken,
} from "@/domain/github";
import { BankWorkspace } from "./BankWorkspace";

function QueryWrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: QueryWrapper });
}

describe("BankWorkspace route init", () => {
  beforeEach(() => {
    mocks.routeState.location.pathname = "/repo/zenmoney/sms-formats/pr/123";
    mocks.routeState.location.search =
      "?file=src/TBank_123/formats/current.txt";
    mocks.routeState.params = {
      owner: "zenmoney",
      repo: "sms-formats",
      prNumber: "123",
    };
    mocks.routeState.navigate.mockReset();

    mocks.sourceState.repository = { owner: "zenmoney", repo: "sms-formats" };
    mocks.sourceState.sourceRef = null;
    mocks.sourceState.sourceChangedFiles = [];
    mocks.sourceState.tree = [];
    mocks.sourceState.banks = [];
    mocks.sourceState.loading = false;
    mocks.sourceState.error = null;
    mocks.sourceState.setRepository.mockClear();
    mocks.sourceState.setSource.mockClear();
    mocks.sourceState.setSourceChangedFiles.mockClear();
    mocks.sourceState.setTree.mockClear();
    mocks.sourceState.setBanks.mockClear();
    mocks.sourceState.setLoading.mockClear();
    mocks.sourceState.setError.mockClear();

    mocks.draftState.drafts = new Map();
    mocks.draftState.getStoredDraftsForScope.mockReset();
    mocks.draftState.getStoredDraftsForScope.mockReturnValue([]);
    mocks.draftState.activateScope.mockReset();
    mocks.draftState.getChangedFiles.mockReset();
    mocks.draftState.getChangedFiles.mockReturnValue([]);
    mocks.draftState.getDeletedFiles.mockReset();
    mocks.draftState.getDeletedFiles.mockReturnValue([]);
    mocks.draftState.getDraft.mockReset();
    mocks.draftState.getDraft.mockReturnValue(undefined);
    mocks.draftState.resetBankToRemote.mockReset();
    mocks.draftState.discardAll.mockReset();
    mocks.draftState.clearAll.mockReset();
    mocks.draftState.renameDraft.mockReset();

    mocks.clearWorkspaceSession.mockReset();
    mocks.loadWorkspaceSession.mockReset();
    mocks.loadWorkspaceSession.mockReturnValue(null);
    mocks.saveWorkspaceSession.mockReset();

    mocks.fetchPullRequestFiles.mockReset();
    mocks.fetchPullRequestFiles.mockResolvedValue([]);
    mocks.fetchPullRequestApprovalByCurrentUser.mockReset();
    mocks.fetchPullRequestApprovalByCurrentUser.mockResolvedValue(false);
    mocks.fetchRepoTree.mockReset();
    mocks.fetchRepoTree.mockResolvedValue(mocks.tree);
    mocks.fileContentStore.getCachedFileContent.mockReset();
    mocks.fileContentStore.getCachedFileContent.mockReturnValue(undefined);
    mocks.fileContentStore.invalidatePullRequestFileContents.mockReset();
    mocks.fileContentStore.primeFileContent.mockReset();
    mocks.fileContentStore.primeFileContent.mockResolvedValue(null);
    mocks.fileContentStore.setFileContentEntry.mockReset();
    mocks.indexBanksFromTree.mockReset();
    mocks.indexBanksFromTree.mockReturnValue(mocks.banks);
    mocks.resolvePullRequestWorkspace.mockReset();
    mocks.resolvePullRequestWorkspace.mockResolvedValue({
      status: "supported",
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      headSha: "head-sha",
      bankPath: "src/TBank_123",
      writable: true,
      readOnlyReason: null,
      changedFiles: [
        { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        { kind: "modify", path: "src/TBank_123/formats/another.txt" },
      ],
    });
    mocks.refreshPullRequestApprovalPermission.mockReset();
    mocks.refreshPullRequestApprovalPermission.mockResolvedValue(false);
    mocks.getCachedPullRequestApprovalPermission.mockReset();
    mocks.getCachedPullRequestApprovalPermission.mockReturnValue(false);
    mocks.getGitHubAuthChangeVersion.mockReset();
    mocks.getGitHubAuthChangeVersion.mockReturnValue(0);
    mocks.subscribeGitHubAuthChange.mockReset();
    mocks.subscribeGitHubAuthChange.mockReturnValue(() => undefined);
    mocks.updatePullRequestHead.mockReset();
  });

  it("reuses the current PR workspace without showing a cold-start loader", async () => {
    mocks.sourceState.sourceRef = {
      type: "pr",
      name: "pr-123",
      sha: "head-sha",
      prNumber: 123,
    };
    mocks.sourceState.sourceChangedFiles = [
      "src/TBank_123/formats/current.txt",
      "src/TBank_123/formats/another.txt",
    ];
    mocks.sourceState.tree = mocks.tree;
    mocks.sourceState.banks = mocks.banks;
    mocks.loadWorkspaceSession.mockReturnValue({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      headSha: "head-sha",
      baseSha: "base-sha",
      bankPath: "src/TBank_123",
      writable: true,
      readOnlyReason: null,
      changedFiles: [
        { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        { kind: "modify", path: "src/TBank_123/formats/another.txt" },
      ],
    });
    mocks.resolvePullRequestWorkspace.mockImplementation(
      () => new Promise(() => undefined)
    );

    render(<BankWorkspace />);

    await waitFor(() => {
      expect(screen.queryByText("app.loading")).not.toBeInTheDocument();
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      );
    });
  });

  it("reuses deleted-file metadata from the saved session and passes base SHA to the editor", async () => {
    mocks.routeState.location.search =
      "?file=src/TBank_123/formats/deleted.txt";
    mocks.sourceState.sourceRef = {
      type: "pr",
      name: "pr-123",
      sha: "head-sha",
      prNumber: 123,
    };
    mocks.sourceState.sourceChangedFiles = [
      "src/TBank_123/formats/deleted.txt",
    ];
    mocks.sourceState.tree = mocks.tree;
    mocks.sourceState.banks = mocks.banks;
    mocks.loadWorkspaceSession.mockReturnValue({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      headSha: "head-sha",
      baseSha: "base-sha",
      bankPath: "src/TBank_123",
      writable: true,
      readOnlyReason: null,
      changedFiles: [
        { kind: "delete", path: "src/TBank_123/formats/deleted.txt" },
      ],
    });
    mocks.resolvePullRequestWorkspace.mockImplementation(
      () => new Promise(() => undefined)
    );

    render(<BankWorkspace />);

    await waitFor(() => {
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/deleted.txt"
      );
    });
    expect(screen.getByTestId("format-editor")).toHaveAttribute(
      "data-source-deleted-base-sha",
      "base-sha"
    );
  });

  it("does not re-run PR route init when only the selected file changes", async () => {
    const { rerender } = render(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      )
    );
    expect(mocks.resolvePullRequestWorkspace).toHaveBeenCalledTimes(1);

    mocks.routeState.location.search =
      "?file=src/TBank_123/formats/another.txt";
    rerender(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/another.txt"
      )
    );
    expect(mocks.resolvePullRequestWorkspace).toHaveBeenCalledTimes(1);
  });

  it("restores the existing approval state for the current user after page reload", async () => {
    mocks.sourceState.sourceRef = {
      type: "pr",
      name: "pr-123",
      sha: "head-sha",
      prNumber: 123,
    };
    mocks.sourceState.sourceChangedFiles = [
      "src/TBank_123/formats/current.txt",
      "src/TBank_123/formats/another.txt",
    ];
    mocks.sourceState.tree = mocks.tree;
    mocks.sourceState.banks = mocks.banks;
    mocks.loadWorkspaceSession.mockReturnValue({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      headSha: "head-sha",
      baseSha: "base-sha",
      bankPath: "src/TBank_123",
      writable: true,
      readOnlyReason: null,
      changedFiles: [
        { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        { kind: "modify", path: "src/TBank_123/formats/another.txt" },
      ],
    });
    mocks.resolvePullRequestWorkspace.mockImplementation(
      () => new Promise(() => undefined)
    );
    mocks.refreshPullRequestApprovalPermission.mockResolvedValue(true);
    mocks.fetchPullRequestApprovalByCurrentUser.mockResolvedValue(true);

    render(<BankWorkspace />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "source.approvePrDone" })
      ).toBeDisabled()
    );
    expect(mocks.fetchPullRequestApprovalByCurrentUser).toHaveBeenCalledWith(
      123,
      { owner: "zenmoney", repo: "sms-formats" }
    );
  });

  it("keeps the current workspace visible and shows a stale notice when PR head changes with local drafts", async () => {
    mocks.draftState.getChangedFiles.mockReturnValue([
      {
        filePath: "src/TBank_123/formats/current.txt",
        content: "LOCAL",
        isDeleted: false,
        baseSha: "head-sha",
      },
    ]);
    mocks.resolvePullRequestWorkspace
      .mockResolvedValueOnce({
        status: "supported",
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        headSha: "head-sha",
        bankPath: "src/TBank_123",
        writable: true,
        readOnlyReason: null,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        ],
      })
      .mockResolvedValueOnce({
        status: "supported",
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        headSha: "new-head-sha",
        bankPath: "src/TBank_123",
        writable: true,
        readOnlyReason: null,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        ],
      });

    render(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      )
    );

    window.dispatchEvent(new Event("focus"));

    await waitFor(() =>
      expect(
        screen.getByText(
          "PR changed since your last local edits. You're viewing the cached previous version. Discard local changes and refresh the PR to continue."
        )
      ).toBeInTheDocument()
    );
    expect(screen.getByTestId("format-editor")).toBeInTheDocument();
    expect(
      mocks.fileContentStore.invalidatePullRequestFileContents
    ).not.toHaveBeenCalled();
  });

  it("invalidates PR file cache and refreshes the workspace when head changes without local drafts", async () => {
    mocks.resolvePullRequestWorkspace
      .mockResolvedValueOnce({
        status: "supported",
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        headSha: "head-sha",
        bankPath: "src/TBank_123",
        writable: true,
        readOnlyReason: null,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        ],
      })
      .mockResolvedValueOnce({
        status: "supported",
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        headSha: "new-head-sha",
        bankPath: "src/TBank_123",
        writable: true,
        readOnlyReason: null,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        ],
      });

    render(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      )
    );

    window.dispatchEvent(new Event("focus"));

    await waitFor(() =>
      expect(
        mocks.fileContentStore.invalidatePullRequestFileContents
      ).toHaveBeenCalledWith({
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
      })
    );
    await waitFor(() =>
      expect(mocks.sourceState.setSource).toHaveBeenCalledWith({
        type: "pr",
        name: "pr-123",
        sha: "new-head-sha",
        prNumber: 123,
      })
    );
  });

  it("invalidates PR cache and reloads the workspace after a successful PR update", async () => {
    vi.mocked(getGitHubUserToken).mockReturnValue("gh-token");
    mocks.draftState.getChangedFiles.mockReturnValue([
      {
        filePath: "src/TBank_123/senders.txt",
        content: "T-BANK",
        isDeleted: false,
        baseSha: "head-sha",
      },
    ]);
    mocks.resolvePullRequestWorkspace
      .mockResolvedValueOnce({
        status: "supported",
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        headSha: "head-sha",
        bankPath: "src/TBank_123",
        writable: true,
        readOnlyReason: null,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        ],
      })
      .mockResolvedValueOnce({
        status: "supported",
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        headSha: "head-sha",
        bankPath: "src/TBank_123",
        writable: true,
        readOnlyReason: null,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        ],
      })
      .mockResolvedValueOnce({
        status: "supported",
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        headSha: "head-sha",
        bankPath: "src/TBank_123",
        writable: true,
        readOnlyReason: null,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        ],
      })
      .mockResolvedValueOnce({
        status: "supported",
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        headSha: "new-head-sha",
        bankPath: "src/TBank_123",
        writable: true,
        readOnlyReason: null,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/current.txt" },
        ],
      });
    mocks.updatePullRequestHead.mockResolvedValue({
      url: "https://github.com/zenmoney/sms-formats/pull/123",
      title: "PR 123",
      headSha: "new-head-sha",
    });

    render(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "publish.updatePR" }));

    await waitFor(() =>
      screen.getByRole("textbox", { name: "publish.commitTitleLabel" })
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "publish.commitTitleLabel" }),
      { target: { value: "Fix negative amounts" } }
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "publish.commitDescriptionLabel" }),
      { target: { value: "Handles the minus sign in the regex" } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "publish.updateAction" })
    );

    await waitFor(() =>
      expect(mocks.updatePullRequestHead).toHaveBeenCalledWith(
        "gh-token",
        123,
        [
          {
            path: "src/TBank_123/senders.txt",
            content: "T-BANK",
            delete: false,
          },
        ],
        { owner: "zenmoney", repo: "sms-formats" },
        "Fix negative amounts\n\nHandles the minus sign in the regex"
      )
    );
    await waitFor(() =>
      expect(
        mocks.fileContentStore.invalidatePullRequestFileContents
      ).toHaveBeenCalledWith({
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
      })
    );
    await waitFor(() =>
      expect(mocks.fetchRepoTree).toHaveBeenCalledWith("new-head-sha", {
        owner: "zenmoney",
        repo: "sms-formats",
      })
    );
    await waitFor(() =>
      expect(mocks.sourceState.setSource).toHaveBeenCalledWith({
        type: "pr",
        name: "pr-123",
        sha: "new-head-sha",
        prNumber: 123,
      })
    );
    expect(mocks.draftState.discardAll).toHaveBeenCalled();
  });

  it("defers every workspace mutation until all reads resolve, committing the new head in one pass", async () => {
    vi.mocked(getGitHubUserToken).mockReturnValue("gh-token");
    vi.mocked(fetchOpenPRs).mockClear();
    vi.mocked(fetchFileContent).mockClear();
    vi.mocked(fetchFileContent).mockResolvedValue("primed content");
    mocks.draftState.getChangedFiles.mockReturnValue([
      {
        filePath: "src/TBank_123/senders.txt",
        content: "T-BANK",
        isDeleted: false,
        baseSha: "head-sha",
      },
    ]);
    const supportedAtHead = {
      status: "supported" as const,
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      headSha: "head-sha",
      bankPath: "src/TBank_123",
      writable: true,
      readOnlyReason: null,
      changedFiles: [
        { kind: "modify" as const, path: "src/TBank_123/formats/current.txt" },
      ],
    };
    mocks.resolvePullRequestWorkspace
      .mockResolvedValueOnce(supportedAtHead)
      .mockResolvedValueOnce(supportedAtHead)
      .mockResolvedValueOnce(supportedAtHead)
      .mockResolvedValueOnce({ ...supportedAtHead, headSha: "new-head-sha" });
    mocks.updatePullRequestHead.mockResolvedValue({
      url: "https://github.com/zenmoney/sms-formats/pull/123",
      title: "PR 123",
      headSha: "new-head-sha",
    });

    render(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "publish.updatePR" }));
    await waitFor(() =>
      screen.getByRole("textbox", { name: "publish.commitTitleLabel" })
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "publish.commitTitleLabel" }),
      { target: { value: "Sync" } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "publish.updateAction" })
    );

    await waitFor(() =>
      expect(mocks.sourceState.setSource).toHaveBeenCalledWith({
        type: "pr",
        name: "pr-123",
        sha: "new-head-sha",
        prNumber: 123,
      })
    );

    const lastOrder = (mock: { mock: { invocationCallOrder: number[] } }) =>
      mock.mock.invocationCallOrder.at(-1) ?? -1;
    const readOrder = Math.max(
      lastOrder(mocks.fetchRepoTree),
      lastOrder(vi.mocked(fetchOpenPRs)),
      lastOrder(vi.mocked(fetchFileContent))
    );
    const setSourceCalls = mocks.sourceState.setSource.mock.calls;
    const newHeadIndex = setSourceCalls.findIndex(
      ([arg]) => arg?.sha === "new-head-sha"
    );
    const setSourceNewHeadOrder =
      mocks.sourceState.setSource.mock.invocationCallOrder[newHeadIndex];

    // Every read must finish before any visible-state write, so React batches
    // the whole transition into a single commit instead of flickering.
    expect(
      lastOrder(mocks.fileContentStore.invalidatePullRequestFileContents)
    ).toBeGreaterThan(readOrder);
    expect(setSourceNewHeadOrder).toBeGreaterThan(readOrder);
    expect(mocks.fileContentStore.setFileContentEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "src/TBank_123/formats/current.txt",
        lastResolvedHeadSha: "new-head-sha",
        status: "ready",
      })
    );
  });
});
