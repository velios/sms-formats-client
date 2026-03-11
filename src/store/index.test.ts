import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("./persistence", () => ({
  clearDrafts: vi.fn(),
  deleteDraft: vi.fn(),
  loadAllDrafts: vi.fn(),
  saveDraft: vi.fn(),
}));

import { loadAllDrafts } from "./persistence";

let useDraftStore: Awaited<typeof import("./index")>["useDraftStore"];

describe("draft store restoreFromDB", () => {
  beforeAll(async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    ({ useDraftStore } = await import("./index"));
  });

  beforeEach(() => {
    useDraftStore.getState().clearAll();
    vi.mocked(loadAllDrafts).mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("restores persisted content over a clean in-memory placeholder", async () => {
    useDraftStore.setState({
      drafts: new Map([
        [
          "src/TestBank/formats/a.txt",
          {
            filePath: "src/TestBank/formats/a.txt",
            baseSha: "base-sha",
            baseHeadSha: "head-sha",
            content: "remote-content",
            remoteContent: "remote-content",
            isDeleted: false,
            timestamp: 1,
          },
        ],
      ]),
    });
    vi.mocked(loadAllDrafts).mockResolvedValue([
      {
        sourceRef: "repo:pr:123",
        bankPath: "src/TestBank",
        filePath: "src/TestBank/formats/a.txt",
        baseSha: "base-sha",
        baseHeadSha: "head-sha",
        content: "local-draft",
        isDeleted: false,
        timestamp: 2,
      },
    ]);

    await useDraftStore.getState().restoreFromDB("repo:pr:123");

    expect(
      useDraftStore.getState().getDraft("src/TestBank/formats/a.txt")
    ).toMatchObject({
      filePath: "src/TestBank/formats/a.txt",
      baseSha: "base-sha",
      baseHeadSha: "head-sha",
      content: "local-draft",
      remoteContent: "remote-content",
      isDeleted: false,
      timestamp: 2,
    });
  });
});
