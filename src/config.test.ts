import { afterEach, describe, expect, it } from "bun:test";

const keys = [
  "VITE_GITHUB_SOURCE_REPO",
  "VITE_GITHUB_DEFAULT_SOURCE_REPO",
  "VITE_DEFAULT_BRANCH",
] as const;
const original = keys.map((key) => process.env[key]);

describe("app config", () => {
  afterEach(() => {
    keys.forEach((key, index) => {
      const value = original[index];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it("uses the upstream repository when build variables are absent", async () => {
    for (const key of keys) {
      process.env[key] = "";
    }
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
