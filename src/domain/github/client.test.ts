import { describe, expect, it } from "vitest";
import { indexBanksFromTree } from "./client";

describe("indexBanksFromTree", () => {
  it("indexes banks from explicit tree folders", () => {
    const result = indexBanksFromTree([
      { path: "src", sha: "1", type: "tree" },
      { path: "src/TestBank_42", sha: "2", type: "tree" },
      { path: "src/TestBank_42/senders.txt", sha: "3", type: "blob" },
      { path: "src/TestBank_42/formats/a.txt", sha: "4", type: "blob" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      displayName: "TestBank",
      folderPath: "src/TestBank_42",
      bankId: "42",
      formatFiles: ["src/TestBank_42/formats/a.txt"],
      hasSenders: true,
    });
  });

  it("indexes banks from blobs when tree entries are missing", () => {
    const result = indexBanksFromTree([
      { path: "src/FallbackBank_7/formats/one.txt", sha: "11", type: "blob" },
      { path: "src/FallbackBank_7/senders.txt", sha: "12", type: "blob" },
      { path: "src/SecondBank/formats/two.txt", sha: "13", type: "blob" },
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((bank) => bank.folderPath).sort()).toEqual([
      "src/FallbackBank_7",
      "src/SecondBank",
    ]);
  });
});
