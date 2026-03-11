import { describe, expect, it } from "vitest";
import {
  buildPullRequestWorkspacePath,
  getLegacyRouteRedirectPath,
  parsePullRequestRouteParams,
} from "@/domain/bank-route";

describe("bank-route", () => {
  it("builds canonical PR workspace path", () => {
    expect(
      buildPullRequestWorkspacePath({
        repository: { owner: "velios", repo: "sms-formats" },
        prNumber: 120,
        filePath: "src/by_15382/formats/a.txt",
      })
    ).toBe(
      "/repo/velios/sms-formats/pr/120?file=src%2Fby_15382%2Fformats%2Fa.txt"
    );
  });

  it("parses canonical PR route params", () => {
    expect(
      parsePullRequestRouteParams({
        owner: "velios",
        repo: "sms-formats",
        prNumber: "120",
      })
    ).toEqual({
      repository: { owner: "velios", repo: "sms-formats" },
      prNumber: 120,
    });
  });

  it("returns null for invalid canonical PR route params", () => {
    expect(
      parsePullRequestRouteParams({
        owner: "velios",
        repo: "sms-formats",
        prNumber: "abc",
      })
    ).toBeNull();
    expect(
      parsePullRequestRouteParams({
        owner: "velios",
        repo: "",
        prNumber: "120",
      })
    ).toBeNull();
  });

  it("redirects legacy workspace routes to dashboard root", () => {
    expect(getLegacyRouteRedirectPath("/workspace")).toBe("/");
    expect(getLegacyRouteRedirectPath("/pr/120")).toBe("/");
    expect(
      getLegacyRouteRedirectPath(
        "/bank/by_15382/repo/velios%2Fsms-formats/branch-or-pr/120"
      )
    ).toBe("/");
    expect(
      getLegacyRouteRedirectPath(
        "/repo/velios/sms-formats/pr/120",
        "?file=src%2Fby_15382%2Fformats%2Fa.txt&commit=a1b2c3"
      )
    ).toBe("/");
  });
});
