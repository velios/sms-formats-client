import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchFileContentMock = vi.hoisted(() => vi.fn());

vi.mock("@/domain/github", () => ({
  fetchFileContent: (...args: unknown[]) => fetchFileContentMock(...args),
}));

async function loadStore() {
  const mod = await import("./file-content-store");
  mod.useFileContentStore.setState({
    entries: {},
  });
  return mod;
}

describe("file-content-store", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchFileContentMock.mockReset();
  });

  it("reuses cached content for the same PR head without re-fetching the file", async () => {
    const { useFileContentStore } = await loadStore();
    fetchFileContentMock.mockResolvedValue("REMOTE V1");

    await useFileContentStore.getState().primeFileContent({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      filePath: "src/TBank_123/formats/a.txt",
      refName: "head-sha",
      headSha: "head-sha",
      loadedFrom: "editor",
    });

    await useFileContentStore.getState().primeFileContent({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      filePath: "src/TBank_123/formats/a.txt",
      refName: "head-sha",
      headSha: "head-sha",
      loadedFrom: "validation",
    });

    expect(fetchFileContentMock).toHaveBeenCalledTimes(1);
  });

  it("invalidates all cached files for a PR", async () => {
    const { useFileContentStore } = await loadStore();
    fetchFileContentMock.mockResolvedValue("REMOTE V1");

    await useFileContentStore.getState().primeFileContents({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      filePaths: [
        "src/TBank_123/formats/a.txt",
        "src/TBank_123/formats/b.txt",
      ],
      refName: "head-sha",
      headSha: "head-sha",
      loadedFrom: "quick-check",
    });

    useFileContentStore.getState().invalidatePullRequestFileContents({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
    });

    expect(
      useFileContentStore.getState().getFileContentEntry({
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        filePath: "src/TBank_123/formats/a.txt",
      })
    ).toBeUndefined();
    expect(
      useFileContentStore.getState().getFileContentEntry({
        repository: { owner: "zenmoney", repo: "sms-formats" },
        prNumber: 123,
        filePath: "src/TBank_123/formats/b.txt",
      })
    ).toBeUndefined();
  });
});
