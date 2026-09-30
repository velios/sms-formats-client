import { act, renderHook } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeFormat } from "@/domain/format";
import type { PullRequestWorkspaceResolution } from "@/domain/pull-request-workspace";
import {
  useDraftStore,
  useSourceStore,
  waitForDraftStoreHydration,
} from "@/store";
import { saveWorkspaceSession } from "@/store/workspace-session";
import { useBankPublishAction } from "./use-publish";
import { WorkspaceSessionController } from "./workspace-session";

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return { resolve: vi.fn(), update: vi.fn(), load: vi.fn() };
});
vi.mock("idb-keyval", () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));
vi.mock("@/infrastructure/github", () => ({
  getGitHubUserToken: () => "test-token",
  resolvePullRequestWorkspace: mocks.resolve,
  fetchRepoTree: vi.fn(async () => []),
  updatePullRequestHead: mocks.update,
}));
vi.mock("@/infrastructure/file-content", () => ({
  loadFileContents: mocks.load,
  loadFileContent: vi.fn(async () => original),
}));

const repository = { owner: "zenmoney", repo: "sms-formats" };
const bankPath = "src/Bank";
const a = `${bankPath}/formats/a.txt`;
const b = `${bankPath}/formats/b.txt`;
const scope = "zenmoney/sms-formats:pr:1";
const original = serializeFormat("^(A)$", ["comment"], ["A"]);
const edited = serializeFormat("^(EDIT)$", ["comment"], ["EDIT"]);
const later = serializeFormat("^(LATER)$", ["comment"], ["LATER"]);
const supported = (headSha = "head"): PullRequestWorkspaceResolution => ({
  status: "supported",
  repository,
  prNumber: 1,
  headSha,
  baseSha: "base",
  bankPath,
  writable: true,
  readOnlyReason: null,
  changedFiles: [{ kind: "modify", path: a }],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup() {
  const controller = new WorkspaceSessionController(repository, 1);
  await controller.open();
  const rendered = renderHook(() => {
    useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    return useBankPublishAction({
      bank: {
        folderPath: bankPath,
        displayName: "Bank",
        bankId: null,
        formatFiles: [a, b],
        hasSenders: true,
      },
      controller,
      t: (key) => key,
    });
  });
  return { ...rendered, controller };
}
async function publish(result: Awaited<ReturnType<typeof setup>>["result"]) {
  await act(async () => {
    await result.current.submitUpdate({ title: "Update", description: "" });
  });
}
describe("publish a validated document snapshot", () => {
  beforeEach(async () => {
    await waitForDraftStoreHydration();
    useDraftStore.getState().discardAll();
    useDraftStore.getState().activateScope(scope, true);
    useDraftStore.getState().setDraft(a, edited, "head", original);
    useSourceStore.getState().setRepository(repository);
    useSourceStore
      .getState()
      .setSource({ type: "pr", name: "pr-1", prNumber: 1, sha: "head" });
    useSourceStore.getState().setTree([{ path: a, sha: "blob", type: "blob" }]);
    useDraftStore.setState({ workspaceSessionsByScope: {} });
    saveWorkspaceSession({
      session: supported() as Extract<
        PullRequestWorkspaceResolution,
        { status: "supported" }
      >,
    });
    mocks.resolve.mockReset().mockResolvedValue(supported());
    mocks.update.mockReset().mockResolvedValue({ headSha: "published" });
    mocks.load
      .mockReset()
      .mockImplementation(async ({ filePaths }: { filePaths: string[] }) => ({
        contents: new Map(
          filePaths.map((path) => [
            path,
            serializeFormat("^(B)$", ["comment"], ["B"]),
          ])
        ),
        cachedCount: 0,
        remoteFetchedCount: filePaths.length,
      }));
  });
  it("blocks collisions with an untouched format", async () => {
    const { result } = await setup();
    mocks.load.mockResolvedValue({
      contents: new Map([[b, edited]]),
      cachedCount: 0,
      remoteFetchedCount: 1,
    });
    await publish(result);
    expect(result.current.publishError).toBe("validation.errors");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("blocks publication when any bank file cannot be read", async () => {
    const { result } = await setup();
    mocks.load.mockRejectedValue(new Error("offline"));
    await publish(result);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(result.current.publishError).toBe("offline");
  });
  it("rejects edits made while preflight is running", async () => {
    const { result } = await setup();
    const response = deferred<PullRequestWorkspaceResolution>();
    mocks.resolve.mockReturnValueOnce(response.promise);
    await act(async () => {
      const pending = result.current.submitUpdate(null);
      useDraftStore.getState().applyUserEdit(a, later, "head", original);
      response.resolve(supported());
      await pending;
    });
    expect(result.current.publishError).toBe("publish.editedDuringValidation");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("preserves edits made while the commit is being written and distinguishes a refresh failure", async () => {
    const { result, controller } = await setup();
    const write = deferred<{ headSha: string }>();
    const started = deferred<void>();
    mocks.update.mockImplementation(() => {
      started.resolve();
      return write.promise;
    });
    mocks.resolve
      .mockResolvedValueOnce(supported())
      .mockRejectedValueOnce(new Error("refresh offline"));
    await act(async () => {
      const pending = result.current.submitUpdate(null);
      await started.promise;
      useDraftStore.getState().applyUserEdit(a, later, "head", original);
      write.resolve({ headSha: "published" });
      await pending;
    });
    expect(mocks.update.mock.calls[0]?.[2]).toBe("head");
    expect(mocks.update.mock.calls[0]?.[3]).toEqual([
      { path: a, content: edited, delete: false },
    ]);
    expect(useDraftStore.getState().getDraft(a)).toMatchObject({
      content: later,
      headContent: edited,
      baselineHeadSha: "published",
    });
    expect(result.current.publishError).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      block: "sync-pending",
      error: "refresh offline",
    });
  });
  it("acknowledges the originating scope when the user opens another PR during the write", async () => {
    const { result, controller } = await setup();
    const write = deferred<{ headSha: string }>();
    const started = deferred<void>();
    mocks.update.mockImplementation(() => {
      started.resolve();
      return write.promise;
    });
    await act(async () => {
      const pending = result.current.submitUpdate(null);
      await started.promise;
      controller.deactivate();
      useDraftStore.getState().activateScope("zenmoney/sms-formats:pr:2", true);
      useDraftStore.getState().setDraft(a, later, "other-head", original);
      useSourceStore.getState().setSource({
        type: "pr",
        name: "pr-2",
        prNumber: 2,
        sha: "other-head",
      });
      write.resolve({ headSha: "published" });
      await pending;
    });
    expect(useDraftStore.getState().getDraft(a)?.content).toBe(later);
    expect(useDraftStore.getState().getStoredDraftsForScope(scope)).toEqual([]);
    expect(useSourceStore.getState().sourceRef?.prNumber).toBe(2);
  });
});
