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
