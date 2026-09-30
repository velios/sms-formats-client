import { expect, it } from "bun:test";
import { resolveFormatAnchor } from "./format-anchor";

it("accepts decimal positions with leading zeros and reports any larger position as missing", () => {
  expect(
    resolveFormatAnchor("#show-example=02", ["A", "B"], [1, 2], 2, false)
  ).toMatchObject({ index: 1, notices: [] });
  expect(
    resolveFormatAnchor(
      "#show-example=999999999999999999999999",
      ["A"],
      [1],
      1,
      false
    )
  ).toMatchObject({
    index: 0,
    notices: [
      { key: "editor.exampleMissing", number: "999999999999999999999999" },
    ],
  });
});
it("imports the empty SMS and falls back for invalid payloads", () => {
  expect(resolveFormatAnchor("#add-sms=", [], [], 0, false)).toMatchObject({
    index: 0,
    append: "",
  });
  expect(
    resolveFormatAnchor(
      "#add-sms=_w&show-example=2",
      ["A", "B"],
      [1, 2],
      2,
      false
    )
  ).toMatchObject({ index: 1, notices: [{ key: "editor.invalidSmsPayload" }] });
});
