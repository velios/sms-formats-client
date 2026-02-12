import { describe, expect, it } from "vitest";
import { decodeBase64Utf8, encodeBase64Utf8 } from "./encoding";

describe("github encoding", () => {
  it("decodes utf-8 base64 content from GitHub API", () => {
    const base64 = "0L/QvtGB0YLRg9C/0LjQu9C+INC+0YI="; // "поступило от"
    expect(decodeBase64Utf8(base64)).toBe("поступило от");
  });

  it("encodes and decodes unicode content without mojibake", () => {
    const regex =
      "^.*\\*(\\d{4}).*(?:оступ|поступило)(?!.*stat).*(?:lot|лот)\\s+$";
    const encoded = encodeBase64Utf8(regex);
    expect(decodeBase64Utf8(encoded)).toBe(regex);
  });

  it("keeps ascii content unchanged", () => {
    const content = "^(\\\\d+) USD$";
    const encoded = encodeBase64Utf8(content);
    expect(decodeBase64Utf8(encoded)).toBe(content);
  });
});
