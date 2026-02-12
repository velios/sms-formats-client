import { describe, expect, it } from "vitest";
import { buildRegex101Url } from "./regex101";

describe("buildRegex101Url", () => {
  it("builds regex101 link with regex and test string", () => {
    const regex = "^(\\d+) руб\\. (.+)$";
    const testString = "100 руб. Магазин\n200 руб. Аптека";
    const url = buildRegex101Url(regex, testString);
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://regex101.com");
    expect(parsed.pathname).toBe("/");
    expect(parsed.searchParams.get("regex")).toBe(regex);
    expect(parsed.searchParams.get("testString")).toBe(testString);
    expect(parsed.searchParams.get("flavor")).toBe("javascript");
    expect(parsed.searchParams.has("flags")).toBe(false);
  });

  it("adds flags when provided", () => {
    const url = buildRegex101Url("^abc$", "abc", { flags: "gm" });
    const parsed = new URL(url);

    expect(parsed.searchParams.get("flags")).toBe("gm");
  });
});
