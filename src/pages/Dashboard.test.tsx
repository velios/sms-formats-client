import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

const navigate = vi.fn();

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ state: null }),
  useNavigate: () => navigate,
}));

vi.mock("@/hooks/useGitHub", () => ({
  useOpenPRs: () => ({
    data: [
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
    isLoading: false,
  }),
}));

vi.mock("@/store", () => {
  const state = {
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
  };
  const draftStore = {
    drafts: new Map(),
    getChangedFiles: () => [],
    hasDrafts: () => false,
    discardAll: vi.fn(),
  };
  return {
    useSourceStore: (selector: (value: typeof state) => unknown) =>
      selector(state),
    useDraftStore: () => draftStore,
  };
});

import { Dashboard } from "./Dashboard";

describe("Dashboard", () => {
  it("shows only pull requests without banks or recent PR sections", () => {
    render(<Dashboard />);

    expect(screen.getByText("PR only workspace")).toBeInTheDocument();
    expect(screen.queryByText(/recent pr/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/banks/i)).not.toBeInTheDocument();
  });
});
