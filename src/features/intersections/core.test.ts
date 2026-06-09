import { describe, expect, it } from "vitest";
import type { FormatIntersectionStat } from "@/domain/format";
import type { CachedFormatEntry } from "@/features/quick-check/format-entries";
import {
  buildCachedFormatEntryFromEditorContext,
  buildIntersectionScope,
  mergeLiveEditIntoSnapshot,
  resolveIntersectionScopeFiles,
  resolveVisibleIntersectionEntries,
  shouldAcceptRunResult,
} from "./core";

function makeEntry(
  filePath: string,
  overrides: Partial<CachedFormatEntry> = {}
): CachedFormatEntry {
  return {
    filePath,
    fileName: filePath.split("/").pop() ?? filePath,
    regex: "^PAY (\\d+)$",
    examples: ["PAY 100"],
    source: "remote",
    fingerprint: "remote:head-sha",
    ...overrides,
  };
}

function makeStat(
  filePath: string,
  intersectingFormatPaths: string[]
): FormatIntersectionStat {
  return {
    filePath,
    totalExamples: 1,
    ownMatchedExamples: 1,
    intersectingOtherFormats: intersectingFormatPaths.length,
    intersectingFormatPaths,
  };
}

describe("shouldAcceptRunResult", () => {
  it("accepts a result of the current run", () => {
    expect(shouldAcceptRunResult({ currentRunId: 3, runId: 3 })).toBe(true);
  });

  it("drops a result that was superseded by a newer run", () => {
    expect(shouldAcceptRunResult({ currentRunId: 4, runId: 3 })).toBe(false);
  });
});

describe("buildCachedFormatEntryFromEditorContext", () => {
  it("trims the regex and drops blank examples", () => {
    const entry = buildCachedFormatEntryFromEditorContext({
      filePath: "src/Bank_1/formats/current.txt",
      regex: " ^PAY (\\d+)$ ",
      examples: [" PAY 100 ", "", "  ", "PAY 200"],
    });

    expect(entry.fileName).toBe("current.txt");
    expect(entry.regex).toBe("^PAY (\\d+)$");
    expect(entry.examples).toEqual(["PAY 100", "PAY 200"]);
    expect(entry.source).toBe("draft");
    expect(entry.fingerprint).toMatch(/^draft-live:/);
  });
});

describe("mergeLiveEditIntoSnapshot", () => {
  it("replaces the edited entry without mutating the previous snapshot", () => {
    const previous = new Map([
      ["a.txt", makeEntry("a.txt")],
      ["b.txt", makeEntry("b.txt")],
    ]);

    const next = mergeLiveEditIntoSnapshot({
      entries: previous,
      context: {
        filePath: "a.txt",
        regex: "^CARD (\\d+)$",
        examples: ["CARD 1"],
      },
    });

    expect(next).not.toBe(previous);
    expect(next.get("a.txt")?.regex).toBe("^CARD (\\d+)$");
    expect(next.get("b.txt")).toBe(previous.get("b.txt"));
    expect(previous.get("a.txt")?.regex).toBe("^PAY (\\d+)$");
  });

  it("adds an entry that was not in the snapshot", () => {
    const next = mergeLiveEditIntoSnapshot({
      entries: new Map(),
      context: { filePath: "new.txt", regex: "^X$", examples: ["X"] },
    });

    expect(next.get("new.txt")?.regex).toBe("^X$");
  });
});

describe("resolveVisibleIntersectionEntries", () => {
  it("hides entries whose files are deleted", () => {
    const entries = resolveVisibleIntersectionEntries({
      entriesByPath: new Map([
        ["a.txt", makeEntry("a.txt")],
        ["b.txt", makeEntry("b.txt")],
      ]),
      deletedFormatFiles: new Set(["b.txt"]),
    });

    expect(entries.map((entry) => entry.filePath)).toEqual(["a.txt"]);
  });
});

describe("buildIntersectionScope", () => {
  it("puts the anchor first followed by the intersecting formats", () => {
    const scope = buildIntersectionScope({
      anchorPath: "a.txt",
      stats: new Map([["a.txt", makeStat("a.txt", ["b.txt", "c.txt"])]]),
    });

    expect(scope).toEqual({
      anchorPath: "a.txt",
      formatPaths: ["a.txt", "b.txt", "c.txt"],
    });
  });

  it("scopes to the anchor alone when it has no stat", () => {
    const scope = buildIntersectionScope({
      anchorPath: "a.txt",
      stats: new Map(),
    });

    expect(scope.formatPaths).toEqual(["a.txt"]);
  });
});

describe("resolveIntersectionScopeFiles", () => {
  it("returns null without a scope", () => {
    expect(
      resolveIntersectionScopeFiles({
        scope: null,
        allFormatFiles: ["a.txt"],
        deletedFormatFiles: new Set(),
      })
    ).toBeNull();
  });

  it("keeps only live files preserving the scope order", () => {
    expect(
      resolveIntersectionScopeFiles({
        scope: {
          anchorPath: "a.txt",
          formatPaths: ["a.txt", "gone.txt", "b.txt", "deleted.txt"],
        },
        allFormatFiles: ["b.txt", "a.txt", "deleted.txt"],
        deletedFormatFiles: new Set(["deleted.txt"]),
      })
    ).toEqual(["a.txt", "b.txt"]);
  });
});
