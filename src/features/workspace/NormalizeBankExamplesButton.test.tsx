import { beforeEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

mock.module("idb-keyval", () => ({ get: mock(), set: mock(), del: mock() }));
mock.module("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const load = mock();
mock.module("@/infrastructure/file-content", () => ({
  loadFileContents: load,
}));
const { useDraftStore, waitForDraftStoreHydration } = await import("@/store");
const { serializeFormat } = await import("@/domain/format");
const { NormalizeBankExamplesButton } = await import(
  "./NormalizeBankExamplesButton"
);
const a = "src/bank/formats/a.txt";
const b = "src/bank/formats/b.txt";
const local = "src/bank/formats/local.txt";
const removed = "src/bank/formats/removed.txt";
const original = serializeFormat(
  "^(е\u0308)$",
  ["comment"],
  ["е\u0308", "и\u0306"]
);
function mount(readOnly = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NormalizeBankExamplesButton
        filePaths={[a, b, local, removed]}
        headSha="head"
        readOnly={readOnly}
        repository={{ owner: "owner", repo: "repo" }}
      />
    </QueryClientProvider>
  );
}
const button = () =>
  screen.getByRole("button", { name: "editor.normalizeAllExamples" });
beforeEach(async () => {
  await waitForDraftStoreHydration();
  useDraftStore.getState().discardAll();
  useDraftStore.getState().activateScope("nfc-test", false);
  load.mockReset();
});
test("uses latest edits after loading, normalizes remote and local examples, and undoes per file", async () => {
  let resolve!: (value: { contents: Map<string, string> }) => void;
  load.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  useDraftStore.getState().applyUserEdit(local, original, "head", null);
  useDraftStore.getState().ensureDraft(removed, original, "head", original);
  useDraftStore.getState().markDeleted(removed);
  mount();
  expect(button()).toBeDisabled();
  const edited = original.replace("е\u0308\n", "  е\u0308 😀\n");
  act(() =>
    useDraftStore.getState().applyUserEdit(a, edited, "head", original)
  );
  await act(async () =>
    resolve({
      contents: new Map([
        [a, original],
        [b, original],
        [removed, original],
      ]),
    })
  );
  await waitFor(() => expect(button()).not.toBeDisabled());
  fireEvent.click(button());
  expect(useDraftStore.getState().getDraft(a)?.content).toBe(
    edited.replace("  е\u0308 😀", "  ё 😀").replace("и\u0306\n", "й\n")
  );
  expect(useDraftStore.getState().getDraft(b)?.content).toBe(
    original.replace("е\u0308\n", "ё\n").replace("и\u0306\n", "й\n")
  );
  expect(useDraftStore.getState().getDraft(local)?.content).toBe(
    useDraftStore.getState().getDraft(b)?.content
  );
  expect(useDraftStore.getState().getDraft(removed)?.isDeleted).toBe(true);
  expect(button()).toBeDisabled();
  act(() => useDraftStore.getState().undo(a));
  expect(useDraftStore.getState().getDraft(a)?.content).toBe(edited);
  expect(button()).not.toBeDisabled();
  act(() => useDraftStore.getState().undo(b));
  expect(useDraftStore.getState().getDraft(b)?.content).toBe(original);
  act(() => useDraftStore.getState().undo(local));
  expect(useDraftStore.getState().getDraft(local)?.content).toBe(original);
});
test("readonly keeps the button visible and disabled without fetching", () => {
  useDraftStore.getState().applyUserEdit(local, original, "head", null);
  mount(true);
  expect(button()).toBeDisabled();
  expect(load).not.toHaveBeenCalled();
});
test("failed bank loading prevents partial normalization and offers retry", async () => {
  load.mockRejectedValueOnce(new Error("offline"));
  load.mockResolvedValue({ contents: new Map([[a, original]]) });
  mount();
  await screen.findByText("app.error: offline");
  expect(button()).toBeDisabled();
  expect(useDraftStore.getState().getDraft(a)).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "app.retry" }));
  await waitFor(() => expect(button()).not.toBeDisabled());
});
