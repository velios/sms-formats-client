import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type UseImportAnswerParams,
  useImportAnswer,
} from "./use-import-answer";

// The real draft store, not a fake: undo and reset-to-remote after an import
// are part of what stage 2 promises, and only the real per-path history can
// answer for them. It is loaded late because the module reads `localStorage`
// and IndexedDB while being evaluated.
const idbStorage = vi.hoisted(() => new Map<string, string>());

vi.mock("idb-keyval", () => ({
  del: vi.fn((key: string) => {
    idbStorage.delete(String(key));
    return Promise.resolve();
  }),
  get: vi.fn((key: string) => Promise.resolve(idbStorage.get(String(key)))),
  keys: vi.fn(() => Promise.resolve([...idbStorage.keys()])),
  set: vi.fn((key: string, value: string) => {
    idbStorage.set(String(key), value);
    return Promise.resolve();
  }),
}));

let useDraftStore: typeof import("@/store").useDraftStore;

const BANK_PATH = "src/TBank_123";
const SENDERS = `${BANK_PATH}/senders.txt`;
const FORMAT_A = `${BANK_PATH}/formats/Формат A_1.txt`;
const FORMAT_B = `${BANK_PATH}/formats/Формат B_2.txt`;
const NEW_FORMAT = `${BANK_PATH}/formats/Формат новый.txt`;

const HEAD_SHA = "headsha";
// Everything the bank has at the head ref; NEW_FORMAT is deliberately absent.
const EXISTING = new Set([SENDERS, FORMAT_A, FORMAT_B]);

function block(tag: "file" | "delete", path: string, body: string): string {
  return `<${tag} path="${path}">\n${body}\n</${tag}>`;
}

function setup(overrides: Partial<UseImportAnswerParams> = {}) {
  const calculateIntersections = vi.fn(() => Promise.resolve());
  const loadBodies = vi.fn(({ paths }: { paths: string[] }) =>
    Promise.resolve(new Map(paths.map((path) => [path, `head of ${path}`])))
  );
  const rendered = renderHook(() =>
    useImportAnswer({
      bankPath: BANK_PATH,
      repository: { owner: "zenmoney", repo: "sms-formats" },
      prNumber: 7,
      sourceRefName: HEAD_SHA,
      headSha: HEAD_SHA,
      existingPaths: EXISTING,
      draftStore: useDraftStore.getState(),
      calculateIntersections,
      loadBodies,
      ...overrides,
    })
  );
  return { ...rendered, calculateIntersections, loadBodies };
}

async function paste(
  rendered: ReturnType<typeof setup>,
  text: string
): Promise<void> {
  act(() => {
    rendered.result.current.setText(text);
  });
  await waitFor(() =>
    expect(rendered.result.current.isLoadingBodies).toBe(false)
  );
}

beforeAll(async () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  });
  const module = await import("@/store");
  useDraftStore = module.useDraftStore;
  await module.waitForDraftStoreHydration();
});

beforeEach(() => {
  useDraftStore.getState().clearAll();
});

describe("useImportAnswer: bodies in force", () => {
  it("fetches only the paths it cannot get for free", async () => {
    useDraftStore
      .getState()
      .setDraft(FORMAT_A, "правка руками", "sha-a", "head of A");
    const rendered = setup();

    await paste(
      rendered,
      [
        block("file", FORMAT_A, "новое A"),
        block("file", NEW_FORMAT, "совсем новый"),
        block("file", FORMAT_B, "новое B"),
      ].join("\n")
    );

    // The draft carries its head-ref body, the new file has none — only B goes
    // to the network.
    expect(rendered.loadBodies).toHaveBeenCalledTimes(1);
    expect(rendered.loadBodies.mock.calls[0]?.[0].paths).toEqual([FORMAT_B]);

    const rows = rendered.result.current.rows;
    expect(rows.map((row) => row.currentContent)).toEqual([
      "правка руками",
      "",
      `head of ${FORMAT_B}`,
    ]);
    expect(rows.map((row) => row.existsAtHead)).toEqual([true, false, true]);
    expect(rendered.result.current.canImport).toBe(true);
  });

  it("shows nothing and refuses the import when a body fails to load", async () => {
    const loadBodies = vi.fn(
      (): Promise<Map<string, string>> => Promise.reject(new Error("503"))
    );
    const rendered = setup({ loadBodies });

    await paste(rendered, block("file", FORMAT_A, "новое A"));

    expect(rendered.result.current.loadError).toBe("load-failed");
    expect(rendered.result.current.canImport).toBe(false);

    loadBodies.mockImplementation(() =>
      Promise.resolve(new Map([[FORMAT_A, "head of A"]]))
    );
    act(() => {
      rendered.result.current.retry();
    });
    // Not on `loadError`: it is cleared the moment the retry starts, so the
    // wait would pass mid-flight.
    await waitFor(() => expect(rendered.result.current.canImport).toBe(true));
    expect(rendered.result.current.loadError).toBeNull();
  });

  it("marks a row that overwrites a manual edit, and only that row", async () => {
    const draftStore = useDraftStore.getState();
    draftStore.setDraft(FORMAT_A, "правка руками", "sha-a", "head of A");
    // Opening a file in the editor creates a draft equal to the head ref —
    // that is not a manual edit.
    draftStore.ensureDraft(FORMAT_B, "head of B", "sha-b", "head of B");
    const rendered = setup();

    await paste(
      rendered,
      [
        block("file", FORMAT_A, "новое A"),
        block("file", FORMAT_B, "новое B"),
      ].join("\n")
    );

    expect(
      rendered.result.current.rows.map((row) => row.overwritesManualEdit)
    ).toEqual([true, false]);
    expect(rendered.result.current.overwriteCount).toBe(1);
  });
});

describe("useImportAnswer: the boundary refuses the whole answer", () => {
  it("names every violation and writes nothing", async () => {
    const rendered = setup();

    await paste(
      rendered,
      [
        block("file", `${BANK_PATH}/README.md`, "обзор"),
        block("file", "src/Halyk Bank-kz_15/formats/Формат_1.txt", "чужой"),
        block("file", FORMAT_A, "новое A"),
      ].join("\n")
    );

    expect(
      rendered.result.current.violatedRows.map((row) => row.violation)
    ).toEqual(["bank-root", "other-bank"]);
    expect(rendered.result.current.canImport).toBe(false);
    expect(rendered.loadBodies).not.toHaveBeenCalled();

    await act(async () => {
      await rendered.result.current.write();
    });
    expect(useDraftStore.getState().getChangedFiles()).toEqual([]);
  });
});

describe("useImportAnswer: writing", () => {
  it("writes in answer order, so the last block on a path wins", async () => {
    const rendered = setup();

    await paste(
      rendered,
      [
        block("file", FORMAT_A, "первое"),
        block("file", FORMAT_B, "тело B"),
        block("file", FORMAT_A, "второе"),
      ].join("\n")
    );
    await act(async () => {
      await rendered.result.current.write();
    });

    const drafts = useDraftStore.getState();
    expect(drafts.getDraft(FORMAT_A)?.content).toBe("второе");
    expect(drafts.getDraft(FORMAT_B)?.content).toBe("тело B");
    // Two blocks, one path: the summary counts files, not blocks.
    expect(rendered.result.current.summary?.written).toBe(2);
  });

  it("deletes an existing file and drops a file the PR only drafted", async () => {
    useDraftStore
      .getState()
      .setDraft(NEW_FORMAT, "черновик нового", "sha-new", "");
    const rendered = setup();

    await paste(
      rendered,
      [
        block("delete", FORMAT_A, "дубль существующего"),
        block("delete", NEW_FORMAT, "не пригодился"),
      ].join("\n")
    );
    await act(async () => {
      await rendered.result.current.write();
    });

    const drafts = useDraftStore.getState();
    expect(drafts.getDraft(FORMAT_A)?.isDeleted).toBe(true);
    // Nothing to delete upstream — the draft simply goes away.
    expect(drafts.getDraft(NEW_FORMAT)).toBeUndefined();
    expect(rendered.result.current.summary?.deleted).toBe(2);
  });

  it("leaves drafts that undo and reset to remote like hand-made ones", async () => {
    useDraftStore
      .getState()
      .setDraft(FORMAT_A, "правка руками", "sha-a", "head of A");
    const rendered = setup();

    await paste(rendered, block("file", FORMAT_A, "от агента"));
    await act(async () => {
      await rendered.result.current.write();
    });

    const drafts = useDraftStore.getState();
    expect(drafts.getDraft(FORMAT_A)?.content).toBe("от агента");
    expect(drafts.canUndo(FORMAT_A)).toBe(true);

    act(() => {
      drafts.undo(FORMAT_A);
    });
    expect(useDraftStore.getState().getDraft(FORMAT_A)?.content).toBe(
      "правка руками"
    );

    act(() => {
      useDraftStore.getState().resetFileToRemote(FORMAT_A);
    });
    expect(useDraftStore.getState().getDraft(FORMAT_A)?.content).toBe(
      "head of A"
    );
  });

  it("recalculates intersections only when the checkbox is on", async () => {
    const rendered = setup();
    await paste(rendered, block("file", FORMAT_A, "новое A"));

    expect(rendered.result.current.recalculateIntersections).toBe(true);
    act(() => {
      rendered.result.current.setRecalculateIntersections(false);
    });
    await act(async () => {
      await rendered.result.current.write();
    });

    expect(rendered.calculateIntersections).not.toHaveBeenCalled();
    expect(rendered.result.current.summary?.intersectionsRecalculated).toBe(
      false
    );
  });

  it("runs the existing recount when the checkbox is left on", async () => {
    const rendered = setup();
    await paste(rendered, block("file", FORMAT_A, "новое A"));

    await act(async () => {
      await rendered.result.current.write();
    });

    expect(rendered.calculateIntersections).toHaveBeenCalledTimes(1);
    expect(rendered.result.current.summary?.intersectionsRecalculated).toBe(
      true
    );
  });

  it("keeps nothing sticky: a fresh hook starts empty with the checkbox on", async () => {
    const first = setup();
    await paste(first, block("file", FORMAT_A, "новое A"));
    act(() => {
      first.result.current.setRecalculateIntersections(false);
    });
    first.unmount();

    const second = setup();
    expect(second.result.current.text).toBe("");
    expect(second.result.current.recalculateIntersections).toBe(true);
    expect(localStorage.getItem("sms-formats-import-answer")).toBeNull();
  });
});
