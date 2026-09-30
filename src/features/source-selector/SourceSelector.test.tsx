import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";

mock.module("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

mock.module("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => mock(),
}));

mock.module("@/hooks/useGitHub", () => ({
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
  useSwitchRepository: () => mock(),
}));

mock.module("@/store", () => {
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
    clearAll: mock(),
  };
  return {
    useSourceStore: (selector: (value: typeof state) => unknown) =>
      selector(state),
    useDraftStore: () => draftStore,
  };
});

const { SourceSelector } = await import("./SourceSelector");

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
