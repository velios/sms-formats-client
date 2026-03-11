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

vi.mock("@/domain/github", async () => {
  const actual = await vi.importActual<typeof import("@/domain/github")>(
    "@/domain/github"
  );
  return {
    ...actual,
    fetchFileContent: (...args: unknown[]) => fetchFileContentMock(...args),
  };
});

async function loadModules() {
  const store = await import("@/store");
  const fileContentStore = await import("@/store/file-content-store");
  const hook = await import("./useWorkspaceFileContent");
  return {
    ...store,
    ...fileContentStore,
    ...hook,
  };
}

describe("useWorkspaceFileContent", () => {
  beforeEach(() => {
    vi.resetModules();
    idbStorage.clear();
    fetchFileContentMock.mockReset();
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
    const { useFileContentStore, useSourceStore, useWorkspaceFileContent } =
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
    useFileContentStore.getState().setFileContentEntry({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      filePath: "src/TBank_123/formats/a.txt",
      content: "CACHED CONTENT",
      lastResolvedHeadSha: "head-sha",
      loadedFrom: "editor",
      status: "ready",
    });

    const { result } = renderHook(() =>
      useWorkspaceFileContent({
        filePath: "src/TBank_123/formats/a.txt",
        loadedFrom: "editor",
      })
    );

    await waitFor(() => {
      expect(result.current.data).toBe("CACHED CONTENT");
      expect(result.current.isLoading).toBe(false);
    });
    expect(fetchFileContentMock).not.toHaveBeenCalled();
  });
});
