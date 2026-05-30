import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareFormatEntries } from "./format-entries";

const fetchFileContentMock = vi.fn();

vi.mock("@/domain/github", () => ({
  fetchFileContent: (...args: unknown[]) => fetchFileContentMock(...args),
}));

describe("prepareFormatEntries", () => {
  beforeEach(() => {
    fetchFileContentMock.mockReset();
  });

  it("reuses remote content from the shared file content store", async () => {
    const { useFileContentStore } = await import("@/store/file-content-store");
    useFileContentStore.setState({ entries: {} });
    useFileContentStore.getState().setFileContentEntry({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 123,
      filePath: "src/Bank/formats/cached.txt",
      content:
        "^(PAY .*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nPAY 100",
      lastResolvedHeadSha: "head-sha",
      loadedFrom: "editor",
      status: "ready",
    });

    const result = await prepareFormatEntries({
      filePaths: ["src/Bank/formats/cached.txt"],
      draftStore: {
        getDraft() {
          return undefined;
        },
      },
      prNumber: 123,
      sourceRefName: "head-sha",
      repository: { owner: "zenmoney", repo: "sms-formats" },
    });

    expect(result.remoteFetchedCount).toBe(0);
    expect(result.cachedCount).toBe(1);
    expect(result.entries.map((entry) => entry.filePath)).toEqual([
      "src/Bank/formats/cached.txt",
    ]);
    expect(fetchFileContentMock).not.toHaveBeenCalled();
  });

  it("skips formats deleted in local drafts", async () => {
    const draftStore = {
      getDraft(filePath: string) {
        if (filePath === "src/Bank/formats/deleted.txt") {
          return {
            content:
              "^(.*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nDeleted",
            isDeleted: true,
            timestamp: 1,
          };
        }

        return undefined;
      },
    };

    fetchFileContentMock.mockResolvedValue(
      "^(PAY .*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nPAY 100"
    );

    const result = await prepareFormatEntries({
      filePaths: [
        "src/Bank/formats/deleted.txt",
        "src/Bank/formats/active.txt",
      ],
      draftStore,
      prNumber: 123,
      sourceRefName: "main",
      repository: { owner: "zenmoney", repo: "sms-formats" },
    });

    expect(result.entries.map((entry) => entry.filePath)).toEqual([
      "src/Bank/formats/active.txt",
    ]);
    expect(fetchFileContentMock).toHaveBeenCalledTimes(1);
    expect(fetchFileContentMock).toHaveBeenCalledWith(
      "src/Bank/formats/active.txt",
      "main",
      { owner: "zenmoney", repo: "sms-formats" }
    );
  });
});
