import { describe, expect, it } from "vitest";
import {
  getPullRequestShortcutConflict,
  getPullRequestWorkspacePath,
} from "@/lib/pull-request-navigation";

describe("pull-request navigation", () => {
  it("builds PR workspace path for a single changed bank", () => {
    expect(
      getPullRequestWorkspacePath({
        changedPaths: [
          "src/TBank_123/formats/one.txt",
          "src/TBank_123/senders.txt",
        ],
        prNumber: 123,
        repository: { owner: "zenmoney", repo: "sms-formats" },
        sourceSha: "abc123",
      })
    ).toBe(
      "/bank/TBank_123/repo/zenmoney%2Fsms-formats/branch-or-pr/123?file=src%2FTBank_123%2Fformats%2Fone.txt&commit=abc123"
    );
  });

  it("falls back to workspace when PR changes touch multiple banks", () => {
    expect(
      getPullRequestWorkspacePath({
        changedPaths: [
          "src/TBank_123/formats/one.txt",
          "src/Sber_456/formats/two.txt",
        ],
        prNumber: 123,
        repository: { owner: "zenmoney", repo: "sms-formats" },
        sourceSha: "abc123",
      })
    ).toBe("/workspace");
  });

  it("blocks deep links when the same PR has local drafts", () => {
    expect(
      getPullRequestShortcutConflict({
        currentRepository: { owner: "zenmoney", repo: "sms-formats" },
        currentSource: {
          type: "pr",
          name: "feature/pr-123",
          prNumber: 123,
          sha: "old-sha",
        },
        hasDrafts: true,
        prNumber: 123,
        targetRepository: { owner: "zenmoney", repo: "sms-formats" },
      })
    ).toBe("same-pr-drafts");
  });

  it("treats drafts from another source as a generic conflict", () => {
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
    ).toBe("other-drafts");
  });
});
