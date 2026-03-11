import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/useGitHub", () => ({
  useAvailableSourceRepos: () => ({
    data: [{ owner: "zenmoney", repo: "sms-formats" }],
  }),
  useOpenPRs: () => ({
    data: [
      {
        number: 123,
        title: "PR only workspace",
        headRef: "feature/pr-only",
        headSha: "abc123",
        approvedCount: 1,
        lastCommitAuthorLogin: "bot",
        labels: [],
      },
    ],
  }),
  useSwitchRepository: () => vi.fn(),
}));

vi.mock("@/store", () => {
  const state = {
    repository: { owner: "zenmoney", repo: "sms-formats" },
    sourceRef: {
      type: "pr" as const,
      name: "feature/pr-only",
      sha: "abc123",
      prNumber: 123,
    },
  };
  const draftStore = {
    drafts: new Map(),
    getChangedFiles: () => [],
    hasDrafts: () => false,
    clearAll: vi.fn(),
  };
  return {
    useSourceStore: (selector: (value: typeof state) => unknown) =>
      selector(state),
    useDraftStore: () => draftStore,
  };
});

import { SourceSelector } from "./SourceSelector";

describe("SourceSelector", () => {
  it("renders classic repo trigger without search or commit SHA selector", () => {
    render(<SourceSelector allowRepoSwitch />);

    expect(
      screen.getByRole("button", { name: "zenmoney/sms-formats" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "zenmoney/sms-formats" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("abc12")).not.toBeInTheDocument();
  });
});
