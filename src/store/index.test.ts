import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const idbStorage = vi.hoisted(() => new Map<string, string>());

vi.mock("idb-keyval", () => ({
  del: vi.fn(async (key: string) => {
    idbStorage.delete(String(key));
  }),
  get: vi.fn(async (key: string) => idbStorage.get(String(key)) ?? null),
  keys: vi.fn(async () => Array.from(idbStorage.keys())),
  set: vi.fn(async (key: string, value: string) => {
    idbStorage.set(String(key), value);
  }),
}));

async function loadStores() {
  const mod = await import("./index");
  await mod.waitForDraftStoreHydration();
  return mod;
}

describe("draft store persist", () => {
  beforeEach(() => {
    vi.resetModules();
    idbStorage.clear();
    const localStorageState = new Map<string, string>();
    vi.stubGlobal("localStorage", {
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
    vi.unstubAllGlobals();
  });

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
        remoteContent: "remote-content",
      },
    ]);

    vi.resetModules();
    const secondLoad = await loadStores();

    expect(
      secondLoad.useDraftStore.getState().getStoredDraftsForScope("repo:pr:123")
    ).toMatchObject([
      {
        filePath: "src/TestBank/formats/a.txt",
        content: "local-draft",
        remoteContent: "remote-content",
      },
    ]);

    secondLoad.useDraftStore.getState().activateScope("repo:pr:123", true);

    expect(
      secondLoad.useDraftStore.getState().getDraft("src/TestBank/formats/a.txt")
    ).toMatchObject({
      filePath: "src/TestBank/formats/a.txt",
      content: "local-draft",
      remoteContent: "remote-content",
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

    vi.resetModules();
    const reloaded = await loadStores();
    expect(
      reloaded.useDraftStore.getState().getStoredDraftsForScope("repo:pr:123")
    ).toEqual([]);
  });
});
