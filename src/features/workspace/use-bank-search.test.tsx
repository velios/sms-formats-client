import { afterEach, expect, it, mock } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";

const mocks = { load: mock() };
mock.module("@/infrastructure/file-content", () => ({
  loadFileContent: mocks.load,
}));

const { serializeFormat } = await import("@/domain/format");
const { useBankFormatSearch } = await import("./use-bank-search");
afterEach(() => mock.clearAllMocks());

const path = "src/Bank/formats/a.txt";
const params = {
  allFormatFiles: [path],
  changedFormatFiles: new Set<string>(),
  draftStore: { drafts: new Map(), getDraft: () => undefined },
  formatTab: "all" as const,
  bankPath: "src/Bank",
  prNumber: 1,
  repository: { owner: "test", repo: "repo" },
};

it("reindexes the same paths when the head revision changes", async () => {
  mocks.load.mockImplementation(async ({ commitSha }) =>
    serializeFormat(
      "^.+$",
      ["comment"],
      [commitSha === "old" ? "alpha" : "beta"]
    )
  );
  const hook = renderHook(
    ({ revision, query }) =>
      useBankFormatSearch({
        ...params,
        sourceHeadSha: revision,
        formatSearch: query,
      }),
    { initialProps: { revision: "old", query: "alpha" } }
  );
  await waitFor(() =>
    expect(hook.result.current.filteredFormatFiles).toEqual([path])
  );
  hook.rerender({ revision: "new", query: "beta" });
  await waitFor(() =>
    expect(hook.result.current.filteredFormatFiles).toEqual([path])
  );
  hook.rerender({ revision: "new", query: "alpha" });
  expect(hook.result.current.filteredFormatFiles).toEqual([]);
  expect(mocks.load).toHaveBeenCalledTimes(2);
});

it("ignores the previous revision finishing while the next revision is loading", async () => {
  let finishOld!: (content: string) => void;
  let finishNew!: (content: string) => void;
  mocks.load.mockImplementation(
    ({ commitSha }) =>
      new Promise<string>((resolve) => {
        if (commitSha === "old") {
          finishOld = resolve;
        } else {
          finishNew = resolve;
        }
      })
  );
  const hook = renderHook(
    ({ revision }) =>
      useBankFormatSearch({
        ...params,
        sourceHeadSha: revision,
        formatSearch: "beta",
      }),
    { initialProps: { revision: "old" } }
  );
  hook.rerender({ revision: "new" });
  await act(async () =>
    finishOld(serializeFormat("^.+$", ["comment"], ["alpha"]))
  );
  expect(hook.result.current.indexingInFlight).toBe(1);
  expect(hook.result.current.indexedScopeSummary.loadedCount).toBe(0);
  await act(async () =>
    finishNew(serializeFormat("^.+$", ["comment"], ["beta"]))
  );
  expect(hook.result.current.filteredFormatFiles).toEqual([path]);
  expect(mocks.load).toHaveBeenCalledTimes(2);
});
