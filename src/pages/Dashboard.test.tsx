import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    openPRs: [
      {
        number: 123,
        title: "PR only workspace",
        headRef: "feature/pr-only",
        headSha: "abc123",
        approvedCount: 1,
        failedValidationCount: 0,
        validationErrors: [],
        validationUrl: null,
        lastCommitAuthorLogin: "bot",
        labels: [],
      },
    ],
    sourceRef: {
      type: "pr" as const,
      name: "feature/pr-only",
      sha: "abc123",
      prNumber: 123,
    },
    sourceChangedFiles: ["src/TBank_123/formats/one.txt"],
    repository: { owner: "zenmoney", repo: "sms-formats" },
    banks: [
      {
        displayName: "TBank",
        folderPath: "src/TBank_123",
        bankId: "123",
        formatFiles: ["src/TBank_123/formats/one.txt"],
        hasSenders: true,
      },
    ],
    currentDraftFiles: [{ filePath: "src/TBank_123/formats/one.txt" }],
    persistedDrafts: [
      {
        sourceRef: "zenmoney/sms-formats:pr:123",
        bankPath: "src/TBank_123",
        filePath: "src/TBank_123/formats/one.txt",
        baseSha: "base-sha",
        baseHeadSha: "head-sha",
        content: "changed",
        hasChanges: true,
        isDeleted: false,
        timestamp: 1,
      },
    ],
  };
  const buildStoredDraftsByScope = () =>
    state.persistedDrafts.reduce<Record<string, typeof state.persistedDrafts>>(
      (acc, draft) => {
        if (!draft.hasChanges) {
          return acc;
        }
        const scopeDrafts = acc[draft.sourceRef] ?? [];
        scopeDrafts.push(draft);
        acc[draft.sourceRef] = scopeDrafts;
        return acc;
      },
      {}
    );

  return {
    buildStoredDraftsByScope,
    navigate: vi.fn(),
    state,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ state: null }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/useGitHub", () => ({
  useOpenPRs: () => ({
    data: mocks.state.openPRs,
    isLoading: false,
  }),
}));

vi.mock("@/store", () => {
  const draftStore = {
    hasHydrated: true,
    get drafts() {
      return new Map(
        mocks.state.currentDraftFiles.map((file, index) => [
          `${file.filePath}:${index}`,
          file,
        ])
      );
    },
    get storedDraftsByScope() {
      const grouped = mocks.buildStoredDraftsByScope();
      return Object.fromEntries(
        Object.entries(grouped).map(([scopeKey, drafts]) => [
          scopeKey,
          Object.fromEntries(
            (drafts ?? []).map((draft) => [draft.filePath, draft])
          ),
        ])
      );
    },
    getChangedFiles: () => mocks.state.currentDraftFiles,
    hasDrafts: () => mocks.state.currentDraftFiles.length > 0,
    discardAll: vi.fn(),
  };

  return {
    useSourceStore: (
      selector: (value: {
        sourceRef: typeof mocks.state.sourceRef;
        sourceChangedFiles: typeof mocks.state.sourceChangedFiles;
        repository: typeof mocks.state.repository;
        banks: typeof mocks.state.banks;
      }) => unknown
    ) =>
      selector({
        sourceRef: mocks.state.sourceRef,
        sourceChangedFiles: mocks.state.sourceChangedFiles,
        repository: mocks.state.repository,
        banks: mocks.state.banks,
      }),
    useDraftStore: () => draftStore,
  };
});

import { Dashboard } from "./Dashboard";

describe("Dashboard", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.state.openPRs = [
      {
        number: 123,
        title: "PR only workspace",
        headRef: "feature/pr-only",
        headSha: "abc123",
        approvedCount: 1,
        failedValidationCount: 0,
        validationErrors: [],
        validationUrl: null,
        lastCommitAuthorLogin: "bot",
        labels: [],
      },
    ];
    mocks.state.sourceRef = {
      type: "pr",
      name: "feature/pr-only",
      sha: "abc123",
      prNumber: 123,
    };
    mocks.state.sourceChangedFiles = ["src/TBank_123/formats/one.txt"];
    mocks.state.repository = { owner: "zenmoney", repo: "sms-formats" };
    mocks.state.banks = [
      {
        displayName: "TBank",
        folderPath: "src/TBank_123",
        bankId: "123",
        formatFiles: ["src/TBank_123/formats/one.txt"],
        hasSenders: true,
      },
    ];
    mocks.state.currentDraftFiles = [
      { filePath: "src/TBank_123/formats/one.txt" },
    ];
    mocks.state.persistedDrafts = [
      {
        sourceRef: "zenmoney/sms-formats:pr:123",
        bankPath: "src/TBank_123",
        filePath: "src/TBank_123/formats/one.txt",
        baseSha: "base-sha",
        baseHeadSha: "head-sha",
        content: "changed",
        hasChanges: true,
        isDeleted: false,
        timestamp: 1,
      },
    ];
  });

  it("renders the PR-only dashboard controls without the duplicated header", async () => {
    const { container } = render(<Dashboard />);

    expect(screen.getByText("PR only workspace")).toBeInTheDocument();
    expect(screen.queryByText(/recent pr/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/banks/i)).not.toBeInTheDocument();
    expect(screen.queryByText("zenmoney/sms-formats")).not.toBeInTheDocument();
    expect(container.querySelector("h1")).toBeNull();
  });

  it("renders a white search field, GitHub PR link, and local draft indicator", async () => {
    render(<Dashboard />);

    expect(
      screen.getByRole("textbox", {
        name: "Search pull requests",
      })
    ).toHaveClass("bg-[color:var(--c-bg-input)]");
    expect(screen.getByRole("link", { name: "PR #123" })).toHaveAttribute(
      "href",
      "https://github.com/zenmoney/sms-formats/pull/123"
    );
    expect(
      screen.getByTitle("You have unsaved local changes in this PR")
    ).toBeInTheDocument();
  });

  it("shows local draft indicators for every PR with persisted changes", async () => {
    mocks.state.openPRs = [
      {
        number: 123,
        title: "PR only workspace",
        headRef: "feature/pr-only",
        headSha: "abc123",
        approvedCount: 1,
        failedValidationCount: 0,
        validationErrors: [],
        validationUrl: null,
        lastCommitAuthorLogin: "bot",
        labels: [],
      },
      {
        number: 456,
        title: "Second draft PR",
        headRef: "feature/second-pr",
        headSha: "def456",
        approvedCount: 0,
        failedValidationCount: 0,
        validationErrors: [],
        validationUrl: null,
        lastCommitAuthorLogin: "bot",
        labels: [],
      },
      {
        number: 789,
        title: "Viewed only PR",
        headRef: "feature/viewed-only",
        headSha: "ghi789",
        approvedCount: 0,
        failedValidationCount: 0,
        validationErrors: [],
        validationUrl: null,
        lastCommitAuthorLogin: "bot",
        labels: [],
      },
    ];
    mocks.state.persistedDrafts = [
      {
        sourceRef: "zenmoney/sms-formats:pr:123",
        bankPath: "src/TBank_123",
        filePath: "src/TBank_123/formats/one.txt",
        baseSha: "base-sha",
        baseHeadSha: "head-sha",
        content: "changed-123",
        hasChanges: true,
        isDeleted: false,
        timestamp: 1,
      },
      {
        sourceRef: "zenmoney/sms-formats:pr:456",
        bankPath: "src/TBank_456",
        filePath: "src/TBank_456/formats/one.txt",
        baseSha: "base-sha",
        baseHeadSha: "head-sha",
        content: "changed-456",
        hasChanges: true,
        isDeleted: false,
        timestamp: 2,
      },
      {
        sourceRef: "zenmoney/sms-formats:pr:789",
        bankPath: "src/TBank_789",
        filePath: "src/TBank_789/formats/one.txt",
        baseSha: "base-sha",
        baseHeadSha: "head-sha",
        content: "viewed-only",
        hasChanges: false,
        isDeleted: false,
        timestamp: 3,
      },
    ];

    render(<Dashboard />);

    await waitFor(() => {
      expect(
        screen.getAllByTitle("You have unsaved local changes in this PR")
      ).toHaveLength(2);
    });
  });
});
