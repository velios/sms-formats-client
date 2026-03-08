import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoRef } from "../types";
import {
  getCachedPullRequestApprovalPermission,
  getGitHubAuthChangeVersion,
  indexBanksFromTree,
  resolveCommitAuthorLabel,
  setCachedPullRequestApprovalPermission,
  setGitHubUserToken,
  subscribeGitHubAuthChange,
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

  it("notifies subscribers when user token is set or reset", () => {
    const onAuthChange = vi.fn();
    const initialVersion = getGitHubAuthChangeVersion();
    const unsubscribe = subscribeGitHubAuthChange(onAuthChange);

    setGitHubUserToken("ghp_test");
    expect(onAuthChange).toHaveBeenCalledTimes(1);
    expect(getGitHubAuthChangeVersion()).toBe(initialVersion + 1);

    setGitHubUserToken("ghp_test");
    expect(onAuthChange).toHaveBeenCalledTimes(1);
    expect(getGitHubAuthChangeVersion()).toBe(initialVersion + 1);

    setGitHubUserToken(null);
    expect(onAuthChange).toHaveBeenCalledTimes(2);
    expect(getGitHubAuthChangeVersion()).toBe(initialVersion + 2);

    unsubscribe();
  });
});

describe("resolveCommitAuthorLabel", () => {
  it("prefers associated GitHub login when available", () => {
    expect(
      resolveCommitAuthorLabel({
        author: { login: "zenmoney-ai[bot]" },
        commit: { author: { name: "Zenmoney AI" } },
      })
    ).toBe("zenmoney-ai[bot]");
  });

  it("falls back to commit author name when GitHub login is missing", () => {
    expect(
      resolveCommitAuthorLabel({
        author: null,
        committer: null,
        commit: { author: { name: "Zenmoney AI" } },
      })
    ).toBe("Zenmoney AI");
  });
});
