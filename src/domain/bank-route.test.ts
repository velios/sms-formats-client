import { describe, expect, it } from "vitest";
import {
  buildBankWorkspacePath,
  isRouteSourceMatched,
  parseBankRouteParams,
  parseBranchOrPrSegment,
  resolveRouteRepository,
  sourceRefToRouteSource,
} from "@/domain/bank-route";

describe("bank-route", () => {
  it("builds structured bank path for branch source", () => {
    const path = buildBankWorkspacePath({
      bankPath: "src/by_15382",
      repository: { owner: "velios", repo: "sms-formats" },
      source: { type: "branch", name: "main" },
      filePath: "src/by_15382/formats/a.txt",
    });

    expect(path).toBe(
      "/bank/by_15382/repo/velios%2Fsms-formats/branch-or-pr/main?file=src%2Fby_15382%2Fformats%2Fa.txt"
    );
  });

  it("builds structured bank path for pull request source", () => {
    const path = buildBankWorkspacePath({
      bankPath: "src/by_15382",
      repository: { owner: "velios", repo: "sms-formats" },
      source: { type: "pr", prNumber: 120, sha: "a1b2c3d4" },
    });

    expect(path).toBe(
      "/bank/by_15382/repo/velios%2Fsms-formats/branch-or-pr/120?commit=a1b2c3d4"
    );
  });

  it("parses structured route params", () => {
    const parsed = parseBankRouteParams({
      bankKey: "by_15382",
      repoSlug: "velios/sms-formats",
      branchOrPr: "120",
      commit: "a1b2c3d4",
    });

    expect(parsed).toEqual({
      bankPath: "src/by_15382",
      repoSlug: "velios/sms-formats",
      source: { type: "pr", prNumber: 120, sha: "a1b2c3d4" },
      isStructuredRoute: true,
    });
  });

  it("treats numeric branch-or-pr segment as PR and text as branch", () => {
    expect(parseBranchOrPrSegment("42")).toEqual({ type: "pr", prNumber: 42 });
    expect(parseBranchOrPrSegment("main")).toEqual({
      type: "branch",
      name: "main",
    });
  });

  it("converts SourceRef to route source with fallback", () => {
    expect(
      sourceRefToRouteSource(
        { type: "pr", name: "feature/x", sha: "sha", prNumber: 7 },
        "main"
      )
    ).toEqual({ type: "pr", prNumber: 7, sha: "sha" });
    expect(sourceRefToRouteSource(null, "main")).toEqual({
      type: "branch",
      name: "main",
    });
  });

  it("resolves route repository from repo slug", () => {
    expect(resolveRouteRepository("velios/sms-formats")).toEqual({
      owner: "velios",
      repo: "sms-formats",
    });
    expect(resolveRouteRepository("velios")).toBeNull();
  });

  it("matches current source to route source", () => {
    expect(
      isRouteSourceMatched(
        { type: "branch", name: "main", sha: "sha" },
        { type: "branch", name: "main" }
      )
    ).toBe(true);
    expect(
      isRouteSourceMatched(
        { type: "pr", name: "feature/x", sha: "sha", prNumber: 99 },
        { type: "pr", prNumber: 99 }
      )
    ).toBe(true);
    expect(
      isRouteSourceMatched(
        { type: "pr", name: "feature/x", sha: "sha-a", prNumber: 99 },
        { type: "pr", prNumber: 99, sha: "sha-b" }
      )
    ).toBe(false);
    expect(
      isRouteSourceMatched(
        { type: "branch", name: "main", sha: "sha" },
        { type: "pr", prNumber: 99 }
      )
    ).toBe(false);
  });
});
