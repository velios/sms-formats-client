import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_STORE_STORAGE_KEY } from "./persistence";
import { hardResetAppState } from "./hard-reset";

const idbStorage = vi.hoisted(() => new Map<string, string>());

vi.mock("idb-keyval", () => ({
  del: vi.fn(async (key: string) => {
    idbStorage.delete(String(key));
  }),
}));

function createLocalStorageMock(state: Map<string, string>) {
  return {
    get length() {
      return state.size;
    },
    getItem: (key: string) => state.get(key) ?? null,
    key: (index: number) => Array.from(state.keys())[index] ?? null,
    removeItem: (key: string) => {
      state.delete(key);
    },
    setItem: (key: string, value: string) => {
      state.set(key, value);
    },
  };
}

describe("hardResetAppState", () => {
  let localStorageState: Map<string, string>;
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    idbStorage.clear();
    localStorageState = new Map<string, string>([
      ["sms-formats-github-user-token", "ghp_saved"],
      ["sms-formats-lang", "en"],
      ["sms-formats-pr-approval-permissions", '{"zenmoney/sms-formats":{"canApprove":true}}'],
      ["sms-formats-recent-formats", '{"src/TBank_123":["src/TBank_123/formats/a.txt"]}'],
      ["sms-formats-workspace-session", '{"prNumber":123}'],
      ["unrelated-key", "keep-me"],
    ]);
    idbStorage.set(DRAFT_STORE_STORAGE_KEY, '{"state":"drafts"}');
    vi.stubGlobal("localStorage", createLocalStorageMock(localStorageState));
    reloadMock = vi.fn();
    vi.stubGlobal("location", {
      reload: reloadMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears app state except the GitHub token and reloads the page", async () => {
    await hardResetAppState();

    expect(localStorageState.get("sms-formats-github-user-token")).toBe(
      "ghp_saved"
    );
    expect(localStorageState.has("sms-formats-lang")).toBe(false);
    expect(
      localStorageState.has("sms-formats-pr-approval-permissions")
    ).toBe(false);
    expect(localStorageState.has("sms-formats-recent-formats")).toBe(false);
    expect(localStorageState.has("sms-formats-workspace-session")).toBe(false);
    expect(localStorageState.get("unrelated-key")).toBe("keep-me");
    expect(idbStorage.has(DRAFT_STORE_STORAGE_KEY)).toBe(false);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
