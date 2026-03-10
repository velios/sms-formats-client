import { describe, expect, it } from "vitest";
import type { RepoRef, SourceRef } from "@/domain/types";
import { isSameDraftScope, makeDraftSourceKey } from "./draft-scope";

describe("draft-scope", () => {
  const repository: RepoRef = { owner: "zenmoney", repo: "sms-formats" };

  it("keeps the same storage key for a pull request across commit switches", () => {
    const sourceA: SourceRef = {
      type: "pr",
      name: "feature/pr-123",
      sha: "abc123",
      prNumber: 123,
    };
    const sourceB: SourceRef = {
      type: "pr",
      name: "feature/pr-123",
      sha: "def456",
      prNumber: 123,
    };

    expect(makeDraftSourceKey(sourceA, repository)).toBe(
      makeDraftSourceKey(sourceB, repository)
    );
    expect(isSameDraftScope(sourceA, sourceB)).toBe(true);
  });

  it("treats different pull requests and branches as separate draft scopes", () => {
    const currentSource: SourceRef = {
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
    expect(
      isSameDraftScope(currentSource, {
        type: "branch",
        name: "main",
      })
    ).toBe(false);
  });
});
