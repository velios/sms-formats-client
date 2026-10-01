import { describe, expect, it } from "bun:test";
import {
  initialExamplePositions,
  reconcileExamplePositions,
  serializeFormat,
} from "@/domain/format";
import { getFormatChangeMarkers } from "./change-markers";

const format = (
  examples = ["A", "B"],
  regex = "^(.*)$",
  columns = ["comment"]
) => serializeFormat(regex, columns, examples);

const base = format();

describe("format change markers", () => {
  it("keeps local and published fields independent, with local priority", () => {
    const head = format(["A", "published"], "^(.+)$");
    const current = format(["local", "published"], "^(.+)$", ["account"]);
    expect(getFormatChangeMarkers(current, head, base, [1, 2])).toEqual({
      regex: "source",
      columns: "local",
      examples: ["local", "source"],
    });
    expect(getFormatChangeMarkers(base, head, base, [1, 2])).toEqual({
      regex: "local",
      columns: null,
      examples: [null, "local"],
    });
    expect(getFormatChangeMarkers(head, head, base, [1, 2])).toEqual({
      regex: "source",
      columns: null,
      examples: [null, "source"],
    });
  });

  it("does not mark untouched examples after insertion or deletion", () => {
    const head = format(["A", "new", "B"]);
    expect(
      getFormatChangeMarkers(head, head, base, [1, 2, 3]).examples
    ).toEqual([null, "source", null]);
    const current = format(["local", "B"]);
    expect(
      getFormatChangeMarkers(current, head, base, [null, 3]).examples
    ).toEqual(["local", null]);
    const deleted = format(["B"]);
    expect(
      getFormatChangeMarkers(deleted, deleted, base, [1]).examples
    ).toEqual([null]);
  });

  it("marks reordered sections without losing duplicate occurrences", () => {
    const head = format(["B", "A"]);
    expect(getFormatChangeMarkers(head, head, base, [1, 2]).examples).toEqual([
      "source",
      "source",
    ]);
    const duplicates = format(["A", "A", "B"]);
    expect(
      getFormatChangeMarkers(duplicates, base, base, [1, null, 2]).examples
    ).toEqual([null, "local", null]);
  });

  it.each([
    { examples: ["Beta", "Alpha", "Gamma"], changed: [true, true, false] },
    {
      examples: ["Beta", "Alpha", "New", "Gamma"],
      changed: [true, true, true, false],
    },
    { examples: ["Gamma", "Alpha"], changed: [true, true] },
    { examples: ["Beta", "Gamma"], changed: [false, false] },
    {
      examples: ["Alpha", "New", "Beta", "Gamma"],
      changed: [false, true, false, false],
    },
  ])(
    "tracks relative example order independently of other field edits: $examples",
    ({ examples, changed }) => {
      const original = format(["Alpha", "Beta", "Gamma"]);
      const edited = format([...examples], "^(.+)$", ["account"]);
      const positions = reconcileExamplePositions(
        original,
        edited,
        initialExamplePositions(original)
      );
      expect(
        getFormatChangeMarkers(edited, original, undefined, positions).examples
      ).toEqual(changed.map((value) => (value ? "local" : null)));
      expect(
        getFormatChangeMarkers(
          edited,
          edited,
          original,
          initialExamplePositions(edited)
        ).examples
      ).toEqual(changed.map((value) => (value ? "source" : null)));
    }
  );

  it("compares literal example text and column order", () => {
    const head = format(["A\nB", "B"], "^(.*)$", ["comment", "account"]);
    const current = format(["A B", "B"], "^(.*)$", ["account", "comment"]);
    expect(getFormatChangeMarkers(current, head, undefined, [1, 2])).toEqual({
      regex: null,
      columns: "local",
      examples: ["local", null],
    });
  });

  it("marks all sections of a new format including empty examples", () => {
    const current = format([""]);
    expect(getFormatChangeMarkers(current, null, undefined, [null])).toEqual({
      regex: "local",
      columns: "local",
      examples: ["local"],
    });
    expect(getFormatChangeMarkers(current, current, null, [1])).toEqual({
      regex: "source",
      columns: "source",
      examples: ["source"],
    });
  });

  it("clears local markers on publication while preserving published changes", () => {
    const current = format(["edited", "B"]);
    expect(
      getFormatChangeMarkers(current, base, base, [1, 2]).examples
    ).toEqual(["local", null]);
    expect(
      getFormatChangeMarkers(current, current, base, [1, 2]).examples
    ).toEqual(["source", null]);
    expect(getFormatChangeMarkers(base, base, undefined, [1, 2])).toEqual({
      regex: null,
      columns: null,
      examples: [null, null],
    });
  });

  it("does not interpret an unavailable source revision as an absent file", () => {
    expect(
      getFormatChangeMarkers(base, base, undefined, [1, 2]).examples
    ).toEqual([null, null]);
    expect(getFormatChangeMarkers(base, "", "", [null, null]).examples).toEqual(
      ["local", "local"]
    );
  });

  it("clears local markers when deletion and recreation restore the entire file", () => {
    expect(getFormatChangeMarkers(base, base, undefined, [null, null])).toEqual(
      {
        regex: null,
        columns: null,
        examples: [null, null],
      }
    );
    const head = format(["A", "published"]);
    expect(
      getFormatChangeMarkers(head, head, base, [null, null]).examples
    ).toEqual([null, "source"]);
  });
});
