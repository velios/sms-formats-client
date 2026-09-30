import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBankSnapshot } from "../workspace/bank-snapshot";

const fetchFileContentMock = vi.fn();

vi.mock("@/infrastructure/github", () => ({
  fetchFileContent: (...args: unknown[]) => fetchFileContentMock(...args),
}));

describe("loadBankSnapshot", () => {
  beforeEach(() => {
    fetchFileContentMock.mockReset();
  });

  it("reuses remote content from the shared file content store", async () => {
    const { cacheFileContent } = await import("@/infrastructure/file-content");

    cacheFileContent({
      repository: { owner: "zenmoney", repo: "sms-formats" },
      filePath: "src/Bank/formats/cached.txt",
      content:
        "^(PAY .*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nPAY 100",
      commitSha: "head-sha",
    });

    const result = await loadBankSnapshot({
      filePaths: ["src/Bank/formats/cached.txt"],
      draftStore: {
        getDraft() {
          return undefined;
        },
      },
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

    const result = await loadBankSnapshot({
      filePaths: [
        "src/Bank/formats/deleted.txt",
        "src/Bank/formats/active.txt",
      ],
      draftStore,
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
