import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  useDraftStore,
  useSourceStore,
  waitForDraftStoreHydration,
} from "@/store";
import { SendersEditor } from "./SendersEditor";

vi.hoisted(() =>
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
  })
);
vi.mock("idb-keyval", () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/useWorkspaceFileContent", () => ({
  useWorkspaceFileContent: () => ({
    data: "BANK",
    isLoading: false,
    error: null,
  }),
}));
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
