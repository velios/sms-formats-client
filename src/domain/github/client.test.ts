import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoRef } from "../types";
import {
  getCachedPullRequestApprovalPermission,
  indexBanksFromTree,
  setCachedPullRequestApprovalPermission,
  setGitHubUserToken,
} from "./client";

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

describe("pull request approval permission cache", () => {
  const repo: RepoRef = { owner: "zenmoney", repo: "sms-formats" };

  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    setGitHubUserToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setGitHubUserToken(null);
  });

  it("stores cached approval permission per repository", () => {
    expect(getCachedPullRequestApprovalPermission(repo)).toBe(false);

    setCachedPullRequestApprovalPermission(true, repo);

    expect(getCachedPullRequestApprovalPermission(repo)).toBe(true);
    expect(
      getCachedPullRequestApprovalPermission({
        owner: "zenmoney",
        repo: "other-repo",
      })
    ).toBe(false);
  });

  it("clears cached approval permissions when user token changes", () => {
    setCachedPullRequestApprovalPermission(true, repo);
    expect(getCachedPullRequestApprovalPermission(repo)).toBe(true);

    setGitHubUserToken("ghp_test");

    expect(getCachedPullRequestApprovalPermission(repo)).toBe(false);
  });
});
