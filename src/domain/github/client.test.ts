import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoRef } from "../types";

const octokitMocks = vi.hoisted(() => {
  const createReview = vi.fn(() => Promise.resolve({}));
  const getPullRequest = vi.fn();
  const getAuthenticated = vi.fn(() =>
    Promise.resolve({ data: { login: "current-user" } })
  );
  const paginate = vi.fn<
    (...args: unknown[]) => Promise<
      Array<{
        user?: { login?: string } | null;
        state?: string | null;
      }>
    >
  >(() => Promise.resolve([]));

  const graphql = vi.fn<
    (query: string, variables: Record<string, unknown>) => Promise<unknown>
  >(() => Promise.resolve({ repository: {} }));

  return {
    createReview,
    getAuthenticated,
    getPullRequest,
    graphql,
    paginate,
    Octokit: class MockOctokit {
      pulls = {
        createReview,
        get: getPullRequest,
        listReviews: vi.fn(),
      };

      users = {
        getAuthenticated,
      };

      paginate = paginate;

      graphql = graphql;
    },
  };
});

vi.mock("@octokit/rest", () => ({
  Octokit: octokitMocks.Octokit,
}));

import {
  approvePullRequest,
  classifyPullRequestResolverError,
  describeGraphqlBlobError,
  fetchBlobsByRef,
  fetchPullRequestApprovalByCurrentUser,
  getCachedPullRequestApprovalPermission,
  getGitHubAuthChangeVersion,
  indexBanksFromTree,
  resolveCommitAuthorLabel,
  resolvePullRequestWorkspaceSnapshot,
  setCachedPullRequestApprovalPermission,
  setGitHubUserToken,
  subscribeGitHubAuthChange,
  updatePullRequestHead,
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
    octokitMocks.createReview.mockReset();
    octokitMocks.createReview.mockResolvedValue({});
    octokitMocks.getAuthenticated.mockReset();
    octokitMocks.getAuthenticated.mockResolvedValue({
      data: { login: "current-user" },
    });
    octokitMocks.paginate.mockReset();
    octokitMocks.paginate.mockResolvedValue([]);
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

describe("pull request approvals", () => {
  const repo: RepoRef = { owner: "zenmoney", repo: "sms-formats" };

  beforeEach(() => {
    setGitHubUserToken("ghp_test");
  });

  afterEach(() => {
    setGitHubUserToken(null);
  });

  it("creates approve reviews without an auto-comment body", async () => {
    await approvePullRequest(123, repo);

    expect(octokitMocks.createReview).toHaveBeenCalledWith({
      owner: "zenmoney",
      repo: "sms-formats",
      pull_number: 123,
      event: "APPROVE",
    });
  });

  it("detects an existing approval from the current user", async () => {
    octokitMocks.paginate.mockResolvedValue([
      { user: { login: "reviewer-a" }, state: "APPROVED" },
      { user: { login: "current-user" }, state: "COMMENTED" },
      { user: { login: "current-user" }, state: "APPROVED" },
    ]);

    await expect(
      fetchPullRequestApprovalByCurrentUser(123, repo)
    ).resolves.toBe(true);
  });
});

describe("updatePullRequestHead", () => {
  const repository: RepoRef = { owner: "zenmoney", repo: "sms-formats" };

  beforeEach(() => {
    octokitMocks.getPullRequest.mockReset();
    octokitMocks.getPullRequest.mockResolvedValue({
      data: {
        head: {
          repo: {
            owner: { login: "contributor" },
            name: "sms-formats",
          },
          ref: "fix-bank-format",
          sha: "old-head-sha",
        },
        title: "Fix bank format",
        html_url: "https://github.com/zenmoney/sms-formats/pull/123",
      },
    });
    octokitMocks.graphql.mockReset();
    octokitMocks.graphql.mockResolvedValue({
      createCommitOnBranch: {
        commit: { oid: "new-head-sha" },
      },
    });
  });

  it("commits additions and deletions atomically to an external PR head", async () => {
    await expect(
      updatePullRequestHead(
        "ghp_test",
        123,
        [
          {
            path: "src/TestBank_1/formats/updated.txt",
            content: "updated\n",
          },
          {
            path: "src/TestBank_1/formats/deleted.txt",
            delete: true,
          },
        ],
        repository,
        "Fix available balance\n\nUse av_balance for the captured value."
      )
    ).resolves.toEqual({
      url: "https://github.com/zenmoney/sms-formats/pull/123",
      title: "Fix bank format",
      headSha: "new-head-sha",
    });

    expect(octokitMocks.graphql).toHaveBeenCalledWith(
      expect.stringContaining("createCommitOnBranch"),
      {
        input: {
          branch: {
            repositoryNameWithOwner: "contributor/sms-formats",
            branchName: "fix-bank-format",
          },
          expectedHeadOid: "old-head-sha",
          message: {
            headline: "Fix available balance",
            body: "Use av_balance for the captured value.",
          },
          fileChanges: {
            additions: [
              {
                path: "src/TestBank_1/formats/updated.txt",
                contents: "dXBkYXRlZAo=",
              },
            ],
            deletions: [{ path: "src/TestBank_1/formats/deleted.txt" }],
          },
        },
      }
    );
  });

  it("uses the PR title when no custom commit message is provided", async () => {
    await updatePullRequestHead(
      "ghp_test",
      123,
      [{ path: "src/TestBank_1/senders.txt", content: "TEST\n" }],
      repository
    );

    expect(octokitMocks.graphql).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        input: expect.objectContaining({
          message: { headline: "Fix bank format" },
        }),
      })
    );
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
        baseSha: "base123",
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
      baseSha: "base123",
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
        baseSha: "base456",
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
        baseSha: "base789",
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

describe("fetchBlobsByRef", () => {
  const repo: RepoRef = { owner: "zenmoney", repo: "sms-formats" };

  beforeEach(() => {
    octokitMocks.graphql.mockReset();
  });

  it("keeps missing, binary and truncated blobs as distinct signals", async () => {
    octokitMocks.graphql.mockResolvedValue({
      repository: {
        f0: { text: "regex\n", isTruncated: false },
        f1: null,
        f2: { text: null, isTruncated: false },
        f3: { text: "cut off", isTruncated: true },
      },
    });

    await expect(
      fetchBlobsByRef(
        "main",
        ["a.txt", "gone.txt", "logo.png", "huge.txt"],
        repo
      )
    ).resolves.toEqual([
      { path: "a.txt", status: "loaded", text: "regex\n" },
      { path: "gone.txt", status: "missing" },
      { path: "logo.png", status: "binary" },
      { path: "huge.txt", status: "truncated" },
    ]);
  });

  it("addresses blobs as <ref>:<path> in the requested repository", async () => {
    octokitMocks.graphql.mockResolvedValue({
      repository: { f0: { text: "x", isTruncated: false } },
    });

    await fetchBlobsByRef("abc123", ["src/Bank_1/senders.txt"], repo);

    const [query, variables] = octokitMocks.graphql.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(query).toContain("f0: object(expression: $e0)");
    expect(query).toContain("isTruncated");
    expect(variables).toMatchObject({
      owner: "zenmoney",
      name: "sms-formats",
      e0: "abc123:src/Bank_1/senders.txt",
    });
  });

  it("splits paths into batches of 50 and preserves input order", async () => {
    const paths = Array.from({ length: 120 }, (_, index) => `f${index}.txt`);
    octokitMocks.graphql.mockImplementation((_query, variables) => {
      const repository: Record<string, { text: string; isTruncated: boolean }> =
        {};
      for (const [key, value] of Object.entries(variables)) {
        if (key.startsWith("e")) {
          repository[`f${key.slice(1)}`] = {
            text: String(value),
            isTruncated: false,
          };
        }
      }
      return Promise.resolve({ repository });
    });

    const results = await fetchBlobsByRef("main", paths, repo);

    expect(octokitMocks.graphql).toHaveBeenCalledTimes(3);
    const batchSizes = octokitMocks.graphql.mock.calls.map(
      ([, variables]) =>
        Object.keys(variables).filter((key) => key.startsWith("e")).length
    );
    expect(batchSizes).toEqual([50, 50, 20]);
    expect(results).toHaveLength(120);
    expect(results[0]).toEqual({
      path: "f0.txt",
      status: "loaded",
      text: "main:f0.txt",
    });
    expect(results[119]).toEqual({
      path: "f119.txt",
      status: "loaded",
      text: "main:f119.txt",
    });
  });

  it("fails instead of returning a partial layer when the repository is unreachable", async () => {
    octokitMocks.graphql.mockResolvedValue({ repository: null });

    await expect(fetchBlobsByRef("main", ["a.txt"], repo)).rejects.toThrow(
      "zenmoney/sms-formats"
    );
  });
});

describe("describeGraphqlBlobError", () => {
  it("reads messages out of a GraphQL response error", () => {
    expect(
      describeGraphqlBlobError({
        message: "Request failed",
        errors: [{ message: "Could not resolve to a Repository" }],
      })
    ).toBe("Could not resolve to a Repository");
  });

  it("falls back to the plain error message", () => {
    expect(describeGraphqlBlobError(new Error("network down"))).toBe(
      "network down"
    );
    expect(describeGraphqlBlobError(null)).toBe("Unknown GraphQL error");
  });
});
