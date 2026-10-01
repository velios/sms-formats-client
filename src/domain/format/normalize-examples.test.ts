import { expect, test } from "bun:test";
import { normalizeExampleSections } from "./normalize-examples";

test("NFC changes only the selected EXAMPLE and preserves the source bytes elsewhere", () => {
  const prefix =
    "^(е\u0308)$\r\n\r\n-----COLUMNS-----\r\ncomment; extra  \r\n\r\n";
  const first = " -----EXAMPLE----- \r\n  е\u0308\r\nи\u0306\u00a0😀  \r\n\r\n";
  const second = "-----EXAMPLE-----\r\na\u0306\u0301  ﬁ Ａ\u200e\u200f";
  const raw = prefix + first + second;
  expect(normalizeExampleSections(raw, 0)).toBe(
    prefix + first.normalize("NFC") + second
  );
  expect(normalizeExampleSections(raw, 1)).toBe(
    prefix + first + second.normalize("NFC")
  );
  const all = prefix + first.normalize("NFC") + second.normalize("NFC");
  expect(normalizeExampleSections(raw)).toBe(all);
  expect(normalizeExampleSections(all)).toBe(all);
  expect(normalizeExampleSections(prefix)).toBe(prefix);
});
