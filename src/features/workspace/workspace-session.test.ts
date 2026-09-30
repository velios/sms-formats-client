import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "@/domain/types";
import {
  useDraftStore,
  useSourceStore,
  waitForDraftStoreHydration,
} from "@/store";
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
  type WorkspaceSession,
} from "@/store/workspace-session";
import { WorkspaceSessionController } from "./workspace-session";

vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
});
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  tree: vi.fn(),
  content: vi.fn(),
  storage: new Map<string, string>(),
}));
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => mocks.storage.get(key)),
  set: vi.fn(async (key: string, value: string) => {
    mocks.storage.set(key, value);
  }),
  del: vi.fn(),
}));
vi.mock("@/infrastructure/github", () => ({
  resolvePullRequestWorkspace: mocks.resolve,
  fetchRepoTree: mocks.tree,
}));
vi.mock("@/infrastructure/file-content", () => ({
  loadFileContent: mocks.content,
}));

const repository = { owner: "zenmoney", repo: "sms-formats" };
const path = "src/Bank/formats/a.txt";
const tree: FileEntry[] = [{ path, sha: "blob", type: "blob" }];
const session = (headSha = "head", prNumber = 1): WorkspaceSession => ({
  status: "supported",
  repository,
  prNumber,
  headSha,
  baseSha: "base",
  bankPath: "src/Bank",
  writable: true,
  readOnlyReason: null,
  changedFiles: [{ kind: "modify", path }],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const controllers: WorkspaceSessionController[] = [];
function makeController(prNumber: number) {
  const controller = new WorkspaceSessionController(repository, prNumber);
  controllers.push(controller);
  return controller;
}
afterEach(() => {
  for (const controller of controllers.splice(0)) {
    controller.deactivate();
  }
});
async function open(prNumber = 1) {
  const controller = makeController(prNumber);
  controller.selectFile(path);
  await controller.open();
  return controller;
}
function edit() {
  useDraftStore.getState().setDraft(path, "edited", "head", "original");
}

describe("workspace lifecycle", () => {
  beforeEach(async () => {
    await waitForDraftStoreHydration();
    useDraftStore.setState({
      drafts: new Map(),
      storedDraftsByScope: {},
      workspaceSessionsByScope: {},
      draftScopeKey: null,
    });
    useSourceStore.setState({
      repository,
      sourceRef: null,
      tree: [],
      banks: [],
      loading: false,
      error: null,
    });
    mocks.resolve
      .mockReset()
      .mockImplementation(async (prNumber: number) =>
        session("head", prNumber)
      );
    mocks.tree.mockReset().mockResolvedValue(tree);
    mocks.content.mockReset().mockResolvedValue("original");
  });

  it("prepares the selected document before applying the revision", async () => {
    const content = deferred<string>();
    const reading = deferred<void>();
    mocks.content.mockImplementation(() => {
      reading.resolve();
      return content.promise;
    });
    const controller = makeController(1);
    controller.selectFile(path);
    const pending = controller.open();
    await reading.promise;
    expect(useSourceStore.getState().sourceRef).toBeNull();
    content.resolve("original");
    await pending;
    expect(controller.getSnapshot().session?.headSha).toBe("head");
    expect(mocks.content).toHaveBeenCalledWith({
      repository,
      filePath: path,
      commitSha: "head",
    });
  });

  it("does not reopen or reload the tree when only selection changes", async () => {
    const controller = await open();
    controller.selectFile("src/Bank/senders.txt");
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.tree).toHaveBeenCalledTimes(1);
  });

  it("ignores the first A response after A → B → A", async () => {
    const response = deferred<WorkspaceSession>();
    mocks.resolve.mockReturnValueOnce(response.promise);
    const first = makeController(1);
    const pending = first.open();
    await Promise.resolve();
    first.deactivate();
    const second = await open(2);
    second.deactivate();
    mocks.resolve.mockResolvedValueOnce(session("latest-A"));
    const latest = await open();
    response.resolve(session("obsolete-A"));
    await pending;
    expect(useSourceStore.getState().sourceRef?.sha).toBe("latest-A");
    expect(latest.getSnapshot().session?.headSha).toBe("latest-A");
    expect(loadWorkspaceSession(repository, 1)?.session.headSha).toBe(
      "latest-A"
    );
  });

  it("ignores a late tree failure and keeps the newer session loading and error untouched", async () => {
    const response = deferred<FileEntry[]>();
    const started = deferred<void>();
    mocks.tree.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });
    const first = makeController(1);
    const pending = first.open();
    await started.promise;
    first.deactivate();
    const second = await open(2);
    response.reject(new Error("old failure"));
    await pending;
    expect(second.getSnapshot()).toMatchObject({
      error: null,
      operation: null,
    });
    expect(useDraftStore.getState().draftScopeKey).toBe(
      "zenmoney/sms-formats:pr:2"
    );
    expect(useSourceStore.getState().error).toBeNull();
  });

  it("preserves edits made while a new revision is loading", async () => {
    const controller = await open();
    const response = deferred<FileEntry[]>();
    mocks.resolve.mockResolvedValueOnce(session("new-head"));
    mocks.tree.mockReturnValueOnce(response.promise);
    const pending = controller.checkUpdates();
    await Promise.resolve();
    edit();
    response.resolve(tree);
    await pending;
    expect(controller.getSnapshot()).toMatchObject({
      block: "stale",
      session: { headSha: "head" },
      nextSession: { headSha: "new-head" },
    });
    expect(useDraftStore.getState().getDraft(path)?.content).toBe("edited");
    expect(useSourceStore.getState().sourceRef?.sha).toBe("head");
  });

  it("does not discard drafts when preparing the latest revision fails", async () => {
    const controller = await open();
    edit();
    mocks.resolve.mockResolvedValue(session("new-head"));
    await controller.checkUpdates();
    mocks.tree.mockRejectedValueOnce(new Error("offline"));
    await controller.discardAndRefresh();
    expect(useDraftStore.getState().getDraft(path)?.content).toBe("edited");
    expect(controller.getSnapshot()).toMatchObject({
      block: "stale",
      error: "offline",
      session: { headSha: "head" },
    });
    await controller.discardAndRefresh();
    expect(controller.getSnapshot()).toMatchObject({
      block: null,
      error: null,
      session: { headSha: "new-head" },
    });
    expect(useDraftStore.getState().getChangedFiles()).toEqual([]);
  });

  it("restores stale drafts and exact revision metadata after opening a different PR", async () => {
    const first = await open();
    edit();
    first.deactivate();
    const second = await open(2);
    second.deactivate();
    mocks.resolve.mockResolvedValueOnce(session("new-head"));
    const restored = await open();
    expect(restored.getSnapshot()).toMatchObject({
      block: "stale",
      session: { headSha: "head", baseSha: "base" },
      nextSession: { headSha: "new-head" },
    });
    expect(useDraftStore.getState().getDraft(path)?.content).toBe("edited");
    expect(mocks.tree).toHaveBeenLastCalledWith("head", repository);
  });

  it("preserves visible drafts when write access is lost and restores access at the same head", async () => {
    const controller = await open();
    edit();
    mocks.resolve.mockResolvedValueOnce({
      ...session(),
      writable: false,
      readOnlyReason: "no-write-access",
    });
    await controller.checkUpdates();
    expect(controller.getSnapshot().session?.writable).toBe(false);
    expect(useDraftStore.getState().getDraft(path)?.content).toBe("edited");
    expect(controller.beginPublication()).toBeNull();
    await controller.checkUpdates();
    expect(controller.getSnapshot().session?.writable).toBe(true);
  });

  it("keeps the snapshot on closed PR and network errors instead of inferring missing permissions", async () => {
    const controller = await open();
    edit();
    mocks.resolve.mockResolvedValueOnce({
      status: "transient-error",
      reason: "network",
    });
    await controller.checkUpdates();
    expect(controller.getSnapshot()).toMatchObject({
      block: null,
      error: "network",
      session: { writable: true },
    });
    mocks.resolve.mockResolvedValueOnce({
      status: "unavailable",
      reason: "closed",
    });
    await controller.checkUpdates();
    expect(controller.getSnapshot()).toMatchObject({
      block: "closed",
      session: { headSha: "head" },
    });
    expect(useDraftStore.getState().getDraft(path)?.content).toBe("edited");
  });

  it("reports recovery failure for orphan drafts without rebasing them on current head", async () => {
    useDraftStore.getState().activateScope("zenmoney/sms-formats:pr:1", true);
    edit();
    mocks.resolve.mockResolvedValueOnce(session("new-head"));
    const controller = await open();
    expect(controller.getSnapshot()).toMatchObject({
      session: null,
      block: "stale",
      error: "recovery-unavailable",
    });
    expect(useDraftStore.getState().getDraft(path)?.baselineHeadSha).toBe(
      "head"
    );
    await controller.discardAndRefresh();
    expect(controller.getSnapshot().session?.headSha).toBe("head");
  });

  it("blocks concurrent refresh and publication commands while allowing document edits", async () => {
    const controller = await open();
    const ticket = controller.beginPublication();
    expect(ticket).not.toBeNull();
    expect(controller.beginPublication()).toBeNull();
    await controller.checkUpdates();
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    edit();
    expect(useDraftStore.getState().getDraft(path)?.content).toBe("edited");
    if (ticket) {
      controller.finishPublication(ticket);
    }
    await controller.checkUpdates();
    expect(mocks.resolve).toHaveBeenCalledTimes(2);
  });

  it("retains the committed SHA on a failed sync and retries reads without discarding late drafts", async () => {
    const controller = await open();
    edit();
    const files = useDraftStore.getState().getChangedFiles();
    const ticket = controller.beginPublication();
    if (!ticket) {
      throw new Error("Publication unavailable");
    }
    useDraftStore.getState().applyUserEdit(path, "later", "head", "original");
    controller.recordPublication(ticket, "published");
    useDraftStore
      .getState()
      .acknowledgePublished(files, "published", ticket.scopeKey);
    mocks.resolve.mockRejectedValueOnce(new Error("offline"));
    expect(await controller.syncPublication(ticket)).toBe(false);
    expect(loadWorkspaceSession(repository, 1)?.pendingPublishedHeadSha).toBe(
      "published"
    );
    expect(controller.getSnapshot()).toMatchObject({
      block: "sync-pending",
      session: { headSha: "head" },
    });
    mocks.resolve.mockResolvedValueOnce(session("published"));
    await controller.syncPublication();
    expect(controller.getSnapshot()).toMatchObject({
      block: null,
      session: { headSha: "published" },
    });
    expect(
      loadWorkspaceSession(repository, 1)?.pendingPublishedHeadSha
    ).toBeUndefined();
    expect(useDraftStore.getState().getDraft(path)).toMatchObject({
      content: "later",
      headContent: "edited",
      baselineHeadSha: "published",
    });
  });

  it("persists publication to the original scope without mutating another active PR", async () => {
    const first = await open();
    const ticket = first.beginPublication();
    if (!ticket) {
      throw new Error("Publication unavailable");
    }
    first.deactivate();
    const second = await open(2);
    first.recordPublication(ticket, "published");
    await first.syncPublication(ticket);
    expect(loadWorkspaceSession(repository, 1)?.pendingPublishedHeadSha).toBe(
      "published"
    );
    expect(second.getSnapshot().session?.prNumber).toBe(2);
    expect(useSourceStore.getState().sourceRef?.prNumber).toBe(2);
  });

  it("restores a pending publication before classifying late drafts as externally stale", async () => {
    saveWorkspaceSession({
      session: session(),
      pendingPublishedHeadSha: "published",
    });
    useDraftStore.getState().activateScope("zenmoney/sms-formats:pr:1", true);
    useDraftStore.getState().setDraft(path, "later", "published", "edited");
    mocks.resolve.mockResolvedValueOnce(session("published"));
    const controller = await open();
    expect(controller.getSnapshot()).toMatchObject({
      block: null,
      session: { headSha: "published" },
    });
    expect(useDraftStore.getState().getDraft(path)?.content).toBe("later");
  });
  it("a new authorization opening supersedes an outstanding read on the same controller", async () => {
    const controller = await open();
    const response = deferred<WorkspaceSession>();
    mocks.resolve.mockReturnValueOnce(response.promise);
    const old = controller.checkUpdates();
    controller.deactivate();
    mocks.resolve.mockResolvedValueOnce({
      ...session(),
      writable: false,
      readOnlyReason: "no-write-access",
    });
    await controller.open();
    response.resolve(session("obsolete"));
    await old;
    expect(controller.getSnapshot()).toMatchObject({
      operation: null,
      block: null,
      session: { headSha: "head", writable: false },
    });
  });

  it("waits for the current selection if it changes while a revision is preparing", async () => {
    const other = "src/Bank/senders.txt";
    mocks.tree.mockResolvedValue([
      ...tree,
      { path: other, sha: "senders", type: "blob" },
    ]);
    const first = deferred<string>();
    const started = deferred<void>();
    mocks.content.mockImplementationOnce(() => {
      started.resolve();
      return first.promise;
    });
    const controller = makeController(1);
    controller.selectFile(path);
    const pending = controller.open();
    await started.promise;
    controller.selectFile(other);
    first.resolve("original");
    await pending;
    expect(mocks.content).toHaveBeenLastCalledWith({
      repository,
      commitSha: "head",
      filePath: other,
    });
    expect(controller.getSnapshot().session?.headSha).toBe("head");
  });

  it("does not apply a clean revision when reading the selected document fails", async () => {
    const controller = await open();
    mocks.resolve.mockResolvedValueOnce(session("new-head"));
    mocks.content.mockRejectedValueOnce(new Error("document offline"));
    await controller.checkUpdates();
    expect(controller.getSnapshot()).toMatchObject({
      error: "document offline",
      session: { headSha: "head" },
    });
    expect(useSourceStore.getState().sourceRef?.sha).toBe("head");
  });

  it("restores the published revision rather than external head when late drafts require it", async () => {
    saveWorkspaceSession({
      session: session(),
      pendingPublishedHeadSha: "published",
    });
    useDraftStore.getState().activateScope("zenmoney/sms-formats:pr:1", true);
    useDraftStore.getState().setDraft(path, "later", "published", "committed");
    mocks.resolve.mockResolvedValueOnce(session("external"));
    mocks.tree.mockImplementation(async (sha: string) => [
      {
        path,
        sha: sha === "base" ? "original-blob" : "committed-blob",
        type: "blob",
      },
    ]);
    const controller = await open();
    expect(controller.getSnapshot()).toMatchObject({
      block: "stale",
      session: {
        headSha: "published",
        baseSha: "base",
        changedFiles: [{ path, kind: "modify" }],
      },
      nextSession: { headSha: "external" },
    });
    expect(useDraftStore.getState().getDraft(path)?.baselineHeadSha).toBe(
      "published"
    );
    expect(
      loadWorkspaceSession(repository, 1)?.pendingPublishedHeadSha
    ).toBeUndefined();
  });

  it("retains pending publication and old visible snapshot if synchronization still fails after reopening", async () => {
    saveWorkspaceSession({
      session: session(),
      pendingPublishedHeadSha: "published",
    });
    useDraftStore.getState().activateScope("zenmoney/sms-formats:pr:1", true);
    useDraftStore.getState().setDraft(path, "later", "published", "committed");
    mocks.resolve.mockRejectedValueOnce(new Error("offline"));
    const controller = await open();
    expect(controller.getSnapshot()).toMatchObject({
      block: "sync-pending",
      error: "offline",
      session: { headSha: "head" },
    });
    expect(loadWorkspaceSession(repository, 1)?.pendingPublishedHeadSha).toBe(
      "published"
    );
    expect(useDraftStore.getState().getDraft(path)).toMatchObject({
      content: "later",
      baselineHeadSha: "published",
      headContent: "committed",
    });
  });
  it("does not overwrite a publication receipt arriving during a newer opening of the same PR", async () => {
    const first = await open();
    edit();
    const files = useDraftStore.getState().getChangedFiles();
    const ticket = first.beginPublication();
    if (!ticket) {
      throw new Error("Publication unavailable");
    }
    first.deactivate();
    useSourceStore.setState({ sourceRef: null, tree: [] });
    const response = deferred<FileEntry[]>();
    const started = deferred<void>();
    mocks.tree.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });
    const second = makeController(1);
    const opening = second.open();
    await started.promise;
    useDraftStore.getState().applyUserEdit(path, "later", "head", "original");
    first.recordPublication(ticket, "published");
    useDraftStore
      .getState()
      .acknowledgePublished(files, "published", ticket.scopeKey);
    response.resolve(tree);
    await opening;
    expect(second.getSnapshot().block).toBe("sync-pending");
    expect(loadWorkspaceSession(repository, 1)?.pendingPublishedHeadSha).toBe(
      "published"
    );
    expect(useDraftStore.getState().getDraft(path)).toMatchObject({
      content: "later",
      baselineHeadSha: "published",
    });
    expect(second.beginPublication()).toBeNull();
    mocks.resolve.mockResolvedValueOnce(session("published"));
    await second.checkUpdates();
    expect(second.getSnapshot()).toMatchObject({
      block: null,
      session: { headSha: "published" },
    });
  });
  it.each([false, true])(
    "syncs an external head without late drafts after a failed read (reopen: %s)",
    async (reopen) => {
      let controller = await open();
      edit();
      const files = useDraftStore.getState().getChangedFiles();
      const ticket = controller.beginPublication()!;
      controller.recordPublication(ticket, "published");
      useDraftStore
        .getState()
        .acknowledgePublished(files, "published", ticket.scopeKey);
      mocks.resolve.mockRejectedValueOnce(new Error("offline"));
      expect(await controller.syncPublication(ticket)).toBe(false);
      mocks.resolve.mockResolvedValue(session("external"));
      if (reopen) {
        controller.deactivate();
        useSourceStore.setState({ sourceRef: null, tree: [] });
        controller = await open();
      } else {
        expect(await controller.syncPublication()).toBe(true);
      }
      expect(controller.getSnapshot()).toMatchObject({
        block: null,
        session: { headSha: "external" },
      });
      expect(useSourceStore.getState().sourceRef?.sha).toBe("external");
      expect(
        loadWorkspaceSession(repository, 1)?.pendingPublishedHeadSha
      ).toBeUndefined();
    }
  );

  it.each([false, true])(
    "blocks a receipt after reopening has completed (new instance: %s)",
    async (newInstance) => {
      const first = await open();
      edit();
      const files = useDraftStore.getState().getChangedFiles();
      const ticket = first.beginPublication()!;
      first.deactivate();
      let current = first;
      let other: WorkspaceSessionController | undefined;
      if (newInstance) {
        other = await open(2);
        other.deactivate();
        current = await open();
      } else {
        await current.open();
      }
      const otherState = other?.getSnapshot();
      first.recordPublication(ticket, "published");
      useDraftStore
        .getState()
        .acknowledgePublished(files, "published", ticket.scopeKey);
      expect(await first.syncPublication(ticket)).toBe(false);
      expect(current.getSnapshot()).toMatchObject({
        block: "sync-pending",
        operation: null,
        session: { headSha: "head" },
      });
      expect(other?.getSnapshot()).toBe(otherState);
      expect(current.beginPublication()).toBeNull();
      mocks.resolve.mockResolvedValueOnce(session("published"));
      expect(await current.syncPublication()).toBe(true);
      expect(current.getSnapshot()).toMatchObject({
        block: null,
        session: { headSha: "published" },
      });
    }
  );

  it("drops unchanged old documents on reopen while keeping same-revision document history", async () => {
    const controller = await open();
    const senders = "src/Bank/senders.txt";
    useDraftStore.getState().ensureDraft(path, "original", "head", "original");
    useDraftStore
      .getState()
      .ensureDraft(senders, "original senders", "head", "original senders");
    useDraftStore.getState().applyUserEdit(path, "edited", "head", "original");
    useDraftStore.getState().undo(path);
    expect(useDraftStore.getState().canRedo(path)).toBe(true);
    await controller.open();
    expect(useDraftStore.getState().canRedo(path)).toBe(true);
    controller.deactivate();
    mocks.resolve.mockResolvedValueOnce(session("new-head"));
    await controller.open();
    expect(controller.getSnapshot().session?.headSha).toBe("new-head");
    expect(useDraftStore.getState().getDraft(path)).toBeUndefined();
    expect(useDraftStore.getState().getDraft(senders)).toBeUndefined();
    useDraftStore
      .getState()
      .ensureDraft(path, "new format", "new-head", "new format");
    useDraftStore
      .getState()
      .ensureDraft(senders, "new senders", "new-head", "new senders");
    expect(useDraftStore.getState().getDraft(path)).toMatchObject({
      content: "new format",
      baselineHeadSha: "new-head",
    });
    expect(useDraftStore.getState().getDraft(senders)).toMatchObject({
      content: "new senders",
      baselineHeadSha: "new-head",
    });
  });

  it("keeps modified documents at their old revision on authorization reopen", async () => {
    const controller = await open();
    edit();
    mocks.resolve.mockResolvedValueOnce(session("new-head"));
    controller.deactivate();
    await controller.open();
    expect(controller.getSnapshot()).toMatchObject({
      block: "stale",
      session: { headSha: "head" },
    });
    expect(useDraftStore.getState().getDraft(path)).toMatchObject({
      content: "edited",
      baselineHeadSha: "head",
    });
  });
});
