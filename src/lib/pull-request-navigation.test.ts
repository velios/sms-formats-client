import { describe, expect, it } from "vitest";
import {
  getPullRequestShortcutConflict,
  getPullRequestWorkspacePath,
} from "@/lib/pull-request-navigation";

describe("pull-request navigation", () => {
  it("builds the canonical PR workspace path", () => {
    expect(
      getPullRequestWorkspacePath({
        prNumber: 123,
        repository: { owner: "zenmoney", repo: "sms-formats" },
      })
    ).toBe("/repo/zenmoney/sms-formats/pr/123");
  });

  it("does not block opening another PR when drafts exist", () => {
    expect(
      getPullRequestShortcutConflict({
        currentRepository: { owner: "fork-user", repo: "sms-formats" },
        currentSource: {
          type: "branch",
          name: "main",
          sha: "branch-sha",
        },
        hasDrafts: true,
        prNumber: 123,
        targetRepository: { owner: "zenmoney", repo: "sms-formats" },
      })
    ).toBeNull();
  });
});
