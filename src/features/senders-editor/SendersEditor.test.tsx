import { beforeEach, expect, it, mock } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { setTestGlobal } from "@/test-globals";

setTestGlobal("localStorage", {
  getItem: () => null,
  setItem: () => undefined,
});
mock.module("idb-keyval", () => ({ get: mock(), set: mock(), del: mock() }));
mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
mock.module("@/hooks/useWorkspaceFileContent", () => ({
  useWorkspaceFileContent: () => ({
    data: "BANK",
    isLoading: false,
    error: null,
  }),
}));

const { useDraftStore, useSourceStore, waitForDraftStoreHydration } =
  await import("@/store");
const { SendersEditor } = await import("./SendersEditor");
const path = "src/Bank/senders.txt";

beforeEach(async () => {
  await waitForDraftStoreHydration();
  useDraftStore.getState().activateScope("senders-test", false);
  useSourceStore
    .getState()
    .setSource({ type: "pr", name: "pr-1", prNumber: 1, sha: "head" });
});

it.each([false, true])(
  "blocks history shortcuts when read-only (redo=%s)",
  (redo) => {
    const view = render(<SendersEditor bankPath="src/Bank" />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "OTHER" },
    });
    if (redo) {
      act(() => useDraftStore.getState().undo(path));
    }
    const before = useDraftStore.getState().getDraft(path)?.content;
    view.rerender(<SendersEditor bankPath="src/Bank" readOnly />);
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "z",
      ctrlKey: true,
      shiftKey: redo,
    });
    expect(useDraftStore.getState().getDraft(path)?.content).toBe(before);
  }
);

it("does not replace a published draft baseline with the previous revision body", () => {
  const view = render(<SendersEditor bankPath="src/Bank" />);
  act(() =>
    useDraftStore.getState().setDraft(path, "LATER", "published", "COMMITTED")
  );
  view.rerender(<SendersEditor bankPath="src/Bank" readOnly />);
  expect(useDraftStore.getState().getDraft(path)).toMatchObject({
    content: "LATER",
    baselineHeadSha: "published",
    headContent: "COMMITTED",
  });
});
