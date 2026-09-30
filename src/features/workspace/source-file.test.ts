import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { CheckedSourceHead, SourceTarget } from "@/domain/types";
import { setTestGlobal } from "@/test-globals";

setTestGlobal("localStorage", {
  getItem: () => null,
  setItem: () => undefined,
});
const storage = new Map<string, unknown>();
mock.module("idb-keyval", () => ({
  get: async (key: string) => storage.get(key),
  update: async (key: string, updater: (previous: unknown) => unknown) => {
    storage.set(key, updater(storage.get(key)));
  },
  set: async (key: string, value: unknown) => {
    storage.set(key, value);
  },
  del: async (key: string) => {
    storage.delete(key);
  },
}));
let authVersion = 0;
let token: string | null = null;
let sha = "commit-1";
let checkedAt = Date.now();
const fetchHead = async (source: SourceTarget): Promise<CheckedSourceHead> => ({
  sourceRef:
    source.type === "main"
      ? { type: "main", name: "main", sha }
      : { ...source, name: "feature", sha },
  checkedAt,
  ...(source.type === "pr" ? { prState: "closed" as const } : {}),
});
const headRequest = mock(fetchHead);
const contentRequest = mock(
  async (_path: string, revision: string) => revision
);
const treeRequest = mock(async () => []);
mock.module("@/infrastructure/github", () => ({
  fetchSourceHead: headRequest,
  fetchFileContent: contentRequest,
  fetchRepoTree: treeRequest,
  getGitHubAuthChangeVersion: () => authVersion,
  getGitHubUserToken: () => token,
}));
const { queryClient } = await import("@/lib/query-client");
const { getCheckedSourceHead, resolveSourceHead, SOURCE_HEAD_TTL } =
  await import("./source-file");
const { useDraftStore, useSourceStore, waitForDraftStoreHydration } =
  await import("@/store");
const { SourceExperimentController } = await import("./source-experiment");
const repository = { owner: "zenmoney", repo: "sms-formats" };
const source = { type: "main" as const };
const filePath = "src/bank/formats/1.txt";
const make = (target: SourceTarget = source) =>
  new SourceExperimentController(repository, target, false);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function calls() {
  return headRequest.mock.calls.length + contentRequest.mock.calls.length;
}
function resetCalls() {
  headRequest.mockClear();
  contentRequest.mockClear();
}

beforeEach(async () => {
  await waitForDraftStoreHydration();
  storage.clear();
  queryClient.clear();
  resetCalls();
  treeRequest.mockClear();
  headRequest.mockReset().mockImplementation(fetchHead);
  contentRequest
    .mockReset()
    .mockImplementation(async (_path: string, revision: string) => revision);
  useDraftStore.setState({
    drafts: new Map(),
    storedDraftsByScope: {},
    workspaceSessionsByScope: {},
    draftScopeKey: null,
  });
  useSourceStore.setState({ repository, sourceRef: null, tree: [], banks: [] });
  sha = "commit-1";
  checkedAt = Date.now();
  authVersion = 0;
  token = null;
});

describe("source head and single-file experiment integration", () => {
  it("persists untouched head and body with the 2/0/1/1/2 request budget", async () => {
    const controller = make();
    await controller.open(filePath);
    expect(useDraftStore.getState().getDraft(filePath)?.headContent).toBe(
      "commit-1"
    );
    const first = controller.getSnapshot().head;
    expect(calls()).toBe(2);
    // Clear RAM documents to exercise persisted immutable body independently of drafts.
    queryClient.clear();
    useDraftStore.setState({ drafts: new Map(), storedDraftsByScope: {} });
    resetCalls();
    const restored = make();
    await restored.open(filePath);
    expect(restored.getSnapshot().head).toEqual(first);
    expect(calls()).toBe(0);
    resetCalls();
    await restored.select("src/bank/formats/2.txt");
    expect(calls()).toBe(1);
    for (const [key, value] of storage) {
      if (key.includes("source-head")) {
        storage.set(key, {
          ...(value as object),
          checkedAt: Date.now() - SOURCE_HEAD_TTL,
        });
      }
    }
    resetCalls();
    const expired = make();
    await expired.open(filePath);
    expect(calls()).toBe(1);
    resetCalls();
    sha = "commit-2";
    await expired.refresh();
    expect(calls()).toBe(2);
    expect(useDraftStore.getState().getDraft(filePath)?.headContent).toBe(
      "commit-2"
    );
    expect(treeRequest).not.toHaveBeenCalled();
  });

  it("checks manually and on authenticated opening while local history makes no requests", async () => {
    const controller = make();
    await controller.open(filePath);
    resetCalls();
    const store = useDraftStore.getState();
    store.applyUserEdit(filePath, "edited", "commit-1", "commit-1");
    store.undo(filePath);
    store.redo(filePath);
    expect(calls()).toBe(0);
    await controller.checkUpdates();
    expect(calls()).toBe(1);
    resetCalls();
    token = "token";
    await make().open(filePath);
    expect(calls()).toBe(1);
  });

  it("distinguishes empty, missing and failed PR bodies without changing source", async () => {
    const target = { type: "pr" as const, prNumber: 123 };
    contentRequest.mockResolvedValueOnce("");
    const empty = make(target);
    await empty.open(filePath);
    expect(empty.getSnapshot().missing).toBe(false);
    expect(empty.getSnapshot().head?.prState).toBe("closed");
    expect(useDraftStore.getState().getDraft(filePath)?.headContent).toBe("");
    contentRequest.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { status: 404 })
    );
    const missingPath = "src/bank/formats/missing.txt";
    await empty.select(missingPath);
    expect(empty.getSnapshot().missing).toBe(true);
    contentRequest.mockRejectedValueOnce(new Error("network"));
    await empty.select("src/bank/formats/error.txt");
    expect(empty.getSnapshot().error).toContain("network");
    expect(empty.getSnapshot().missing).toBe(false);
    expect(
      headRequest.mock.calls.every(([target]) => target.type === "pr")
    ).toBe(true);
    expect(useSourceStore.getState().sourceRef?.type).toBe("pr");
  });

  it("failed checking preserves verified metadata and existing edits", async () => {
    const controller = make();
    await controller.open(filePath);
    const first = await getCheckedSourceHead(repository, source);
    useDraftStore
      .getState()
      .applyUserEdit(filePath, "edited", "commit-1", "commit-1");
    headRequest.mockRejectedValueOnce(new Error("offline"));
    await controller.checkUpdates();
    expect(controller.getSnapshot().error).toContain("offline");
    expect(await getCheckedSourceHead(repository, source)).toEqual(first);
    expect(useDraftStore.getState().getDraft(filePath)?.content).toBe("edited");
  });

  it("late bodies cannot overwrite a new file, source, same-source reopen or token context", async () => {
    for (const change of ["file", "source", "reopen", "token"]) {
      storage.clear();
      queryClient.clear();
      useDraftStore.setState({ drafts: new Map(), storedDraftsByScope: {} });
      const waiting = deferred<string>();
      const started = deferred<void>();
      contentRequest.mockImplementationOnce(() => {
        started.resolve();
        return waiting.promise;
      });
      const old = make();
      const opening = old.open(filePath);
      await started.promise;
      if (change === "file") {
        await old.select("src/bank/formats/new.txt");
      } else {
        old.deactivate();
        if (change === "token") {
          authVersion += 1;
        }
        const next = make(
          change === "source" ? { type: "pr", prNumber: 9 } : source
        );
        // A different path avoids waiting on the old in-flight immutable query.
        await next.open("src/bank/formats/new.txt");
      }
      waiting.resolve("OLD");
      await opening;
      expect(
        useDraftStore.getState().getDraft("src/bank/formats/new.txt")?.content
      ).toBe("commit-1");
      expect(useSourceStore.getState().sourceRef?.type).toBe(
        change === "source" ? "pr" : "main"
      );
      if (change !== "file") {
        expect(useDraftStore.getState().getDraft(filePath)).toBeUndefined();
      }
    }
  });
});

it("late same-source head cannot roll back verified metadata after reopening", async () => {
  const waiting = deferred<CheckedSourceHead>();
  const started = deferred<void>();
  headRequest.mockImplementationOnce(() => {
    started.resolve();
    return waiting.promise;
  });
  const old = make();
  const opening = old.open(filePath);
  await started.promise;
  old.deactivate();
  sha = "commit-NEW";
  const accepted = make();
  await accepted.open(filePath);
  waiting.resolve({
    sourceRef: { type: "main", name: "main", sha: "commit-OLD" },
    checkedAt: Date.now() + 1000,
  });
  await opening;
  queryClient.clear();
  resetCalls();
  expect(await resolveSourceHead({ repository, source })).toEqual(
    accepted.getSnapshot().head!
  );
  expect(calls()).toBe(0);
  expect(useSourceStore.getState().sourceRef?.sha).toBe("commit-NEW");
});

it("head finishing after auth change cannot persist stale freshness", async () => {
  const waiting = deferred<CheckedSourceHead>();
  const started = deferred<void>();
  headRequest.mockImplementationOnce(() => {
    started.resolve();
    return waiting.promise;
  });
  const old = make();
  const opening = old.open(filePath);
  await started.promise;
  authVersion += 1;
  waiting.resolve({
    sourceRef: { type: "main", name: "main", sha: "OLD" },
    checkedAt,
  });
  await opening;
  expect(await getCheckedSourceHead(repository, source)).toBeUndefined();
  expect(useSourceStore.getState().sourceRef).toBeNull();
  expect(contentRequest).not.toHaveBeenCalled();
});

it("first unavailable source reports error and explicit reopening retries", async () => {
  headRequest.mockRejectedValueOnce(new Error("inaccessible source"));
  const controller = make();
  await controller.open(filePath);
  expect(controller.getSnapshot().head).toBeNull();
  expect(controller.getSnapshot().error).toContain("inaccessible source");
  expect(contentRequest).not.toHaveBeenCalled();
  await controller.open(filePath);
  expect(controller.getSnapshot().error).toBeNull();
  expect(useDraftStore.getState().getDraft(filePath)?.content).toBe("commit-1");
});
