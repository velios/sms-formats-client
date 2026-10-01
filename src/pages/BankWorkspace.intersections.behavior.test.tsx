import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactElement, type ReactNode, useState } from "react";

const scrollIntoViewMock = mock();
const localStorageState = new Map<string, string>();

mock.module("@/features/workspace/NormalizeBankExamplesButton", () => ({
  NormalizeBankExamplesButton: () => null,
}));

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
    sourceRef: {
      type: "pr" as const,
      name: "pr-123",
      sha: "head-sha",
      prNumber: 123,
    },
    sourceChangedFiles: [
      "src/TBank_123/formats/current.txt",
      "src/TBank_123/formats/another.txt",
      "src/TBank_123/formats/deleted.txt",
    ] as string[],
    tree,
    banks,
    loading: false,
    error: null as string | null,
    setRepository: mock(),
    setSource: mock(),
    setSourceChangedFiles: mock(),
    setTree: mock(),
    setBanks: mock(),
    setLoading: mock(),
    setError: mock(),
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
        baseSha: string;
      }>
    >(() => []),
    getDeletedFiles: mock<
      () => Array<{
        filePath: string;
        content: string;
        isDeleted: boolean;
        baseSha: string;
      }>
    >(() => []),
    getDraft: mock(() => undefined),
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
    banks,
    draftState,
    fetchPullRequestFiles: mock(() => Promise.resolve([])),
    fetchRepoTree: mock(() => Promise.resolve(tree)),
    fileContentStore: {
      getCachedFileContent: mock(() => undefined),
      invalidatePullRequestFileContents: mock(),
    },
    getCachedPullRequestApprovalPermission: mock(() => false),
    getGitHubAuthChangeVersion: mock(() => 0),
    indexBanksFromTree: mock(() => banks),
    loadWorkspaceSession: mock(() => ({
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
          {
            kind: "modify" as const,
            path: "src/TBank_123/formats/current.txt",
          },
          {
            kind: "modify" as const,
            path: "src/TBank_123/formats/another.txt",
          },
          {
            kind: "delete" as const,
            path: "src/TBank_123/formats/deleted.txt",
          },
        ],
      },
    })),
    loadBankSnapshot: mock(),
    refreshPullRequestApprovalPermission: mock(() => Promise.resolve(false)),
    resolvePullRequestWorkspace: mock(() => new Promise(() => undefined)),
    routeState,
    saveWorkspaceSession: mock(),
    sourceState,
    subscribeGitHubAuthChange: mock(() => () => undefined),
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
  FormatEditor: ({
    filePath,
    intersectionExamples,
    onOpenIntersectionFileInApp,
    onRegexBlurAfterEdit,
  }: {
    filePath: string;
    intersectionExamples?: Array<{ text: string }>;
    onOpenIntersectionFileInApp?: (filePath: string) => void;
    onRegexBlurAfterEdit?: (context: {
      filePath: string;
      regex: string;
      examples: string[];
    }) => void;
  }) => (
    <div data-testid="format-editor">
      {filePath}
      <div data-testid="format-editor-intersection-examples">
        {(intersectionExamples ?? []).map((item) => item.text).join("|")}
      </div>
      <button
        onClick={() =>
          onOpenIntersectionFileInApp?.("src/TBank_123/formats/another.txt")
        }
        type="button"
      >
        open-intersection-file-in-app
      </button>
      <button
        onClick={() =>
          onRegexBlurAfterEdit?.({
            filePath,
            regex: "^CARD (\\d+)$",
            examples: ["PAY 100", "PAY 200"],
          })
        }
        type="button"
      >
        regex-blur-after-edit
      </button>
    </div>
  ),
}));

mock.module("@/features/workspace-header/WorkspaceHeaderBar", () => ({
  WorkspaceHeaderBar: () => <div data-testid="workspace-header-bar" />,
}));

mock.module("@/features/create-entity/CreateFormatModal", () => ({
  CreateFormatModal: () => null,
}));

mock.module("@/features/quick-check/QuickCheckPanel", () => ({
  QuickCheckPanel: ({
    onOpenFileInApp,
  }: {
    onOpenFileInApp?: (filePath: string) => void;
  }) => (
    <button
      onClick={() => onOpenFileInApp?.("src/TBank_123/formats/another.txt")}
      type="button"
    >
      quick-check-open-in-app
    </button>
  ),
}));

const actualBankSnapshot = await import("@/features/workspace/bank-snapshot");
mock.module("@/features/workspace/bank-snapshot", () => ({
  ...actualBankSnapshot,
  loadBankSnapshot: (...args: unknown[]) => mocks.loadBankSnapshot(...args),
}));

mock.module("@/features/senders-editor/SendersEditor", () => ({
  SendersEditor: () => <div data-testid="senders-editor" />,
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
  loadFileContent: mock(async () => ""),
  useFileContentStore: {
    getState: () => mocks.fileContentStore,
  },
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
    fetchPullRequestApprovalByCurrentUser: mock(() => Promise.resolve(false)),
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

const { PullRequestBankWorkspace: BankWorkspace } = await import(
  "./BankWorkspace"
);

function QueryWrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: QueryWrapper });
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => localStorageState.get(key) ?? null,
      setItem: (key: string, value: string) => {
        localStorageState.set(key, value);
      },
      removeItem: (key: string) => {
        localStorageState.delete(key);
      },
    },
  });
});

function getFormatRow(fileName: string) {
  const label = screen.getByText(fileName);
  const row = label.closest('[role="button"]');
  if (!row) {
    throw new Error(`Row for ${fileName} not found`);
  }
  return row;
}

describe("BankWorkspace intersections behavior", () => {
  beforeEach(() => {
    localStorageState.clear();
    localStorageState.set("sms-formats-recent-formats", "{}");
    scrollIntoViewMock.mockClear();
    mocks.routeState.location.pathname = "/repo/zenmoney/sms-formats/pr/123";
    mocks.routeState.location.search =
      "?file=src/TBank_123/formats/current.txt";
    mocks.routeState.params = {
      owner: "zenmoney",
      repo: "sms-formats",
      prNumber: "123",
    };
    mocks.routeState.navigate.mockReset();
    mocks.routeState.navigate.mockImplementation((nextPath: string) => {
      const [pathname, search = ""] = nextPath.split("?");
      mocks.routeState.location.pathname = pathname ?? "";
      mocks.routeState.location.search = search ? `?${search}` : "";
    });

    mocks.sourceState.repository = { owner: "zenmoney", repo: "sms-formats" };
    mocks.sourceState.sourceRef = {
      type: "pr",
      name: "pr-123",
      sha: "head-sha",
      prNumber: 123,
    };
    mocks.sourceState.sourceChangedFiles = [
      "src/TBank_123/formats/current.txt",
      "src/TBank_123/formats/another.txt",
      "src/TBank_123/formats/deleted.txt",
    ];
    mocks.sourceState.tree = mocks.banks[0]
      ? [
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
        ]
      : [];
    mocks.sourceState.banks = mocks.banks;
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
    mocks.draftState.getDraft.mockReturnValue(undefined);
    mocks.draftState.resetBankToRemote.mockReset();
    mocks.draftState.discardAll.mockReset();
    mocks.draftState.clearAll.mockReset();
    mocks.draftState.renameDraft.mockReset();

    mocks.loadWorkspaceSession.mockReset();
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
          { kind: "delete", path: "src/TBank_123/formats/deleted.txt" },
        ],
      },
    });
    mocks.saveWorkspaceSession.mockReset();

    mocks.loadBankSnapshot.mockReset();
    mocks.loadBankSnapshot.mockResolvedValue({
      entries: [
        {
          filePath: "src/TBank_123/formats/current.txt",
          fileName: "current.txt",
          regex: "^PAY (\\d+)$",
          examples: ["PAY 100", "PAY 200"],
          source: "remote",
          fingerprint: "remote:head-sha",
        },
        {
          filePath: "src/TBank_123/formats/another.txt",
          fileName: "another.txt",
          regex: "^REFUND (\\d+)$",
          examples: ["PAY 300", "REFUND 50"],
          source: "remote",
          fingerprint: "remote:head-sha",
        },
      ],
      loadErrorsCount: 0,
      remoteFetchedCount: 2,
      cachedCount: 0,
    });
  });

  it("keeps indicators after initial calculation, excludes locally deleted files, and recalculates on regex blur", async () => {
    const { rerender } = render(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      )
    );

    fireEvent.click(
      screen.getByRole("button", { name: "quickCheck.calculateIntersections" })
    );

    await waitFor(() =>
      expect(mocks.loadBankSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          filePaths: expect.arrayContaining([
            "src/TBank_123/formats/current.txt",
            "src/TBank_123/formats/another.txt",
          ]),
        })
      )
    );
    expect(mocks.loadBankSnapshot.mock.calls[0]?.[0]?.filePaths).toHaveLength(
      2
    );
    await waitFor(() =>
      expect(getFormatRow("current.txt")).toHaveTextContent("2 / 2 / 1")
    );
    expect(
      screen.getByTestId("format-editor-intersection-examples")
    ).toHaveTextContent("PAY 300");
    expect(getFormatRow("deleted.txt")).not.toHaveTextContent(
      /\d+\s*\/\s*\d+\s*\/\s*\d+/
    );

    mocks.draftState.drafts = new Map([
      [
        "src/TBank_123/formats/another.txt",
        { filePath: "src/TBank_123/formats/another.txt" },
      ],
    ]);
    mocks.draftState.getChangedFiles.mockReturnValue([
      {
        filePath: "src/TBank_123/formats/another.txt",
        content: "",
        isDeleted: true,
        baseSha: "head-sha",
      },
    ]);
    mocks.draftState.getDeletedFiles.mockReturnValue([
      {
        filePath: "src/TBank_123/formats/another.txt",
        content: "",
        isDeleted: true,
        baseSha: "head-sha",
      },
    ]);

    rerender(<BankWorkspace />);

    await waitFor(() =>
      expect(getFormatRow("current.txt")).toHaveTextContent("2 / 2 / 0")
    );
    expect(getFormatRow("another.txt")).not.toHaveTextContent(
      /\d+\s*\/\s*\d+\s*\/\s*\d+/
    );

    fireEvent.click(
      screen.getByRole("button", { name: "regex-blur-after-edit" })
    );

    await waitFor(() =>
      expect(getFormatRow("current.txt")).toHaveTextContent("2 / 0 / 0")
    );
    expect(
      screen.getByTestId("format-editor-intersection-examples")
    ).toBeEmptyDOMElement();
  });

  it("keeps the last successful indicators when a repeated calculation fails", async () => {
    mocks.loadBankSnapshot
      .mockResolvedValueOnce({
        entries: [
          {
            filePath: "src/TBank_123/formats/current.txt",
            fileName: "current.txt",
            regex: "^PAY (\\d+)$",
            examples: ["PAY 100", "PAY 200"],
            source: "remote",
            fingerprint: "remote:head-sha",
          },
          {
            filePath: "src/TBank_123/formats/another.txt",
            fileName: "another.txt",
            regex: "^REFUND (\\d+)$",
            examples: ["PAY 300", "REFUND 50"],
            source: "remote",
            fingerprint: "remote:head-sha",
          },
        ],
        loadErrorsCount: 0,
        remoteFetchedCount: 2,
        cachedCount: 0,
      })
      .mockRejectedValueOnce(new Error("boom"));

    render(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      )
    );

    fireEvent.click(
      screen.getByRole("button", { name: "quickCheck.calculateIntersections" })
    );

    await waitFor(() =>
      expect(getFormatRow("current.txt")).toHaveTextContent("2 / 2 / 1")
    );

    const confirmSpy = spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(
      screen.getByRole("button", { name: "quickCheck.calculateIntersections" })
    );

    await waitFor(() =>
      expect(
        screen.getByText("quickCheck.intersectionsUnexpectedError")
      ).toBeInTheDocument()
    );
    expect(getFormatRow("current.txt")).toHaveTextContent("2 / 2 / 1");

    confirmSpy.mockRestore();
  });

  it("reveals the target file in the list when opening from intersections", async () => {
    localStorageState.set(
      "sms-formats-recent-formats",
      JSON.stringify({
        src: ["src/TBank_123/formats/current.txt"],
        "src/TBank_123": ["src/TBank_123/formats/current.txt"],
      })
    );

    render(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "bank.recentFiles" }));
    fireEvent.change(screen.getByRole("textbox", { name: "bank.searchFile" }), {
      target: { value: "current" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "quickCheck.calculateIntersections" })
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("format-editor-intersection-examples")
      ).toHaveTextContent("PAY 300")
    );

    fireEvent.click(
      screen.getByRole("button", { name: "open-intersection-file-in-app" })
    );

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/another.txt"
      )
    );

    expect(
      screen.getByRole("textbox", { name: "bank.searchFile" })
    ).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "bank.allFiles" })
    ).toHaveAttribute("data-active", "true");
    expect(getFormatRow("another.txt").className).toContain("text-primary");
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("reveals the target file in the list when opening from quick check", async () => {
    localStorageState.set(
      "sms-formats-recent-formats",
      JSON.stringify({
        src: ["src/TBank_123/formats/current.txt"],
        "src/TBank_123": ["src/TBank_123/formats/current.txt"],
      })
    );

    render(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "bank.recentFiles" }));
    fireEvent.change(screen.getByRole("textbox", { name: "bank.searchFile" }), {
      target: { value: "current" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "quickCheck.openSmsByTemplate" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "quick-check-open-in-app" })
    );

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/another.txt"
      )
    );

    expect(
      screen.getByRole("textbox", { name: "bank.searchFile" })
    ).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "bank.allFiles" })
    ).toHaveAttribute("data-active", "true");
    expect(getFormatRow("another.txt").className).toContain("text-primary");
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("scopes the intersections tab from the right badge without touching the editor", async () => {
    render(<BankWorkspace />);

    await waitFor(() =>
      expect(screen.getByTestId("format-editor")).toHaveTextContent(
        "src/TBank_123/formats/current.txt"
      )
    );

    expect(
      screen.queryByRole("button", { name: "bank.intersectionsTab" })
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "quickCheck.calculateIntersections" })
    );

    await waitFor(() =>
      expect(getFormatRow("current.txt")).toHaveTextContent("2 / 2 / 1")
    );

    fireEvent.click(
      screen.getByRole("button", { name: "bank.scopeIntersections" })
    );

    const intersectionsTab = await screen.findByRole("button", {
      name: "bank.intersectionsTab",
    });
    expect(intersectionsTab).toHaveAttribute("data-active", "true");

    expect(getFormatRow("current.txt")).toBeInTheDocument();
    expect(getFormatRow("another.txt")).toBeInTheDocument();

    expect(screen.getByTestId("format-editor")).toHaveTextContent(
      "src/TBank_123/formats/current.txt"
    );
  });
});
