import { expect, it, mock } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const filePath = "src/Bank_123/formats/example.txt";
const original = "^SMS$\n\n-----COLUMNS-----\n\n-----EXAMPLE-----\nSMS\n";

mock.module("idb-keyval", () => ({
  get: async () => undefined,
  del: async () => undefined,
  set: async () => undefined,
  update: async () => undefined,
}));
mock.module("@/infrastructure/github", () => ({
  getGitHubUserToken: () => "test-token",
  getGitHubAuthChangeVersion: () => 0,
  subscribeGitHubAuthChange: () => () => undefined,
  fetchSourceHead: async () => ({
    sourceRef: { type: "main", name: "main", sha: "head" },
    checkedAt: Date.now(),
  }),
  fetchRepoTree: async () => [{ path: filePath, type: "blob", sha: "blob" }],
}));
mock.module("@/infrastructure/file-content", () => ({
  loadFileContent: async () => original,
}));
mock.module("@/features/format-editor/FormatEditor", () => ({
  FormatEditor: () => null,
}));
mock.module("@/features/senders-editor/SendersEditor", () => ({
  SendersEditor: () => null,
}));
mock.module("@/features/workspace-header/WorkspaceHeaderBar", () => ({
  WorkspaceHeaderBar: () => null,
}));

const { useDraftStore } = await import("@/store");
const { SourceWorkspace } = await import("./SourceWorkspace");

it("shows the blue change badge for edits to a file opened by link and removes it on reset", async () => {
  render(
    <MemoryRouter
      initialEntries={[`/repo/zenmoney/sms-formats/main?file=${filePath}`]}
    >
      <Routes>
        <Route element={<SourceWorkspace />} path="/repo/:owner/:repo/main" />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
  const row = screen.getByRole("button", { name: "example.txt" });
  expect(row.querySelector('[data-slot="badge"]')).toBeNull();
  act(() => {
    useDraftStore
      .getState()
      .applyUserEdit(filePath, `${original}\n`, "head", original);
  });
  expect(row).not.toHaveTextContent("*");
  const badge = row.querySelector('[data-slot="badge"]');
  expect(badge).toHaveAttribute("data-variant", "modified");
  expect(badge).toHaveTextContent("●");
  expect(badge).toHaveClass("text-primary");
  act(() => useDraftStore.getState().resetFileToRemote(filePath));
  expect(row.querySelector('[data-slot="badge"]')).toBeNull();
});
