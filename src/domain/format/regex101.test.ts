import { describe, expect, it } from "bun:test";
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
    expect(parsed.searchParams.get("testString")).toBe(
      "100 руб. Магазин 200 руб. Аптека"
    );
    expect(parsed.searchParams.get("flavor")).toBe("javascript");
    expect(parsed.searchParams.has("flags")).toBe(false);
  });

  it("exports NFC matching text while keeping the regex unchanged", () => {
    const regex = "^(lúc)$";
    const url = new URL(buildRegex101Url(regex, "\nlu\u0301c "));
    expect(url.searchParams.get("testString")).toBe("lúc");
    expect(url.searchParams.get("regex")).toBe(regex);
  });

  it("adds flags when provided", () => {
    const url = buildRegex101Url("^abc$", "abc", { flags: "gm" });
    const parsed = new URL(url);

    expect(parsed.searchParams.get("flags")).toBe("gm");
  });
});
