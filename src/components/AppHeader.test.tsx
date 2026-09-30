import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = {
  changeLanguage: mock(),
  hardResetAppState: mock(async () => undefined),
  navigate: mock(),
  setLocale: mock(),
};

mock.module("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      changeLanguage: mocks.changeLanguage,
    },
    t: (key: string) => key,
  }),
}));

mock.module("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => mocks.navigate,
}));

mock.module("@/components/ModalDialog", () => ({
  ModalDialog: ({
    children,
    title,
  }: {
    children: ReactNode;
    title: ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      {children}
    </div>
  ),
}));

mock.module("@/infrastructure/github", () => ({
  getCachedPullRequestApprovalPermission: mock(() => false),
  getGitHubAuthChangeVersion: mock(() => 0),
  getGitHubUserToken: mock(() => "ghp_saved"),
  refreshPullRequestApprovalPermission: mock(async () => false),
  setGitHubUserToken: mock(),
  subscribeGitHubAuthChange: mock(() => () => undefined),
  validateToken: mock(async () => undefined),
}));

mock.module("@/features/source-selector/SourceSelector", () => ({
  SourceSelector: () => <div data-testid="source-selector" />,
}));

mock.module("@/store", () => ({
  useSourceStore: (
    selector: (state: {
      repository: { owner: string; repo: string };
    }) => unknown
  ) =>
    selector({
      repository: { owner: "zenmoney", repo: "sms-formats" },
    }),
  useUIStore: (
    selector: (state: {
      locale: string;
      setLocale: typeof mocks.setLocale;
    }) => unknown
  ) =>
    selector({
      locale: "ru",
      setLocale: mocks.setLocale,
    }),
}));

mock.module("@/store/hard-reset", () => ({
  hardResetAppState: mocks.hardResetAppState,
}));

const { AppHeader } = await import("./AppHeader");

describe("AppHeader", () => {
  beforeEach(() => {
    mocks.changeLanguage.mockReset();
    mocks.hardResetAppState.mockClear();
    mocks.navigate.mockReset();
    mocks.setLocale.mockReset();
  });

  it("renders hard reset button in token settings and calls it on click", async () => {
    render(<AppHeader />);

    fireEvent.click(
      screen.getByRole("button", { name: "githubAuth.openSettings" })
    );

    const hardResetButton = screen.getByRole("button", {
      name: "githubAuth.hardReset",
    });

    fireEvent.click(hardResetButton);

    await waitFor(() => {
      expect(mocks.hardResetAppState).toHaveBeenCalledTimes(1);
    });
  });
});
