import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore, waitForDraftStoreHydration } from "@/store";
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
  type WorkspaceSession,
} from "./workspace-session";

vi.hoisted(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
});
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("idb-keyval", () => ({
  get: vi.fn(async (key: string) => storage.get(key)),
  set: vi.fn(async (key: string, value: string) => {
    storage.set(key, value);
  }),
  del: vi.fn(),
}));
const repository = { owner: "zenmoney", repo: "sms-formats" };
const session: WorkspaceSession = {
  status: "supported",
  repository,
  prNumber: 123,
  headSha: "head",
  baseSha: "base",
  bankPath: "src/Bank",
  writable: true,
  readOnlyReason: null,
  changedFiles: [{ kind: "modify", path: "src/Bank/formats/a.txt" }],
};

describe("saved workspace revisions", () => {
  beforeEach(async () => {
    await waitForDraftStoreHydration();
    useDraftStore.setState({
      workspaceSessionsByScope: {},
      storedDraftsByScope: {},
      drafts: new Map(),
      draftScopeKey: null,
    });
  });
  it("retains independent sessions by repository and PR", () => {
    saveWorkspaceSession({ session });
    saveWorkspaceSession({
      session: { ...session, prNumber: 456, headSha: "other-head" },
    });
    saveWorkspaceSession({
      session: {
        ...session,
        repository: { ...repository, owner: "other" },
        headSha: "other-repo",
      },
    });
    expect(loadWorkspaceSession(repository, 123)).toEqual({ session });
    expect(loadWorkspaceSession(repository, 456)?.session.headSha).toBe(
      "other-head"
    );
  });
  it("restores committed SHA and late drafts together from persisted data", async () => {
    useDraftStore.getState().activateScope("zenmoney/sms-formats:pr:123", true);
    saveWorkspaceSession({ session, pendingPublishedHeadSha: "published" });
    useDraftStore
      .getState()
      .setDraft("src/Bank/formats/a.txt", "later", "published", "committed");
    const record = storage.get("sms-formats-draft-store");
    expect(record).toBeDefined();
    useDraftStore.setState({
      workspaceSessionsByScope: {},
      storedDraftsByScope: {},
    });
    storage.set("sms-formats-draft-store", record ?? "");
    await useDraftStore.persist.rehydrate();
    expect(loadWorkspaceSession(repository, 123)?.pendingPublishedHeadSha).toBe(
      "published"
    );
    expect(
      useDraftStore
        .getState()
        .getStoredDraftsForScope("zenmoney/sms-formats:pr:123")[0]
    ).toMatchObject({
      content: "later",
      baselineHeadSha: "published",
      headContent: "committed",
    });
  });
  it("rejects malformed or mismatched persisted metadata without removing drafts", () => {
    useDraftStore.getState().activateScope("zenmoney/sms-formats:pr:123", true);
    useDraftStore
      .getState()
      .setDraft("src/Bank/formats/a.txt", "edited", "head", "original");
    useDraftStore
      .getState()
      .saveWorkspaceSession("zenmoney/sms-formats:pr:123", {
        session: { ...session, prNumber: 456 },
      });
    expect(loadWorkspaceSession(repository, 123)).toBeNull();
    expect(useDraftStore.getState().getChangedFiles()).toHaveLength(1);
  });
});
