import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { restoreTestGlobals, setTestGlobal } from "@/test-globals";

let generation = 0;
const idbStorage = new Map<string, string>();

mock.module("idb-keyval", () => ({
  del: mock(async (key: string) => {
    idbStorage.delete(String(key));
  }),
  get: mock(async (key: string) => idbStorage.get(String(key)) ?? null),
  keys: mock(async () => Array.from(idbStorage.keys())),
  set: mock(async (key: string, value: string) => {
    idbStorage.set(String(key), value);
  }),
}));

async function loadStores() {
  // Reload the store without reloading its mocked persistence dependencies.
  const mod: typeof import("./index") = await import(
    `./index.ts?generation=${generation++}`
  );
  await mod.waitForDraftStoreHydration();
  return mod;
}

beforeEach(() => {
  idbStorage.clear();
  const localStorageState = new Map<string, string>();
  setTestGlobal("localStorage", {
    getItem: (key: string) => localStorageState.get(key) ?? null,
    removeItem: (key: string) => {
      localStorageState.delete(key);
    },
    setItem: (key: string, value: string) => {
      localStorageState.set(key, value);
    },
  });
});

afterEach(() => {
  restoreTestGlobals();
});

describe("draft store persist", () => {
  it("persists scoped drafts and restores them after module reload", async () => {
    const firstLoad = await loadStores();
    firstLoad.useSourceStore.getState().setSource({
      type: "pr",
      name: "pr-123",
      sha: "head-sha",
      prNumber: 123,
    });
    firstLoad.useDraftStore.getState().activateScope("repo:pr:123", false);
    firstLoad.useDraftStore
      .getState()
      .setDraft(
        "src/TestBank/formats/a.txt",
        "local-draft",
        "base-sha",
        "remote-content"
      );

    expect(
      firstLoad.useDraftStore.getState().getStoredDraftsForScope("repo:pr:123")
    ).toMatchObject([
      {
        filePath: "src/TestBank/formats/a.txt",
        content: "local-draft",
        headContent: "remote-content",
      },
    ]);

    const secondLoad = await loadStores();
    expect(secondLoad.useDraftStore).not.toBe(firstLoad.useDraftStore);

    expect(
      secondLoad.useDraftStore.getState().getStoredDraftsForScope("repo:pr:123")
    ).toMatchObject([
      {
        filePath: "src/TestBank/formats/a.txt",
        content: "local-draft",
        headContent: "remote-content",
      },
    ]);

    secondLoad.useDraftStore.getState().activateScope("repo:pr:123", true);

    expect(
      secondLoad.useDraftStore.getState().getDraft("src/TestBank/formats/a.txt")
    ).toMatchObject({
      filePath: "src/TestBank/formats/a.txt",
      content: "local-draft",
      headContent: "remote-content",
    });
  });

  it("keeps persisted drafts isolated per scope while switching between PRs", async () => {
    const { useDraftStore, useSourceStore } = await loadStores();
    useSourceStore.getState().setSource({
      type: "pr",
      name: "pr-123",
      sha: "head-123",
      prNumber: 123,
    });

    useDraftStore.getState().activateScope("repo:pr:123", false);
    useDraftStore
      .getState()
      .setDraft("src/TestBank/formats/a.txt", "draft-123", "base-123", "A");

    useSourceStore.getState().setSource({
      type: "pr",
      name: "pr-456",
      sha: "head-456",
      prNumber: 456,
    });
    useDraftStore.getState().activateScope("repo:pr:456", false);
    useDraftStore
      .getState()
      .setDraft("src/TestBank/formats/b.txt", "draft-456", "base-456", "B");

    useDraftStore.getState().activateScope("repo:pr:123", true);
    expect(
      useDraftStore.getState().getDraft("src/TestBank/formats/a.txt")
    ).toMatchObject({
      content: "draft-123",
    });
    expect(
      useDraftStore.getState().getDraft("src/TestBank/formats/b.txt")
    ).toBeUndefined();

    useDraftStore.getState().activateScope("repo:pr:456", true);
    expect(
      useDraftStore.getState().getDraft("src/TestBank/formats/b.txt")
    ).toMatchObject({
      content: "draft-456",
    });
  });

  it("advances the baseline of other documents and preserves their later edits and history", async () => {
    const { useDraftStore } = await loadStores();
    const store = useDraftStore.getState();
    store.activateScope("publish-test", false);
    store.ensureDraft("a.txt", "A", "head", "A");
    store.ensureDraft("b.txt", "B", "head", "B");
    store.ensureDraft("c.txt", "C", "head", "C");
    store.applyUserEdit("a.txt", "PUBLISHED", "head", "A");
    const published = store.getChangedFiles();
    store.applyUserEdit("b.txt", "LATER", "head", "B");
    store.acknowledgePublished(published, "new-head", "publish-test");
    expect(store.getDraft("a.txt")).toBeUndefined();
    expect(store.getDraft("b.txt")).toMatchObject({
      content: "LATER",
      headContent: "B",
      baselineHeadSha: "new-head",
    });
    expect(store.getDraft("c.txt")).toMatchObject({
      content: "C",
      headContent: "C",
      baselineHeadSha: "new-head",
    });
    store.undo("b.txt");
    expect(store.getDraft("b.txt")?.content).toBe("B");
    store.redo("b.txt");
    expect(store.getDraft("b.txt")?.content).toBe("LATER");
  });

  it.each(["delete", "rename", "switch-scope"])(
    "preserves a removed captured creation after %s during publication",
    async (operation) => {
      const { useDraftStore } = await loadStores();
      const store = useDraftStore.getState();
      store.activateScope("publishing", false);
      store.setDraft("new.txt", "NEW", "head", null);
      const captured = store.getChangedFiles();
      if (operation === "rename") {
        store.renameDraft("new.txt", "renamed.txt");
      } else {
        store.markDeleted("new.txt");
      }
      if (operation === "switch-scope") {
        store.activateScope("other", false);
        store.setDraft("other.txt", "OTHER", "other-head", null);
      }
      store.acknowledgePublished(captured, "published", "publishing");
      if (operation === "switch-scope") {
        expect(store.getDraft("other.txt")?.content).toBe("OTHER");
        store.activateScope("publishing", true);
      }
      expect(store.getDraft("new.txt")).toMatchObject({
        isDeleted: true,
        headContent: "NEW",
        baselineHeadSha: "published",
      });
      if (operation === "rename") {
        expect(store.getDraft("renamed.txt")).toMatchObject({
          content: "NEW",
          headContent: null,
          baselineHeadSha: "published",
        });
      }
      const reloaded = await loadStores();
      reloaded.useDraftStore.getState().activateScope("publishing", true);
      expect(
        reloaded.useDraftStore.getState().getDraft("new.txt")?.isDeleted
      ).toBe(true);
    }
  );

  it("preserves a reset of an existing captured write", async () => {
    const { useDraftStore } = await loadStores();
    const store = useDraftStore.getState();
    store.activateScope("publishing", false);
    store.setDraft("existing.txt", "NEW", "head", "ORIGINAL");
    const captured = store.getChangedFiles();
    store.discardAll();
    store.acknowledgePublished(captured, "published", "publishing");
    expect(store.getDraft("existing.txt")).toMatchObject({
      content: "ORIGINAL",
      headContent: "NEW",
      isDeleted: false,
    });
  });

  it("preserves restoration of a captured deletion across a scope switch", async () => {
    const { useDraftStore } = await loadStores();
    const store = useDraftStore.getState();
    store.activateScope("publishing", false);
    store.ensureDraft("existing.txt", "ORIGINAL", "head", "ORIGINAL");
    store.markDeleted("existing.txt");
    const captured = store.getChangedFiles();
    store.resetFileToRemote("existing.txt");
    store.activateScope("other", false);
    store.acknowledgePublished(captured, "published", "publishing");
    store.activateScope("publishing", true);
    expect(store.getDraft("existing.txt")).toMatchObject({
      content: "ORIGINAL",
      headContent: null,
      baselineHeadSha: "published",
      isDeleted: false,
    });
  });
  it("removes persisted drafts for the active scope after discardAll", async () => {
    const { useDraftStore, useSourceStore } = await loadStores();
    useSourceStore.getState().setSource({
      type: "pr",
      name: "pr-123",
      sha: "head-sha",
      prNumber: 123,
    });
    useDraftStore.getState().activateScope("repo:pr:123", false);
    useDraftStore
      .getState()
      .setDraft("src/TestBank/formats/a.txt", "local-draft", "base-sha", "A");

    useDraftStore.getState().discardAll();

    expect(
      useDraftStore.getState().getStoredDraftsForScope("repo:pr:123")
    ).toEqual([]);

    const reloaded = await loadStores();
    expect(
      reloaded.useDraftStore.getState().getStoredDraftsForScope("repo:pr:123")
    ).toEqual([]);
  });
});

it("distinguishes an existing empty file from an absent file during deletion", async () => {
  const { useDraftStore } = await loadStores();
  const store = useDraftStore.getState();
  store.activateScope("empty-file-test", false);
  store.ensureDraft("existing.txt", "", "head", "");
  store.markDeleted("existing.txt");
  expect(store.getDraft("existing.txt")?.isDeleted).toBe(true);
  store.setDraft("new.txt", "NEW", "head", null);
  store.markDeleted("new.txt");
  expect(store.getDraft("new.txt")).toBeUndefined();
});

it("persists experiment baseline even without edits and keeps publish scopes separate", async () => {
  const first = await loadStores();
  const scope = "experiment:owner/repo:main";
  const path = "src/Bank/formats/a.txt";
  first.useDraftStore.getState().activateScope(scope);
  first.useDraftStore
    .getState()
    .ensureDraft(path, "original", "commit-A", "original");
  const second = await loadStores();
  second.useDraftStore.getState().activateScope(scope);
  expect(second.useDraftStore.getState().getDraft(path)).toMatchObject({
    content: "original",
    headContent: "original",
    baselineHeadSha: "commit-A",
  });
  second.useDraftStore
    .getState()
    .applyUserEdit(path, "experiment", "commit-A", "original");
  second.useDraftStore.getState().activateScope("owner/repo:pr:7");
  expect(second.useDraftStore.getState().getChangedFiles()).toEqual([]);
  second.useDraftStore.getState().activateScope(scope);
  expect(second.useDraftStore.getState().getDraft(path)?.content).toBe(
    "experiment"
  );
});

it("persists Example source positions and restores them through undo, redo, and scope reload", async () => {
  const { useDraftStore } = await loadStores();
  const store = useDraftStore.getState();
  const baseline =
    "^(.*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nA\n\n-----EXAMPLE-----\nB\n";
  store.activateScope("experiment:owner/repo:main", false);
  store.ensureDraft("examples.txt", baseline, "head", baseline);
  const edit = baseline.replace("\nB\n", "\nlocal\n\n-----EXAMPLE-----\nB\n");
  store.applyUserEdit("examples.txt", edit, "head", baseline);
  expect(
    useDraftStore.getState().getDraft("examples.txt")?.examplePositions
  ).toEqual([1, null, 2]);
  store.undo("examples.txt");
  expect(
    useDraftStore.getState().getDraft("examples.txt")?.examplePositions
  ).toEqual([1, 2]);
  store.redo("examples.txt");
  store.activateScope(null);
  store.activateScope("experiment:owner/repo:main");
  expect(
    useDraftStore.getState().getDraft("examples.txt")?.examplePositions
  ).toEqual([1, null, 2]);
  store.resetFileToRemote("examples.txt");
  expect(
    useDraftStore.getState().getDraft("examples.txt")?.examplePositions
  ).toEqual([1, 2]);
});

it("restores a legacy document without Example metadata and preserves its raw-edit history", async () => {
  const baseline =
    "^(.*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nA\n\n-----EXAMPLE-----\nB\n";
  const content = baseline.replace(
    "\nB\n",
    "\nlocal\n\n-----EXAMPLE-----\nB\n"
  );
  const scope = "experiment:owner/repo:main";
  idbStorage.set(
    "sms-formats-draft-store",
    JSON.stringify({
      version: 1,
      state: {
        storedDraftsByScope: {
          [scope]: {
            "legacy.txt": {
              filePath: "legacy.txt",
              content,
              headContent: baseline,
              baselineHeadSha: "head",
              isDeleted: false,
              timestamp: 1,
            },
          },
        },
        workspaceSessionsByScope: {},
      },
    })
  );
  const { useDraftStore } = await loadStores();
  const store = useDraftStore.getState();
  store.activateScope(scope);
  expect(
    useDraftStore.getState().getDraft("legacy.txt")?.examplePositions
  ).toEqual([1, null, 2]);
  store.applyUserEdit(
    "legacy.txt",
    content.replace("\nB\n", "\nedited B\n"),
    "head",
    baseline
  );
  store.undo("legacy.txt");
  expect(useDraftStore.getState().getDraft("legacy.txt")?.content).toBe(
    content
  );
  expect(
    useDraftStore.getState().getDraft("legacy.txt")?.examplePositions
  ).toEqual([1, null, 2]);
});

it("retains a locally replaced duplicate's identity without adding it to publication", async () => {
  const { useDraftStore } = await loadStores();
  const store = useDraftStore.getState();
  const baseline =
    "^(.*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nA\n";
  store.activateScope("owner/repo:pr:1", false);
  store.ensureDraft("same.txt", baseline, "head", baseline);
  store.applyUserEdit("same.txt", baseline, "head", baseline, [null]);
  store.activateScope(null);
  store.activateScope("owner/repo:pr:1");
  expect(
    useDraftStore.getState().getDraft("same.txt")?.examplePositions
  ).toEqual([null]);
  expect(useDraftStore.getState().getChangedFiles()).toEqual([]);
});

it.each([
  {
    publishedExamples: ["A", "B", "C", "X"],
    publishedPositions: [1, 2, 3, null],
    lateExamples: ["A", "edited B", "C", "X"],
    expected: [1, 2, 3, 4],
    previous: [1, 2, 3],
  },
  {
    publishedExamples: ["A", "X", "B", "C"],
    publishedPositions: [1, null, 2, 3],
    lateExamples: ["A", "X", "edited B", "C"],
    expected: [1, 2, 3, 4],
    previous: [1, 3, 4],
  },
  {
    publishedExamples: ["A", "C"],
    publishedPositions: [1, 3],
    lateExamples: ["edited A", "C"],
    expected: [1, 2],
    previous: [1, null, 2],
  },
])(
  "reassigns published Example positions in late edits, undo/redo, and reload (%j)",
  async ({
    publishedExamples,
    publishedPositions,
    lateExamples,
    expected,
    previous,
  }) => {
    const { useDraftStore } = await loadStores();
    const store = useDraftStore.getState();
    const format = (examples: readonly string[]) =>
      `^(.*)$\n\n-----COLUMNS-----\ncomment\n${examples.map((text) => `\n-----EXAMPLE-----\n${text}\n`).join("")}`;
    const baseline = format(["A", "B", "C"]);
    const published = format(publishedExamples);
    const late = format(lateExamples);
    store.activateScope("publish-positions", false);
    store.ensureDraft("examples.txt", baseline, "old-head", baseline);
    store.applyUserEdit("examples.txt", published, "old-head", baseline, [
      ...publishedPositions,
    ]);
    const captured = store.getChangedFiles();
    store.applyUserEdit("examples.txt", late, "old-head", baseline, [
      ...publishedPositions,
    ]);
    store.acknowledgePublished(captured, "published-head", "publish-positions");
    expect(store.getDraft("examples.txt")).toMatchObject({
      content: late,
      headContent: published,
      baselineHeadSha: "published-head",
      examplePositions: expected,
    });
    store.undo("examples.txt");
    expect(store.getDraft("examples.txt")?.content).toBe(published);
    expect(store.getDraft("examples.txt")?.examplePositions).toEqual(
      publishedExamples.map((_, index) => index + 1)
    );
    store.undo("examples.txt");
    expect(store.getDraft("examples.txt")?.content).toBe(baseline);
    expect(store.getDraft("examples.txt")?.examplePositions).toEqual([
      ...previous,
    ]);
    store.redo("examples.txt");
    store.redo("examples.txt");
    expect(store.getDraft("examples.txt")?.examplePositions).toEqual([
      ...expected,
    ]);
    const reloaded = await loadStores();
    reloaded.useDraftStore.getState().activateScope("publish-positions");
    expect(
      reloaded.useDraftStore.getState().getDraft("examples.txt")
    ).toMatchObject({
      content: late,
      headContent: published,
      examplePositions: expected,
    });
  }
);

it("reassigns an inactive publication scope without changing another scope's document or history", async () => {
  const { useDraftStore } = await loadStores();
  const store = useDraftStore.getState();
  const baseline =
    "^(.*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nA\n";
  const published = `${baseline}\n-----EXAMPLE-----\nX\n`;
  store.activateScope("publishing", false);
  store.ensureDraft("same.txt", baseline, "old", baseline);
  store.applyUserEdit("same.txt", published, "old", baseline, [1, null]);
  const captured = store.getChangedFiles();
  store.applyUserEdit(
    "same.txt",
    published.replace("\nX\n", "\nedited X\n"),
    "old",
    baseline,
    [1, null]
  );
  store.activateScope("other", false);
  store.ensureDraft("same.txt", baseline, "other", baseline);
  store.applyUserEdit(
    "same.txt",
    baseline.replace("\nA\n", "\nother A\n"),
    "other",
    baseline,
    [1]
  );
  store.acknowledgePublished(captured, "published", "publishing");
  expect(store.getDraft("same.txt")?.examplePositions).toEqual([1]);
  store.undo("same.txt");
  expect(store.getDraft("same.txt")?.content).toBe(baseline);
  store.redo("same.txt");
  expect(store.getDraft("same.txt")?.content).toContain("other A");
  store.activateScope("publishing");
  expect(store.getDraft("same.txt")).toMatchObject({
    examplePositions: [1, 2],
    headContent: published,
    baselineHeadSha: "published",
  });
});

it("keeps the undo cursor and future redo steps when publication finishes after an undo", async () => {
  const { useDraftStore } = await loadStores();
  const store = useDraftStore.getState();
  const baseline =
    "^(.*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nA\n";
  const published = `${baseline}\n-----EXAMPLE-----\nX\n`;
  const late = published.replace("\nX\n", "\nedited X\n");
  store.activateScope("cursor", false);
  store.ensureDraft("a.txt", baseline, "old", baseline);
  store.applyUserEdit("a.txt", published, "old", baseline, [1, null]);
  const captured = store.getChangedFiles();
  store.applyUserEdit("a.txt", late, "old", baseline, [1, null]);
  store.undo("a.txt");
  store.undo("a.txt");
  store.acknowledgePublished(captured, "published", "cursor");
  expect(store.getDraft("a.txt")).toMatchObject({
    content: baseline,
    headContent: published,
    examplePositions: [1],
  });
  expect(store.canUndo("a.txt")).toBe(false);
  expect(store.canRedo("a.txt")).toBe(true);
  store.redo("a.txt");
  expect(store.getDraft("a.txt")).toMatchObject({
    content: published,
    examplePositions: [1, 2],
  });
  store.redo("a.txt");
  expect(store.getDraft("a.txt")).toMatchObject({
    content: late,
    examplePositions: [1, 2],
  });
});

it("does not restore a locally replaced source Example's identity when acknowledging a late edit", async () => {
  const { useDraftStore } = await loadStores();
  const store = useDraftStore.getState();
  const baseline =
    "^(.*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nA\n";
  const published = `${baseline}\n-----EXAMPLE-----\nX\n`;
  store.activateScope("replacement", false);
  store.ensureDraft("a.txt", baseline, "old", baseline);
  store.applyUserEdit("a.txt", published, "old", baseline, [1, null]);
  const captured = store.getChangedFiles();
  store.applyUserEdit("a.txt", published, "old", baseline, [null, null]);
  store.acknowledgePublished(captured, "published", "replacement");
  expect(store.getDraft("a.txt")?.examplePositions).toEqual([null, 2]);
  store.undo("a.txt");
  expect(store.getDraft("a.txt")?.examplePositions).toEqual([1, 2]);
  store.redo("a.txt");
  expect(store.getDraft("a.txt")?.examplePositions).toEqual([null, 2]);
});

it("retains metadata-only undo steps that become equal after a source Example is published as deleted", async () => {
  const { useDraftStore } = await loadStores();
  const store = useDraftStore.getState();
  const published =
    "^(.*)$\n\n-----COLUMNS-----\ncomment\n\n-----EXAMPLE-----\nA\n";
  const baseline = `${published}\n-----EXAMPLE-----\nB\n`;
  const late = published.replace("\nA\n", "\nedited A\n");
  store.activateScope("equal-steps", false);
  store.ensureDraft("a.txt", baseline, "old", baseline);
  store.applyUserEdit("a.txt", baseline, "old", baseline, [1, null]);
  store.applyUserEdit("a.txt", published, "old", baseline, [1]);
  const captured = store.getChangedFiles();
  store.applyUserEdit("a.txt", late, "old", baseline, [1]);
  store.acknowledgePublished(captured, "published", "equal-steps");
  store.undo("a.txt");
  expect(store.getDraft("a.txt")?.content).toBe(published);
  store.undo("a.txt");
  expect(store.getDraft("a.txt")).toMatchObject({
    content: baseline,
    examplePositions: [1, null],
  });
  expect(store.canUndo("a.txt")).toBe(true);
  store.undo("a.txt");
  expect(store.getDraft("a.txt")).toMatchObject({
    content: baseline,
    examplePositions: [1, null],
  });
  expect(store.canUndo("a.txt")).toBe(false);
  store.redo("a.txt");
  store.redo("a.txt");
  store.redo("a.txt");
  expect(store.getDraft("a.txt")).toMatchObject({
    content: late,
    examplePositions: [1],
  });
});
