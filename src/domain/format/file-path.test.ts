import { describe, expect, it } from "bun:test";
import { validateNewFormatPath } from "./file-path";

const bank = "src/Bank";
describe("new format paths", () => {
  it.each([
    ".txt",
    "../other.txt",
    "nested/a.txt",
    "a\\b.txt",
    "a\u0000.txt",
    "a.md",
  ])("rejects unsafe or non-format names: %s", (name) => {
    expect(validateNewFormatPath(`${bank}/formats/${name}`, bank, [])).toBe(
      "invalidFormatName"
    );
  });
  it("rejects another bank and an existing file", () => {
    expect(validateNewFormatPath("src/Other/formats/a.txt", bank, [])).toBe(
      "invalidFormatName"
    );
    expect(
      validateNewFormatPath(`${bank}/formats/a.txt`, bank, [
        `${bank}/formats/a.txt`,
      ])
    ).toBe("formatExists");
    expect(
      validateNewFormatPath(`${bank}/formats/new.txt`, bank, [])
    ).toBeNull();
  });
});
