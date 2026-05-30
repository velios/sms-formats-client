import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
  hardResetAppState: vi.fn(async () => undefined),
  navigate: vi.fn(),
  setLocale: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      changeLanguage: mocks.changeLanguage,
    },
    t: (key: string) => key,
  }),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/components/ModalDialog", () => ({
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

vi.mock("@/domain/github", () => ({
  getCachedPullRequestApprovalPermission: vi.fn(() => false),
  getGitHubAuthChangeVersion: vi.fn(() => 0),
  getGitHubUserToken: vi.fn(() => "ghp_saved"),
  refreshPullRequestApprovalPermission: vi.fn(async () => false),
  setGitHubUserToken: vi.fn(),
  subscribeGitHubAuthChange: vi.fn(() => () => undefined),
  validateToken: vi.fn(async () => undefined),
}));

vi.mock("@/features/source-selector/SourceSelector", () => ({
  SourceSelector: () => <div data-testid="source-selector" />,
}));

vi.mock("@/store", () => ({
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

vi.mock("@/store/hard-reset", () => ({
  hardResetAppState: mocks.hardResetAppState,
}));

import { AppHeader } from "./AppHeader";

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
