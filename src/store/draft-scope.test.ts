import { describe, expect, it } from "bun:test";
import type { PullRequestSource, RepoRef } from "@/domain/types";
import { isSameDraftScope, makeDraftSourceKey } from "./draft-scope";

describe("draft-scope", () => {
  const repository: RepoRef = { owner: "zenmoney", repo: "sms-formats" };

  it("keeps the same storage key for a pull request regardless of PR head name", () => {
    expect(
      makeDraftSourceKey(
        { type: "pr", prNumber: 123, name: "feature/x" },
        repository
      )
    ).toBe(
      makeDraftSourceKey(
        { type: "pr", prNumber: 123, name: "feature/y" },
        repository
      )
    );
  });

  it("treats different pull requests as different draft scopes", () => {
    const currentSource: PullRequestSource = {
      type: "pr",
      name: "feature/pr-123",
      sha: "abc123",
      prNumber: 123,
    };

    expect(
      isSameDraftScope(currentSource, {
        type: "pr",
        name: "feature/pr-124",
        prNumber: 124,
      })
    ).toBe(false);
  });

  it("rejects legacy branch draft scopes", () => {
    expect(() =>
      makeDraftSourceKey(
        { type: "branch", name: "main" } as unknown as PullRequestSource,
        repository
      )
    ).toThrow(/legacy|unsupported/i);
  });
});
