import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type {
  WorkspaceSessionController,
  WorkspaceState,
} from "./workspace-session";

mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const actions = {
  checkUpdates: mock(),
  discardAndRefresh: mock(),
  open: mock(),
  syncPublication: mock(),
};
const controller = actions as unknown as WorkspaceSessionController;
const readyState: WorkspaceState = {
  session: {
    status: "supported",
    repository: { owner: "zenmoney", repo: "sms-formats" },
    prNumber: 123,
    headSha: "head-sha",
    baseSha: "base-sha",
    bankPath: "src/TBank_123",
    writable: true,
    readOnlyReason: null,
    changedFiles: [],
  },
  nextSession: null,
  block: null,
  operation: null,
  error: null,
};

const { WorkspaceSessionNotice } = await import("./WorkspaceSessionNotice");

describe("WorkspaceSessionNotice", () => {
  beforeEach(() => {
    for (const action of Object.values(actions)) {
      action.mockClear();
    }
  });

  it("leaves no notice row or manual check action in a ready workspace", () => {
    const { container } = render(
      <WorkspaceSessionNotice controller={controller} state={readyState} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    {
      state: { ...readyState, session: null, error: "opening failed" },
      label: "app.retry",
      action: "open" as const,
    },
    {
      state: { ...readyState, block: "sync-pending" as const },
      label: "workspace.retrySync",
      action: "syncPublication" as const,
    },
  ])("preserves the $action recovery action", ({ state, label, action }) => {
    render(<WorkspaceSessionNotice controller={controller} state={state} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(actions[action]).toHaveBeenCalledOnce();
    expect(actions.checkUpdates).not.toHaveBeenCalled();
  });
});
