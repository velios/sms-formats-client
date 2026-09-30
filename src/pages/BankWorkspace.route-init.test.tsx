import { beforeEach, describe, expect, it, type Mock, mock } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactElement, type ReactNode, useState } from "react";

const mocks = (() => {
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
    navigate: mock(),
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
    setRepository: mock((repository: { owner: string; repo: string }) => {
      sourceState.repository = repository;
    }),
    setSource: mock(
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
    setSourceChangedFiles: mock((files: string[]) => {
      sourceState.sourceChangedFiles = files;
    }),
    setTree: mock((nextTree: typeof tree) => {
      sourceState.tree = nextTree;
    }),
    setBanks: mock((nextBanks: typeof banks) => {
      sourceState.banks = nextBanks;
    }),
    setLoading: mock((loading: boolean) => {
      sourceState.loading = loading;
    }),
    setError: mock((error: string | null) => {
      sourceState.error = error;
    }),
  };

  const useSourceStore = (<T,>(selector: (state: typeof sourceState) => T) =>
    selector(sourceState)) as ((
    selector: (state: typeof sourceState) => unknown
  ) => unknown) & { getState: () => typeof sourceState };
  useSourceStore.getState = () => sourceState;

  const draftState = {
    draftScopeKey: null as string | null,
    drafts: new Map<string, unknown>(),
    hasHydrated: true,
    getStoredDraftsForScope: mock(() => []),
    activateScope: mock((scopeKey: string) => {
      draftState.draftScopeKey = scopeKey;
    }),
    getChangedFiles: mock<
      () => Array<{
        filePath: string;
        content: string;
        isDeleted: boolean;
        baselineHeadSha: string;
      }>
    >(() => []),
    getDeletedFiles: mock(() => []),
    getDraft:
      mock<
        (path: string) =>
          | {
              filePath: string;
              content: string;
              isDeleted: boolean;
              baselineHeadSha: string;
            }
          | undefined
      >(),
    acknowledgePublished: mock(),
    resetBankToRemote: mock(),
    discardAll: mock(),
    clearAll: mock(),
    renameDraft: mock(),
  };

  const useDraftStore = (() => draftState) as (() => typeof draftState) & {
    getState: () => typeof draftState;
    subscribe: () => () => void;
  };
  useDraftStore.getState = () => draftState;
  useDraftStore.subscribe = () => () => undefined;

  return {
    fetchPullRequestApprovalByCurrentUser: mock(() => Promise.resolve(false)),
    banks,
    draftState,
    fetchPullRequestFiles: mock(() => Promise.resolve([])),
    fetchRepoTree: mock(() => Promise.resolve(tree)),
    cacheFileContent: mock(),
    loadFileContents: mock(async ({ filePaths }: { filePaths: string[] }) => ({
      contents: new Map(
        filePaths.map((path) => [
          path,
          `^${path.includes("current") ? "CURRENT" : "ANOTHER"}$\n\n-----COLUMNS-----\n\n-----EXAMPLE-----\n${path.includes("current") ? "CURRENT" : "ANOTHER"}\n`,
        ])
      ),
      cachedCount: 0,
      remoteFetchedCount: filePaths.length,
    })),
    getCachedPullRequestApprovalPermission: mock(() => false),
    getGitHubAuthChangeVersion: mock(() => 0),
    indexBanksFromTree: mock(() => banks),
    loadWorkspaceSession: mock<() => unknown>(() => null),
    resolvePullRequestWorkspace: mock(() =>
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
    refreshPullRequestApprovalPermission: mock(() => Promise.resolve(false)),
    routeState,
    saveWorkspaceSession: mock(),
    sourceState,
    subscribeGitHubAuthChange: mock(() => () => undefined),
    tree,
    updatePullRequestHead: mock(),
    useDraftStore,
    useSourceStore,
  };
})();

mock.module("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

mock.module("react-router-dom", () => ({
  useLocation: () => mocks.routeState.location,
  useNavigate: () => mocks.routeState.navigate,
  useParams: () => mocks.routeState.params,
  useSearchParams: () => [
    new URLSearchParams(mocks.routeState.location.search),
  ],
}));

mock.module("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

mock.module("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

mock.module("@/components/ui/spinner", () => ({
  Spinner: () => <span>spinner</span>,
}));

mock.module("@/components/ui/status-badge", () => ({
  StatusBadge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

mock.module("@/features/format-editor/FormatEditor", () => ({
  FormatEditor: ({ filePath }: { filePath: string }) => (
    <div data-testid="format-editor">{filePath}</div>
  ),
}));

mock.module("@/features/senders-editor/SendersEditor", () => ({
  SendersEditor: () => <div data-testid="senders-editor" />,
}));

mock.module("@/features/workspace-header/WorkspaceHeaderBar", () => ({
  WorkspaceHeaderBar: () => <div data-testid="workspace-header-bar" />,
}));

mock.module("@/features/create-entity/CreateFormatModal", () => ({
  CreateFormatModal: () => null,
}));

mock.module("@/features/quick-check/QuickCheckPanel", () => ({
  QuickCheckPanel: () => null,
}));

mock.module("@/features/validation/ValidationPanel", () => ({
  ValidationPanel: () => null,
}));

mock.module("@/lib/utils", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
}));

mock.module("@/store", () => ({
  useDraftStore: mocks.useDraftStore,
  useSourceStore: mocks.useSourceStore,
  waitForDraftStoreHydration: () => Promise.resolve(),
}));

const actualWorkspaceSession = await import("@/store/workspace-session");
mock.module("@/store/workspace-session", () => ({
  ...actualWorkspaceSession,
  loadWorkspaceSession: mocks.loadWorkspaceSession,
  saveWorkspaceSession: mocks.saveWorkspaceSession,
}));

mock.module("@/infrastructure/file-content", () => ({
  cacheFileContent: mocks.cacheFileContent,
  loadFileContent: mock(async (params) => {
    const content = await fetchFileContent(
      params.filePath,
      params.commitSha,
      params.repository
    );
    mocks.cacheFileContent({ ...params, content });
    return content;
  }),
  loadFileContents: mocks.loadFileContents,
}));

mock.module("@/domain/bank-index", () => ({
  indexBanksFromTree: mocks.indexBanksFromTree,
}));

const actualGitHub = await import("@/infrastructure/github");
mock.module("@/infrastructure/github", () => {
  const actual = actualGitHub;
  return {
    ...actual,
    approvePullRequest: mock(),
    fetchFileContent: mock(() => Promise.resolve("")),
    fetchOpenPRs: mock(() => Promise.resolve([])),
    fetchPullRequestApprovalByCurrentUser:
      mocks.fetchPullRequestApprovalByCurrentUser,
    fetchPullRequestFiles: mocks.fetchPullRequestFiles,
    fetchRepoTree: mocks.fetchRepoTree,
    getCachedPullRequestApprovalPermission:
      mocks.getCachedPullRequestApprovalPermission,
    getGitHubAuthChangeVersion: mocks.getGitHubAuthChangeVersion,
    getGitHubUserToken: mock(() => ""),
    refreshPullRequestApprovalPermission:
      mocks.refreshPullRequestApprovalPermission,
    resolvePullRequestWorkspace: mocks.resolvePullRequestWorkspace,
    subscribeGitHubAuthChange: mocks.subscribeGitHubAuthChange,
    updatePullRequestHead: mocks.updatePullRequestHead,
  };
});

const { fetchFileContent, fetchOpenPRs, getGitHubUserToken } = await import(
  "@/infrastructure/github"
);
const { BankWorkspace } = await import("./BankWorkspace");

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
    mocks.draftState.draftScopeKey = null;
    mocks.draftState.activateScope.mockReset();
    mocks.draftState.activateScope.mockImplementation((scopeKey: string) => {
      mocks.draftState.draftScopeKey = scopeKey;
    });
    mocks.draftState.getChangedFiles.mockReset();
    mocks.draftState.getChangedFiles.mockReturnValue([]);
    mocks.draftState.getDeletedFiles.mockReset();
    mocks.draftState.getDeletedFiles.mockReturnValue([]);
    mocks.draftState.getDraft.mockReset();
    mocks.draftState.getDraft.mockImplementation((path) =>
      mocks.draftState.getChangedFiles().find((file) => file.filePath === path)
    );
    mocks.draftState.acknowledgePublished.mockReset();
    mocks.draftState.resetBankToRemote.mockReset();
    mocks.draftState.discardAll.mockReset();
    mocks.draftState.clearAll.mockReset();
    mocks.draftState.renameDraft.mockReset();

    mocks.loadWorkspaceSession.mockReset();
    mocks.loadWorkspaceSession.mockReturnValue(null);
    mocks.saveWorkspaceSession.mockReset();
    mocks.saveWorkspaceSession.mockImplementation((saved) => {
      mocks.loadWorkspaceSession.mockReturnValue(saved);
    });

    mocks.fetchPullRequestFiles.mockReset();
    mocks.fetchPullRequestFiles.mockResolvedValue([]);
    mocks.fetchPullRequestApprovalByCurrentUser.mockReset();
    mocks.fetchPullRequestApprovalByCurrentUser.mockResolvedValue(false);
    mocks.fetchRepoTree.mockReset();
    mocks.fetchRepoTree.mockResolvedValue(mocks.tree);
    mocks.cacheFileContent.mockClear();
    mocks.loadFileContents.mockClear();
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
      session: {
        status: "supported",
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
      },
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

  it("reports that the selected document is absent from the saved working revision", async () => {
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
      session: {
        status: "supported",
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
      },
    });
    mocks.resolvePullRequestWorkspace.mockImplementation(
      () => new Promise(() => undefined)
    );

    render(<BankWorkspace />);

    await waitFor(() =>
      expect(
        screen.getByText("workspace.selectedFileRemoved")
      ).toBeInTheDocument()
    );
    expect(screen.queryByTestId("format-editor")).not.toBeInTheDocument();
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
      session: {
        status: "supported",
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
      },
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
        baselineHeadSha: "head-sha",
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

    fireEvent.click(
      screen.getByRole("button", { name: "workspace.checkUpdates" })
    );

    await waitFor(() =>
      expect(
        screen.getByText("workspace.cachedStaleNotice")
      ).toBeInTheDocument()
    );
    expect(screen.getByTestId("format-editor")).toBeInTheDocument();
    expect(mocks.sourceState.sourceRef?.sha).toBe("head-sha");
  });

  it("caches the new revision and refreshes the workspace when head changes without local drafts", async () => {
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

    fireEvent.click(
      screen.getByRole("button", { name: "workspace.checkUpdates" })
    );

    await waitFor(() =>
      expect(mocks.cacheFileContent).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: { owner: "zenmoney", repo: "sms-formats" },
          commitSha: "new-head-sha",
        })
      )
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

  it("preserves edits made while a clean workspace refresh is loading", async () => {
    const session = {
      status: "supported" as const,
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      headSha: "head-sha",
      baseSha: "base-sha",
      bankPath: "src/TBank_123",
      writable: true,
      readOnlyReason: null,
      changedFiles: [],
    };
    mocks.resolvePullRequestWorkspace
      .mockResolvedValueOnce(session)
      .mockResolvedValue({ ...session, headSha: "new-head-sha" });
    let finishTree!: (tree: typeof mocks.tree) => void;
    mocks.fetchRepoTree
      .mockResolvedValueOnce(mocks.tree)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishTree = resolve;
          })
      );
    render(<BankWorkspace />);
    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toBeInTheDocument()
    );
    mocks.draftState.discardAll.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "workspace.checkUpdates" })
    );
    await waitFor(() => expect(mocks.fetchRepoTree).toHaveBeenCalledTimes(2));
    mocks.draftState.getChangedFiles.mockReturnValue([
      {
        filePath: "src/TBank_123/formats/current.txt",
        content: "LATE EDIT",
        isDeleted: false,
        baselineHeadSha: "head-sha",
      },
    ]);
    await act(async () => finishTree(mocks.tree));
    await waitFor(() =>
      expect(
        screen.getByText("workspace.cachedStaleNotice")
      ).toBeInTheDocument()
    );
    expect(mocks.draftState.discardAll).not.toHaveBeenCalled();
    expect(mocks.sourceState.sourceRef?.sha).toBe("head-sha");
  });

  it("acknowledges the published snapshot and reloads the workspace after a successful PR update", async () => {
    (getGitHubUserToken as Mock<typeof getGitHubUserToken>).mockReturnValue(
      "gh-token"
    );
    mocks.draftState.getChangedFiles.mockReturnValue([
      {
        filePath: "src/TBank_123/senders.txt",
        content: "T-BANK",
        isDeleted: false,
        baselineHeadSha: "head-sha",
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
        "head-sha",
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
      expect(mocks.cacheFileContent).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: { owner: "zenmoney", repo: "sms-formats" },
          commitSha: "new-head-sha",
        })
      )
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
    expect(mocks.draftState.acknowledgePublished).toHaveBeenCalledWith(
      mocks.draftState.getChangedFiles(),
      "new-head-sha",
      "zenmoney/sms-formats:pr:123"
    );
    expect(mocks.draftState.discardAll).not.toHaveBeenCalled();
  });

  it("defers every workspace mutation until all reads resolve, committing the new head in one pass", async () => {
    (getGitHubUserToken as Mock<typeof getGitHubUserToken>).mockReturnValue(
      "gh-token"
    );
    (fetchOpenPRs as Mock<typeof fetchOpenPRs>).mockClear();
    (fetchFileContent as Mock<typeof fetchFileContent>).mockClear();
    (fetchFileContent as Mock<typeof fetchFileContent>).mockResolvedValue(
      "primed content"
    );
    mocks.draftState.getChangedFiles.mockReturnValue([
      {
        filePath: "src/TBank_123/senders.txt",
        content: "T-BANK",
        isDeleted: false,
        baselineHeadSha: "head-sha",
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
      lastOrder(fetchFileContent as Mock<typeof fetchFileContent>)
    );
    const setSourceCalls = mocks.sourceState.setSource.mock.calls;
    const newHeadIndex = setSourceCalls.findIndex(
      ([arg]) => arg?.sha === "new-head-sha"
    );
    const setSourceNewHeadOrder =
      mocks.sourceState.setSource.mock.invocationCallOrder[newHeadIndex];

    // Every read must finish before any visible-state write, so React batches
    // the whole transition into a single commit instead of flickering.
    expect(lastOrder(mocks.cacheFileContent)).toBeGreaterThan(readOrder);
    expect(setSourceNewHeadOrder).toBeGreaterThan(readOrder);
    expect(mocks.cacheFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "src/TBank_123/formats/current.txt",
        commitSha: "new-head-sha",
        content: "primed content",
      })
    );
  });
  it("does not recheck GitHub on focus or visibility events", async () => {
    render(<BankWorkspace />);
    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toBeInTheDocument()
    );
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.resolvePullRequestWorkspace).toHaveBeenCalledTimes(1);
  });

  it("does not make the open PR list a prerequisite for revision updates", async () => {
    render(<BankWorkspace />);
    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toBeInTheDocument()
    );
    (fetchOpenPRs as Mock<typeof fetchOpenPRs>).mockRejectedValueOnce(
      new Error("list offline")
    );
    const current = (await mocks.resolvePullRequestWorkspace.mock.results[0]
      ?.value) as Awaited<ReturnType<typeof mocks.resolvePullRequestWorkspace>>;
    mocks.resolvePullRequestWorkspace.mockResolvedValueOnce({
      ...current,
      headSha: "next-head",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "workspace.checkUpdates" })
    );
    await waitFor(() =>
      expect(mocks.sourceState.sourceRef?.sha).toBe("next-head")
    );
  });
});
