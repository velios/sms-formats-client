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

  it("skips formats deleted in local drafts", async () => {
    const draftStore = {
      getDraft(filePath: string) {
        if (filePath === "src/Bank/formats/deleted.txt") {
          return {
            content: "^(.*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nDeleted",
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
      sourceRefName: "main",
      repository: { owner: "zenmoney", repo: "sms-formats" },
      cache: new Map(),
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
