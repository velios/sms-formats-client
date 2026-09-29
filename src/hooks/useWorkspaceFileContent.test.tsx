import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchFileContentMock = vi.hoisted(() => vi.fn());
const idbStorage = vi.hoisted(() => new Map<string, string>());

vi.mock("idb-keyval", () => ({
  del: vi.fn(async (key: string) => {
    idbStorage.delete(String(key));
  }),
  get: vi.fn(async (key: string) => idbStorage.get(String(key)) ?? null),
  keys: vi.fn(async () => Array.from(idbStorage.keys())),
  set: vi.fn(async (key: string, value: string) => {
    idbStorage.set(String(key), value);
  }),
}));

vi.mock("@/infrastructure/github", async () => {
  const actual = await vi.importActual<
    typeof import("@/infrastructure/github")
  >("@/infrastructure/github");
  return {
    ...actual,
    fetchFileContent: (...args: unknown[]) => fetchFileContentMock(...args),
  };
});

async function loadModules() {
  const store = await import("@/store");
  const fileContentStore = await import("@/infrastructure/file-content");
  const hook = await import("./useWorkspaceFileContent");
  return {
    ...store,
    ...fileContentStore,
    ...hook,
  };
}

describe("useWorkspaceFileContent", () => {
  beforeEach(async () => {
    vi.resetModules();
    idbStorage.clear();
    fetchFileContentMock.mockReset();
    (await import("@/lib/query-client")).queryClient.clear();
    const localStorageState = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => localStorageState.get(key) ?? null,
      removeItem: (key: string) => {
        localStorageState.delete(key);
      },
      setItem: (key: string, value: string) => {
        localStorageState.set(key, value);
      },
    });
  });

  it("returns cached content immediately for the current PR head", async () => {
    const { cacheFileContent, useSourceStore, useWorkspaceFileContent } =
      await loadModules();
    useSourceStore.getState().setRepository({
      owner: "zenmoney",
      repo: "sms-formats",
    });
    useSourceStore.getState().setSource({
      type: "pr",
      name: "pr-123",
      sha: "head-sha",
      prNumber: 123,
    });
    cacheFileContent({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      filePath: "src/TBank_123/formats/a.txt",
      content: "CACHED CONTENT",
      refName: "head-sha",
    });

    const { result } = renderHook(() =>
      useWorkspaceFileContent({
        filePath: "src/TBank_123/formats/a.txt",
      })
    );

    await waitFor(() => {
      expect(result.current.data).toBe("CACHED CONTENT");
      expect(result.current.isLoading).toBe(false);
    });
    expect(fetchFileContentMock).not.toHaveBeenCalled();
  });

  it("does not request a file absent at head", async () => {
    const { useSourceStore, useWorkspaceFileContent } = await loadModules();
    useSourceStore
      .getState()
      .setSource({ type: "pr", name: "pr-1", prNumber: 1, sha: "head" });
    const { result } = renderHook(() =>
      useWorkspaceFileContent({ filePath: "new.txt", enabled: false })
    );
    expect(result.current.isLoading).toBe(false);
    expect(fetchFileContentMock).not.toHaveBeenCalled();
  });

  it("loads deleted-file preview content from an override ref", async () => {
    const { useSourceStore, useWorkspaceFileContent } = await loadModules();
    useSourceStore.getState().setRepository({
      owner: "zenmoney",
      repo: "sms-formats",
    });
    useSourceStore.getState().setSource({
      type: "pr",
      name: "pr-123",
      sha: "head-sha",
      prNumber: 123,
    });
    fetchFileContentMock.mockResolvedValue("BASE CONTENT");

    const { result } = renderHook(() =>
      useWorkspaceFileContent({
        filePath: "src/TBank_123/formats/deleted.txt",
        contentRefName: "base-sha",
      })
    );

    await waitFor(() => {
      expect(fetchFileContentMock).toHaveBeenCalledWith(
        "src/TBank_123/formats/deleted.txt",
        "base-sha",
        { owner: "zenmoney", repo: "sms-formats" }
      );
      expect(result.current.data).toBe("BASE CONTENT");
      expect(result.current.isLoading).toBe(false);
    });
  });
});
