import { expect, it } from "bun:test";
import {
  initialExamplePositions,
  reconcileExamplePositions,
} from "./example-positions";
import { serializeFormat } from "./parser";

const format = (examples: string[]) =>
  serializeFormat("^(.*)$", ["comment"], examples);
it("retains source positions through raw insertion, text edit, deletion, and empty list", () => {
  let content = format(["A", "B", "C"]);
  let positions = initialExamplePositions(content);
  let next = format(["A", "local", "B", "C"]);
  positions = reconcileExamplePositions(content, next, positions);
  expect(positions).toEqual([1, null, 2, 3]);
  content = next;
  next = format(["A", "local", "changed B", "C"]);
  positions = reconcileExamplePositions(content, next, positions);
  expect(positions).toEqual([1, null, 2, 3]);
  content = next;
  next = format(["A", "local", "C"]);
  expect(reconcileExamplePositions(content, next, positions)).toEqual([
    1,
    null,
    3,
  ]);
  expect(reconcileExamplePositions(next, format([]), [1, null, 3])).toEqual([]);
});
it("does not turn a local duplicate into a source Example during its edit", () => {
  expect(
    reconcileExamplePositions(format(["A", "A"]), format(["A", "edited"]), [
      1,
      null,
    ])
  ).toEqual([1, null]);
});
it("keeps the position of a text edit even when it becomes another Example's exact text", () => {
  expect(
    reconcileExamplePositions(
      format(["A", "B", "C"]),
      format(["B", "B", "C"]),
      [1, 2, 3]
    )
  ).toEqual([1, 2, 3]);
});
