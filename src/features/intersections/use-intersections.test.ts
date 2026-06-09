import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  CachedFormatEntry,
  PreparedFormatEntries,
  prepareFormatEntries,
} from "@/features/quick-check/format-entries";
import type { IntersectionsScopeSignal } from "./core";
import {
  type UseIntersectionsParams,
  useIntersections,
} from "./use-intersections";

type LoadEntries = typeof prepareFormatEntries;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const CURRENT_PATH = "src/TBank_123/formats/current.txt";
const ANOTHER_PATH = "src/TBank_123/formats/another.txt";

function makeEntry(
  filePath: string,
  overrides: Partial<CachedFormatEntry> = {}
): CachedFormatEntry {
  return {
    filePath,
    fileName: filePath.split("/").pop() ?? filePath,
    regex: "^PAY (\\d+)$",
    examples: ["PAY 100", "PAY 200"],
    source: "remote",
    fingerprint: "remote:head-sha",
    ...overrides,
  };
}

// current.txt's regex recognizes another.txt's "PAY 300" → Z(current) = 1
function makePrepared(): PreparedFormatEntries {
  return {
    entries: [
      makeEntry(CURRENT_PATH),
      makeEntry(ANOTHER_PATH, {
        regex: "^REFUND (\\d+)$",
        examples: ["PAY 300", "REFUND 50"],
      }),
    ],
    loadErrorsCount: 0,
    remoteFetchedCount: 2,
    cachedCount: 0,
  };
}

function makeParams(
  overrides: Partial<UseIntersectionsParams> = {}
): UseIntersectionsParams {
  return {
    bankPath: "src/TBank_123",
    repository: { owner: "zenmoney", repo: "sms-formats" },
    sourceRefName: "head-sha",
    prNumber: 123,
    formatPaths: [CURRENT_PATH, ANOTHER_PATH],
    draftStore: { drafts: new Map(), getDraft: () => undefined },
    allFormatFiles: [CURRENT_PATH, ANOTHER_PATH],
    deletedFormatFiles: new Set<string>(),
    loadEntries: vi.fn(async () => makePrepared()),
    ...overrides,
  };
}

function renderIntersections(initialParams: UseIntersectionsParams) {
  const signals: IntersectionsScopeSignal[] = [];
  const rendered = renderHook(
    (params: UseIntersectionsParams) => useIntersections(params),
    {
      initialProps: {
        ...initialParams,
        onScopeSignal: (signal: IntersectionsScopeSignal) => {
          signals.push(signal);
        },
      },
    }
  );
  signals.length = 0; // drop the mount-time reset signal
  const rerender = (params: UseIntersectionsParams) =>
    rendered.rerender({
      ...params,
      onScopeSignal: (signal: IntersectionsScopeSignal) => {
        signals.push(signal);
      },
    });
  return { ...rendered, rerender, signals };
}

describe("useIntersections / calculate", () => {
  it("snapshots entries and exposes directed stats", async () => {
    const params = makeParams();
    const { result } = renderIntersections(params);

    await act(() => result.current.calculate());

    expect(result.current.hasCalculated).toBe(true);
    expect(result.current.isCalculating).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.entries.size).toBe(2);
    expect(result.current.stats.get(CURRENT_PATH)).toMatchObject({
      totalExamples: 2,
      ownMatchedExamples: 2,
      intersectingOtherFormats: 1,
      intersectingFormatPaths: [ANOTHER_PATH],
    });
  });

  it("reports no-source without invoking the loader", async () => {
    const loadEntries = vi.fn<LoadEntries>();
    const params = makeParams({ sourceRefName: undefined, loadEntries });
    const { result } = renderIntersections(params);

    await act(() => result.current.calculate());

    expect(result.current.error).toBe("no-source");
    expect(result.current.isCalculating).toBe(false);
    expect(loadEntries).not.toHaveBeenCalled();
  });

  it("reports missing-pr-number without invoking the loader", async () => {
    const loadEntries = vi.fn<LoadEntries>();
    const params = makeParams({ prNumber: null, loadEntries });
    const { result } = renderIntersections(params);

    await act(() => result.current.calculate());

    expect(result.current.error).toBe("missing-pr-number");
    expect(loadEntries).not.toHaveBeenCalled();
  });

  it("keeps the last successful snapshot when a recalculation fails", async () => {
    const loadEntries = vi
      .fn<LoadEntries>()
      .mockResolvedValueOnce(makePrepared())
      .mockRejectedValueOnce(new Error("boom"));
    const params = makeParams({ loadEntries });
    const { result } = renderIntersections(params);

    await act(() => result.current.calculate());
    await act(() => result.current.calculate());

    expect(result.current.error).toBe("load-failed");
    expect(result.current.hasCalculated).toBe(true);
    expect(result.current.entries.size).toBe(2);
    expect(result.current.isCalculating).toBe(false);
  });

  it("surfaces the loader's load errors count", async () => {
    const loadEntries = vi
      .fn<LoadEntries>()
      .mockResolvedValue({ ...makePrepared(), loadErrorsCount: 3 });
    const params = makeParams({ loadEntries });
    const { result } = renderIntersections(params);

    await act(() => result.current.calculate());

    expect(result.current.loadErrorsCount).toBe(3);
    expect(result.current.error).toBeNull();
  });

  it("silently drops a result superseded by a draft edit mid-flight", async () => {
    const pending = deferred<PreparedFormatEntries>();
    const loadEntries = vi.fn<LoadEntries>().mockReturnValue(pending.promise);
    const params = makeParams({ loadEntries });
    const { result, rerender } = renderIntersections(params);

    let calculation: Promise<void> = Promise.resolve();
    act(() => {
      calculation = result.current.calculate();
    });
    expect(result.current.isCalculating).toBe(true);

    rerender(
      makeParams({
        loadEntries,
        draftStore: {
          drafts: new Map([[CURRENT_PATH, {}]]),
          getDraft: () => undefined,
        },
      })
    );
    expect(result.current.isCalculating).toBe(false);

    await act(async () => {
      pending.resolve(makePrepared());
      await calculation;
    });

    expect(result.current.hasCalculated).toBe(false);
    expect(result.current.entries.size).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it("lets a newer run win over an older in-flight run", async () => {
    const first = deferred<PreparedFormatEntries>();
    const loadEntries = vi
      .fn<LoadEntries>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        ...makePrepared(),
        entries: [makeEntry(CURRENT_PATH)],
      });
    const params = makeParams({ loadEntries });
    const { result } = renderIntersections(params);

    let firstCalculation: Promise<void> = Promise.resolve();
    act(() => {
      firstCalculation = result.current.calculate();
    });
    await act(() => result.current.calculate());

    await act(async () => {
      first.resolve(makePrepared());
      await firstCalculation;
    });

    expect(result.current.entries.size).toBe(1);
    expect(result.current.hasCalculated).toBe(true);
  });
});

describe("useIntersections / scope", () => {
  it("raises the scope under an anchor and signals the caller", async () => {
    const params = makeParams();
    const { result, signals } = renderIntersections(params);

    await act(() => result.current.calculate());
    signals.length = 0; // calculate itself signals a scope clear
    act(() => result.current.scopeTo(CURRENT_PATH));

    expect(result.current.scopeFiles).toEqual([CURRENT_PATH, ANOTHER_PATH]);
    expect(signals).toEqual(["raised"]);
  });

  it("clears the scope on recalculation and signals the caller", async () => {
    const params = makeParams();
    const { result, signals } = renderIntersections(params);

    await act(() => result.current.calculate());
    signals.length = 0; // calculate itself signals a scope clear
    act(() => result.current.scopeTo(CURRENT_PATH));
    await act(() => result.current.calculate());

    expect(result.current.scopeFiles).toBeNull();
    expect(signals).toEqual(["raised", "cleared"]);
  });

  it("filters scope files down to live, non-deleted formats", async () => {
    const params = makeParams();
    const { result, rerender } = renderIntersections(params);

    await act(() => result.current.calculate());
    act(() => result.current.scopeTo(CURRENT_PATH));

    rerender(
      makeParams({
        loadEntries: params.loadEntries,
        deletedFormatFiles: new Set([ANOTHER_PATH]),
      })
    );

    expect(result.current.scopeFiles).toEqual([CURRENT_PATH]);
  });
});

describe("useIntersections / identity reset (ADR-0013 bug fix)", () => {
  it("resets everything including the scope when the bank changes", async () => {
    const params = makeParams();
    const { result, rerender, signals } = renderIntersections(params);

    await act(() => result.current.calculate());
    act(() => result.current.scopeTo(CURRENT_PATH));
    signals.length = 0;

    rerender(makeParams({ bankPath: "src/OtherBank_9" }));

    expect(result.current.scopeFiles).toBeNull();
    expect(result.current.entries.size).toBe(0);
    expect(result.current.hasCalculated).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isCalculating).toBe(false);
    expect(signals).toEqual(["cleared"]);
  });

  it("drops an in-flight result after a source change", async () => {
    const pending = deferred<PreparedFormatEntries>();
    const loadEntries = vi.fn<LoadEntries>().mockReturnValue(pending.promise);
    const params = makeParams({ loadEntries });
    const { result, rerender } = renderIntersections(params);

    let calculation: Promise<void> = Promise.resolve();
    act(() => {
      calculation = result.current.calculate();
    });

    rerender(makeParams({ loadEntries, sourceRefName: "other-sha" }));

    await act(async () => {
      pending.resolve(makePrepared());
      await calculation;
    });

    expect(result.current.hasCalculated).toBe(false);
    expect(result.current.entries.size).toBe(0);
  });
});

describe("useIntersections / mergeLiveEdit", () => {
  it("merges a live edit into the snapshot and recalculates stats", async () => {
    const params = makeParams();
    const { result } = renderIntersections(params);

    await act(() => result.current.calculate());
    expect(
      result.current.stats.get(CURRENT_PATH)?.intersectingOtherFormats
    ).toBe(1);

    act(() =>
      result.current.mergeLiveEdit({
        filePath: CURRENT_PATH,
        regex: "^CARD (\\d+)$",
        examples: ["PAY 100", "PAY 200"],
      })
    );

    expect(
      result.current.stats.get(CURRENT_PATH)?.intersectingOtherFormats
    ).toBe(0);
    expect(result.current.entries.get(CURRENT_PATH)?.regex).toBe(
      "^CARD (\\d+)$"
    );
  });

  it("ignores edits before calculation and edits of deleted files", async () => {
    const params = makeParams({
      deletedFormatFiles: new Set([ANOTHER_PATH]),
    });
    const { result } = renderIntersections(params);

    act(() =>
      result.current.mergeLiveEdit({
        filePath: CURRENT_PATH,
        regex: "^X$",
        examples: [],
      })
    );
    expect(result.current.entries.size).toBe(0);

    await act(() => result.current.calculate());
    act(() =>
      result.current.mergeLiveEdit({
        filePath: ANOTHER_PATH,
        regex: "^X$",
        examples: [],
      })
    );
    expect(result.current.entries.get(ANOTHER_PATH)?.regex).toBe(
      "^REFUND (\\d+)$"
    );
  });
});
