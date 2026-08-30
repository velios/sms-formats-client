import { afterEach, describe, expect, it, vi } from "vitest";

describe("app config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the upstream repository when build variables are absent", async () => {
    vi.stubEnv("VITE_GITHUB_SOURCE_REPO", "");
    vi.stubEnv("VITE_GITHUB_DEFAULT_SOURCE_REPO", "");
    vi.stubEnv("VITE_DEFAULT_BRANCH", "");

    const { config } = await import("./config");

    expect(config).toMatchObject({
      sourceOwner: "zenmoney",
      sourceRepo: "sms-formats",
      defaultSourceOwner: "zenmoney",
      defaultSourceRepo: "sms-formats",
      defaultBranch: "main",
    });
  });
});
