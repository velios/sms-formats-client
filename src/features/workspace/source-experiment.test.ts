import { beforeEach, expect, it, mock } from "bun:test";
import type { CheckedSourceHead, FileEntry } from "@/domain/types";
import { setTestGlobal } from "@/test-globals";

setTestGlobal("localStorage", {
  getItem: () => null,
  setItem: () => undefined,
});
const storage = new Map<string, unknown>();
mock.module("idb-keyval", () => ({
  get: async (key: string) => storage.get(key),
  set: async (key: string, value: unknown) => {
    storage.set(key, value);
  },
  del: async (key: string) => {
    storage.delete(key);
  },
}));
let auth = 0;
let sha = "A";
const head = mock(
  async (): Promise<CheckedSourceHead> => ({
    sourceRef: { type: "main", name: "main", sha },
    checkedAt: 123,
  })
);
mock.module("./source-file", () => ({ resolveSourceHead: head }));
const a = "src/Bank/formats/a.txt";
const b = "src/Bank/formats/b.txt";
const other = "src/Other/formats/a.txt";
const tree = mock(
  async (): Promise<FileEntry[]> =>
    [a, b, other].map((path) => ({ path, sha: "blob", type: "blob" }))
);
const content = mock(
  async ({ commitSha, filePath }: { commitSha: string; filePath: string }) =>
    `${commitSha}:${filePath}`
);
mock.module("@/infrastructure/github", () => ({
  fetchRepoTree: tree,
  getGitHubAuthChangeVersion: () => auth,
}));
mock.module("@/infrastructure/file-content", () => ({
  loadFileContent: content,
}));
const { useDraftStore, useSourceStore, waitForDraftStoreHydration } =
  await import("@/store");
const { SourceExperimentController } = await import("./source-experiment");
const repository = { owner: "owner", repo: "repo" };
const make = (full = false) =>
  new SourceExperimentController(repository, { type: "main" }, full);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  await waitForDraftStoreHydration();
  auth = 0;
  sha = "A";
  useDraftStore.setState({
    drafts: new Map(),
    storedDraftsByScope: {},
    workspaceSessionsByScope: {},
    draftScopeKey: null,
  });
  useSourceStore.setState({ repository, sourceRef: null, tree: [], banks: [] });
  head.mockClear();
  tree.mockClear();
  content
    .mockReset()
    .mockImplementation(
      async ({ commitSha, filePath }) => `${commitSha}:${filePath}`
    );
});
function edit(path = a) {
  const store = useDraftStore.getState();
  const draft = store.getDraft(path)!;
  store.applyUserEdit(
    path,
    `edited:${path}`,
    draft.baselineHeadSha,
    draft.headContent
  );
}
it("anonymous opening and local history load only the selected body", async () => {
  const controller = make();
  await controller.open(a);
  edit();
  useDraftStore.getState().undo(a);
  useDraftStore.getState().redo(a);
  expect(tree).not.toHaveBeenCalled();
  expect(content).toHaveBeenCalledTimes(1);
  expect(useDraftStore.getState().getDraft(a)?.content).toBe(`edited:${a}`);
  await controller.select(b);
  expect(head).toHaveBeenCalledTimes(1);
  expect(content).toHaveBeenCalledTimes(2);
});
it("restores old baseline and edits, preparing changed head without rebasing", async () => {
  const controller = make();
  await controller.open(a);
  edit();
  sha = "B";
  const next = make();
  await next.open(a);
  expect(next.getSnapshot().nextHead?.sourceRef.sha).toBe("B");
  expect(useDraftStore.getState().getDraft(a)).toMatchObject({
    baselineHeadSha: "A",
    headContent: `A:${a}`,
    content: `edited:${a}`,
  });
  expect(content).toHaveBeenLastCalledWith({
    repository,
    filePath: a,
    commitSha: "B",
  });
});
it("normal reset restores only the selected experiment without any network", async () => {
  const controller = make(true);
  await controller.open(a);
  edit();
  await controller.select(b);
  edit(b);
  useDraftStore.getState().resetFileToRemote(a);
  expect(useDraftStore.getState().getDraft(a)?.content).toBe(`A:${a}`);
  expect(useDraftStore.getState().getDraft(b)?.content).toBe(`edited:${b}`);
  expect(head).toHaveBeenCalledTimes(1);
  expect(content).toHaveBeenCalledTimes(2);
});
it("anonymous refresh resets current file only", async () => {
  const controller = make();
  await controller.open(a);
  edit();
  await controller.select(b);
  edit(b);
  sha = "B";
  await controller.refresh();
  expect(useDraftStore.getState().getDraft(a)?.content).toBe(`edited:${a}`);
  expect(useDraftStore.getState().getDraft(b)?.baselineHeadSha).toBe("B");
});
it("full main refresh resets selected bank only and lazy bodies use one prepared SHA", async () => {
  const controller = make(true);
  await controller.open(a);
  edit();
  await controller.select(b);
  edit(b);
  await controller.select(other);
  edit(other);
  await controller.select(a);
  sha = "B";
  await controller.checkUpdates();
  expect(useDraftStore.getState().getDraft(a)?.baselineHeadSha).toBe("A");
  await controller.refresh();
  expect(useDraftStore.getState().getDraft(other)?.content).toBe(
    `edited:${other}`
  );
  expect(useDraftStore.getState().getDraft(a)?.content).toBe(`B:${a}`);
  expect(useDraftStore.getState().getDraft(b)).toBeUndefined();
  sha = "C";
  await controller.select(b);
  expect(content).toHaveBeenLastCalledWith({
    repository,
    filePath: b,
    commitSha: "B",
  });
  expect(useSourceStore.getState().sourceRef?.sha).toBe("B");
});
it("preparation failure preserves every old draft and baseline", async () => {
  const controller = make(true);
  await controller.open(a);
  edit();
  await controller.select(b);
  edit(b);
  sha = "B";
  content.mockRejectedValueOnce(new Error("failed preparation"));
  await controller.refresh();
  expect(controller.getSnapshot().error).toContain("failed preparation");
  expect(useDraftStore.getState().getDraft(a)?.baselineHeadSha).toBe("A");
  expect(useDraftStore.getState().getDraft(b)?.content).toBe(`edited:${b}`);
  expect(useSourceStore.getState().sourceRef?.sha).toBe("A");
});
it("prepares explicit missing current head and preserves restored local document", async () => {
  const controller = make();
  await controller.open(a);
  edit();
  sha = "B";
  content.mockRejectedValueOnce(
    Object.assign(new Error("not found"), { status: 404 })
  );
  const next = make();
  await next.open(a);
  expect(next.getSnapshot().missing).toBe(true);
  expect(useDraftStore.getState().getDraft(a)?.content).toBe(`edited:${a}`);
  content.mockRejectedValueOnce(
    Object.assign(new Error("not found"), { status: 404 })
  );
  await next.refresh();
  expect(next.getSnapshot().missing).toBe(true);
  expect(useDraftStore.getState().getDraft(a)).toBeUndefined();
});
it("retries selected file content failure without checking head or losing other edits", async () => {
  const controller = make(true);
  await controller.open(a);
  edit();
  content.mockRejectedValueOnce(new Error("body failed"));
  await controller.select(b);
  expect(controller.getSnapshot().error).toContain("body failed");
  await controller.select(b, true);
  expect(controller.getSnapshot().error).toBeNull();
  expect(useDraftStore.getState().getDraft(b)?.content).toBe(`A:${b}`);
  expect(useDraftStore.getState().getDraft(a)?.content).toBe(`edited:${a}`);
  expect(head).toHaveBeenCalledTimes(1);
});
it("uses latest selection when file changes before initial head finishes", async () => {
  const waiting = deferred<CheckedSourceHead>();
  head.mockReturnValueOnce(waiting.promise);
  const controller = make();
  const opening = controller.open(a);
  await Promise.resolve();
  await controller.select(b);
  waiting.resolve({
    sourceRef: { type: "main", name: "main", sha: "A" },
    checkedAt: 123,
  });
  await opening;
  expect(controller.getSnapshot().filePath).toBe(b);
  expect(content).toHaveBeenCalledTimes(1);
  expect(useDraftStore.getState().getDraft(a)).toBeUndefined();
});
it("ignores late selection bodies after authorization change", async () => {
  const controller = make();
  await controller.open(a);
  const waiting = deferred<string>();
  content.mockReturnValueOnce(waiting.promise);
  const selecting = controller.select(b);
  auth += 1;
  controller.deactivate();
  waiting.resolve("obsolete");
  await selecting;
  expect(useDraftStore.getState().getDraft(b)).toBeUndefined();
});
it("recovers persisted local document when freshness check fails", async () => {
  const controller = make();
  await controller.open(a);
  edit();
  head.mockRejectedValueOnce(new Error("offline"));
  const next = make();
  await next.open(a);
  expect(next.getSnapshot().head?.sourceRef.sha).toBe("A");
  expect(next.getSnapshot().error).toContain("offline");
  expect(useDraftStore.getState().getDraft(a)?.content).toBe(`edited:${a}`);
});
it("cancels pending refresh when navigation changes file and preserves confirmed bank drafts", async () => {
  const controller = make(true);
  await controller.open(a);
  edit();
  await controller.select(b);
  edit(b);
  await controller.select(a);
  sha = "B";
  const waiting = deferred<string>();
  const started = deferred<void>();
  content.mockImplementationOnce(() => {
    started.resolve();
    return waiting.promise;
  });
  const refreshing = controller.refresh();
  await started.promise;
  await controller.select(b);
  waiting.resolve("new-A");
  await refreshing;
  expect(controller.getSnapshot().filePath).toBe(b);
  expect(useSourceStore.getState().sourceRef?.sha).toBe("A");
  expect(useDraftStore.getState().getDraft(a)?.content).toBe(`edited:${a}`);
  expect(useDraftStore.getState().getDraft(b)?.content).toBe(`edited:${b}`);
});
