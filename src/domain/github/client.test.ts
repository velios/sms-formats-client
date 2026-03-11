import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoRef } from "../types";
import {
  classifyPullRequestResolverError,
  getCachedPullRequestApprovalPermission,
  getGitHubAuthChangeVersion,
  indexBanksFromTree,
  resolveCommitAuthorLabel,
  resolvePullRequestWorkspaceSnapshot,
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

describe("resolvePullRequestWorkspaceSnapshot", () => {
  const repository: RepoRef = { owner: "zenmoney", repo: "sms-formats" };

  it("returns a snapshot-bound supported result for a writable PR", () => {
    expect(
      resolvePullRequestWorkspaceSnapshot({
        repository,
        prNumber: 123,
        state: "open",
        merged: false,
        headSha: "abc123",
        canWriteRepository: true,
        maintainerCanModify: true,
        headRepository: repository,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/one.txt" },
          {
            kind: "rename",
            path: "src/TBank_123/formats/two.txt",
            oldPath: "src/TBank_123/formats/legacy.txt",
          },
        ],
      })
    ).toEqual({
      status: "supported",
      repository,
      prNumber: 123,
      headSha: "abc123",
      bankPath: "src/TBank_123",
      writable: true,
      readOnlyReason: null,
      changedFiles: [
        { kind: "modify", path: "src/TBank_123/formats/one.txt" },
        {
          kind: "rename",
          path: "src/TBank_123/formats/two.txt",
          oldPath: "src/TBank_123/formats/legacy.txt",
        },
      ],
    });
  });

  it("returns unsupported when PR changes files outside a single bank scope", () => {
    expect(
      resolvePullRequestWorkspaceSnapshot({
        repository,
        prNumber: 124,
        state: "open",
        merged: false,
        headSha: "def456",
        canWriteRepository: true,
        maintainerCanModify: true,
        headRepository: repository,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/one.txt" },
          { kind: "modify", path: "docs/readme.md" },
        ],
      })
    ).toEqual({
      status: "unsupported",
      reason: "outside-bank-scope",
    });
  });

  it("returns unavailable when the pull request is already closed", () => {
    expect(
      resolvePullRequestWorkspaceSnapshot({
        repository,
        prNumber: 125,
        state: "closed",
        merged: false,
        headSha: "ghi789",
        canWriteRepository: false,
        maintainerCanModify: false,
        headRepository: repository,
        changedFiles: [
          { kind: "modify", path: "src/TBank_123/formats/one.txt" },
        ],
      })
    ).toEqual({
      status: "unavailable",
      reason: "closed",
    });
  });
});

describe("classifyPullRequestResolverError", () => {
  it("maps GitHub not-found errors to unavailable", () => {
    expect(
      classifyPullRequestResolverError({
        status: 404,
      })
    ).toEqual({
      status: "unavailable",
      reason: "not-found",
    });
  });

  it("maps throttling and unexpected failures to transient errors", () => {
    expect(
      classifyPullRequestResolverError({
        status: 429,
      })
    ).toEqual({
      status: "transient-error",
      reason: "rate-limit",
    });
    expect(classifyPullRequestResolverError(new Error("boom"))).toEqual({
      status: "transient-error",
      reason: "unknown",
    });
  });
});
