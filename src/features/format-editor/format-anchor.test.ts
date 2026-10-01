import { expect, it } from "bun:test";
import { encodeSmsPayload } from "@/domain/format";
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

it.each([
  "-----EXAMPLE-----",
  "hello\n-----EXAMPLE-----\nworld",
  "hello\r\n-----EXAMPLE-----\r\nworld",
  "hello\n \t-----EXAMPLE----- \t\nworld",
])("rejects a reserved Example delimiter before importing %j", (sms) => {
  const result = resolveFormatAnchor(
    `#add-sms=${encodeSmsPayload(sms)}&show-example=2`,
    ["A", "B"],
    [1, 2],
    2,
    false
  );
  expect(result).toEqual({
    index: 1,
    notices: [{ key: "editor.reservedSmsDelimiter" }],
  });
});

it("imports an inline delimiter without changing SMS bytes", () => {
  const sms = " \nКод 😀 -----EXAMPLE----- внутри строки\r\n ";
  expect(
    resolveFormatAnchor(
      `#add-sms=${encodeSmsPayload(sms)}`,
      ["A"],
      [1],
      1,
      false
    )
  ).toEqual({ index: 1, notices: [], append: sms });
});
